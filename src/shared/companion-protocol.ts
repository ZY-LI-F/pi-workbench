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
export const COMPANION_MAX_FRAME_BYTES = 1_024 * 1_024;

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

export interface CompanionDeviceSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastSeenAt?: string;
  readonly revokedAt?: string;
  readonly connected: boolean;
}

export interface CompanionGatewayStatus {
  readonly state: "stopped" | "listening" | "error";
  readonly host: CompanionHostSummary;
  readonly port?: number;
  readonly connectionUrls: readonly string[];
  readonly devices: readonly CompanionDeviceSummary[];
  readonly error?: string;
}

export interface CompanionPairingOffer {
  readonly id: string;
  readonly host: CompanionHostSummary;
  readonly pairingUri: string;
  readonly connectionUrls: readonly string[];
  readonly expiresAt: string;
}

export interface CompanionPairingUri {
  readonly endpoint: string;
  readonly offerId: string;
  readonly offerSecret: string;
  readonly hostId: string;
  readonly protocolVersion: number;
  readonly minimumProtocolVersion: number;
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

export type CompanionClientFrame =
  | {
      readonly type: "pair";
      readonly requestId: string;
      readonly protocolVersion: number;
      readonly minimumProtocolVersion: number;
      readonly offerId: string;
      readonly offerSecret: string;
      readonly deviceName: string;
    }
  | {
      readonly type: "authenticate";
      readonly requestId: string;
      readonly protocolVersion: number;
      readonly minimumProtocolVersion: number;
      readonly deviceId: string;
      readonly credential: string;
    }
  | {
      readonly type: "get-snapshot";
      readonly requestId: string;
    }
  | {
      readonly type: "get-task-detail";
      readonly requestId: string;
      readonly taskId: string;
    }
  | {
      readonly type: "ping";
      readonly requestId: string;
    };

export type CompanionServerErrorCode =
  | "malformed-frame"
  | "protocol-incompatible"
  | "pairing-invalid"
  | "authentication-failed"
  | "not-authenticated"
  | "task-not-found"
  | "request-failed";

export type CompanionServerFrame =
  | {
      readonly type: "paired";
      readonly requestId: string;
      readonly protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
      readonly minimumProtocolVersion: typeof COMPANION_MINIMUM_PROTOCOL_VERSION;
      readonly host: CompanionHostSummary;
      readonly device: CompanionDeviceSummary;
      readonly credential: string;
    }
  | {
      readonly type: "ready";
      readonly requestId: string;
      readonly protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
      readonly minimumProtocolVersion: typeof COMPANION_MINIMUM_PROTOCOL_VERSION;
      readonly host: CompanionHostSummary;
      readonly device: CompanionDeviceSummary;
      readonly snapshot: CompanionSnapshot;
    }
  | {
      readonly type: "snapshot";
      readonly requestId?: string;
      readonly event: CompanionSnapshotEvent;
    }
  | {
      readonly type: "task-detail";
      readonly requestId: string;
      readonly detail: CompanionTaskDetail;
    }
  | {
      readonly type: "pong";
      readonly requestId: string;
      readonly capturedAt: string;
    }
  | {
      readonly type: "error";
      readonly requestId?: string;
      readonly code: CompanionServerErrorCode;
      readonly message: string;
      readonly recoverable: boolean;
    };

export interface CompanionProtocolCompatibility {
  readonly compatible: boolean;
  readonly localVersion: typeof COMPANION_PROTOCOL_VERSION;
  readonly localMinimumVersion: typeof COMPANION_MINIMUM_PROTOCOL_VERSION;
  readonly peerVersion: number;
  readonly peerMinimumVersion: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredFrameText(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2_048) {
    throw new Error(`Companion frame ${key} 无效`);
  }
  return value;
}

function requiredProtocolNumber(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`Companion frame ${key} 无效`);
  return value as number;
}

export function companionProtocolCompatibility(
  peerVersion: number,
  peerMinimumVersion: number,
): CompanionProtocolCompatibility {
  const compatible = Number.isSafeInteger(peerVersion)
    && Number.isSafeInteger(peerMinimumVersion)
    && peerVersion >= COMPANION_MINIMUM_PROTOCOL_VERSION
    && COMPANION_PROTOCOL_VERSION >= peerMinimumVersion;
  return Object.freeze({
    compatible,
    localVersion: COMPANION_PROTOCOL_VERSION,
    localMinimumVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
    peerVersion,
    peerMinimumVersion,
  });
}

