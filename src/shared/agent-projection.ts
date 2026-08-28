import type {
  ExternalExecutionCatalogSnapshot,
  ExternalExecutionItem,
  ExternalExecutionSourceSnapshot,
} from "./external-execution";
import type {
  AgentTask,
  AgentTaskStatus,
  BoardState,
  KanbanTask,
  StepRun,
  StepRunStatus,
  TaskStage,
  WorkflowRun,
} from "./kanban";

export const AGENT_PROJECTION_BUCKETS = ["attention", "working", "recent", "idle"] as const;
export type AgentProjectionBucket = (typeof AGENT_PROJECTION_BUCKETS)[number];

export type AgentProjectionKind = "agent-task" | "workflow-step" | "external";

export type AgentProjectionState =
  | { readonly domain: "agent-task"; readonly value: AgentTaskStatus }
  | { readonly domain: "workflow-step"; readonly value: StepRunStatus }
  | { readonly domain: "external"; readonly value: ExternalExecutionItem["state"] };

export type AgentProjectionAttentionReason =
  | "waiting-human"
  | "human-gate"
  | "review"
  | "needs-input"
  | "failed"
  | "protocol-invalid";

export interface AgentProjectionSourceFreshness {
  readonly state: ExternalExecutionSourceSnapshot["state"];
  readonly stale: boolean;
  readonly lastSuccessfulAt?: string;
  readonly error?: string;
}

export interface AgentProjectionCard {
  readonly id: string;
  readonly kind: AgentProjectionKind;
  readonly bucket: AgentProjectionBucket;
  readonly state: AgentProjectionState;
  readonly title: string;
  readonly taskTitle?: string;
  readonly summary?: string;
  readonly projectPath: string;
  readonly taskId?: string;
  readonly taskStage?: TaskStage;
  readonly runId?: string;
  readonly stepId?: string;
  readonly agentTaskId?: string;
  readonly parentId?: string;
  readonly backendId?: string;
  readonly sourceLabel?: string;
  readonly needsInput: boolean;
  readonly waitingFor?: string;
  readonly attentionReason?: AgentProjectionAttentionReason;
  readonly updatedAt: string;
  readonly freshness?: AgentProjectionSourceFreshness;
  /** Normalized external value retained for adapter-owned actions in desktop clients. */
  readonly external?: ExternalExecutionItem;
}

export interface AgentProjection {
  readonly cards: readonly AgentProjectionCard[];
  readonly buckets: Readonly<Record<AgentProjectionBucket, readonly AgentProjectionCard[]>>;
}

export interface ProjectAgentActivityInput {
  readonly board?: Pick<BoardState, "tasks" | "runs" | "agentTasks">;
  readonly external?: ExternalExecutionCatalogSnapshot;
}

const BUCKET_RANK: Readonly<Record<AgentProjectionBucket, number>> = Object.freeze({
  attention: 0,
  working: 1,
  recent: 2,
  idle: 3,
});

const ATTENTION_RANK: Readonly<Record<AgentProjectionAttentionReason, number>> = Object.freeze({
  "human-gate": 0,
  "waiting-human": 1,
  "needs-input": 1,
  review: 2,
  failed: 3,
  "protocol-invalid": 3,
});

function optionalText(value: string | undefined, limit = 240): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function cloneExternal(item: ExternalExecutionItem): ExternalExecutionItem {
  return Object.freeze({
    ...item,
    session: Object.freeze({ ...item.session }),
    process: item.process ? Object.freeze({ ...item.process }) : undefined,
    association: item.association ? Object.freeze({ ...item.association }) : undefined,
  });
}

function agentTaskPresentation(agentTask: AgentTask): {
  readonly bucket: AgentProjectionBucket;
  readonly attentionReason?: AgentProjectionAttentionReason;
  readonly needsInput: boolean;
} {
  if (agentTask.status === "waiting_human") return { bucket: "attention", attentionReason: "waiting-human", needsInput: true };
  if (agentTask.status === "protocol-invalid") return { bucket: "attention", attentionReason: "protocol-invalid", needsInput: false };
  if (agentTask.status === "failed") return { bucket: "attention", attentionReason: "failed", needsInput: false };
  if (agentTask.status === "reported" && agentTask.acceptance === "pending") {
    return { bucket: "attention", attentionReason: "review", needsInput: true };
  }
  if (agentTask.status === "queued" || agentTask.status === "running" || agentTask.status === "waiting_children") {
    return { bucket: "working", needsInput: false };
  }
  return { bucket: "recent", needsInput: false };
}

