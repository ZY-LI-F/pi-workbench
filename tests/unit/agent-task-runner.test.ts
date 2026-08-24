// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PiCommand, PiResponse, RuntimeSignal } from "../../src/shared/contracts";
import { EMPTY_BOARD_STATE, parseBoardState, type BoardState, type ExecutionTarget } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { DEFAULT_SQUAD_LEADER_INSTRUCTIONS, LEGACY_SQUAD_LEADER_INSTRUCTIONS } from "../../src/shared/coordinator-protocol";
import { AgentTaskRunner } from "../../src/main/agent-task-runner";
import { ExecutionBackendRegistry } from "../../src/main/execution-backend-registry";
import {
  ExecutionProtocolError,
  type ExecutionBackend,
  type ExecutionEvent,
  type ExecutionOutcome,
  type ExecutionRequest,
} from "../../src/main/execution-backend";
import { PiRpcExecutionAdapter, type PiRpcExecutionRuntime as AgentTaskRuntime, type PiRpcExecutionRuntimeFactory as AgentTaskRuntimeFactory } from "../../src/main/execution-adapters/pi-rpc-execution-adapter";
import { AgentTaskService } from "../../src/main/agent-task-service";
import { BoardService } from "../../src/main/board-service";
import type { BoardRepository } from "../../src/main/board-repository";
import { SquadService } from "../../src/main/squad-service";
import { WorkspaceAdmission } from "../../src/main/workspace-admission";
import { READY_AGENT_SKILLS, TEST_COORDINATOR_EXTENSION } from "./test-doubles";
import type { ExecutionBackendHealth, ExecutionProfileId } from "../../src/shared/execution-profile";

class MemoryRepository implements BoardRepository {
  state: BoardState = EMPTY_BOARD_STATE;
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

class FakeAgentRuntime implements AgentTaskRuntime {
  running = false;
  readonly commands: PiCommand[] = [];
  readonly start = vi.fn(async () => { await this.startBehavior(); this.running = true; });
  readonly stop = vi.fn(async () => { this.running = false; });
  readonly abortAndStop = vi.fn(async () => { this.running = false; });

  constructor(
    readonly callbacks: { readonly emitPiEvent: (event: unknown) => void; readonly emitRuntimeSignal: (signal: RuntimeSignal) => void },
    readonly output: string,
    readonly startBehavior: () => Promise<void>,
  ) {}

  async send(command: PiCommand): Promise<PiResponse> {
    this.commands.push(command);
    if (command.type === "get_last_assistant_text") return { id: "1", type: "response", command: command.type, success: true, data: { text: this.output } };
    if (command.type === "get_state") return { id: "2", type: "response", command: command.type, success: true, data: { thinkingLevel: "off", isStreaming: false, isCompacting: false, steeringMode: "all", followUpMode: "all", sessionFile: "C:/agent-task.jsonl", sessionId: "session", autoCompactionEnabled: true, messageCount: 2, pendingMessageCount: 0 } };
    if (command.type === "get_session_stats") return { id: "3", type: "response", command: command.type, success: true, data: { sessionFile: "C:/agent-task.jsonl", sessionId: "session", userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 12, output: 34, cacheRead: 0, cacheWrite: 0, total: 46 }, cost: 0.02 } };
    if (command.type === "get_messages") {
      let details: unknown;
      try { details = JSON.parse(this.output); } catch { details = undefined; }
      const messages = details && typeof details === "object" && "action" in details
        ? [{ role: "assistant", stopReason: "toolUse", content: [], provider: "test", model: "test", timestamp: 1 }, { role: "toolResult", toolName: "coordinator_action", isError: false, details }]
        : [{ role: "assistant", stopReason: "stop", content: [], provider: "test", model: "test", timestamp: 1 }];
      return { id: "4", type: "response", command: command.type, success: true, data: { messages } };
    }
    if (command.type === "prompt") return { id: "5", type: "response", command: command.type, success: true };
    throw new Error(`FakeAgentRuntime 没有实现命令 ${command.type}`);
  }

  settle(): void { this.callbacks.emitPiEvent({ type: "agent_settled" }); }
  exit(): void { this.callbacks.emitRuntimeSignal({ type: "runtime_exit", code: 1, signal: null }); }
}

class FakeAgentRuntimeFactory implements AgentTaskRuntimeFactory {
  readonly runtimes: FakeAgentRuntime[] = [];
  constructor(
    readonly output: string | readonly string[] = "真实 Agent 产物",
    readonly startBehavior: () => Promise<void> = async () => undefined,
  ) {}
  create(callbacks: ConstructorParameters<typeof FakeAgentRuntime>[0]): AgentTaskRuntime {
    const index = this.runtimes.length;
    const output = typeof this.output === "string" ? this.output : this.output[index] ?? this.output.at(-1) ?? "结果";
    const runtime = new FakeAgentRuntime(callbacks, output, this.startBehavior);
    this.runtimes.push(runtime);
    return runtime;
  }
}

class ProtocolFailingCodexBackend implements ExecutionBackend {
  readonly backendId = "codex" as const;

  async probe(): Promise<ExecutionBackendHealth> {
    return Object.freeze({
      backendId: "codex",
      state: "ready",
      authState: "ready",
      version: "codex-cli 7.6.5",
      updatedAt: "2026-07-18T00:00:00.000Z",
    });
  }

