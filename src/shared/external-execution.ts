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
  readonly supportsDetails: boolean;
  readonly supportsImport: boolean;
  readonly supportsContinue: boolean;
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

export function isExternalExecutionSourceId(value: unknown): value is ExternalExecutionSourceId {
  return typeof value === "string" && EXTERNAL_EXECUTION_SOURCE_IDS.includes(value as ExternalExecutionSourceId);
}

export function externalExecutionScopeKey(scope: ExternalExecutionScope): string {
  return scope.kind === "all" ? "all" : `project:${scope.projectPath}`;
}
