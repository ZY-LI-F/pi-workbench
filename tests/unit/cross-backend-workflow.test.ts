// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { BoardRepository } from "../../src/main/board-repository";
import { BoardService } from "../../src/main/board-service";
import { CliProcess } from "../../src/main/cli-process";
import { CodexExecExecutionAdapter } from "../../src/main/execution-adapters/codex-exec-execution-adapter";
import { ClaudePrintExecutionAdapter } from "../../src/main/execution-adapters/claude-print-execution-adapter";
import { ExecutionBackendRegistry } from "../../src/main/execution-backend-registry";
import { WorkflowOrchestrator } from "../../src/main/workflow-orchestrator";
import { WorkspaceAdmission } from "../../src/main/workspace-admission";
import { EMPTY_BOARD_STATE, parseBoardState, type BoardState } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import type { ExecutionProfileId } from "../../src/shared/execution-profile";

const SHIM = fileURLToPath(new URL("../fixtures/cli-process-shim.mjs", import.meta.url));
const NOW = "2026-08-24T00:00:00.000Z";

class MemoryRepository implements BoardRepository {
  state: BoardState = EMPTY_BOARD_STATE;
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

function idFactory(): () => string {
  let value = 0;
  return () => `cross-backend-${++value}`;
}

function backendRegistry(profileId: "codex.exec" | "claude.print", behavior: string): ExecutionBackendRegistry {
  const configuration = Object.freeze({
    backendId: profileId === "codex.exec" ? "codex" as const : "claude" as const,
    executable: process.execPath,
    prefixArgv: Object.freeze([SHIM, profileId === "codex.exec" ? "codex-exec" : "claude-print", behavior]),
    displayPath: `/fake/${profileId === "codex.exec" ? "codex" : "claude"}`,
    executableSource: "path" as const,
  });
  const backend = profileId === "codex.exec"
    ? new CodexExecExecutionAdapter({ process: new CliProcess({ abortGraceMs: 20 }), isGitRepository: async () => true })
    : new ClaudePrintExecutionAdapter({ process: new CliProcess({ abortGraceMs: 20 }) });
  backend.activate(configuration);
  return new ExecutionBackendRegistry({ backends: [backend], configurations: [configuration], now: () => NOW });
}

async function fixture(
  profileId: "codex.exec" | "claude.print",
  behavior = "success",
  workflowId = "read-only-review",
) {
  const repository = new MemoryRepository();
  const id = idFactory();
  const boardService = new BoardService({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    emitChanged: () => undefined,
    projectIdentity: (path) => path,
    id,
    now: () => NOW,
  });
  await boardService.createTask({
    title: `${profileId} Workflow`,
    description: "验证跨后端固定流程",
    acceptanceCriteria: "步骤产物按顺序保存",
    priority: "high",
    projectPath: process.cwd(),
    projectName: "pi gui",
    trusted: true,
    executionTarget: { kind: "workflow", workflowId },
    executionProfileId: profileId,
  });
  const taskId = repository.state.tasks[0]?.id;
  if (!taskId) throw new Error("测试任务未创建");
  const events: unknown[] = [];
  const orchestrator = new WorkflowOrchestrator({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    backendRegistry: backendRegistry(profileId, behavior),
    emitBoardEvent: (event) => events.push(event),
    admission: new WorkspaceAdmission({ canonicalize: async (path) => path }),
    resolveProjectTrust: async () => true,
    resolveProjectPath: async (path) => path,
    id,
    now: () => NOW,
  });
  return { repository, boardService, orchestrator, events, taskId };
}

function agentSteps(state: BoardState) {
  return state.runs[0]?.steps.filter((step) => step.stepKind === "agent") ?? [];
}

describe("cross-backend Workflow", () => {
  it("runs Codex steps in order with independent Threads and persisted upstream Artifacts", async () => {
    const { repository, orchestrator, taskId } = await fixture("codex.exec");

    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(repository.state.runs[0]?.status).toBe("review"));

    const steps = agentSteps(repository.state);
    expect(repository.state.runs[0]?.executionProfile).toMatchObject({ id: "codex.exec", backendId: "codex" });
    expect(steps.slice(0, 2).map((step) => step.status)).toEqual(["succeeded", "succeeded"]);
    expect(steps[0]).toMatchObject({
      backendVersion: "7.6.5",
      session: { backendId: "codex", sessionId: expect.stringMatching(/^thread-shim-\d+$/u) },
      artifact: { inputTokens: 21, outputTokens: 34 },
    });
    expect(steps[1]?.session?.sessionId).not.toBe(steps[0]?.session?.sessionId);
    expect(steps[1]?.artifact?.content).toContain(steps[0]?.artifact?.content);
    expect(repository.state.runs[0]?.currentStepId).toBe("accept");
  });

  it("runs Claude steps in order with independent Sessions, usage, cost, and a human gate", async () => {
    const { repository, orchestrator, taskId } = await fixture("claude.print");

    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(repository.state.runs[0]?.status).toBe("review"));

    const steps = agentSteps(repository.state);
    expect(repository.state.runs[0]?.executionProfile).toMatchObject({ id: "claude.print", backendId: "claude" });
    expect(steps.slice(0, 2).map((step) => step.status)).toEqual(["succeeded", "succeeded"]);
    expect(steps[0]).toMatchObject({
      backendVersion: "8.7.6",
      session: { backendId: "claude", sessionId: expect.stringMatching(/^claude-session-shim-\d+$/u) },
      artifact: { inputTokens: 12, outputTokens: 12, cost: 0.04 },
    });
    expect(steps[1]?.session?.sessionId).not.toBe(steps[0]?.session?.sessionId);
    expect(steps[1]?.artifact?.content).toContain(steps[0]?.artifact?.content);
    expect(repository.state.runs[0]?.steps.at(-1)).toMatchObject({ stepKind: "human-gate", status: "waiting" });
  });

