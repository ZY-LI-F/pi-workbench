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

export function isExternalExecutionSourceId(value: unknown): value is ExternalExecutionSourceId {
  return typeof value === "string" && EXTERNAL_EXECUTION_SOURCE_IDS.includes(value as ExternalExecutionSourceId);
}
