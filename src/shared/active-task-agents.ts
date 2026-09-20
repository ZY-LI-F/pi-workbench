import { isTerminalAgentTaskStatus, type AgentTask, type KanbanTask } from "./kanban";

/** Only running nodes in the current execution tree are current executors. */
export function activeTaskAgents(task: KanbanTask, agentTasks: readonly AgentTask[]): readonly AgentTask[] {
  const root = agentTasks.find((candidate) => candidate.id === task.activeAgentTaskId && candidate.taskId === task.id && !candidate.parentAgentTaskId);
  if (!root || isTerminalAgentTaskStatus(root.status)) return [];
  const children = new Map<string, AgentTask[]>();
  for (const candidate of agentTasks) {
    if (candidate.taskId !== task.id || candidate.executionAttempt !== root.executionAttempt
      || candidate.taskSpec.revision !== root.taskSpec.revision || !candidate.parentAgentTaskId) continue;
    const siblings = children.get(candidate.parentAgentTaskId);
    if (siblings) siblings.push(candidate);
    else children.set(candidate.parentAgentTaskId, [candidate]);
  }
  const pending = [root];
  const visited = new Set<string>();
  const running: AgentTask[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    if (node.status === "running") running.push(node);
    if (!isTerminalAgentTaskStatus(node.status)) {
      for (const child of children.get(node.id) ?? []) pending.push(child);
    }
  }
  return running.sort((left, right) => Date.parse(left.startedAt ?? left.createdAt) - Date.parse(right.startedAt ?? right.createdAt) || left.id.localeCompare(right.id));
}
