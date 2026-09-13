import type { NativeDiagnosticLayout, NativeRequestTrace } from "../shared/native-diagnostics";
import type { NativeSubmissionReceipt } from "../shared/native-submission";
import type { RuntimeScope } from "../shared/runtime-scope";

const EVENT_TYPES = new Set(["agent_start", "agent_end", "agent_settled", "turn_start", "turn_end", "message_start", "message_update", "message_end",
  "tool_execution_start", "tool_execution_update", "tool_execution_end", "compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end",
  "queue_update", "extension_ui_request", "extension_error", "session_info_changed", "thinking_level_changed", "entry_appended",
  "runtime_starting", "runtime_ready", "runtime_stderr", "runtime_exit", "protocol_error"]);

export function validateDiagnosticLayout(value: unknown): NativeDiagnosticLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("诊断布局参数无效");
  const input = value as Record<string, unknown>;
  for (const key of ["width", "height", "inspectorWidth"]) {
    if (typeof input[key] !== "number" || !Number.isFinite(input[key]) || input[key] < 0) throw new Error(`诊断布局 ${key} 无效`);
  }
  if (typeof input.inspectorOpen !== "boolean" || typeof input.sidebarOpen !== "boolean"
    || !["small", "default", "large"].includes(String(input.fontSize))) throw new Error("诊断布局选项无效");
  return { width: input.width as number, height: input.height as number, inspectorWidth: input.inspectorWidth as number,
    inspectorOpen: input.inspectorOpen, sidebarOpen: input.sidebarOpen, fontSize: input.fontSize as NativeDiagnosticLayout["fontSize"] };
}

interface RunMetrics {
  readonly generation: string;
  readonly startedAt: string;
  updatedAt: string;
  lastSequence: number;
  counts: Record<string, number>;
}

/** Structural diagnostics by construction: raw messages, errors, URLs and credentials never enter this recorder. */
export class NativeDiagnostics {
  readonly #runs = new Map<string, RunMetrics>();
  readonly #requests = new Map<string, NativeRequestTrace & { readonly generation: string; readonly sessionId?: string; readonly updatedAt: string }>();
  constructor(readonly now: () => string) {}
  event(event: unknown, scope: RuntimeScope): void {
    const type = event && typeof event === "object" && "type" in event && typeof event.type === "string" && EVENT_TYPES.has(event.type) ? event.type : "unknown_event";
    const now = this.now();
    const previous = this.#runs.get(scope.generation);
    const counts = { ...previous?.counts, [type]: (previous?.counts[type] ?? 0) + 1 };
    this.#runs.set(scope.generation, { generation: scope.generation, startedAt: previous?.startedAt ?? now, updatedAt: now, lastSequence: scope.sequence, counts });
  }
  request(trace: NativeRequestTrace, scope: RuntimeScope): void {
    this.#requests.set(trace.id, { id: trace.id, command: trace.command, stage: trace.stage,
      generation: scope.generation, sessionId: scope.sessionId, updatedAt: this.now() });
  }
  snapshot(version: string, piVersion: string, scope: RuntimeScope | undefined, layout: NativeDiagnosticLayout, receipts: readonly NativeSubmissionReceipt[]) {
    return {
      schemaVersion: 1, exportedAt: this.now(), appVersion: version, piVersion, platform: process.platform, arch: process.arch,
      scope: scope ? { generation: scope.generation, scope: scope.scope, sequence: scope.sequence, sessionId: scope.sessionId,
        cwd: scope.cwd, sessionFile: scope.sessionFile } : undefined,
      layout, runs: [...this.#runs.values()], requests: [...this.#requests.values()],
      submissions: receipts.map((receipt) => ({ id: receipt.id, sessionId: receipt.sessionId, generation: receipt.generation,
        command: receipt.command, status: receipt.status, createdAt: receipt.createdAt, updatedAt: receipt.updatedAt })),
      privacy: { includesConversation: false, includesRawErrors: false, includesEnvironment: false, includesCredentials: false, uploaded: false },
    };
  }
}
