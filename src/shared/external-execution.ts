import type { ExecutionSessionReference } from "./execution-session";

export const EXTERNAL_EXECUTION_SOURCE_IDS = ["claude", "codex"] as const;
export type ExternalExecutionSourceId = (typeof EXTERNAL_EXECUTION_SOURCE_IDS)[number];

export interface ExternalExecutionOrigin {
  readonly sourceId: ExternalExecutionSourceId;
  readonly externalId: string;
  readonly session?: ExecutionSessionReference;
  readonly projectPath: string;
  readonly importedAt: string;
}

export const EXTERNAL_EXECUTION_STATES = [
  "working",
  "needs-input",
  "idle",
  "completed",
  "failed",
  "stopped",
  "unknown",
] as const;
export type ExternalExecutionState = (typeof EXTERNAL_EXECUTION_STATES)[number];

export const EXTERNAL_EXECUTION_DISCOVERY_MECHANISMS = ["cli-json", "app-server"] as const;
export type ExternalExecutionDiscoveryMechanism = (typeof EXTERNAL_EXECUTION_DISCOVERY_MECHANISMS)[number];

export const EXTERNAL_EXECUTION_UPDATE_MECHANISMS = ["poll", "notification", "hook"] as const;
export type ExternalExecutionUpdateMechanism = (typeof EXTERNAL_EXECUTION_UPDATE_MECHANISMS)[number];

export const EXTERNAL_EXECUTION_EVIDENCE_QUALITIES = ["official-structured", "provider-file", "heuristic"] as const;
export type ExternalExecutionEvidenceQuality = (typeof EXTERNAL_EXECUTION_EVIDENCE_QUALITIES)[number];

export type ExternalExecutionScope =
  | { readonly kind: "all" }
  | { readonly kind: "project"; readonly projectPath: string };

export interface ExternalExecutionProcess {
  readonly pid?: number;
  readonly status?: string;
  readonly alive: boolean;
}

export interface ExternalExecutionTaskAssociation {
  readonly taskId: string;
  readonly relation: "managed" | "imported";
}

export interface ExternalExecutionItem {
  readonly sourceId: ExternalExecutionSourceId;
  /** Stable full identity used for association and import de-duplication. */
  readonly externalId: string;
  /** Source-native short identity accepted by commands such as `claude attach`. */
  readonly nativeId: string;
  readonly kind: string;
  readonly title: string;
  readonly summary?: string;
  readonly projectPath: string;
  readonly parentExternalId?: string;
  readonly session: ExecutionSessionReference;
  readonly state: ExternalExecutionState;
  readonly needsInput: boolean;
  readonly waitingFor?: string;
  readonly terminal: boolean;
  readonly process?: ExternalExecutionProcess;
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly association?: ExternalExecutionTaskAssociation;
}

export interface ExternalExecutionSourceDefinition {
  readonly id: ExternalExecutionSourceId;
  readonly label: string;
  readonly description: string;
  readonly capabilities: {
    readonly discovery: ExternalExecutionDiscoveryMechanism;
    readonly updates: readonly ExternalExecutionUpdateMechanism[];
    readonly details: boolean;
    readonly import: boolean;
    readonly continue: boolean;
    readonly hierarchy: boolean;
    readonly evidence: ExternalExecutionEvidenceQuality;
  };
}

export interface ExternalExecutionSourceSnapshot {
  readonly source: ExternalExecutionSourceDefinition;
  readonly state: "ready" | "unavailable" | "error";
  readonly stale: boolean;
  readonly error?: string;
  readonly lastSuccessfulAt?: string;
  readonly items: readonly ExternalExecutionItem[];
}

export interface ExternalExecutionCatalogSnapshot {
  readonly epoch: number;
  readonly scope: ExternalExecutionScope;
  readonly capturedAt: string;
  readonly sources: readonly ExternalExecutionSourceSnapshot[];
}

export interface ImportExternalExecutionInput {
  readonly sourceId: ExternalExecutionSourceId;
  readonly externalId: string;
}

export interface ImportExternalExecutionResult {
  readonly taskId: string;
  readonly created: boolean;
}

export interface ContinueExternalExecutionInput {
  readonly sourceId: ExternalExecutionSourceId;
  readonly externalId: string;
}

export interface ContinueExternalExecutionResult {
  readonly kind: "command-copied" | "opened-external";
  readonly message: string;
}

export interface ExternalExecutionDetailItem {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly text?: string;
  readonly status?: string;
}

export interface ExternalExecutionDetailTurn {
  readonly id: string;
  readonly status: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly items: readonly ExternalExecutionDetailItem[];
}

export interface ExternalExecutionDetails {
  readonly sourceId: ExternalExecutionSourceId;
  readonly externalId: string;
  readonly title: string;
  readonly projectPath: string;
  readonly fetchedAt: string;
  readonly turns: readonly ExternalExecutionDetailTurn[];
}

export interface ReadExternalExecutionDetailsInput {
  readonly sourceId: ExternalExecutionSourceId;
  readonly externalId: string;
}

export function isExternalExecutionSourceId(value: unknown): value is ExternalExecutionSourceId {
  return typeof value === "string" && EXTERNAL_EXECUTION_SOURCE_IDS.includes(value as ExternalExecutionSourceId);
}

export function externalExecutionScopeKey(scope: ExternalExecutionScope): string {
  return scope.kind === "all" ? "all" : `project:${scope.projectPath}`;
}
