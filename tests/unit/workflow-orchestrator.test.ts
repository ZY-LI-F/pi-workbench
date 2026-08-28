// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PiCommand, PiResponse, RuntimeSignal } from "../../src/shared/contracts";
import { EMPTY_BOARD_STATE, parseBoardState, type BoardBridgeEvent, type BoardState } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { BoardService } from "../../src/main/board-service";
import type { BoardRepository } from "../../src/main/board-repository";
import { ExecutionBackendRegistry } from "../../src/main/execution-backend-registry";
import {
  PiRpcExecutionAdapter,
  type PiRpcExecutionRuntime,
  type PiRpcExecutionRuntimeFactory,
} from "../../src/main/execution-adapters/pi-rpc-execution-adapter";
import { WorkflowOrchestrator } from "../../src/main/workflow-orchestrator";
import { WorkspaceAdmission } from "../../src/main/workspace-admission";
import { CurrentFolderExecutionWorkspace } from "../../src/main/execution-workspace";
import { READY_AGENT_SKILLS, TEST_COORDINATOR_EXTENSION } from "./test-doubles";

class MemoryRepository implements BoardRepository {
  state: BoardState = EMPTY_BOARD_STATE;
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

class HoldUpdateRepository extends MemoryRepository {
  #hold?: { readonly matches: (next: BoardState) => boolean; readonly release: Promise<void>; readonly onHeld: () => void };

  holdNextMatching(matches: (next: BoardState) => boolean, release: Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      this.#hold = { matches, release, onHeld: resolve };
    });
  }

  override async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    const hold = this.#hold;
    if (hold && hold.matches(transform(this.state))) {
      this.#hold = undefined;
      hold.onHeld();
      await hold.release;
    }
    return super.update(transform);
  }
}

class FakeRuntime implements PiRpcExecutionRuntime {
  running = false;
  readonly commands: PiCommand[] = [];
  readonly start = vi.fn(async () => { await this.startBehavior(); this.running = true; });
  readonly stop = vi.fn(async () => { this.running = false; });
  readonly abortAndStop = vi.fn(async () => {
    this.running = false;
    this.abortBehavior();
  });

  constructor(
    readonly callbacks: { readonly emitPiEvent: (event: unknown) => void; readonly emitRuntimeSignal: (signal: RuntimeSignal) => void },
    readonly output: string = "步骤产物",
    readonly startBehavior: () => Promise<void> = async () => undefined,
    readonly abortBehavior: () => void = () => undefined,
  ) {}

  async send(command: PiCommand): Promise<PiResponse> {
    this.commands.push(command);
    if (command.type === "get_last_assistant_text") return { id: "1", type: "response", command: "get_last_assistant_text", success: true, data: { text: this.output } };
    if (command.type === "get_state") return { id: "2", type: "response", command: "get_state", success: true, data: { thinkingLevel: "off", isStreaming: false, isCompacting: false, steeringMode: "all", followUpMode: "all", sessionFile: "C:/session.jsonl", sessionId: "session", autoCompactionEnabled: true, messageCount: 2, pendingMessageCount: 0 } };
    if (command.type === "get_session_stats") return { id: "3", type: "response", command: "get_session_stats", success: true, data: { sessionFile: "C:/session.jsonl", sessionId: "session", userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 }, cost: 0.01 } };
    if (command.type === "get_messages") return { id: "4", type: "response", command: "get_messages", success: true, data: { messages: [{ role: "assistant", stopReason: "stop", content: [], provider: "test", model: "test", timestamp: 1 }] } };
    if (command.type === "prompt") return { id: "5", type: "response", command: "prompt", success: true };
    throw new Error(`FakeRuntime 没有实现命令 ${command.type}`);
  }

  settle(): void { this.callbacks.emitPiEvent({ type: "agent_settled" }); }
  exit(): void { this.callbacks.emitRuntimeSignal({ type: "runtime_exit", code: 1, signal: null }); }
}

class FakeRuntimeFactory implements PiRpcExecutionRuntimeFactory {
  readonly runtimes: FakeRuntime[] = [];
  constructor(
    readonly startBehavior: () => Promise<void> = async () => undefined,
    readonly abortBehavior: () => void = () => undefined,
  ) {}
  create(callbacks: ConstructorParameters<typeof FakeRuntime>[0]): PiRpcExecutionRuntime {
    const runtime = new FakeRuntime(callbacks, "步骤产物", this.startBehavior, this.abortBehavior);
    this.runtimes.push(runtime);
    return runtime;
  }
}

function backendRegistry(
  runtimeFactory: PiRpcExecutionRuntimeFactory,
  globalModel: () => Readonly<{ readonly provider: string; readonly model: string }> | undefined,
): ExecutionBackendRegistry {
  return new ExecutionBackendRegistry({
    backends: [new PiRpcExecutionAdapter({
      runtimeFactory,
      globalModel,
      coordinatorExtensionPath: TEST_COORDINATOR_EXTENSION,
      skills: READY_AGENT_SKILLS,
      backendVersion: () => "test-pi-1.0.0",
      now: () => "2026-07-17T00:00:00.000Z",
    })],
    now: () => "2026-07-17T00:00:00.000Z",
  });
}

