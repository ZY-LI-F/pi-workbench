import type { BoardState, KanbanTask } from "./kanban";

export interface TeamTaskAttention {
  readonly taskId: string;
  readonly requiresHuman: boolean;
  readonly reasons: readonly string[];
}

/** Human-facing projection only. Agents continue to consume durable execution state, not an inbox. */
export function deriveTeamTaskAttention(board: BoardState, task: KanbanTask): TeamTaskAttention {
  const reasons: string[] = [];
  if (task.stage === "blocked") reasons.push(task.blockedReason ?? "执行受阻，需要处理");
  if (task.awaitingReviewExecution) reasons.push("执行报告等待验收");

  if (task.activeAgentTaskId) {
    const root = board.agentTasks.find((candidate) => candidate.id === task.activeAgentTaskId);
    if (root?.status === "waiting_human") reasons.push("Coordinator 等待你的回复");
  }

  if (task.activeRunId) {
    const run = board.runs.find((candidate) => candidate.id === task.activeRunId);
    const step = run?.currentStepId ? run.steps.find((candidate) => candidate.stepId === run.currentStepId) : undefined;
    if (step?.stepKind === "human-gate" && step.status === "waiting") reasons.push(`人工关卡「${step.name}」等待决定`);
  }

  return Object.freeze({ taskId: task.id, requiresHuman: reasons.length > 0, reasons: Object.freeze(reasons) });
}
