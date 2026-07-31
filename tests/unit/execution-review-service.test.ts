// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ExecutionReviewService } from "../../src/main/execution-review-service";
import type { BoardRepository } from "../../src/main/board-repository";
import {
  BOARD_SCHEMA_VERSION,
  parseBoardState,
  type BoardState,
  type KanbanTask,
} from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { snapshotTaskSpec } from "../../src/shared/execution-state";

const CREATED_AT = "2026-07-18T00:00:00.000Z";
const REVIEWED_AT = "2026-07-18T01:00:00.000Z";
const workflow = BUILTIN_ORCHESTRATION_CATALOG.workflows.find((candidate) => candidate.id === "read-only-review");
const builder = BUILTIN_ORCHESTRATION_CATALOG.agents.find((candidate) => candidate.id === "builder");
if (!workflow || !builder) throw new Error("测试目录缺少执行定义");
const workflowAgentIds = new Set(workflow.steps.filter((step) => step.kind === "agent").map((step) => step.agentId));

const TASK: KanbanTask = Object.freeze({
  id: "task-review",
  title: "验收执行结果",
  description: "",
  acceptanceCriteria: "人工明确确认",
  priority: "high",
  projectPath: "C:/project",
  projectName: "project",
  trusted: true,
  executionTarget: Object.freeze({ kind: "workflow", workflowId: workflow.id }),
  stage: "review",
  specRevision: 1,
  executionAttempt: 1,
  awaitingReviewExecution: Object.freeze({ kind: "workflow", id: "run-reported", attempt: 1 }),
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
});

function initialState(awaiting: "workflow" | "agent-task" = "workflow"): BoardState {
  const task: KanbanTask = Object.freeze({
    ...TASK,
    awaitingReviewExecution: Object.freeze({
      kind: awaiting,
      id: awaiting === "workflow" ? "run-reported" : "agent-reported",
      attempt: 1,
    }),
  });
  return parseBoardState({
    version: BOARD_SCHEMA_VERSION,
    tasks: [task],
    runs: [{
      id: "run-reported",
      taskId: TASK.id,
      executionAttempt: 1,
      taskSpec: snapshotTaskSpec(TASK),
      workflow,
      agents: BUILTIN_ORCHESTRATION_CATALOG.agents.filter((agent) => workflowAgentIds.has(agent.id)),
      status: "reported",
      acceptance: awaiting === "workflow" ? "pending" : "superseded",
      acceptanceComment: awaiting === "workflow" ? undefined : "由 AgentTask 验收测试取代",
      steps: workflow.steps.map((step, index) => ({
        id: `step-${index}`,
        stepId: step.id,
        stepKind: step.kind,
        name: step.name,
        status: "succeeded",
        agentId: step.kind === "agent" ? step.agentId : undefined,
        startedAt: CREATED_AT,
        completedAt: CREATED_AT,
      })),
      startedAt: CREATED_AT,
      updatedAt: CREATED_AT,
      completedAt: CREATED_AT,
    }],
    activities: [],
    comments: [],
    agentTasks: [{
      id: "agent-reported",
      taskId: TASK.id,
      executionAttempt: 1,
      taskSpec: snapshotTaskSpec(TASK),
      agentSnapshot: builder,
      kind: "direct",
      status: "reported",
      acceptance: awaiting === "agent-task" ? "pending" : "superseded",
      acceptanceComment: awaiting === "agent-task" ? undefined : "由 Workflow 验收测试取代",
      prompt: "交付",
      output: "全部测试通过——这仍然只是 Agent 报告",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      startedAt: CREATED_AT,
      completedAt: CREATED_AT,
    }],
    customAgents: [],
    squads: [],
    autopilots: [],
    autopilotRuns: [],
  });
}