function idFactory(): () => string {
  let value = 0;
  return () => `id-${++value}`;
}

async function setup(
  runtimeFactory = new FakeRuntimeFactory(),
  globalModel: () => Readonly<{ readonly provider: string; readonly model: string }> | undefined = () => undefined,
  repository = new MemoryRepository(),
  resolveProjectPath: (projectPath: string, trusted: boolean) => Promise<string> = async (projectPath) => projectPath,
  resolveProjectTrust: (projectPath: string) => Promise<boolean> = async () => true,
) {
  const events: BoardBridgeEvent[] = [];
  const admission = new WorkspaceAdmission({ canonicalize: async (path) => path.toLocaleLowerCase("en-US") });
  const workspace = new CurrentFolderExecutionWorkspace({ admission, resolveProjectTrust, resolveProjectPath });
  const id = idFactory();
  const service = new BoardService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, projectIdentity: (path) => path.toLocaleLowerCase(), id, now: () => "2026-07-17T00:00:00.000Z" });
  await service.createTask({
    title: "实现固定流程", description: "真实执行", acceptanceCriteria: "经过人工关卡", priority: "high",
    projectPath: "C:/project", projectName: "project", trusted: true,
    executionTarget: { kind: "workflow", workflowId: "feature-delivery" },
  });
  const taskId = repository.state.tasks[0]?.id;
  if (!taskId) throw new Error("测试任务未创建");
  const orchestrator = new WorkflowOrchestrator({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    backendRegistry: backendRegistry(runtimeFactory, globalModel),
    emitBoardEvent: (event) => events.push(event),
    workspace,
    id,
    now: () => "2026-07-17T00:00:00.000Z",
  });
  return { repository, runtimeFactory, events, orchestrator, admission, taskId };
}