function projectAgentTask(agentTask: AgentTask, task: KanbanTask | undefined): AgentProjectionCard {
  const presentation = agentTaskPresentation(agentTask);
  const summary = optionalText(agentTask.error ?? agentTask.output);
  return Object.freeze({
    id: `managed:agent-task:${agentTask.id}`,
    kind: "agent-task",
    bucket: presentation.bucket,
    state: Object.freeze({ domain: "agent-task", value: agentTask.status }),
    title: agentTask.agentSnapshot.name,
    taskTitle: task?.title ?? agentTask.taskSpec.title,
    ...(summary ? { summary } : {}),
    projectPath: task?.projectPath ?? "",
    taskId: agentTask.taskId,
    ...(task ? { taskStage: task.stage } : {}),
    agentTaskId: agentTask.id,
    ...(agentTask.parentAgentTaskId ? { parentId: `managed:agent-task:${agentTask.parentAgentTaskId}` } : {}),
    backendId: agentTask.executionProfile.backendId,
    needsInput: presentation.needsInput,
    ...(agentTask.status === "waiting_human" ? { waitingFor: "等待你的回复" } : {}),
    ...(presentation.attentionReason ? { attentionReason: presentation.attentionReason } : {}),
    updatedAt: agentTask.updatedAt,
  });
}

function workflowStepPresentation(run: WorkflowRun, step: StepRun): {
  readonly bucket: AgentProjectionBucket;
  readonly attentionReason?: AgentProjectionAttentionReason;
  readonly needsInput: boolean;
} {
  if (step.stepKind === "human-gate" && step.status === "waiting") {
    return { bucket: "attention", attentionReason: "human-gate", needsInput: true };
  }
  if (step.status === "failed" || run.status === "failed" || run.status === "blocked") {
    return { bucket: "attention", attentionReason: "failed", needsInput: false };
  }
  if ((run.status === "review" || run.status === "reported") && run.acceptance === "pending") {
    return { bucket: "attention", attentionReason: "review", needsInput: true };
  }
  if (step.status === "pending") return { bucket: "idle", needsInput: false };
  if (step.status === "running" || step.status === "waiting" || run.status === "queued" || run.status === "running") {
    return { bucket: "working", needsInput: false };
  }
  return { bucket: "recent", needsInput: false };
}

function currentWorkflowStep(run: WorkflowRun): StepRun | undefined {
  return run.steps.find((step) => step.id === run.currentStepId)
    ?? [...run.steps].reverse().find((step) => step.status !== "pending")
    ?? run.steps[0];
}

function projectWorkflowRun(run: WorkflowRun, task: KanbanTask | undefined): AgentProjectionCard | undefined {
  const step = currentWorkflowStep(run);
  if (!step) return undefined;
  const presentation = workflowStepPresentation(run, step);
  const summary = optionalText(step.error ?? step.artifact?.content);
  return Object.freeze({
    id: `managed:workflow-step:${run.id}:${step.id}`,
    kind: "workflow-step",
    bucket: presentation.bucket,
    state: Object.freeze({ domain: "workflow-step", value: step.status }),
    title: step.name,
    taskTitle: task?.title ?? run.taskSpec.title,
    ...(summary ? { summary } : {}),
    projectPath: task?.projectPath ?? "",
    taskId: run.taskId,
    ...(task ? { taskStage: task.stage } : {}),
    runId: run.id,
    stepId: step.id,
    parentId: `managed:workflow:${run.id}`,
    backendId: run.executionProfile.backendId,
    needsInput: presentation.needsInput,
    ...(presentation.attentionReason === "human-gate" ? { waitingFor: "等待人工关卡决策" } : {}),
    ...(presentation.attentionReason ? { attentionReason: presentation.attentionReason } : {}),
    updatedAt: step.completedAt ?? step.startedAt ?? run.updatedAt,
  });
}

