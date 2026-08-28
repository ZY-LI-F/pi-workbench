import { applyTaskLifecycle, type TaskLifecycleEvent } from "./task-lifecycle";
import { cloneExecutionWorkspacePreference, type AgentTask, type BoardState, type ExecutionReference, type KanbanTask, type TaskSpecSnapshot, type WorkflowRun } from "./kanban";

const SUPERSEDED_REASON = "已由更新的执行尝试取代";

export function nextExecutionAttempt(task: KanbanTask): number {
  return (task.executionAttempt ?? 0) + 1;
}

export function snapshotTaskSpec(task: KanbanTask): TaskSpecSnapshot {
  return Object.freeze({
    revision: task.specRevision,
    title: task.title,
    description: task.description,
    acceptanceCriteria: task.acceptanceCriteria,
    priority: task.priority,
    executionTarget: Object.freeze({ ...task.executionTarget }),
    executionProfileId: task.executionProfileId,
    executionWorkspace: cloneExecutionWorkspacePreference(task.executionWorkspace),
  });
}

export function supersedePendingExecutions(state: BoardState, taskId: string, reason = SUPERSEDED_REASON): BoardState {
  return Object.freeze({
    ...state,
    runs: Object.freeze(state.runs.map((run) => run.taskId === taskId && run.status === "reported" && run.acceptance === "pending"
      ? Object.freeze({ ...run, acceptance: "superseded" as const, acceptanceComment: reason })
      : run)),
    agentTasks: Object.freeze(state.agentTasks.map((agentTask) => agentTask.taskId === taskId
      && agentTask.parentAgentTaskId === undefined
      && agentTask.status === "reported"
      && agentTask.acceptance === "pending"
      ? Object.freeze({ ...agentTask, acceptance: "superseded" as const, acceptanceComment: reason })
      : agentTask)),
  });
}

function assertNextAttempt(task: KanbanTask, attempt: number): void {
  const expected = nextExecutionAttempt(task);
  if (attempt !== expected) throw new Error(`任务 ${task.id} 的执行尝试应为 ${expected}，实际为 ${attempt}`);
}

export function beginWorkflowExecution(task: KanbanTask, runId: string, attempt: number, now: string): KanbanTask {
  assertNextAttempt(task, attempt);
  return applyTaskLifecycle(Object.freeze({
    ...task,
    executionAttempt: attempt,
    awaitingReviewExecution: undefined,
    activeAgentTaskId: undefined,
    activeRunId: runId,
  }), { type: "execution-queued" }, now);
}

export function beginAgentExecution(task: KanbanTask, agentTaskId: string, attempt: number, now: string): KanbanTask {
  assertNextAttempt(task, attempt);
  return applyTaskLifecycle(Object.freeze({
    ...task,
    executionAttempt: attempt,
    awaitingReviewExecution: undefined,
    activeRunId: undefined,
    activeAgentTaskId: agentTaskId,
  }), { type: "execution-queued" }, now);
}

function awaitingReference(
  task: KanbanTask,
  kind: ExecutionReference["kind"],
  execution: Pick<WorkflowRun | AgentTask, "id" | "executionAttempt" | "taskSpec">,
): ExecutionReference {
  const attempt = task.executionAttempt ?? 0;
  if (execution.executionAttempt !== attempt || execution.taskSpec.revision !== task.specRevision) {
    throw new Error(`执行 ${execution.id} 不属于任务 ${task.id} 的当前规格与执行尝试`);
  }
  return Object.freeze({ kind, id: execution.id, attempt });
}

export function reportWorkflowExecution(task: KanbanTask, run: Pick<WorkflowRun, "id" | "executionAttempt" | "taskSpec">, now: string): KanbanTask {
  if (task.activeRunId !== run.id) throw new Error(`WorkflowRun ${run.id} 不是任务 ${task.id} 的当前执行`);
  return applyTaskLifecycle(Object.freeze({
    ...task,
    activeRunId: undefined,
    awaitingReviewExecution: awaitingReference(task, "workflow", run),
  }), { type: "execution-reported" }, now);
}

export function reportAgentExecution(task: KanbanTask, agentTask: Pick<AgentTask, "id" | "executionAttempt" | "taskSpec">, now: string): KanbanTask {
  if (task.activeAgentTaskId !== agentTask.id) throw new Error(`AgentTask ${agentTask.id} 不是任务 ${task.id} 的当前执行`);
  return applyTaskLifecycle(Object.freeze({
    ...task,
    activeAgentTaskId: undefined,
    awaitingReviewExecution: awaitingReference(task, "agent-task", agentTask),
  }), { type: "execution-reported" }, now);
}

export function finishExecutionLifecycle(task: KanbanTask, event: TaskLifecycleEvent, now: string): KanbanTask {
  return applyTaskLifecycle(Object.freeze({
    ...task,
    activeRunId: undefined,
    activeAgentTaskId: undefined,
    awaitingReviewExecution: undefined,
  }), event, now);
}