describe("WorkflowOrchestrator", () => {
  it("inherits the application model for workflow Agents without overrides", async () => {
    const runtimeFactory = new FakeRuntimeFactory();
    const { orchestrator, taskId } = await setup(
      runtimeFactory,
      () => Object.freeze({ provider: "openai", model: "gpt-global" }),
    );

    await orchestrator.dispatch(taskId);

    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.start).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      model: "gpt-global",
    })));
  });

  it("rejects dispatch before queuing when project identity verification fails", async () => {
    const runtimeFactory = new FakeRuntimeFactory();
    const resolveProjectPath = vi.fn(async () => { throw new Error("受信任项目路径的真实位置已变化"); });
    const { repository, orchestrator, taskId } = await setup(
      runtimeFactory,
      () => undefined,
      new MemoryRepository(),
      resolveProjectPath,
    );

    await expect(orchestrator.dispatch(taskId)).rejects.toThrow("受信任项目路径的真实位置已变化");
    expect(resolveProjectPath).toHaveBeenCalledWith("C:/project", true);
    expect(runtimeFactory.runtimes).toHaveLength(0);
    expect(repository.state.runs).toHaveLength(0);
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("planned");
  });

  it("starts workflow Agents with the live trust decision rather than the saved Task flag", async () => {
    const runtimeFactory = new FakeRuntimeFactory();
    const resolveProjectPath = vi.fn(async (projectPath: string) => projectPath);
    const { orchestrator, taskId } = await setup(
      runtimeFactory,
      () => undefined,
      new MemoryRepository(),
      resolveProjectPath,
      async () => false,
    );

    await orchestrator.dispatch(taskId);

    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.start).toHaveBeenCalledWith(expect.objectContaining({ trusted: false })));
    expect(resolveProjectPath).toHaveBeenCalledWith("C:/project", false);
  });

  it("runs isolated Agents in order and pauses at the plan gate", async () => {
    const { repository, runtimeFactory, orchestrator, taskId } = await setup();
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));
    expect(repository.state.runs[0]?.workspacePlacement).toMatchObject({
      strategy: "current-folder",
      projectPath: "C:/project",
      cwd: "C:/project",
      ownership: "project",
      lifecycle: "retained",
    });

    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    expect(repository.state.runs[0]?.steps[0]?.status).toBe("succeeded");
    expect(repository.state.runs[0]?.steps[0]).toMatchObject({
      backendVersion: "test-pi-1.0.0",
      session: { backendId: "pi", sessionId: "session", sessionPath: "C:/session.jsonl" },
      artifact: { inputTokens: 10, outputTokens: 20, cost: 0.01 },
    });

    runtimeFactory.runtimes[1]?.settle();
    await vi.waitFor(() => expect(repository.state.runs[0]?.status).toBe("review"));
    expect(repository.state.tasks[0]?.stage).toBe("review");
    expect(repository.state.runs[0]?.currentStepId).toBe("approve-plan");

    const gateRun = repository.state.runs[0];
    const gateStep = gateRun?.steps.find((step) => step.stepId === gateRun.currentStepId);
    if (!gateRun || !gateStep) throw new Error("测试缺少等待中的人工关卡");
    await expect(orchestrator.resolveGate({ taskId, runId: "stale-run", stepId: gateStep.id, decision: "approve", comment: "旧决定" }))
      .rejects.toThrow("execution 已变化");
    await expect(orchestrator.resolveGate({ taskId, runId: gateRun.id, stepId: "stale-step", decision: "approve", comment: "旧决定" }))
      .rejects.toThrow("步骤已变化");

    await orchestrator.resolveGate({ taskId, runId: gateRun.id, stepId: gateStep.id, decision: "approve", comment: "方案通过" });
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(3));
    await vi.waitFor(() => expect(runtimeFactory.runtimes[2]?.start).toHaveBeenCalledWith(expect.objectContaining({
      allowedTools: expect.arrayContaining(["edit", "write"]),
    })));
  });

  it("ignores settled and exit events from a previous step Runtime", async () => {
    const { repository, runtimeFactory, orchestrator, taskId } = await setup();
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));
    const firstRuntime = runtimeFactory.runtimes[0];
    firstRuntime?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    const secondRuntime = runtimeFactory.runtimes[1];
    await vi.waitFor(() => expect(secondRuntime?.commands.some((command) => command.type === "prompt")).toBe(true));

    firstRuntime?.settle();
    firstRuntime?.exit();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(secondRuntime?.stop).not.toHaveBeenCalled();
    expect(secondRuntime?.running).toBe(true);
    expect(repository.state.runs[0]?.status).toBe("running");
    expect(repository.state.runs[0]?.steps[1]).toMatchObject({ status: "running" });
  });

  it("records an explicit interruption when the user aborts", async () => {
    const { repository, runtimeFactory, orchestrator, taskId } = await setup();
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    const activeRunId = repository.state.tasks[0]?.activeRunId;
    if (!activeRunId) throw new Error("测试缺少 active Workflow run");
    await expect(orchestrator.abort(taskId, "stale-run")).rejects.toThrow("execution 已变化");
    expect(runtimeFactory.runtimes[0]?.abortAndStop).not.toHaveBeenCalled();
    await orchestrator.abort(taskId, activeRunId);
    expect(repository.state.tasks[0]?.stage).toBe("blocked");
    expect(repository.state.tasks[0]?.activeRunId).toBeUndefined();
    expect(repository.state.runs[0]?.status).toBe("interrupted");
    expect(repository.state.activities.at(-1)?.summary).toContain("中止");
  });

  it("does not send a prompt when abort wins a runtime-start race", async () => {
    let releaseStart: (() => void) | undefined;
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
    const runtimeFactory = new FakeRuntimeFactory(() => startGate, () => releaseStart?.());
    const { repository, orchestrator, taskId } = await setup(runtimeFactory);
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.start).toHaveBeenCalledOnce());
    await orchestrator.abort(taskId);
    releaseStart?.();
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.abortAndStop).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.stop).toHaveBeenCalledOnce());
    expect(runtimeFactory.runtimes[0]?.running).toBe(false);
    expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(false);
    expect(repository.state.tasks[0]?.stage).toBe("blocked");
  });

  it("keeps abort terminal when a late Agent settlement arrives", async () => {
    const { repository, runtimeFactory, orchestrator, taskId } = await setup();
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));
    const runtime = runtimeFactory.runtimes[0];
    await orchestrator.abort(taskId);
    runtime?.settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.state.tasks[0]?.stage).toBe("blocked");
    expect(repository.state.runs[0]?.status).toBe("interrupted");
    expect(repository.state.runs[0]?.steps[0]?.artifact).toBeUndefined();
  });

  it("does not resurrect an interrupted run when a pending gate commit lands late", async () => {
    const repository = new HoldUpdateRepository();
    const runtimeFactory = new FakeRuntimeFactory();
    const { orchestrator, taskId } = await setup(runtimeFactory, () => undefined, repository);
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));
    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes[1]?.commands.some((command) => command.type === "prompt")).toBe(true));

    let releaseGateCommit: (() => void) | undefined;
    const held = repository.holdNextMatching(
      (next) => next.runs[0]?.status === "review",
      new Promise<void>((resolve) => { releaseGateCommit = resolve; }),
    );
    runtimeFactory.runtimes[1]?.settle();
    await held;
    await orchestrator.abort(taskId);
    releaseGateCommit?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(repository.state.runs[0]?.status).toBe("interrupted");
    expect(repository.state.tasks[0]?.stage).toBe("blocked");
    expect(repository.state.tasks[0]?.activeRunId).toBeUndefined();
    expect(repository.state.runs[0]?.currentStepId).toBeUndefined();
    expect(repository.state.runs[0]?.steps.every((step) => step.status !== "waiting")).toBe(true);
  });

  it("persists interruption before stopping active runtimes during shutdown", async () => {
    const { repository, runtimeFactory, orchestrator, taskId } = await setup();
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));
    await orchestrator.shutdown();
    expect(repository.state.tasks[0]?.stage).toBe("blocked");
    expect(repository.state.runs[0]?.status).toBe("interrupted");
    expect(runtimeFactory.runtimes[0]?.abortAndStop).toHaveBeenCalled();
  });
});