function externalPresentation(item: ExternalExecutionItem): {
  readonly bucket: AgentProjectionBucket;
  readonly attentionReason?: AgentProjectionAttentionReason;
} {
  if (item.state === "needs-input") return { bucket: "attention", attentionReason: "needs-input" };
  if (item.state === "failed") return { bucket: "attention", attentionReason: "failed" };
  if (item.state === "working") return { bucket: "working" };
  if (item.state === "completed" || item.state === "stopped") return { bucket: "recent" };
  return { bucket: "idle" };
}

function projectExternalSource(
  source: ExternalExecutionSourceSnapshot,
  taskById: ReadonlyMap<string, KanbanTask>,
): readonly AgentProjectionCard[] {
  const freshness = Object.freeze({
    state: source.state,
    stale: source.stale,
    ...(source.lastSuccessfulAt ? { lastSuccessfulAt: source.lastSuccessfulAt } : {}),
    ...(source.error ? { error: source.error } : {}),
  });
  return source.items.map((rawItem) => {
    const item = cloneExternal(rawItem);
    const presentation = externalPresentation(item);
    const associatedTask = item.association ? taskById.get(item.association.taskId) : undefined;
    const summary = optionalText(item.summary);
    const waitingFor = optionalText(item.waitingFor);
    return Object.freeze({
      id: `external:${item.sourceId}:${item.externalId}`,
      kind: "external" as const,
      bucket: presentation.bucket,
      state: Object.freeze({ domain: "external" as const, value: item.state }),
      title: item.title,
      ...(summary ? { summary } : {}),
      projectPath: item.projectPath,
      ...(item.association ? { taskId: item.association.taskId } : {}),
      ...(associatedTask ? { taskStage: associatedTask.stage } : {}),
      ...(item.parentExternalId ? { parentId: `external:${item.sourceId}:${item.parentExternalId}` } : {}),
      backendId: item.session.backendId,
      sourceLabel: source.source.label,
      needsInput: item.needsInput,
      ...(waitingFor ? { waitingFor } : {}),
      ...(presentation.attentionReason ? { attentionReason: presentation.attentionReason } : {}),
      updatedAt: item.updatedAt,
      freshness,
      external: item,
    });
  });
}

function compareCards(left: AgentProjectionCard, right: AgentProjectionCard): number {
  const bucket = BUCKET_RANK[left.bucket] - BUCKET_RANK[right.bucket];
  if (bucket !== 0) return bucket;
  const attention = (left.attentionReason ? ATTENTION_RANK[left.attentionReason] : Number.MAX_SAFE_INTEGER)
    - (right.attentionReason ? ATTENTION_RANK[right.attentionReason] : Number.MAX_SAFE_INTEGER);
  if (attention !== 0) return attention;
  const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (Number.isFinite(updated) && updated !== 0) return updated;
  return left.id.localeCompare(right.id);
}

export function projectAgentActivity(input: ProjectAgentActivityInput): AgentProjection {
  const taskById = new Map(input.board?.tasks.map((task) => [task.id, task] as const) ?? []);
  const cards: AgentProjectionCard[] = [];
  for (const agentTask of input.board?.agentTasks ?? []) cards.push(projectAgentTask(agentTask, taskById.get(agentTask.taskId)));
  for (const run of input.board?.runs ?? []) {
    const card = projectWorkflowRun(run, taskById.get(run.taskId));
    if (card) cards.push(card);
  }
  const managedTaskIds = new Set(cards.flatMap((card) => card.taskId ? [card.taskId] : []));
  for (const source of input.external?.sources ?? []) {
    cards.push(...projectExternalSource(source, taskById).filter((card) => !(
      card.external?.association?.relation === "managed"
      && card.taskId
      && managedTaskIds.has(card.taskId)
    )));
  }
  cards.sort(compareCards);
  const frozenCards = Object.freeze(cards);
  const buckets = Object.freeze(Object.fromEntries(AGENT_PROJECTION_BUCKETS.map((bucket) => [
    bucket,
    Object.freeze(frozenCards.filter((card) => card.bucket === bucket)),
  ])) as unknown as Record<AgentProjectionBucket, readonly AgentProjectionCard[]>);
  return Object.freeze({ cards: frozenCards, buckets });
}

export function projectExternalExecutionCards(snapshot: ExternalExecutionCatalogSnapshot | undefined): readonly AgentProjectionCard[] {
  return projectAgentActivity({ external: snapshot }).cards;
}
