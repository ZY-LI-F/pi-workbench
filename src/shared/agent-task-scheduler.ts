import {
  isTerminalAgentTaskStatus,
  type AgentTask,
  type BoardState,
  type TaskPriority,
} from "./kanban";

export const AGENT_TASK_AGING_INTERVAL_MS = 15 * 60 * 1_000;

export type AgentTaskQueueDisposition = "ready" | "blocked" | "invalid";

export interface AgentTaskQueueEntry {
  readonly agentTask: AgentTask;
  readonly disposition: AgentTaskQueueDisposition;
  readonly reason: string;
  readonly queuePosition?: number;
  readonly effectivePriority: number;
  readonly waitingMinutes: number;
}

const PRIORITY_WEIGHT: Readonly<Record<TaskPriority, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
});

function delegationRound(agentTask: AgentTask): number {
  return agentTask.delegationRound ?? 1;
}

function dependencyDisposition(
  agentTask: AgentTask,
  byId: ReadonlyMap<string, AgentTask>,
  tasksById: ReadonlyMap<string, BoardState["tasks"][number]>,
  childrenByParent: ReadonlyMap<string, readonly AgentTask[]>,
): Pick<AgentTaskQueueEntry, "disposition" | "reason"> {
  const task = tasksById.get(agentTask.taskId);
  if (!task) return Object.freeze({ disposition: "invalid", reason: "引用的任务不存在" });

  let root = agentTask;
  const visited = new Set<string>([root.id]);
  while (root.parentAgentTaskId) {
    const parent = byId.get(root.parentAgentTaskId);
    if (!parent) return Object.freeze({ disposition: "invalid", reason: `父 AgentTask ${root.parentAgentTaskId} 不存在` });
    if (parent.taskId !== agentTask.taskId) return Object.freeze({ disposition: "invalid", reason: "父子 AgentTask 不属于同一任务" });
    if (visited.has(parent.id)) return Object.freeze({ disposition: "invalid", reason: "AgentTask 依赖存在循环" });
    visited.add(parent.id);
    root = parent;
  }

  if (task.activeAgentTaskId !== root.id) {
    return Object.freeze({ disposition: "invalid", reason: `不属于任务当前活动执行 ${task.activeAgentTaskId ?? "（无）"}` });
  }
  if (!agentTask.parentAgentTaskId) {
    return Object.freeze({ disposition: "ready", reason: "根 AgentTask 依赖已满足" });
  }

  const parent = byId.get(agentTask.parentAgentTaskId);
  if (!parent) return Object.freeze({ disposition: "invalid", reason: `父 AgentTask ${agentTask.parentAgentTaskId} 不存在` });
  if (parent.status === "queued" || parent.status === "running") {
    return Object.freeze({ disposition: "blocked", reason: `等待父 AgentTask ${parent.agentSnapshot.name} 完成本回合` });
  }
  if (parent.status !== "waiting_children") {
    return Object.freeze({ disposition: "invalid", reason: `父 AgentTask 状态 ${parent.status} 不允许启动子任务` });
  }

  if (agentTask.kind === "coordinator-review") {
    const round = delegationRound(agentTask);
    const unfinished = childrenByParent.get(parent.id)?.find((candidate) => candidate.parentAgentTaskId === parent.id
      && candidate.kind === "delegated"
      && delegationRound(candidate) === round
      && !isTerminalAgentTaskStatus(candidate.status));
    if (unfinished) {
      return Object.freeze({ disposition: "blocked", reason: `等待第 ${round} 轮成员 ${unfinished.agentSnapshot.name} 返回终态` });
    }
  }

  return Object.freeze({ disposition: "ready", reason: "父 AgentTask 已进入子任务阶段" });
}

/**
 * Projects the durable queue into dependency state and a starvation-free order.
 * Durable array position is the final tie-breaker; UUID lexical order is never execution semantics.
 */
export function deriveAgentTaskQueue(board: BoardState, now: string | number | Date): readonly AgentTaskQueueEntry[] {
  const nowMs = typeof now === "number" ? now : now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("AgentTask 调度时间无效");
  const byId = new Map(board.agentTasks.map((agentTask) => [agentTask.id, agentTask]));
  const tasksById = new Map(board.tasks.map((task) => [task.id, task]));
  const childrenByParent = new Map<string, AgentTask[]>();
  for (const agentTask of board.agentTasks) {
    if (!agentTask.parentAgentTaskId) continue;
    const siblings = childrenByParent.get(agentTask.parentAgentTaskId);
    if (siblings) siblings.push(agentTask);
    else childrenByParent.set(agentTask.parentAgentTaskId, [agentTask]);
  }
  const insertionIndex = new Map(board.agentTasks.map((agentTask, index) => [agentTask.id, index]));
  const entries = board.agentTasks
    .filter((agentTask) => agentTask.status === "queued")
    .map((agentTask) => {
      const waitingMs = Math.max(0, nowMs - Date.parse(agentTask.createdAt));
      const waitingMinutes = Math.floor(waitingMs / 60_000);
      const effectivePriority = PRIORITY_WEIGHT[agentTask.taskSpec.priority] + Math.floor(waitingMs / AGENT_TASK_AGING_INTERVAL_MS);
      const dependency = dependencyDisposition(agentTask, byId, tasksById, childrenByParent);
      return Object.freeze({ agentTask, ...dependency, effectivePriority, waitingMinutes });
    });
  const ready = entries
    .filter((entry) => entry.disposition === "ready")
    .sort((left, right) => right.effectivePriority - left.effectivePriority
      || Date.parse(left.agentTask.createdAt) - Date.parse(right.agentTask.createdAt)
      || (insertionIndex.get(left.agentTask.id) ?? 0) - (insertionIndex.get(right.agentTask.id) ?? 0));
  const positions = new Map(ready.map((entry, index) => [entry.agentTask.id, index + 1]));
  return Object.freeze(entries.map((entry) => Object.freeze({
    ...entry,
    queuePosition: positions.get(entry.agentTask.id),
  })));
}

export function nextRunnableAgentTask(board: BoardState, now: string | number | Date): AgentTaskQueueEntry | undefined {
  if (board.agentTasks.some((agentTask) => agentTask.status === "running")) return undefined;
  return deriveAgentTaskQueue(board, now).find((entry) => entry.queuePosition === 1);
}
