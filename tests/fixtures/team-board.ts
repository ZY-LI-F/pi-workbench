import { EMPTY_BOARD_STATE, type AgentTask, type BoardState, type KanbanTask } from "../../src/shared/kanban";
import { snapshotExecutionProfile } from "../../src/shared/execution-profile";
import { snapshotTaskSpec } from "../../src/shared/execution-state";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

/** A deterministic UI regression fixture, not evidence of a real model run. */
export function teamBoardFixture(projectPath = "C:/project"): BoardState {
  const now = "2026-09-19T08:00:00.000Z";
  const task: KanbanTask = {
    id: "team-regression", title: "多轮团队验收", description: "包含同轮两次 Leader 验收的布局回归数据。",
    acceptanceCriteria: "节点完整可读，报告必须由用户验收。", projectPath, projectName: "project", trusted: false,
    priority: "medium", executionTarget: { kind: "agent", agentId: "lead" }, executionProfileId: "pi.rpc",
    stage: "review", specRevision: 1, executionAttempt: 1,
    awaitingReviewExecution: { kind: "agent-task", id: "lead-root", attempt: 1 }, createdAt: now, updatedAt: now,
  };
  const node = (id: string, agentId: string, kind: AgentTask["kind"], offset: number): AgentTask => {
    const time = new Date(Date.parse(now) + offset * 60_000).toISOString();
    const agentSnapshot = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === agentId)!;
    return {
      id, taskId: task.id, executionAttempt: 1, taskSpec: snapshotTaskSpec(task), executionProfile: snapshotExecutionProfile("pi.rpc"),
      agentSnapshot, kind, status: "reported", acceptance: kind === "coordinator" ? "pending" : "not-ready", prompt: "布局回归数据",
      ...(kind !== "coordinator" ? { parentAgentTaskId: "lead-root", delegationRound: 1 } : {}),
      output: "仅为自动化测试数据，不是模型执行结果。", createdAt: time, updatedAt: time, startedAt: time, completedAt: time,
    };
  };
  return {
    ...EMPTY_BOARD_STATE, tasks: [task],
    agentTasks: [node("lead-root", "lead", "coordinator", 0), node("review-after-human", "lead", "coordinator-review", 1),
      node("scout", "scout", "delegated", 2), node("review-after-scout", "lead", "coordinator-review", 3)],
  };
}
