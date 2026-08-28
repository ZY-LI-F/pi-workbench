import { projectAgentActivity, type AgentProjectionCard } from "../shared/agent-projection";
import {
  COMPANION_PROJECTION_LIMITS,
  COMPANION_PROTOCOL_VERSION,
  type CompanionAgentSummary,
  type CompanionAttentionItem,
  type CompanionCommand,
  type CompanionCommandPreview,
  type CompanionCommandResult,
  type CompanionControlPlane,
  type CompanionHostSummary,
  type CompanionProjectedEventListener,
  type CompanionProjectSummary,
  type CompanionRecentTimelineEntry,
  type CompanionSnapshot,
  type CompanionSnapshotEvent,
  type CompanionTaskDetail,
  type CompanionTaskAction,
  type CompanionTaskSummary,
  type CompanionTaskTimelineEntry,
} from "../shared/companion-protocol";
import {
  CURRENT_FOLDER_EXECUTION_WORKSPACE,
  type BoardState,
  type KanbanTask,
} from "../shared/kanban";
import { projectTaskTimeline, type TaskTimelineEntry } from "../shared/task-timeline";
import type { BoardRepository } from "./board-repository";

interface MainCompanionControlPlaneDependencies {
  readonly repository: BoardRepository;
  readonly host: CompanionHostSummary;
  readonly commands?: {
    preview(command: CompanionCommand): Promise<CompanionCommandPreview>;
    execute(deviceId: string, command: CompanionCommand): Promise<CompanionCommandResult>;
  };
  readonly now?: () => string;
}

