import { Bot, GitBranch, GitMerge, LoaderCircle, TriangleAlert } from "lucide-react";
import type { AgentTask } from "@shared/kanban";
import type { AgentTaskQueueEntry } from "@shared/agent-task-scheduler";
import { EXECUTION_STATUS_LABEL } from "./kanban-format";

interface AgentExecutionGraphProps {
  readonly agentTasks: readonly AgentTask[];
  readonly activeRootId?: string;
  readonly queueEntries?: readonly AgentTaskQueueEntry[];
}

function nodeRole(agentTask: AgentTask): string {
  if (agentTask.kind === "coordinator-review") return "Leader 验收";
  if (agentTask.kind === "coordinator") return agentTask.executionPlan?.kind === "squad" ? "Squad Leader" : "LEAD Coordinator";
  if (agentTask.kind === "squad-leader") return "Squad Leader（兼容执行）";
  if (agentTask.kind === "mention-root") return "Mention 根任务";
  if (agentTask.kind === "delegated") return "Worker 委派";
  return "直接执行";
}

function GraphNode({ agentTask, queueEntry }: { readonly agentTask: AgentTask; readonly queueEntry?: AgentTaskQueueEntry }) {
  const detail = agentTask.error
    ?? (queueEntry?.disposition === "ready"
      ? `全局队列第 ${queueEntry.queuePosition ?? "?"} 位`
      : queueEntry?.reason);
  return (
    <article className={`agent-execution-node agent-execution-node--${agentTask.status}`} title={detail}>
      <span className="agent-execution-node__icon">
        {agentTask.status === "running" ? <LoaderCircle className="spin" size={13} /> : agentTask.status === "failed" || agentTask.status === "protocol-invalid" ? <TriangleAlert size={13} /> : <Bot size={13} />}
      </span>
      <span><strong>{agentTask.agentSnapshot.name}</strong><small>{nodeRole(agentTask)}</small>{detail && <em>{detail}</em>}</span>
      <b>{EXECUTION_STATUS_LABEL[agentTask.status] ?? agentTask.status}</b>
    </article>
  );
}

export function AgentExecutionGraph({ agentTasks, activeRootId, queueEntries = [] }: AgentExecutionGraphProps) {
  const roots = agentTasks.map((agentTask, index) => Object.freeze({ agentTask, index }))
    .filter((candidate) => !candidate.agentTask.parentAgentTaskId)
    .sort((left, right) => Date.parse(right.agentTask.createdAt) - Date.parse(left.agentTask.createdAt) || right.index - left.index)
    .map((candidate) => candidate.agentTask);
  const root = roots.find((candidate) => candidate.id === activeRootId) ?? roots[0];
  if (!root) return null;
  const children = agentTasks.filter((candidate) => candidate.parentAgentTaskId === root.id);
  const queueById = new Map(queueEntries.map((entry) => [entry.agentTask.id, entry]));
  const rounds = [...new Set(children.map((candidate) => candidate.delegationRound ?? 1))].sort((left, right) => left - right);

  return (
    <section className="agent-execution-graph" aria-label="Agent 执行图">
      <header><div><small>AGENT EXECUTION GRAPH</small><h3>团队执行图</h3></div><span>{1 + children.length} 个节点</span></header>
      <div className="agent-execution-graph__root"><GraphNode agentTask={root} queueEntry={queueById.get(root.id)} /></div>
      {rounds.map((round) => {
        const roundNodes = children
          .filter((candidate) => (candidate.delegationRound ?? 1) === round)
          .sort((left, right) => Number(left.kind === "coordinator-review") - Number(right.kind === "coordinator-review") || Date.parse(left.createdAt) - Date.parse(right.createdAt));
        const delegated = roundNodes.filter((candidate) => candidate.kind !== "coordinator-review");
        const reviews = roundNodes.filter((candidate) => candidate.kind === "coordinator-review");
        return <div className="agent-execution-round" key={round}>
          <div className="agent-execution-round__label"><GitBranch size={12} /><span>第 {round} 轮</span></div>
          {delegated.length > 0 && <div className="agent-execution-round__nodes">{delegated.map((candidate) => <GraphNode key={candidate.id} agentTask={candidate} queueEntry={queueById.get(candidate.id)} />)}</div>}
          {reviews.map((candidate) => <div key={candidate.id} className="agent-execution-round__merge"><GitMerge size={13} /><GraphNode agentTask={candidate} queueEntry={queueById.get(candidate.id)} /></div>)}
        </div>;
      })}
    </section>
  );
}
