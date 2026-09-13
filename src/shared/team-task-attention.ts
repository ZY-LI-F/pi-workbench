import type { AgentTask, BoardState, KanbanTask, WorkflowRun } from "./kanban";

export interface TeamTaskAttention {
  readonly taskId: string;
  readonly requiresHuman: boolean;
  readonly reasons: readonly string[];
}

/** Human-facing projection only. Agents continue to consume durable execution state, not an inbox. */
export function deriveTeamTaskAttention(board: BoardState, task: KanbanTask): TeamTaskAttention {
  return taskAttention(task,
    task.activeAgentTaskId ? board.agentTasks.find((candidate) => candidate.id === task.activeAgentTaskId) : undefined,
    task.activeRunId ? board.runs.find((candidate) => candidate.id === task.activeRunId) : undefined);
}

/** One lookup pass for project-wide projections; shares the same attention rules as Task Room. */
export function deriveBoardTaskAttention(board: BoardState): ReadonlyMap<string, TeamTaskAttention> {
  const agents = new Map(board.agentTasks.map((agent) => [agent.id, agent]));
  const runs = new Map(board.runs.map((run) => [run.id, run]));
  return new Map(board.tasks.map((task) => [task.id, taskAttention(task,
    task.activeAgentTaskId ? agents.get(task.activeAgentTaskId) : undefined,
    task.activeRunId ? runs.get(task.activeRunId) : undefined)]));
}

function taskAttention(task: KanbanTask, root?: AgentTask, run?: WorkflowRun): TeamTaskAttention {
  const reasons: string[] = [];
  if (task.stage === "blocked") reasons.push(task.blockedReason ?? "执行受阻，需要处理");
  if (task.awaitingReviewExecution) reasons.push("执行报告等待验收");
  if (task.stage === "review" && task.executionTarget.kind === "manual") reasons.push("手工任务等待审核");

  if (task.activeAgentTaskId) {
    if (root?.status === "waiting_human") reasons.push("Coordinator 等待你的回复");
  }

  if (task.activeRunId) {
    const step = run?.currentStepId ? run.steps.find((candidate) => candidate.stepId === run.currentStepId) : undefined;
    if (step?.stepKind === "human-gate" && step.status === "waiting") reasons.push(`人工关卡「${step.name}」等待决定`);
  }

  return Object.freeze({ taskId: task.id, requiresHuman: reasons.length > 0, reasons: Object.freeze(reasons) });
}
