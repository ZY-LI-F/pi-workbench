import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Bot, Check, Folder, GitBranch, MessageSquareShare, Sparkles, UserRound, Users } from "lucide-react";
import type {
  AgentDefinition,
  CreateTaskInput,
  ExecutionTarget,
  KanbanTask,
  Squad,
  TaskPriority,
  UpdateTaskInput,
  WorkflowDefinition,
} from "@shared/kanban";
import type { ProjectMeta } from "@shared/contracts";
import { Modal } from "../../components/Modal";
import type { PiTaskDraft } from "./pi-task-draft";
import type { ExecutionBackendCatalogSnapshot, ExecutionProfileId } from "@shared/execution-profile";
import { ExecutionProfilePicker, executionProfileOptions } from "./ExecutionProfilePicker";

interface TaskEditorDialogProps {
  readonly task?: KanbanTask;
  readonly draft?: PiTaskDraft;
  readonly project: ProjectMeta;
  readonly workflows: readonly WorkflowDefinition[];
  readonly agents: readonly AgentDefinition[];
  readonly squads: readonly Squad[];
  readonly automationEnabled?: boolean;
  readonly executionBackends?: ExecutionBackendCatalogSnapshot;
  readonly piExecutionEnabled?: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onCreate: (input: CreateTaskInput) => Promise<void>;
  readonly onUpdate: (input: UpdateTaskInput) => Promise<void>;
}

const PRIORITIES: readonly { readonly value: TaskPriority; readonly label: string }[] = Object.freeze([
  { value: "low", label: "低" },
  { value: "medium", label: "普通" },
  { value: "high", label: "高" },
  { value: "urgent", label: "紧急" },
]);

function targetId(target: ExecutionTarget | undefined): string {
  if (!target || target.kind === "manual") return "manual";
  if (target.kind === "workflow") return target.workflowId;
  if (target.kind === "agent") return target.agentId;
  return target.squadId;
}

