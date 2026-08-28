import type {
  AgentProjectionAttentionReason,
  AgentProjectionBucket,
  AgentProjectionKind,
  AgentProjectionSourceFreshness,
  AgentProjectionState,
} from "./agent-projection";
import type { TaskPriority, TaskStage } from "./kanban";
import type {
  TaskTimelineKind,
  TaskTimelineProvenance,
  TaskTimelineStatus,
} from "./task-timeline";

export const COMPANION_PROTOCOL_VERSION = 1 as const;
export const COMPANION_MINIMUM_PROTOCOL_VERSION = 1 as const;

export const COMPANION_PROJECTION_LIMITS = Object.freeze({
  projects: 100,
  tasks: 200,
  agents: 200,
  attention: 100,
  recentTimeline: 40,
  taskTimeline: 100,
  titleText: 160,
  summaryText: 240,
  detailText: 2_000,
  artifactText: 8_000,
  pathText: 1_024,
});

export interface CompanionProtocolEnvelope {
  readonly protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
  readonly sequence: number;
  readonly capturedAt: string;
}

export interface CompanionHostSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export interface CompanionSnapshotFreshness {
  readonly state: "live" | "stale";
  readonly stale: boolean;
  readonly capturedAt: string;
}

export interface CompanionProjectSummary {
  readonly path: string;
  readonly name: string;
  readonly taskCount: number;
  readonly attentionCount: number;
  readonly workingAgentCount: number;
  readonly updatedAt: string;
}

export interface CompanionExecutionReference {
  readonly kind: "workflow" | "agent-task";
  readonly id: string;
}

export interface CompanionTaskSummary {
  readonly id: string;
  readonly title: string;
  readonly priority: TaskPriority;
  readonly stage: TaskStage;
  readonly projectPath: string;
  readonly projectName: string;
  readonly attentionCount: number;
  readonly agentCount: number;
  readonly activeExecution?: CompanionExecutionReference;
  readonly updatedAt: string;
}

export interface CompanionAgentSummary {
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
}

export interface CompanionAttentionItem {
  readonly id: string;
  readonly agentId: string;
  readonly reason: AgentProjectionAttentionReason;
  readonly title: string;
  readonly taskId?: string;
  readonly taskTitle?: string;
  readonly waitingFor?: string;
  readonly updatedAt: string;
}

export interface CompanionRecentTimelineEntry {
  readonly id: string;
  readonly taskId: string;
  readonly source: "activity" | "message";
  readonly title: string;
  readonly body?: string;
  readonly createdAt: string;
}

export interface CompanionSnapshot extends CompanionProtocolEnvelope {
  readonly host: CompanionHostSummary;
  readonly freshness: CompanionSnapshotFreshness;
  readonly projects: readonly CompanionProjectSummary[];
  readonly tasks: readonly CompanionTaskSummary[];
  readonly agents: readonly CompanionAgentSummary[];
  readonly attention: readonly CompanionAttentionItem[];
  readonly recentTimeline: readonly CompanionRecentTimelineEntry[];
}

export interface CompanionTaskWorkspaceSummary {
  readonly strategy: "current-folder" | "isolated-worktree";
  readonly baseRef?: string;
}

export interface CompanionTaskDetailSummary extends CompanionTaskSummary {
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly blockedReason?: string;
  readonly executionWorkspace: CompanionTaskWorkspaceSummary;
}

export interface CompanionTimelineArtifact {
  readonly title: string;
  readonly content: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface CompanionTaskTimelineEntry {
  readonly id: string;
  readonly kind: TaskTimelineKind;
  readonly createdAt: string;
  readonly title: string;
  readonly body?: string;
  readonly detail?: string;
  readonly authorAgentId?: string;
  readonly status?: TaskTimelineStatus;
  readonly acceptance?: "not-ready" | "pending" | "accepted" | "revision-requested" | "rejected" | "superseded";
  readonly artifact?: CompanionTimelineArtifact;
  readonly provenance: TaskTimelineProvenance;
}

export interface CompanionTaskDetail extends CompanionProtocolEnvelope {
  readonly task: CompanionTaskDetailSummary;
  readonly agents: readonly CompanionAgentSummary[];
  readonly timeline: readonly CompanionTaskTimelineEntry[];
}

export interface CompanionSnapshotEvent extends CompanionProtocolEnvelope {
  readonly type: "snapshot";
  readonly snapshot: CompanionSnapshot;
}

export type CompanionProjectedEvent = CompanionSnapshotEvent;
export type CompanionProjectedEventListener = (event: CompanionProjectedEvent) => void;

/** Product-level read seam consumed by both in-memory and network transports. */
export interface CompanionControlPlane {
  getSnapshot(): Promise<CompanionSnapshot>;
  getTaskDetail(taskId: string): Promise<CompanionTaskDetail>;
  subscribe(listener: CompanionProjectedEventListener): () => void;
}
