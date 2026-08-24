import type { ExecutionBackendId } from "./execution-profile";

export interface ExecutionSessionReference {
  readonly backendId: ExecutionBackendId;
  /** Adapter 可稳定恢复的 session/thread ID。 */
  readonly sessionId?: string;
  /** 仅在后端公开稳定本地路径时存在。 */
  readonly sessionPath?: string;
}

export function hasExecutionSessionIdentity(value: ExecutionSessionReference): boolean {
  return Boolean(value.sessionId?.trim() || value.sessionPath?.trim());
}

export function cloneExecutionSessionReference(
  value: ExecutionSessionReference | undefined,
): ExecutionSessionReference | undefined {
  return value ? Object.freeze({ ...value }) : undefined;
}

export function piExecutionSession(input: {
  readonly sessionId?: string;
  readonly sessionPath?: string;
}): ExecutionSessionReference | undefined {
  const sessionId = input.sessionId?.trim() || undefined;
  const sessionPath = input.sessionPath?.trim() || undefined;
  return sessionId || sessionPath ? Object.freeze({ backendId: "pi", sessionId, sessionPath }) : undefined;
}
