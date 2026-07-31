// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EMPTY_BOARD_STATE, type AgentTask, type KanbanTask } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import {
  beginAgentExecution,
  reportAgentExecution,
  snapshotTaskSpec,
  supersedePendingExecutions,
} from "../../src/shared/execution-state";

const BUILDER = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
if (!BUILDER) throw new Error("测试目录缺少 builder");

const TASK: KanbanTask = Object.freeze({
  id: "task-attempt",
  title: "执行尝试隔离",
  description: "",
  acceptanceCriteria: "只验收当前执行",
  priority: "high",
  projectPath: "C:/project",
  projectName: "project",
  trusted: true,
  executionTarget: Object.freeze({ kind: "agent", agentId: BUILDER.id }),
  stage: "review",
  specRevision: 1,
  executionAttempt: 1,
  awaitingReviewExecution: Object.freeze({ kind: "agent-task", id: "old-root", attempt: 1 }),
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:01:00.000Z",
});

const OLD_ROOT: AgentTask = Object.freeze({
  id: "old-root",
  taskId: TASK.id,
  executionAttempt: 1,
  taskSpec: snapshotTaskSpec(TASK),
  agentSnapshot: BUILDER,
  kind: "direct",
  status: "reported",
  acceptance: "pending",
  prompt: "旧执行",
  output: "旧报告",
  createdAt: TASK.createdAt,
  updatedAt: TASK.updatedAt,
  completedAt: TASK.updatedAt,
});

describe("Task execution attempt identity", () => {
  it("supersedes the prior report before opening a new execution attempt", () => {
    const state = supersedePendingExecutions(Object.freeze({
      ...EMPTY_BOARD_STATE,
      tasks: Object.freeze([TASK]),
      agentTasks: Object.freeze([OLD_ROOT]),
    }), TASK.id);
    const next = beginAgentExecution(state.tasks[0] as KanbanTask, "new-root", 2, "2026-07-18T00:02:00.000Z");

    expect(state.agentTasks[0]).toMatchObject({ acceptance: "superseded", acceptanceComment: "已由更新的执行尝试取代" });
    expect(next).toMatchObject({ stage: "queued", executionAttempt: 2, activeAgentTaskId: "new-root" });
    expect(next.awaitingReviewExecution).toBeUndefined();
  });

  it("refuses to let a stale completion report mutate the new Task lifecycle", () => {
    const current = beginAgentExecution(TASK, "new-root", 2, "2026-07-18T00:02:00.000Z");

    expect(() => reportAgentExecution(current, OLD_ROOT, "2026-07-18T00:03:00.000Z"))
      .toThrow("不是任务 task-attempt 的当前执行");
    expect(current).toMatchObject({ stage: "queued", activeAgentTaskId: "new-root", executionAttempt: 2 });
  });

  it("refuses a result from an old Task specification even when the attempt number matches", () => {
    const revised = Object.freeze({ ...TASK, specRevision: 2, executionAttempt: 2, stage: "running" as const, activeAgentTaskId: "same-attempt", awaitingReviewExecution: undefined });
    const stale = Object.freeze({ ...OLD_ROOT, id: "same-attempt", executionAttempt: 2, taskSpec: snapshotTaskSpec(TASK) });

    expect(() => reportAgentExecution(revised, stale, "2026-07-18T00:04:00.000Z"))
      .toThrow("不属于任务 task-attempt 的当前规格与执行尝试");
  });
});