export function TaskEditorDialog({
  task,
  draft,
  project,
  workflows,
  agents,
  squads,
  automationEnabled = true,
  executionBackends,
  piExecutionEnabled = true,
  busy,
  onClose,
  onCreate,
  onUpdate,
}: TaskEditorDialogProps) {
  const [title, setTitle] = useState(task?.title ?? draft?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? draft?.description ?? "");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(task?.acceptanceCriteria ?? draft?.acceptanceCriteria ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? draft?.priority ?? "medium");
  const [executionKind, setExecutionKind] = useState<ExecutionTarget["kind"]>(task?.executionTarget.kind ?? "manual");
  const [executionId, setExecutionId] = useState(targetId(task?.executionTarget));
  const [executionProfileId, setExecutionProfileId] = useState<ExecutionProfileId>(task?.executionProfileId ?? "pi.rpc");
  const [error, setError] = useState("");
  const showAutomationChoices = automationEnabled || (task !== undefined && task.executionTarget.kind !== "manual");
  const executionTarget: ExecutionTarget = useMemo(() => executionKind === "manual"
    ? { kind: "manual" }
    : executionKind === "workflow"
      ? { kind: "workflow", workflowId: executionId }
      : executionKind === "agent"
        ? { kind: "agent", agentId: executionId }
        : { kind: "squad", squadId: executionId }, [executionId, executionKind]);
  const targetAgents = useMemo(() => {
    const ids = executionTarget.kind === "agent"
      ? [executionTarget.agentId]
      : executionTarget.kind === "workflow"
        ? workflows.find((workflow) => workflow.id === executionTarget.workflowId)?.steps.flatMap((step) => step.kind === "agent" ? [step.agentId] : []) ?? []
        : executionTarget.kind === "squad"
          ? (() => {
              const squad = squads.find((candidate) => candidate.id === executionTarget.squadId);
              return squad ? [squad.leaderAgentId, ...squad.memberAgentIds] : [];
            })()
          : [];
    return Object.freeze([...new Set(ids)].flatMap((id) => agents.find((agent) => agent.id === id) ?? []));
  }, [agents, executionTarget, squads, workflows]);
  const profileOptions = useMemo(() => executionTarget.kind === "manual" ? Object.freeze([]) : executionProfileOptions({
    target: executionTarget,
    agents: targetAgents,
    gitRepository: Boolean(project.branch),
    snapshot: executionBackends,
    piExecutionEnabled,
  }), [executionBackends, executionTarget, piExecutionEnabled, project.branch, targetAgents]);
  const targetSignature = `${executionKind}:${executionId}`;
  const initialTargetSignature = useRef(targetSignature);

  useEffect(() => {
    const current = profileOptions.find((option) => option.id === executionProfileId);
    const preservesUnavailableHistory = Boolean(task)
      && targetSignature === initialTargetSignature.current
      && executionProfileId === task?.executionProfileId;
    if (!current?.selectable && !preservesUnavailableHistory) {
      const fallback = profileOptions.find((option) => option.selectable);
      if (fallback) setExecutionProfileId(fallback.id);
    }
  }, [executionProfileId, profileOptions, targetSignature, task]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError("请填写任务标题");
      return;
    }
    if (executionKind !== "manual" && !executionId) {
      setError("请选择执行目标");
      return;
    }
    const selectedProfile = profileOptions.find((option) => option.id === executionProfileId);
    const preservesUnavailableHistory = Boolean(task)
      && targetSignature === initialTargetSignature.current
      && executionProfileId === task?.executionProfileId;
    if (executionKind !== "manual" && !selectedProfile?.selectable && !preservesUnavailableHistory) {
      setError(selectedProfile?.reason ?? "当前没有可用的执行环境");
      return;
    }
    const selectedProfileId = executionKind === "manual" ? undefined : executionProfileId;
    setError("");
    try {
      if (task) {
        await onUpdate({ taskId: task.id, title, description, acceptanceCriteria, priority, executionTarget, executionProfileId: selectedProfileId });
      } else {
        await onCreate({
          title,
          description,
          acceptanceCriteria,
          priority,
          executionTarget,
          executionProfileId: selectedProfileId,
          projectPath: project.cwd,
          projectName: project.name,
          trusted: project.trusted,
          sourceSession: draft?.sourceSession,
        });
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Modal
      title={task ? "编辑任务" : "创建看板任务"}
      eyebrow={task ? "REFINE MISSION" : "NEW MISSION"}
      onClose={onClose}
      className="task-editor"
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="task-editor__project">
          <span><Folder size={14} />{project.name}</span>
          {project.branch && <span><GitBranch size={13} />{project.branch}</span>}
          <small>{task ? "任务项目创建后保持不变" : project.cwd}</small>
        </div>

        {!task && draft && (
          <div className="task-editor__pi-source">
            <MessageSquareShare size={15} />
            <div><strong>来自当前 Pi 会话的可编辑草稿</strong><small>保存后只创建待规划任务，不会自动分发。来源 session identity 将随任务保存。</small></div>
          </div>
        )}

        <label className="kanban-field">
          <span>任务标题 <i>必填</i></span>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="清楚描述要交付的结果" />
        </label>

        <label className="kanban-field">
          <span>任务说明</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="背景、边界、用户场景与不能破坏的内容" />
        </label>

        <label className="kanban-field">
          <span>验收标准</span>
          <textarea value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} rows={3} placeholder="完成后必须能被验证的条件" />
        </label>

        <div className="task-editor__row">
          <label className="kanban-field">
            <span>优先级</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
              {PRIORITIES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
            </select>
          </label>
          <div className="kanban-field">
            <span>推进方式</span>
            <div className="execution-kind-picker" role="tablist" aria-label="执行目标类型">
              {([
                ["manual", "自己推进", UserRound],
                ["workflow", "固定流程", Sparkles],
                ["agent", "单 Agent", Bot],
                ["squad", "动态 Squad", Users],
              ] as const).filter(([kind]) => kind === "manual" || showAutomationChoices).map(([kind, label, Icon]) => (
                <button type="button" role="tab" aria-selected={executionKind === kind} className={executionKind === kind ? "is-selected" : ""} key={kind} onClick={() => {
                  setExecutionKind(kind);
                  setExecutionId(kind === "manual" ? "manual" : kind === "workflow" ? workflows[0]?.id ?? "" : kind === "agent" ? agents[0]?.id ?? "" : squads[0]?.id ?? "");
                }}><Icon size={12} />{label}</button>
              ))}
            </div>
            <div className="workflow-picker">
              {executionKind === "manual" && (
                <div className="manual-execution-choice">
                  <span><UserRound size={15} />由你掌控进度</span>
                  <small>创建后不会调用模型。可直接把任务拖到执行中、待审核、受阻或已完成。</small>
                </div>
              )}
              {executionKind === "workflow" && workflows.map((workflow) => (
                <button
                  type="button"
                  className={workflow.id === executionId ? "is-selected" : ""}
                  key={workflow.id}
                  onClick={() => setExecutionId(workflow.id)}
                >
                  <span><Sparkles size={13} />{workflow.shortName}</span>
                  <small>{workflow.steps.length} 个步骤</small>
                  {workflow.id === executionId && <Check size={14} />}
                </button>
              ))}
              {executionKind === "agent" && agents.map((agent) => (
                <button type="button" className={agent.id === executionId ? "is-selected" : ""} key={agent.id} onClick={() => setExecutionId(agent.id)}>
                  <span><Bot size={13} />{agent.name}</span><small>@{agent.id} · {agent.workspaceAccess === "write" ? "可写" : "只读"}</small>
                  {agent.id === executionId && <Check size={14} />}
                </button>
              ))}
              {executionKind === "squad" && squads.map((squad) => (
                <button type="button" className={squad.id === executionId ? "is-selected" : ""} key={squad.id} onClick={() => setExecutionId(squad.id)}>
                  <span><Users size={13} />{squad.name}</span><small>Leader + {squad.memberAgentIds.length} 位成员</small>
                  {squad.id === executionId && <Check size={14} />}
                </button>
              ))}
              {executionKind === "squad" && squads.length === 0 && <p className="workflow-picker__empty">请先在自动化工作室创建 Squad。</p>}
            </div>
          </div>
        </div>

        {executionKind !== "manual" && (
          <div className="kanban-field">
            <span>执行环境</span>
            <ExecutionProfilePicker options={profileOptions} value={executionProfileId} onChange={setExecutionProfileId} />
            <small>环境只决定实际 CLI；推进方式、任务生命周期和人工验收仍由 Stella 管理。</small>
          </div>
        )}

        {error && <p className="kanban-form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="button-primary" disabled={busy}>{busy ? "保存中…" : task ? "保存任务" : "创建任务"}</button>
        </div>
      </form>
    </Modal>
  );
}