class MemoryRepository implements BoardRepository {
  constructor(public state: BoardState = initialState()) {}
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

function setup(awaiting: "workflow" | "agent-task" = "workflow") {
  const repository = new MemoryRepository(initialState(awaiting));
  let id = 0;
  const service = new ExecutionReviewService({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    emitChanged: () => undefined,
    now: () => REVIEWED_AT,
    id: () => `review-${++id}`,
  });
  return { repository, service };
}

describe("ExecutionReviewService", () => {
  it("accepts a reported Workflow and deterministically completes the Task", async () => {
    const { repository, service } = setup();
    expect(repository.state.runs[0]?.acceptance).toBe("pending");

    await service.review({ taskId: TASK.id, executionKind: "workflow", executionId: "run-reported", decision: "accept", comment: "" });

    expect(repository.state.runs[0]).toMatchObject({ acceptance: "accepted", reviewedAt: REVIEWED_AT });
    expect(repository.state.tasks[0]).toMatchObject({ stage: "completed" });
    expect(repository.state.tasks[0]?.blockedReason).toBeUndefined();
    expect(repository.state.comments[0]).toMatchObject({ author: "user", messageKind: "acceptance", runId: "run-reported", body: "已接受" });
    expect(repository.state.activities[0]).toMatchObject({ kind: "gate", runId: "run-reported", summary: "执行结果已接受" });
  });

  it("records a revision reason once and never rewrites that decision", async () => {
    const { repository, service } = setup("agent-task");
    await service.review({ taskId: TASK.id, executionKind: "agent-task", executionId: "agent-reported", decision: "revision-requested", comment: "补充 Windows 安装验证" });

    expect(repository.state.agentTasks[0]).toMatchObject({
      status: "reported",
      acceptance: "revision-requested",
      acceptanceComment: "补充 Windows 安装验证",
      reviewedAt: REVIEWED_AT,
    });
    expect(repository.state.tasks[0]).toMatchObject({ stage: "planned" });
    const decided = repository.state;
    await expect(service.review({ taskId: TASK.id, executionKind: "agent-task", executionId: "agent-reported", decision: "accept", comment: "改成接受" }))
      .rejects.toThrow("历史执行已经被取代");
    expect(repository.state).toBe(decided);
  });

  it("blocks review while the task has a newer active execution", async () => {
    const base = initialState();
    const repository = new MemoryRepository(parseBoardState({
      ...base,
      tasks: base.tasks.map((task) => ({
        ...task,
        stage: "queued",
        executionAttempt: 2,
        activeAgentTaskId: "agent-active",
        awaitingReviewExecution: undefined,
      })),
      runs: base.runs.map((run) => ({ ...run, acceptance: "superseded", acceptanceComment: "由新执行取代" })),
      agentTasks: [
        ...base.agentTasks,
        {
          id: "agent-active", taskId: TASK.id, agentSnapshot: builder, kind: "direct", status: "queued",
          executionAttempt: 2, taskSpec: snapshotTaskSpec(TASK), acceptance: "not-ready", prompt: "新一轮执行", createdAt: REVIEWED_AT, updatedAt: REVIEWED_AT,
        },
      ],
    }));
    let id = 0;
    const service = new ExecutionReviewService({
      repository,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      emitChanged: () => undefined,
      now: () => REVIEWED_AT,
      id: () => `review-${++id}`,
    });
    const before = repository.state;
    await expect(service.review({ taskId: TASK.id, executionKind: "workflow", executionId: "run-reported", decision: "accept", comment: "" }))
      .rejects.toThrow("正在进行的执行");
    await expect(service.review({ taskId: TASK.id, executionKind: "agent-task", executionId: "agent-reported", decision: "revision-requested", comment: "先中止执行" }))
      .rejects.toThrow("正在进行的执行");
    await expect(service.review({ taskId: TASK.id, executionKind: "agent-task", executionId: "agent-reported", decision: "reject", comment: "先中止执行" }))
      .rejects.toThrow("正在进行的执行");
    expect(repository.state).toBe(before);
  });

  it("requires reasons for revision/rejection and rejects failed false-success review", async () => {
    const { repository, service } = setup("agent-task");
    repository.state = initialState();
    await expect(service.review({ taskId: TASK.id, executionKind: "workflow", executionId: "run-reported", decision: "reject", comment: "  " }))
      .rejects.toThrow("必须填写理由");
    repository.state = Object.freeze({
      ...repository.state,
      tasks: Object.freeze(repository.state.tasks.map((task) => Object.freeze({
        ...task,
        awaitingReviewExecution: Object.freeze({ kind: "agent-task" as const, id: "agent-reported", attempt: 1 }),
      }))),
      agentTasks: repository.state.agentTasks.map((agentTask) => ({
        ...agentTask,
        status: "failed",
        acceptance: "not-ready",
        output: undefined,
        error: "Runtime failed after a fluent final sentence",
      })),
    }) as BoardState;
    await expect(service.review({ taskId: TASK.id, executionKind: "agent-task", executionId: "agent-reported", decision: "accept", comment: "" }))
      .rejects.toThrow("尚未 reported");
    expect(repository.state.tasks[0]?.stage).toBe("review");
  });
});