  async run(_request: ExecutionRequest, _emit: (event: ExecutionEvent) => void, _signal: AbortSignal): Promise<ExecutionOutcome> {
    throw new ExecutionProtocolError({
      message: "Codex JSONL 缺少 turn.completed 终态",
      output: "已完成文件分析，但终态丢失",
      session: { backendId: "codex", sessionId: "thread-partial" },
      usage: { inputTokens: 45, outputTokens: 67 },
      backendVersion: "codex-cli 7.6.5",
    });
  }

  async openSession(): Promise<never> {
    throw new Error("not used");
  }
}

function idFactory(): () => string {
  let value = 0;
  return () => `id-${String(++value).padStart(3, "0")}`;
}

function backendRegistry(
  runtimeFactory: AgentTaskRuntimeFactory,
  globalModel: () => Readonly<{ readonly provider: string; readonly model: string }> | undefined = () => undefined,
): ExecutionBackendRegistry {
  return new ExecutionBackendRegistry({
    backends: [new PiRpcExecutionAdapter({
      runtimeFactory,
      globalModel,
      coordinatorExtensionPath: TEST_COORDINATOR_EXTENSION,
      skills: READY_AGENT_SKILLS,
      now: () => "2026-07-18T00:00:00.000Z",
    })],
    now: () => "2026-07-18T00:00:00.000Z",
  });
}

async function setup(
  runtimeFactory = new FakeAgentRuntimeFactory(),
  globalModel: () => Readonly<{ readonly provider: string; readonly model: string }> | undefined = () => undefined,
  resolveProjectPath: (projectPath: string, trusted: boolean) => Promise<string> = async (projectPath) => projectPath,
  resolveProjectTrust: (projectPath: string) => Promise<boolean> = async () => true,
  assertExecutionAvailable: () => void = () => undefined,
  customBackendRegistry?: ExecutionBackendRegistry,
) {
  const repository = new MemoryRepository();
  const id = idFactory();
  const now = () => "2026-07-18T00:00:00.000Z";
  const boardService = new BoardService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, projectIdentity: (path) => path.toLocaleLowerCase(), id, now });
  const agentTaskService = new AgentTaskService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, skills: READY_AGENT_SKILLS, assertExecutionAvailable, id, now });
  const squadService = new SquadService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, projectIdentity: (path) => path.toLocaleLowerCase(), id, now });
  const events: unknown[] = [];
  const admission = new WorkspaceAdmission({ canonicalize: async (path) => path.toLocaleLowerCase("en-US") });
  const runner = new AgentTaskRunner({
    service: agentTaskService,
    backendRegistry: customBackendRegistry ?? backendRegistry(runtimeFactory, globalModel),
    emitBoardEvent: (event) => events.push(event),
    admission,
    resolveProjectTrust,
    resolveProjectPath,
  });

  const createTask = async (
    title: string,
    executionTarget: ExecutionTarget = { kind: "agent", agentId: "builder" },
    executionProfileId?: ExecutionProfileId,
  ) => {
    await boardService.createTask({
      title, description: "修改真实项目", acceptanceCriteria: "留下可验证结果", priority: "high",
      projectPath: "C:/project", projectName: "project", trusted: true,
      executionTarget, executionProfileId,
    });
    const task = repository.state.tasks.find((candidate) => candidate.title === title);
    if (!task) throw new Error("测试任务未创建");
    return task.id;
  };

  return { repository, boardService, agentTaskService, squadService, runtimeFactory, runner, admission, events, createTask };
}