export function parseCompanionClientFrame(value: unknown): CompanionClientFrame {
  if (!isRecord(value) || typeof value.type !== "string") throw new Error("Companion frame 必须是带 type 的对象");
  const requestId = requiredFrameText(value, "requestId");
  if (value.type === "pair") {
    return Object.freeze({
      type: value.type,
      requestId,
      protocolVersion: requiredProtocolNumber(value, "protocolVersion"),
      minimumProtocolVersion: requiredProtocolNumber(value, "minimumProtocolVersion"),
      offerId: requiredFrameText(value, "offerId"),
      offerSecret: requiredFrameText(value, "offerSecret"),
      deviceName: requiredFrameText(value, "deviceName"),
    });
  }
  if (value.type === "authenticate") {
    return Object.freeze({
      type: value.type,
      requestId,
      protocolVersion: requiredProtocolNumber(value, "protocolVersion"),
      minimumProtocolVersion: requiredProtocolNumber(value, "minimumProtocolVersion"),
      deviceId: requiredFrameText(value, "deviceId"),
      credential: requiredFrameText(value, "credential"),
    });
  }
  if (value.type === "get-snapshot") return Object.freeze({ type: value.type, requestId });
  if (value.type === "get-task-detail") {
    return Object.freeze({ type: value.type, requestId, taskId: requiredFrameText(value, "taskId") });
  }
  if (value.type === "ping") return Object.freeze({ type: value.type, requestId });
  throw new Error(`未知 Companion frame type: ${value.type}`);
}

function isHostSummary(value: unknown): value is CompanionHostSummary {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.version === "string";
}

function isDeviceSummary(value: unknown): value is CompanionDeviceSummary {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.createdAt === "string"
    && typeof value.connected === "boolean";
}

function isSnapshot(value: unknown): value is CompanionSnapshot {
  return isRecord(value)
    && value.protocolVersion === COMPANION_PROTOCOL_VERSION
    && Number.isSafeInteger(value.sequence)
    && typeof value.capturedAt === "string"
    && isHostSummary(value.host)
    && isRecord(value.freshness)
    && Array.isArray(value.projects)
    && Array.isArray(value.tasks)
    && Array.isArray(value.agents)
    && Array.isArray(value.attention)
    && Array.isArray(value.recentTimeline);
}