  it("preserves protocol failure evidence on the failed external step", async () => {
    const { repository, orchestrator, taskId } = await fixture("codex.exec", "no-terminal");

    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(repository.state.runs[0]?.status).toBe("failed"));

    expect(agentSteps(repository.state)[0]).toMatchObject({
      status: "failed",
      error: "Codex JSONL 缺少 turn.completed 终态",
      backendVersion: "7.6.5",
      session: { backendId: "codex", sessionId: expect.stringMatching(/^thread-shim-\d+$/u) },
      artifact: {
        title: expect.stringContaining("失败前部分产物"),
        content: expect.stringContaining("Codex 完成："),
      },
    });
    expect(repository.state.tasks[0]).toMatchObject({ stage: "blocked", activeRunId: undefined });
  });

  it("interrupts an active Claude process when the user aborts", async () => {
    const { repository, orchestrator, taskId } = await fixture("claude.print", "wait");
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(agentSteps(repository.state)[0]?.status).toBe("running"));

    await orchestrator.abort(taskId);

    expect(repository.state.runs[0]).toMatchObject({ status: "interrupted", currentStepId: undefined });
    expect(repository.state.tasks[0]).toMatchObject({ stage: "blocked", activeRunId: undefined });
  });

  it("persists interruption before stopping an external process during application shutdown", async () => {
    const { repository, orchestrator, taskId } = await fixture("codex.exec", "wait");
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(agentSteps(repository.state)[0]?.status).toBe("running"));

    await orchestrator.shutdown();

    expect(repository.state.runs[0]).toMatchObject({ status: "interrupted", completedAt: NOW });
    expect(repository.state.tasks[0]).toMatchObject({ stage: "blocked", activeRunId: undefined });
  });

  it("rejects Pi-Skill workflows and Codex Review before creating an incompatible task", async () => {
    const repository = new MemoryRepository();
    const boardService = new BoardService({
      repository,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      emitChanged: () => undefined,
      projectIdentity: (path) => path,
      now: () => NOW,
      id: idFactory(),
    });
    const create = (workflowId: string, executionProfileId: ExecutionProfileId) => boardService.createTask({
      title: "不兼容流程", description: "", acceptanceCriteria: "", priority: "medium",
      projectPath: process.cwd(), projectName: "pi gui", trusted: true,
      executionTarget: { kind: "workflow", workflowId }, executionProfileId,
    });

    await expect(create("early-target-assessment", "claude.print")).rejects.toThrow("不支持依赖 Pi Skills");
    await expect(create("read-only-review", "codex.review")).rejects.toThrow("不支持 workflow");
    expect(repository.state.tasks).toHaveLength(0);
  });
});