describe("AgentTaskRunner", () => {
  it("inherits the application model when the Agent has no model override", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory();
    const { agentTaskService, runner, createTask } = await setup(
      runtimeFactory,
      () => Object.freeze({ provider: "openai", model: "gpt-global" }),
    );
    const taskId = await createTask("继承全局模型");
    await agentTaskService.dispatchDirect(taskId);

    runner.start();

    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.start).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      model: "gpt-global",
    })));
  });

  it("fails before starting Pi when the saved project path no longer has the same identity", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory();
    const resolveProjectPath = vi.fn(async () => { throw new Error("受信任项目路径的真实位置已变化"); });
    const { repository, agentTaskService, runner, createTask } = await setup(runtimeFactory, () => undefined, resolveProjectPath);
    const taskId = await createTask("拒绝重定向项目");
    await agentTaskService.dispatchDirect(taskId);

    runner.start();

    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.taskId === taskId)?.status).toBe("failed"));
    expect(resolveProjectPath).toHaveBeenCalledWith("C:/project", true);
    expect(runtimeFactory.runtimes).toHaveLength(0);
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("blocked");
  });

  it("uses live project trust and never reuses a stale trusted Task snapshot", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory();
    const resolveProjectPath = vi.fn(async (projectPath: string) => projectPath);
    const { agentTaskService, runner, createTask } = await setup(
      runtimeFactory,
      () => undefined,
      resolveProjectPath,
      async () => false,
    );
    const taskId = await createTask("权限已撤销的任务");
    await agentTaskService.dispatchDirect(taskId);

    runner.start();

    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.start).toHaveBeenCalledWith(expect.objectContaining({ trusted: false })));
    expect(resolveProjectPath).toHaveBeenCalledWith("C:/project", false);
  });

  it("runs direct AgentTasks serially and persists output, stats, comments, and review state", async () => {
    const { repository, agentTaskService, runtimeFactory, runner, createTask } = await setup();
    const firstTaskId = await createTask("第一个任务");
    const secondTaskId = await createTask("第二个任务");
    await agentTaskService.addComment({ taskId: firstTaskId, body: "请保留用户已有改动" });
    await agentTaskService.dispatchDirect(firstTaskId);
    await agentTaskService.dispatchDirect(secondTaskId);

    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    const prompt = runtimeFactory.runtimes[0]?.commands.find((command) => command.type === "prompt");
    expect(prompt).toMatchObject({ type: "prompt", message: expect.stringContaining("请保留用户已有改动") });
    expect(repository.state.agentTasks.filter((task) => task.status === "running")).toHaveLength(1);

    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    const first = repository.state.agentTasks.find((task) => task.taskId === firstTaskId);
    expect(first).toMatchObject({ status: "reported", acceptance: "pending", output: "真实 Agent 产物", session: { backendId: "pi", sessionPath: "C:/agent-task.jsonl" }, inputTokens: 12, outputTokens: 34, cost: 0.02 });
    expect(repository.state.tasks.find((task) => task.id === firstTaskId)?.stage).toBe("review");
    expect(repository.state.comments.some((comment) => comment.taskId === firstTaskId && comment.author === "agent" && comment.body === "真实 Agent 产物")).toBe(true);
    expect(repository.state.agentTasks.find((task) => task.taskId === secondTaskId)?.status).toBe("running");
  });

  it("fails a direct task on a typed Backend protocol error while preserving partial evidence", async () => {
    const registry = new ExecutionBackendRegistry({
      backends: [new ProtocolFailingCodexBackend()],
      now: () => "2026-07-18T00:00:00.000Z",
    });
    const { repository, agentTaskService, runner, createTask } = await setup(
      new FakeAgentRuntimeFactory(),
      () => undefined,
      async (projectPath) => projectPath,
      async () => true,
      () => undefined,
      registry,
    );
    const taskId = await createTask("Codex 协议失败", { kind: "agent", agentId: "builder" }, "codex.exec");
    await agentTaskService.dispatchDirect(taskId);

    runner.start();

    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.taskId === taskId)?.status).toBe("failed"));
    expect(repository.state.agentTasks.find((task) => task.taskId === taskId)).toMatchObject({
      output: "已完成文件分析，但终态丢失",
      error: "Codex JSONL 缺少 turn.completed 终态",
      session: { backendId: "codex", sessionId: "thread-partial" },
      backendVersion: "codex-cli 7.6.5",
      inputTokens: 45,
      outputTokens: 67,
    });
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("blocked");
    expect(repository.state.comments.some((comment) => comment.taskId === taskId && comment.author === "agent")).toBe(false);
  });

  it("rejects a stale queued execution without corrupting the task's current root", async () => {
    const { repository, agentTaskService, createTask } = await setup();
    const taskId = await createTask("保留当前执行");
    await agentTaskService.dispatchDirect(taskId);
    const currentTask = repository.state.tasks.find((candidate) => candidate.id === taskId);
    const currentRoot = repository.state.agentTasks.find((candidate) => candidate.id === currentTask?.activeAgentTaskId);
    if (!currentTask || !currentRoot) throw new Error("测试缺少当前执行");
    const staleRoot = Object.freeze({
      ...currentRoot,
      id: "stale-root",
      executionAttempt: Math.max(1, currentRoot.executionAttempt - 1),
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    repository.state = parseBoardState(Object.freeze({
      ...repository.state,
      agentTasks: Object.freeze([staleRoot, currentRoot]),
    }));

    const next = await agentTaskService.nextQueued();

    expect(next?.agentTask.id).toBe(currentRoot.id);
    expect(repository.state.agentTasks.find((candidate) => candidate.id === staleRoot.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("不属于任务当前活动执行"),
    });
    expect(repository.state.agentTasks.find((candidate) => candidate.id === currentRoot.id)?.status).toBe("queued");
    expect(repository.state.tasks.find((candidate) => candidate.id === taskId)).toMatchObject({
      activeAgentTaskId: currentRoot.id,
      stage: "queued",
    });
  });

  it("treats a typed stale Runtime lease as an idempotent shutdown race", async () => {
    const { repository, agentTaskService, runtimeFactory, runner, createTask } = await setup();
    const taskId = await createTask("关闭竞争任务");
    await agentTaskService.dispatchDirect(taskId);
    runner.start();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.taskId === taskId)?.status).toBe("running"));
    const running = repository.state.agentTasks.find((task) => task.taskId === taskId);
    if (!running?.runtimeToken) throw new Error("测试 Runtime 未取得 token");

    await agentTaskService.interruptRunning(running.id, running.runtimeToken, "外部关闭先完成");

    await expect(runner.shutdown()).resolves.toBeUndefined();
    expect(runtimeFactory.runtimes[0]?.abortAndStop).toHaveBeenCalledOnce();
  });

  it("does not suppress unrelated shutdown failures whose text mentions Runtime expiry", async () => {
    const { repository, agentTaskService, runtimeFactory, runner, createTask } = await setup();
    const taskId = await createTask("关闭错误任务");
    await agentTaskService.dispatchDirect(taskId);
    runner.start();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.taskId === taskId)?.status).toBe("running"));
    vi.spyOn(agentTaskService, "interruptRunning").mockRejectedValueOnce(new Error("数据库写入失败：Runtime 已失效"));

    await expect(runner.shutdown()).rejects.toThrow("数据库写入失败");
    expect(runtimeFactory.runtimes[0]?.abortAndStop).not.toHaveBeenCalled();
    await runtimeFactory.runtimes[0]?.abortAndStop();
  });

  it("keeps user abort terminal when a late settlement arrives", async () => {
    const { repository, agentTaskService, runtimeFactory, runner, createTask } = await setup();
    const taskId = await createTask("可中止任务");
    await agentTaskService.dispatchDirect(taskId);
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));
    const runtime = runtimeFactory.runtimes[0];
    await runner.abortTask(taskId);
    runtime?.settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("blocked");
    expect(repository.state.agentTasks.find((task) => task.taskId === taskId)?.status).toBe("interrupted");
    expect(repository.state.comments.some((comment) => comment.author === "agent")).toBe(false);
    expect(runtime?.abortAndStop).toHaveBeenCalledOnce();
  });

  it("cancels a workspace waiter without launching it after the owner releases", async () => {
    const { repository, agentTaskService, runtimeFactory, runner, admission, createTask } = await setup();
    const owner = await admission.acquireInteractive("C:/project", {
      id: "interactive-owner",
      kind: "interactive",
      label: "Interactive Pi",
    });
    const taskId = await createTask("排队后取消");
    await agentTaskService.dispatchDirect(taskId);
    runner.start();
    await vi.waitFor(() => expect(repository.state.activities.some((activity) => activity.taskId === taskId && activity.summary.includes("等待项目写入席位"))).toBe(true));

    await runner.abortTask(taskId);
    owner.release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtimeFactory.runtimes).toHaveLength(0);
    expect(repository.state.agentTasks.find((task) => task.taskId === taskId)?.status).toBe("cancelled");
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("blocked");
  });

  it("persists startup failures and continues with the next queued AgentTask", async () => {
    let starts = 0;
    const runtimeFactory = new FakeAgentRuntimeFactory("结果", async () => {
      starts += 1;
      if (starts === 1) throw new Error("无法启动真实 Pi Runtime");
    });
    const { repository, agentTaskService, runner, createTask } = await setup(runtimeFactory);
    const firstTaskId = await createTask("启动失败任务");
    const secondTaskId = await createTask("继续执行任务");
    await agentTaskService.dispatchDirect(firstTaskId);
    await agentTaskService.dispatchDirect(secondTaskId);
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    expect(repository.state.agentTasks.find((task) => task.taskId === firstTaskId)).toMatchObject({ status: "failed", error: "无法启动真实 Pi Runtime" });
    expect(repository.state.agentTasks.find((task) => task.taskId === secondTaskId)?.status).toBe("running");
  });

  it("rejects an unsafe read-only tool snapshot before creating a Runtime", async () => {
    const { repository, agentTaskService, runtimeFactory, runner, createTask } = await setup();
    const taskId = await createTask("伪只读权限");
    await agentTaskService.dispatchDirect(taskId);
    await repository.update((current) => ({
      ...current,
      agentTasks: current.agentTasks.map((agentTask) => agentTask.taskId === taskId
        ? Object.freeze({
            ...agentTask,
            agentSnapshot: Object.freeze({
              ...agentTask.agentSnapshot,
              workspaceAccess: "read" as const,
              allowedTools: Object.freeze(["read", "bash"]),
            }),
          })
        : agentTask),
    }));

    runner.start();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((agentTask) => agentTask.taskId === taskId)?.status).toBe("failed"));
    expect(runtimeFactory.runtimes).toHaveLength(0);
    expect(repository.state.agentTasks.find((agentTask) => agentTask.taskId === taskId)?.error).toContain("未验证工具: bash");
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("blocked");
  });

  it("turns user comment mentions into one serial parent-child execution group", async () => {
    const { repository, agentTaskService, createTask } = await setup();
    const taskId = await createTask("评论委派任务");
    await agentTaskService.addComment({ taskId, body: "请由 @builder 完成，再请 @VERIFY 核验；重复 @BUILD 不应重复入队" });
    const group = repository.state.agentTasks.filter((task) => task.taskId === taskId);
    expect(group).toHaveLength(2);
    expect(group[0]).toMatchObject({ kind: "mention-root", status: "queued", agentSnapshot: { id: "builder" } });
    expect(group[1]).toMatchObject({ kind: "delegated", parentAgentTaskId: group[0]?.id, agentSnapshot: { id: "tester" } });
    expect(repository.state.tasks.find((task) => task.id === taskId)?.activeAgentTaskId).toBe(group[0]?.id);

    const before = repository.state;
    await expect(agentTaskService.addComment({ taskId, body: "请交给 @missing" })).rejects.toThrow("未知 Agent mention");
    expect(repository.state.comments).toHaveLength(before.comments.length);
    expect(repository.state.agentTasks).toHaveLength(before.agentTasks.length);
  });

  it("injects persisted predecessor output when the next mention Worker is claimed", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory(["调研结论：入口位于 src/main.ts", "实现完成"]);
    const { agentTaskService, runtimeFactory: factory, runner, createTask } = await setup(runtimeFactory);
    const taskId = await createTask("串行交接任务");
    await agentTaskService.addComment({ taskId, body: "请由 @builder 调研，再请 @VERIFY 根据调研核验" });
    runner.start();
    await vi.waitFor(() => expect(factory.runtimes).toHaveLength(1));
    factory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(factory.runtimes).toHaveLength(2));

    expect(factory.runtimes[1]?.commands.find((command) => command.type === "prompt")).toMatchObject({
      type: "prompt",
      message: expect.stringContaining("调研结论：入口位于 src/main.ts"),
    });
  });

  it("stores @tokens literally when the generic board disables Team dispatch", async () => {
    const { repository, agentTaskService, createTask } = await setup();
    const taskId = await createTask("普通看板记录");

    await agentTaskService.addComment({ taskId, body: "记录 @builder 尚未开始", dispatchMentions: false });

    expect(repository.state.comments.at(-1)?.body).toBe("记录 @builder 尚未开始");
    expect(repository.state.agentTasks.filter((task) => task.taskId === taskId)).toEqual([]);
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("planned");
  });

  it("keeps plain comments available but rejects execution effects when Pi is unavailable", async () => {
    const assertExecutionAvailable = vi.fn(() => { throw new Error("Pi Runtime 不可用于任务执行"); });
    const { repository, agentTaskService, createTask } = await setup(
      new FakeAgentRuntimeFactory(),
      () => undefined,
      async (projectPath) => projectPath,
      async () => true,
      assertExecutionAvailable,
    );
    const taskId = await createTask("Capability 评论边界");

    await agentTaskService.addComment({ taskId, body: "仅记录当前阻塞，不创建执行" });
    const commentsBeforeMention = repository.state.comments.length;
    await expect(agentTaskService.addComment({ taskId, body: "请由 @builder 执行" })).rejects.toThrow("Pi Runtime 不可用于任务执行");

    expect(repository.state.comments).toHaveLength(commentsBeforeMention);
    expect(repository.state.agentTasks).toHaveLength(0);
    expect(assertExecutionAvailable).toHaveBeenCalledOnce();
  });

  it("rejects mixing LEAD coordinator mode with direct Worker mentions atomically", async () => {
    const { repository, agentTaskService, createTask } = await setup();
    const taskId = await createTask("拒绝混合协调协议");
    const before = repository.state;
    await expect(agentTaskService.addComment({ taskId, body: "@lead 请规划，并让 @builder 直接开始" })).rejects.toThrow("不能与直接 Worker mention 混用");
    expect(repository.state.comments).toHaveLength(before.comments.length);
    expect(repository.state.agentTasks).toHaveLength(before.agentTasks.length);
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("planned");
  });

  it("atomically creates a Task, first message, and queued Coordinator from the project launch room", async () => {
    const { repository, agentTaskService } = await setup();
    const bootstrap = await agentTaskService.launchTeamTask({
      body: "@LEAD 评估 NLRP3 作为帕金森病早研靶点。覆盖临床竞品和关键风险。",
      acceptanceCriteria: "给出带来源的支持、反对与未知证据，并提出可证伪实验",
      projectPath: "C:/project",
      projectName: "project",
      trusted: true,
    });

    const task = bootstrap.board.tasks[0];
    expect(task).toMatchObject({
      title: "评估 NLRP3 作为帕金森病早研靶点",
      description: "评估 NLRP3 作为帕金森病早研靶点。覆盖临床竞品和关键风险。",
      priority: "medium",
      stage: "queued",
      executionTarget: { kind: "agent", agentId: "lead" },
    });
    const root = bootstrap.board.agentTasks.find((agentTask) => agentTask.id === task?.activeAgentTaskId);
    expect(root).toMatchObject({ taskId: task?.id, kind: "coordinator", status: "queued", acceptance: "not-ready", agentSnapshot: { id: "lead" } });
    expect(root?.executionPlan).toMatchObject({
      kind: "coordinator",
      delegates: expect.arrayContaining([expect.objectContaining({ id: "builder", version: 1 })]),
    });
    expect(root?.prompt).toContain("用户请求：@LEAD 评估 NLRP3");
    expect(bootstrap.board.comments).toEqual([expect.objectContaining({ taskId: task?.id, author: "user", body: expect.stringContaining("@LEAD") })]);
    expect(bootstrap.board.activities.map((activity) => activity.summary)).toEqual(expect.arrayContaining([
      "任务由任务启动台创建",
      "用户向 通用调度负责人 提交了启动指令",
      "任务启动台已交给 LEAD 协调",
    ]));
  });

  it("atomically creates and directly dispatches a clear Worker-owned task", async () => {
    const { agentTaskService } = await setup();
    const bootstrap = await agentTaskService.launchTeamTask({
      body: "@BUILD 直接开始实现",
      acceptanceCriteria: "真实修改通过自动化验证",
      projectPath: "C:/project",
      projectName: "project",
      trusted: true,
    });
    expect(bootstrap.board.tasks[0]).toMatchObject({ executionTarget: { kind: "agent", agentId: "builder" }, stage: "queued" });
    expect(bootstrap.board.agentTasks[0]).toMatchObject({ kind: "direct", status: "queued", agentSnapshot: { id: "builder" } });
  });

  it("lets @lead delegate with a strict action, review worker evidence, and report for human acceptance", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory([
      JSON.stringify({ action: "delegate", summary: "先实现再由我验收", delegations: [{ agentId: "builder", objective: "完成真实修改", acceptanceCriteria: "测试通过并报告证据" }] }),
      "实现完成；npm test 通过。",
      JSON.stringify({ action: "complete", summary: "Builder 已报告真实修改和测试证据", delegations: [] }),
    ]);
    const { repository, agentTaskService, runner, createTask } = await setup(runtimeFactory);
    const taskId = await createTask("LEAD 团队任务");
    await agentTaskService.addComment({ taskId, body: "@lead 请拆解、委派并验收这个任务" });
    runner.start();

    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    expect(runtimeFactory.runtimes[0]?.commands.find((command) => command.type === "prompt")).toMatchObject({ type: "prompt", message: expect.stringContaining("严格行动协议") });
    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    const root = repository.state.agentTasks.find((task) => task.kind === "coordinator");
    expect(root).toMatchObject({ status: "waiting_children", agentSnapshot: { id: "lead" } });
    expect(repository.state.agentTasks.find((task) => task.kind === "delegated")).toMatchObject({ status: "running", agentSnapshot: { id: "builder" }, parentAgentTaskId: root?.id });

    runtimeFactory.runtimes[1]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(3));
    expect(repository.state.agentTasks.find((task) => task.kind === "coordinator-review")?.status).toBe("running");
    runtimeFactory.runtimes[2]?.settle();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.id === root?.id)?.status).toBe("reported"));

    expect(repository.state.tasks.find((task) => task.id === taskId)).toMatchObject({ stage: "review", activeAgentTaskId: undefined });
    expect(repository.state.agentTasks.find((task) => task.id === root?.id)).toMatchObject({ acceptance: "pending" });
    expect(repository.state.comments.some((comment) => comment.authorAgentId === "lead" && comment.body.includes("Builder 已报告"))).toBe(true);
  });

  it("returns a queued Worker preflight failure to LEAD instead of cancelling the group", async () => {
    const { repository, agentTaskService, createTask } = await setup();
    const taskId = await createTask("Worker 预检恢复");
    await agentTaskService.addComment({ taskId, body: "@lead 请委派实现任务" });
    const root = repository.state.agentTasks.find((task) => task.kind === "coordinator");
    if (!root) throw new Error("测试 Coordinator 未创建");
    const claimed = await agentTaskService.claim(root.id);
    const runtimeToken = claimed?.agentTask.runtimeToken;
    if (!runtimeToken) throw new Error("测试 Coordinator 未认领");
    await agentTaskService.complete(root.id, runtimeToken, {
      output: JSON.stringify({ action: "delegate", summary: "委派 Builder", delegations: [{ agentId: "builder", objective: "完成实现", acceptanceCriteria: "测试通过" }] }),
    });
    const child = repository.state.agentTasks.find((task) => task.kind === "delegated");
    if (!child) throw new Error("测试 Worker 子任务未创建");

    await agentTaskService.rejectQueued(child.id, new Error("缺少必需 Pi Skill：implementation-check"));

    expect(repository.state.agentTasks.find((task) => task.id === child.id)).toMatchObject({ status: "failed", error: expect.stringContaining("implementation-check") });
    expect(repository.state.agentTasks.find((task) => task.id === root.id)?.status).toBe("waiting_children");
    expect(repository.state.tasks.find((task) => task.id === taskId)).toMatchObject({ stage: "queued", activeAgentTaskId: root.id });
    expect(repository.state.agentTasks.find((task) => task.kind === "coordinator-review")).toMatchObject({
      status: "queued",
      delegationRound: 1,
      prompt: expect.stringContaining("执行失败：缺少必需 Pi Skill"),
    });
  });

  it("resumes a waiting LEAD from a normal Task Room reply", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory([
      JSON.stringify({ action: "ask_human", summary: "存在两个互斥范围", delegations: [], question: "选择 A 还是 B？" }),
      JSON.stringify({ action: "complete", summary: "用户选择 A，规划结论已明确", delegations: [] }),
    ]);
    const { repository, agentTaskService, runner, createTask } = await setup(runtimeFactory);
    const taskId = await createTask("需要用户决定");
    await agentTaskService.addComment({ taskId, body: "@LEAD 请先澄清范围" });
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.kind === "coordinator")?.status).toBe("waiting_human"));
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("review");

    await agentTaskService.addComment({ taskId, body: "选择 A，并保持当前兼容边界。" });
    runner.notify();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    expect(runtimeFactory.runtimes[1]?.commands.find((command) => command.type === "prompt")).toMatchObject({ type: "prompt", message: expect.stringContaining("选择 A，并保持当前兼容边界") });
    runtimeFactory.runtimes[1]?.settle();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.kind === "coordinator")?.status).toBe("reported"));
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("review");
  });

  it("blocks the task when LEAD emits prose instead of the structured action protocol", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory("请让 @builder 开始工作");
    const { repository, agentTaskService, runner, createTask } = await setup(runtimeFactory);
    const taskId = await createTask("拒绝隐式委派");
    await agentTaskService.addComment({ taskId, body: "@lead 请处理" });
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.kind === "coordinator")?.status).toBe("protocol-invalid"));
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("blocked");
    expect(repository.state.agentTasks.find((task) => task.kind === "coordinator")).toMatchObject({
      output: "请让 @builder 开始工作",
      session: { backendId: "pi", sessionPath: "C:/agent-task.jsonl" },
      inputTokens: 12,
      outputTokens: 34,
      error: expect.stringContaining("未调用必需的 coordinator_action 工具"),
    });
    expect(repository.state.comments.some((comment) => comment.body === "请让 @builder 开始工作")).toBe(true);
    expect(repository.state.agentTasks.some((task) => task.kind === "delegated")).toBe(false);
  });

  it("executes a Squad through structured Leader actions and completes only after review", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory([
      JSON.stringify({ action: "delegate", summary: "实现与验证并行分工", delegations: [
        { agentId: "builder", objective: "完成实现", acceptanceCriteria: "提交可验证实现" },
        { agentId: "tester", objective: "完成验证", acceptanceCriteria: "报告验证证据" },
      ] }),
      "实现完成",
      "验证完成",
      JSON.stringify({ action: "complete", summary: "成员报告满足验收标准", delegations: [] }),
    ]);
    const { repository, agentTaskService, squadService, runner, createTask } = await setup(runtimeFactory);
    await squadService.create({
      name: "动态交付组",
      description: "Leader 动态路由",
      leaderAgentId: "planner",
      memberAgentIds: ["builder", "tester"],
      leaderInstructions: "根据任务决定需要的成员并通过结构化行动委派。",
    }, "C:/project");
    const squad = repository.state.squads[0];
    if (!squad) throw new Error("测试 Squad 未创建");
    const taskId = await createTask("Squad 任务", { kind: "squad", squadId: squad.id });
    await agentTaskService.dispatchSquad(taskId);
    await squadService.update({
      squadId: squad.id,
      name: "运行期间已修改的小队",
      description: "只影响下一次分发",
      leaderAgentId: "planner",
      memberAgentIds: ["reviewer"],
      leaderInstructions: "只允许使用新的成员配置。",
    }, "C:/project");
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));

    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    const leader = repository.state.agentTasks.find((task) => !task.parentAgentTaskId && task.executionPlan?.kind === "squad");
    const children = repository.state.agentTasks.filter((task) => task.parentAgentTaskId === leader?.id && task.kind === "delegated");
    expect(leader?.executionPlan).toMatchObject({
      kind: "squad",
      squadId: squad.id,
      squadVersion: 1,
      squadName: "动态交付组",
      delegates: [expect.objectContaining({ id: "builder" }), expect.objectContaining({ id: "tester" })],
    });
    expect(leader?.status).toBe("waiting_children");
    expect(children.map((child) => child.agentSnapshot.id)).toEqual(["builder", "tester"]);
    expect(repository.state.tasks.find((task) => task.id === taskId)?.activeAgentTaskId).toBe(leader?.id);

    runtimeFactory.runtimes[1]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(3));
    expect(repository.state.agentTasks.find((task) => task.id === leader?.id)?.status).toBe("waiting_children");
    runtimeFactory.runtimes[2]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(4));
    expect(repository.state.agentTasks.find((task) => task.kind === "coordinator-review")?.delegationRound).toBe(1);
    runtimeFactory.runtimes[3]?.settle();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.id === leader?.id)?.status).toBe("reported"));
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("review");
    expect(repository.state.agentTasks.find((task) => task.id === leader?.id)).toMatchObject({ status: "reported", acceptance: "pending" });
    expect(repository.state.comments.filter((comment) => comment.taskId === taskId && comment.author === "agent")).toHaveLength(4);
  });

  it("upgrades a queued legacy squad-leader prompt to the typed protocol when claimed", async () => {
    const { repository, agentTaskService, squadService, createTask } = await setup();
    await squadService.create({
      name: "兼容小队",
      description: "验证旧记录",
      leaderAgentId: "planner",
      memberAgentIds: ["builder"],
      leaderInstructions: "只通过结构化行动委派。",
    }, "C:/project");
    const squad = repository.state.squads[0];
    if (!squad) throw new Error("测试 Squad 未创建");
    const taskId = await createTask("旧 Squad 记录", { kind: "squad", squadId: squad.id });
    await agentTaskService.dispatchSquad(taskId);
    const root = repository.state.agentTasks.find((task) => !task.parentAgentTaskId && task.executionPlan?.kind === "squad");
    if (!root) throw new Error("测试 Squad 根任务未创建");
    await repository.update((current) => ({
      ...current,
      agentTasks: current.agentTasks.map((task) => task.id === root.id
        ? Object.freeze({
            ...task,
            kind: "squad-leader" as const,
            prompt: "旧版：最终文本使用 @mention 委派",
            executionPlan: task.executionPlan?.kind === "squad"
              ? Object.freeze({ ...task.executionPlan, leaderInstructions: LEGACY_SQUAD_LEADER_INSTRUCTIONS })
              : task.executionPlan,
          })
        : task),
    }));

    const claimed = await agentTaskService.claim(root.id);

    expect(claimed?.agentTask).toMatchObject({ kind: "squad-leader", status: "running" });
    expect(claimed?.agentTask.prompt).toContain("严格行动协议");
    expect(claimed?.agentTask.prompt).toContain(DEFAULT_SQUAD_LEADER_INSTRUCTIONS);
    expect(claimed?.agentTask.prompt).not.toContain(LEGACY_SQUAD_LEADER_INSTRUCTIONS);
    expect(claimed?.agentTask.prompt).not.toContain("最终文本使用 @mention 委派");
  });

  it("keeps the Squad alive and returns worker failure to the Leader for a decision", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory([
      JSON.stringify({ action: "delegate", summary: "委派两个成员", delegations: [
        { agentId: "builder", objective: "完成实现", acceptanceCriteria: "提交实现证据" },
        { agentId: "tester", objective: "独立验证", acceptanceCriteria: "提交验证证据" },
      ] }),
      "不会使用",
      "验证完成",
      JSON.stringify({ action: "ask_human", summary: "实现成员失败，需要用户决定是否缩小范围", delegations: [], question: "是否仅接受验证报告？" }),
    ]);
    const { repository, agentTaskService, squadService, runner, createTask } = await setup(runtimeFactory);
    await squadService.create({
      name: "失败传播组",
      description: "测试失败传播",
      leaderAgentId: "planner",
      memberAgentIds: ["builder", "tester"],
      leaderInstructions: "委派两个成员。",
    }, "C:/project");
    const squad = repository.state.squads[0];
    if (!squad) throw new Error("测试 Squad 未创建");
    const taskId = await createTask("失败传播", { kind: "squad", squadId: squad.id });
    await agentTaskService.dispatchSquad(taskId);
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    runtimeFactory.runtimes[1]?.exit();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(3));
    runtimeFactory.runtimes[2]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(4));
    expect(runtimeFactory.runtimes[3]?.commands.find((command) => command.type === "prompt")).toMatchObject({ type: "prompt", message: expect.stringContaining("执行失败") });
    runtimeFactory.runtimes[3]?.settle();
    const leader = repository.state.agentTasks.find((task) => !task.parentAgentTaskId && task.executionPlan?.kind === "squad");
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.id === leader?.id)?.status).toBe("waiting_human"));
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("review");
    const children = repository.state.agentTasks.filter((task) => task.parentAgentTaskId === leader?.id && task.kind === "delegated");
    expect(children.map((child) => child.status)).toEqual(["failed", "reported"]);
    expect(children.some((child) => child.status === "cancelled")).toBe(false);

    if (!leader) throw new Error("测试 Squad Leader 不存在");
    await repository.update((current) => ({
      ...current,
      agentTasks: current.agentTasks.map((task) => task.id === leader.id ? Object.freeze({ ...task, kind: "squad-leader" as const }) : task),
    }));
    await agentTaskService.addComment({ taskId, body: "继续缩小范围执行。", dispatchMentions: false });
    expect(repository.state.agentTasks.find((task) => task.kind === "coordinator-review" && task.status === "queued")).toBeDefined();
    expect(repository.state.activities.at(-1)?.summary).toBe("用户回复已交给 Squad Leader 继续决策");
  });

  it("continues the remaining Squad work when startup recovery finds an interrupted child", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory([
      JSON.stringify({ action: "delegate", summary: "委派两个成员", delegations: [
        { agentId: "builder", objective: "完成实现", acceptanceCriteria: "提交实现证据" },
        { agentId: "tester", objective: "独立验证", acceptanceCriteria: "提交验证证据" },
      ] }),
      "不会结算",
    ]);
    const { repository, agentTaskService, squadService, runner, createTask } = await setup(runtimeFactory);
    await squadService.create({
      name: "恢复检查组",
      description: "测试重启恢复",
      leaderAgentId: "planner",
      memberAgentIds: ["builder", "tester"],
      leaderInstructions: "委派两个成员。",
    }, "C:/project");
    const squad = repository.state.squads[0];
    if (!squad) throw new Error("测试 Squad 未创建");
    const taskId = await createTask("恢复父任务", { kind: "squad", squadId: squad.id });
    await agentTaskService.dispatchSquad(taskId);
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    const runningChild = repository.state.agentTasks.find((task) => task.status === "running");
    if (!runningChild) throw new Error("测试子任务未运行");
    await repository.update((current) => ({
      ...current,
      agentTasks: current.agentTasks.map((task) => task.id === runningChild.id
        ? Object.freeze({ ...task, status: "interrupted" as const, runtimeToken: undefined, error: "应用重启", updatedAt: "2026-07-18T00:01:00.000Z", completedAt: "2026-07-18T00:01:00.000Z" })
        : task),
    }));

    const recoveredFactory = new FakeAgentRuntimeFactory([
      "验证完成",
      JSON.stringify({ action: "complete", summary: "已记录中断并接受其余成员证据", delegations: [] }),
    ]);
    const recoveredRunner = new AgentTaskRunner({
      service: agentTaskService,
      backendRegistry: backendRegistry(recoveredFactory),
      emitBoardEvent: () => undefined,
      admission: new WorkspaceAdmission({ canonicalize: async (path) => path.toLocaleLowerCase("en-US") }),
      resolveProjectTrust: async () => true,
      resolveProjectPath: async (projectPath) => projectPath,
    });
    recoveredRunner.start();
    await vi.waitFor(() => expect(recoveredFactory.runtimes).toHaveLength(1));
    recoveredFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(recoveredFactory.runtimes).toHaveLength(2));
    recoveredFactory.runtimes[1]?.settle();
    const leader = repository.state.agentTasks.find((task) => !task.parentAgentTaskId && task.executionPlan?.kind === "squad");
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.id === leader?.id)?.status).toBe("reported"));
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("review");
    expect(repository.state.agentTasks.filter((task) => task.parentAgentTaskId === leader?.id && task.kind === "delegated").map((task) => task.status)).toEqual(["interrupted", "reported"]);
  });
});