export function parseCompanionServerFrame(value: unknown): CompanionServerFrame {
  if (!isRecord(value) || typeof value.type !== "string") throw new Error("Companion server frame 必须是带 type 的对象");
  if (value.type === "paired") {
    if (!isHostSummary(value.host) || !isDeviceSummary(value.device)) throw new Error("Companion paired frame 身份无效");
    return Object.freeze({
      type: value.type,
      requestId: requiredFrameText(value, "requestId"),
      protocolVersion: requiredProtocolNumber(value, "protocolVersion") as typeof COMPANION_PROTOCOL_VERSION,
      minimumProtocolVersion: requiredProtocolNumber(value, "minimumProtocolVersion") as typeof COMPANION_MINIMUM_PROTOCOL_VERSION,
      host: value.host,
      device: value.device,
      credential: requiredFrameText(value, "credential"),
    });
  }
  if (value.type === "ready") {
    if (!isHostSummary(value.host) || !isDeviceSummary(value.device) || !isSnapshot(value.snapshot)) {
      throw new Error("Companion ready frame payload 无效");
    }
    return Object.freeze({
      type: value.type,
      requestId: requiredFrameText(value, "requestId"),
      protocolVersion: requiredProtocolNumber(value, "protocolVersion") as typeof COMPANION_PROTOCOL_VERSION,
      minimumProtocolVersion: requiredProtocolNumber(value, "minimumProtocolVersion") as typeof COMPANION_MINIMUM_PROTOCOL_VERSION,
      host: value.host,
      device: value.device,
      snapshot: value.snapshot,
    });
  }
  if (value.type === "snapshot") {
    if (!isRecord(value.event) || value.event.type !== "snapshot" || !isSnapshot(value.event.snapshot)
      || value.event.protocolVersion !== COMPANION_PROTOCOL_VERSION || !Number.isSafeInteger(value.event.sequence)
      || typeof value.event.capturedAt !== "string") {
      throw new Error("Companion snapshot event 无效");
    }
    return Object.freeze({
      type: value.type,
      ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
      event: value.event as unknown as CompanionSnapshotEvent,
    });
  }
  if (value.type === "task-detail") {
    if (!isRecord(value.detail) || value.detail.protocolVersion !== COMPANION_PROTOCOL_VERSION
      || !Number.isSafeInteger(value.detail.sequence) || typeof value.detail.capturedAt !== "string"
      || !isRecord(value.detail.task) || !Array.isArray(value.detail.agents) || !Array.isArray(value.detail.timeline)) {
      throw new Error("Companion task-detail frame 无效");
    }
    return Object.freeze({
      type: value.type,
      requestId: requiredFrameText(value, "requestId"),
      detail: value.detail as unknown as CompanionTaskDetail,
    });
  }
  if (value.type === "pong") {
    return Object.freeze({
      type: value.type,
      requestId: requiredFrameText(value, "requestId"),
      capturedAt: requiredFrameText(value, "capturedAt"),
    });
  }
  if (value.type === "error") {
    const validCodes: readonly CompanionServerErrorCode[] = [
      "malformed-frame", "protocol-incompatible", "pairing-invalid", "authentication-failed",
      "not-authenticated", "task-not-found", "request-failed",
    ];
    if (typeof value.code !== "string" || !validCodes.includes(value.code as CompanionServerErrorCode)
      || typeof value.message !== "string" || typeof value.recoverable !== "boolean") {
      throw new Error("Companion error frame 无效");
    }
    return Object.freeze({
      type: value.type,
      ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
      code: value.code as CompanionServerErrorCode,
      message: value.message,
      recoverable: value.recoverable,
    });
  }
  throw new Error(`未知 Companion server frame type: ${value.type}`);
}

export function formatCompanionPairingUri(value: CompanionPairingUri): string {
  const endpoint = new URL(value.endpoint);
  if (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") throw new Error("Companion endpoint 必须使用 ws 或 wss");
  const result = new URL("stella://pair");
  result.searchParams.set("endpoint", endpoint.toString());
  result.searchParams.set("offerId", value.offerId);
  result.searchParams.set("offerSecret", value.offerSecret);
  result.searchParams.set("hostId", value.hostId);
  result.searchParams.set("protocolVersion", String(value.protocolVersion));
  result.searchParams.set("minimumProtocolVersion", String(value.minimumProtocolVersion));
  return result.toString();
}

export function parseCompanionPairingUri(raw: string): CompanionPairingUri {
  const normalized = raw.trim();
  if (!/^stella:\/\/pair(?:\?|$)/i.test(normalized)) throw new Error("这不是 Stella Companion 配对链接");
  const value = new URL(normalized);
  const endpoint = value.searchParams.get("endpoint") ?? "";
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== "ws:" && endpointUrl.protocol !== "wss:") throw new Error("配对链接 endpoint 无效");
  const offerId = value.searchParams.get("offerId")?.trim() ?? "";
  const offerSecret = value.searchParams.get("offerSecret")?.trim() ?? "";
  const hostId = value.searchParams.get("hostId")?.trim() ?? "";
  const protocolVersion = Number(value.searchParams.get("protocolVersion"));
  const minimumProtocolVersion = Number(value.searchParams.get("minimumProtocolVersion"));
  if (!offerId || !offerSecret || !hostId) throw new Error("配对链接缺少身份信息");
  if (!Number.isSafeInteger(protocolVersion) || protocolVersion < 1
    || !Number.isSafeInteger(minimumProtocolVersion) || minimumProtocolVersion < 1) {
    throw new Error("配对链接协议版本无效");
  }
  return Object.freeze({
    endpoint: endpointUrl.toString(),
    offerId,
    offerSecret,
    hostId,
    protocolVersion,
    minimumProtocolVersion,
  });
}

/** Product-level read seam consumed by both in-memory and network transports. */
export interface CompanionControlPlane {
  getSnapshot(): Promise<CompanionSnapshot>;
  getTaskDetail(taskId: string): Promise<CompanionTaskDetail>;
  subscribe(listener: CompanionProjectedEventListener): () => void;
}