function compactText(value: string | undefined, limit: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function requiredCompactText(value: string, limit: number): string {
  return compactText(value, limit) ?? "";
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function newestFirst<T extends { readonly updatedAt: string; readonly id: string }>(left: T, right: T): number {
  const byTime = timestamp(right.updatedAt) - timestamp(left.updatedAt);
  return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
}

function activeExecution(task: KanbanTask): CompanionTaskSummary["activeExecution"] {
  if (task.activeRunId) return Object.freeze({ kind: "workflow", id: task.activeRunId });
  if (task.activeAgentTaskId) return Object.freeze({ kind: "agent-task", id: task.activeAgentTaskId });
  return undefined;
}

function compactAgent(card: AgentProjectionCard): CompanionAgentSummary {
  const summary = compactText(card.summary, COMPANION_PROJECTION_LIMITS.summaryText);
  const taskTitle = compactText(card.taskTitle, COMPANION_PROJECTION_LIMITS.titleText);
  const waitingFor = compactText(card.waitingFor, COMPANION_PROJECTION_LIMITS.summaryText);
  const freshness = card.freshness
    ? Object.freeze({
        ...card.freshness,
        error: compactText(card.freshness.error, COMPANION_PROJECTION_LIMITS.summaryText),
      })
    : undefined;
  return Object.freeze({
    id: card.id,
    kind: card.kind,
    bucket: card.bucket,
    state: Object.freeze({ ...card.state }),
    title: requiredCompactText(card.title, COMPANION_PROJECTION_LIMITS.titleText),
    ...(taskTitle ? { taskTitle } : {}),
    ...(summary ? { summary } : {}),
    projectPath: requiredCompactText(card.projectPath, COMPANION_PROJECTION_LIMITS.pathText),
    ...(card.taskId ? { taskId: card.taskId } : {}),
    ...(card.taskStage ? { taskStage: card.taskStage } : {}),
    ...(card.runId ? { runId: card.runId } : {}),
    ...(card.stepId ? { stepId: card.stepId } : {}),
    ...(card.agentTaskId ? { agentTaskId: card.agentTaskId } : {}),
    ...(card.parentId ? { parentId: card.parentId } : {}),
    ...(card.backendId ? { backendId: card.backendId } : {}),
    ...(card.sourceLabel ? { sourceLabel: requiredCompactText(card.sourceLabel, COMPANION_PROJECTION_LIMITS.titleText) } : {}),
    needsInput: card.needsInput,
    ...(waitingFor ? { waitingFor } : {}),
    ...(card.attentionReason ? { attentionReason: card.attentionReason } : {}),
    updatedAt: card.updatedAt,
    ...(freshness ? { freshness } : {}),
  });
}

function attentionItem(card: CompanionAgentSummary): CompanionAttentionItem | undefined {
  if (!card.attentionReason) return undefined;
  return Object.freeze({
    id: `attention:${card.id}`,
    agentId: card.id,
    reason: card.attentionReason,
    title: card.title,
    ...(card.taskId ? { taskId: card.taskId } : {}),
    ...(card.taskTitle ? { taskTitle: card.taskTitle } : {}),
    ...(card.waitingFor ? { waitingFor: card.waitingFor } : {}),
    updatedAt: card.updatedAt,
  });
}

function taskSummary(
  task: KanbanTask,
  agentCounts: ReadonlyMap<string, number>,
  attentionCounts: ReadonlyMap<string, number>,
): CompanionTaskSummary {
  const execution = activeExecution(task);
  return Object.freeze({
    id: task.id,
    title: requiredCompactText(task.title, COMPANION_PROJECTION_LIMITS.titleText),
    priority: task.priority,
    stage: task.stage,
    projectPath: requiredCompactText(task.projectPath, COMPANION_PROJECTION_LIMITS.pathText),
    projectName: requiredCompactText(task.projectName, COMPANION_PROJECTION_LIMITS.titleText),
    attentionCount: attentionCounts.get(task.id) ?? 0,
    agentCount: agentCounts.get(task.id) ?? 0,
    ...(execution ? { activeExecution: execution } : {}),
    updatedAt: task.updatedAt,
  });
}

function increment(counts: Map<string, number>, key: string | undefined): void {
  if (!key) return;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function projectSummaries(board: BoardState): {
  readonly allAgents: readonly CompanionAgentSummary[];
  readonly tasks: readonly CompanionTaskSummary[];
  readonly attention: readonly CompanionAttentionItem[];
} {
  const projectedCards = projectAgentActivity({ board }).cards;
  const agentCounts = new Map<string, number>();
  const attentionCounts = new Map<string, number>();
  for (const card of projectedCards) {
    increment(agentCounts, card.taskId);
    if (card.bucket === "attention") increment(attentionCounts, card.taskId);
  }
  const allAgents = Object.freeze(projectedCards.map(compactAgent));
  const tasks = Object.freeze(
    board.tasks
      .map((task) => taskSummary(task, agentCounts, attentionCounts))
      .sort(newestFirst)
      .slice(0, COMPANION_PROJECTION_LIMITS.tasks),
  );
  const attention = Object.freeze(
    allAgents
      .map(attentionItem)
      .filter((item): item is CompanionAttentionItem => Boolean(item))
      .slice(0, COMPANION_PROJECTION_LIMITS.attention),
  );
  return Object.freeze({ allAgents, tasks, attention });
}

function projectProjects(
  board: BoardState,
  agents: readonly CompanionAgentSummary[],
): readonly CompanionProjectSummary[] {
  const byPath = new Map<string, {
    name: string;
    taskCount: number;
    attentionCount: number;
    workingAgentCount: number;
    updatedAt: string;
  }>();
  for (const task of board.tasks) {
    const current = byPath.get(task.projectPath);
    byPath.set(task.projectPath, {
      name: task.projectName,
      taskCount: (current?.taskCount ?? 0) + 1,
      attentionCount: current?.attentionCount ?? 0,
      workingAgentCount: current?.workingAgentCount ?? 0,
      updatedAt: !current || timestamp(task.updatedAt) > timestamp(current.updatedAt) ? task.updatedAt : current.updatedAt,
    });
  }
  for (const agent of agents) {
    const current = byPath.get(agent.projectPath);
    if (!current) continue;
    byPath.set(agent.projectPath, {
      ...current,
      attentionCount: current.attentionCount + (agent.bucket === "attention" ? 1 : 0),
      workingAgentCount: current.workingAgentCount + (agent.bucket === "working" ? 1 : 0),
      updatedAt: timestamp(agent.updatedAt) > timestamp(current.updatedAt) ? agent.updatedAt : current.updatedAt,
    });
  }
  return Object.freeze(
    [...byPath.entries()]
      .map(([path, value]) => Object.freeze({
        path: requiredCompactText(path, COMPANION_PROJECTION_LIMITS.pathText),
        name: requiredCompactText(value.name, COMPANION_PROJECTION_LIMITS.titleText),
        taskCount: value.taskCount,
        attentionCount: value.attentionCount,
        workingAgentCount: value.workingAgentCount,
        updatedAt: value.updatedAt,
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, COMPANION_PROJECTION_LIMITS.projects),
  );
}

function projectRecentTimeline(board: BoardState): readonly CompanionRecentTimelineEntry[] {
  const activities: CompanionRecentTimelineEntry[] = board.activities.map((activity) => Object.freeze({
    id: `activity:${activity.id}`,
    taskId: activity.taskId,
    source: "activity" as const,
    title: requiredCompactText(activity.summary, COMPANION_PROJECTION_LIMITS.titleText),
    ...(compactText(activity.detail, COMPANION_PROJECTION_LIMITS.summaryText)
      ? { body: compactText(activity.detail, COMPANION_PROJECTION_LIMITS.summaryText) }
      : {}),
    createdAt: activity.createdAt,
  }));
  const messages: CompanionRecentTimelineEntry[] = board.comments.map((message) => Object.freeze({
    id: `message:${message.id}`,
    taskId: message.taskId,
    source: "message" as const,
    title: message.author === "user"
      ? "用户消息"
      : message.author === "agent"
        ? requiredCompactText(message.authorAgentId ? `@${message.authorAgentId} 返回结果` : "Agent 返回结果", COMPANION_PROJECTION_LIMITS.titleText)
        : "Stella 系统消息",
    ...(compactText(message.body, COMPANION_PROJECTION_LIMITS.summaryText)
      ? { body: compactText(message.body, COMPANION_PROJECTION_LIMITS.summaryText) }
      : {}),
    createdAt: message.createdAt,
  }));
  return Object.freeze(
    [...activities, ...messages]
      .sort((left, right) => {
        const byTime = timestamp(right.createdAt) - timestamp(left.createdAt);
        return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
      })
      .slice(0, COMPANION_PROJECTION_LIMITS.recentTimeline),
  );
}

function compactTimelineEntry(item: TaskTimelineEntry): CompanionTaskTimelineEntry {
  const body = compactText(item.body, COMPANION_PROJECTION_LIMITS.detailText);
  const detail = compactText(item.detail, COMPANION_PROJECTION_LIMITS.detailText);
  const artifact = item.artifact
    ? Object.freeze({
        title: requiredCompactText(item.artifact.title, COMPANION_PROJECTION_LIMITS.titleText),
        content: requiredCompactText(item.artifact.content, COMPANION_PROJECTION_LIMITS.artifactText),
        ...(item.artifact.inputTokens !== undefined ? { inputTokens: item.artifact.inputTokens } : {}),
        ...(item.artifact.outputTokens !== undefined ? { outputTokens: item.artifact.outputTokens } : {}),
        ...(item.artifact.cost !== undefined ? { cost: item.artifact.cost } : {}),
        ...(item.artifact.startedAt ? { startedAt: item.artifact.startedAt } : {}),
        ...(item.artifact.completedAt ? { completedAt: item.artifact.completedAt } : {}),
      })
    : undefined;
  return Object.freeze({
    id: item.id,
    kind: item.kind,
    createdAt: item.createdAt,
    title: requiredCompactText(item.title, COMPANION_PROJECTION_LIMITS.titleText),
    ...(body ? { body } : {}),
    ...(detail ? { detail } : {}),
    ...(item.authorAgentId ? { authorAgentId: item.authorAgentId } : {}),
    ...(item.status ? { status: item.status } : {}),
    ...(item.acceptance ? { acceptance: item.acceptance } : {}),
    ...(artifact ? { artifact } : {}),
    provenance: Object.freeze({ ...item.provenance }),
  });
}

function taskActions(board: BoardState, task: KanbanTask): readonly CompanionTaskAction[] {
  const actions: CompanionTaskAction[] = [];
  if (task.activeRunId) {
    const run = board.runs.find((candidate) => candidate.id === task.activeRunId);
    const gate = run?.currentStepId
      ? run.steps.find((candidate) => candidate.stepId === run.currentStepId && candidate.stepKind === "human-gate" && candidate.status === "waiting")
      : undefined;
    if (run?.status === "review" && gate) {
      actions.push(Object.freeze({
        kind: "resolve-human-gate",
        taskId: task.id,
        runId: run.id,
        stepId: gate.id,
        label: requiredCompactText(gate.name, COMPANION_PROJECTION_LIMITS.titleText),
      }));
    }
    actions.push(Object.freeze({
      kind: "abort-execution",
      taskId: task.id,
      executionKind: "workflow",
      executionId: task.activeRunId,
    }));
  } else if (task.activeAgentTaskId) {
    actions.push(Object.freeze({
      kind: "abort-execution",
      taskId: task.id,
      executionKind: "agent-task",
      executionId: task.activeAgentTaskId,
    }));
  }
  if (task.awaitingReviewExecution) {
    actions.push(Object.freeze({
      kind: "review-execution",
      taskId: task.id,
      executionKind: task.awaitingReviewExecution.kind,
      executionId: task.awaitingReviewExecution.id,
    }));
  }
  return Object.freeze(actions);
}

export class MainCompanionControlPlane implements CompanionControlPlane {
  readonly #repository: BoardRepository;
  readonly #host: CompanionHostSummary;
  readonly #commands: MainCompanionControlPlaneDependencies["commands"];
  readonly #now: () => string;
  readonly #listeners = new Set<CompanionProjectedEventListener>();
  #board: BoardState | undefined;
  #sequence = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(dependencies: MainCompanionControlPlaneDependencies) {
    this.#repository = dependencies.repository;
    this.#host = Object.freeze({ ...dependencies.host });
    this.#commands = dependencies.commands;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  getSnapshot(): Promise<CompanionSnapshot> {
    return this.#enqueue(async () => this.#projectSnapshot(await this.#currentBoard()));
  }

  getTaskDetail(taskId: string): Promise<CompanionTaskDetail> {
    return this.#enqueue(async () => {
      const board = await this.#currentBoard();
      const task = board.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new Error(`Companion Task 不存在: ${taskId}`);
      const capturedAt = this.#now();
      const projection = projectSummaries(board);
      const taskAgents = projection.allAgents.filter((agent) => agent.taskId === taskId);
      const taskAttention = taskAgents.filter((agent) => agent.bucket === "attention");
      const summary = taskSummary(
        task,
        new Map([[taskId, taskAgents.length]]),
        new Map([[taskId, taskAttention.length]]),
      );
      const selectedAgents = Object.freeze(
        taskAgents.slice(0, COMPANION_PROJECTION_LIMITS.agents),
      );
      const timeline = projectTaskTimeline({
        task,
        comments: board.comments.filter((message) => message.taskId === taskId),
        activities: board.activities.filter((activity) => activity.taskId === taskId),
        runs: board.runs.filter((run) => run.taskId === taskId),
        agentTasks: board.agentTasks.filter((agentTask) => agentTask.taskId === taskId),
      });
      const selectedTimeline = Object.freeze(
        timeline
          .slice(-COMPANION_PROJECTION_LIMITS.taskTimeline)
          .map(compactTimelineEntry),
      );
      const workspace = task.executionWorkspace ?? CURRENT_FOLDER_EXECUTION_WORKSPACE;
      return Object.freeze({
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        sequence: this.#sequence,
        capturedAt,
        task: Object.freeze({
          ...summary,
          description: requiredCompactText(task.description, COMPANION_PROJECTION_LIMITS.detailText),
          acceptanceCriteria: requiredCompactText(task.acceptanceCriteria, COMPANION_PROJECTION_LIMITS.detailText),
          ...(compactText(task.blockedReason, COMPANION_PROJECTION_LIMITS.summaryText)
            ? { blockedReason: compactText(task.blockedReason, COMPANION_PROJECTION_LIMITS.summaryText) }
            : {}),
          executionWorkspace: Object.freeze(workspace.strategy === "isolated-worktree"
            ? { strategy: workspace.strategy, baseRef: requiredCompactText(workspace.baseRef, COMPANION_PROJECTION_LIMITS.pathText) }
            : { strategy: workspace.strategy }),
        }),
        agents: selectedAgents,
        timeline: selectedTimeline,
        actions: taskActions(board, task),
      });
    });
  }

  previewCommand(_deviceId: string, command: CompanionCommand): Promise<CompanionCommandPreview> {
    if (!this.#commands) return Promise.reject(new Error("Companion command control plane 尚未配置"));
    return this.#commands.preview(command);
  }

  executeCommand(deviceId: string, command: CompanionCommand): Promise<CompanionCommandResult> {
    if (!this.#commands) return Promise.reject(new Error("Companion command control plane 尚未配置"));
    return this.#commands.execute(deviceId, command);
  }

  subscribe(listener: CompanionProjectedEventListener): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Called only after a Board repository transaction has committed. */
  publishCommitted(board: BoardState): Promise<CompanionSnapshotEvent> {
    return this.#enqueue(async () => {
      this.#board = board;
      this.#sequence = this.#sequence === 0 ? 1 : this.#sequence + 1;
      const snapshot = this.#projectSnapshot(board);
      const event = Object.freeze({
        type: "snapshot" as const,
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        sequence: snapshot.sequence,
        capturedAt: snapshot.capturedAt,
        snapshot,
      });
      for (const listener of [...this.#listeners]) {
        try {
          listener(event);
        } catch {
          // One transport must not prevent committed projections reaching peers.
        }
      }
      return event;
    });
  }

  async #currentBoard(): Promise<BoardState> {
    if (!this.#board) this.#board = await this.#repository.read();
    if (this.#sequence === 0) this.#sequence = 1;
    return this.#board;
  }

  #projectSnapshot(board: BoardState): CompanionSnapshot {
    if (this.#sequence === 0) this.#sequence = 1;
    const capturedAt = this.#now();
    const projection = projectSummaries(board);
    const agents = Object.freeze(projection.allAgents.slice(0, COMPANION_PROJECTION_LIMITS.agents));
    return Object.freeze({
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      sequence: this.#sequence,
      capturedAt,
      host: this.#host,
      freshness: Object.freeze({ state: "live", stale: false, capturedAt }),
      projects: projectProjects(board, projection.allAgents),
      tasks: projection.tasks,
      agents,
      attention: projection.attention,
      recentTimeline: projectRecentTimeline(board),
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
