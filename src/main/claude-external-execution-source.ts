import type { ExecutionBackendConfiguration } from "./execution-backend";
import { CliProcess } from "./cli-process";
import type {
  ContinueExternalExecutionResult,
  ExternalExecutionItem,
  ExternalExecutionProcess,
  ExternalExecutionScope,
  ExternalExecutionState,
} from "../shared/external-execution";
import { ExternalExecutionSourceUnavailableError, type ExternalExecutionSource } from "./external-execution-source";

const MAX_AGENT_RECORDS = 5_000;
const TERMINAL_STATES = new Set<ExternalExecutionState>(["completed", "failed", "stopped"]);

interface ClaudeExternalExecutionSourceOptions {
  readonly configuration: () => ExecutionBackendConfiguration;
  readonly process?: Pick<CliProcess, "run">;
  readonly copyText?: (value: string) => void;
  readonly cwd?: string;
  readonly now?: () => string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function positivePid(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function isoDate(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  const valueText = text(value);
  if (!valueText) return undefined;
  const parsed = new Date(valueText);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizedState(rawState: unknown, rawStatus: unknown): ExternalExecutionState {
  const status = text(rawStatus)?.toLocaleLowerCase("en-US");
  if (status === "waiting") return "needs-input";
  if (status === "busy") return "working";
  const state = text(rawState)?.toLocaleLowerCase("en-US").replaceAll("_", "-");
  if (state === "working" || state === "active") return "working";
  if (state === "needs-input" || state === "blocked" || state === "waiting") return "needs-input";
  if (state === "idle") return "idle";
  if (state === "completed" || state === "done" || state === "succeeded") return "completed";
  if (state === "failed" || state === "error") return "failed";
  if (state === "stopped" || state === "cancelled" || state === "canceled") return "stopped";
  if (status === "idle") return "idle";
  return "unknown";
}

function parentIdentity(value: Record<string, unknown>): string | undefined {
  const direct = text(value.parentSessionId) ?? text(value.parentId) ?? text(value.parentExternalId);
  if (direct) return direct;
  if (value.parent && typeof value.parent === "object" && !Array.isArray(value.parent)) {
    const parent = value.parent as Record<string, unknown>;
    return text(parent.sessionId) ?? text(parent.id);
  }
  return undefined;
}

export function normalizeClaudeExternalExecution(value: unknown, capturedAt: string, index = 0): ExternalExecutionItem {
  const input = record(value, `Claude agents[${index}]`);
  const sessionId = text(input.sessionId) ?? text(input.session_id);
  const nativeId = text(input.id) ?? sessionId?.slice(0, 8);
  if (!nativeId) throw new Error(`Claude agents[${index}].id 缺失`);
  const externalId = sessionId ?? nativeId;
  const projectPath = text(input.cwd);
  if (!projectPath) throw new Error(`Claude agents[${index}].cwd 缺失`);
  const state = normalizedState(input.state, input.status);
  const nestedProcess = input.process && typeof input.process === "object" && !Array.isArray(input.process)
    ? input.process as Record<string, unknown>
    : undefined;
  const status = text(input.status) ?? text(nestedProcess?.status);
  const pid = positivePid(input.pid) ?? positivePid(nestedProcess?.pid);
  const processInfo: ExternalExecutionProcess | undefined = pid || status
    ? Object.freeze({ pid, status, alive: pid !== undefined && !TERMINAL_STATES.has(state) })
    : undefined;
  const waitingFor = text(input.waitingFor) ?? text(input.waiting_for);
  const title = text(input.name) ?? text(input.title) ?? `Claude ${nativeId}`;
  const summary = waitingFor
    ?? text(input.detail)
    ?? text(input.summary)
    ?? text(input.activity)
    ?? text(input.lastMessage);
  const startedAt = isoDate(input.startedAt ?? input.started_at);
  const updatedAt = isoDate(input.updatedAt ?? input.updated_at ?? input.lastActivityAt ?? input.stateChangedAt) ?? capturedAt;
  const transcriptPath = text(input.transcriptPath) ?? text(input.transcript_path);

  return Object.freeze({
    sourceId: "claude",
    externalId,
    nativeId,
    kind: text(input.kind) ?? "background",
    title,
    summary,
    projectPath,
    parentExternalId: parentIdentity(input),
    session: Object.freeze({ backendId: "claude", sessionId: externalId, sessionPath: transcriptPath }),
    state,
    needsInput: state === "needs-input",
    waitingFor,
    terminal: TERMINAL_STATES.has(state),
    process: processInfo,
    startedAt,
    updatedAt,
  });
}

export class ClaudeExternalExecutionSource implements ExternalExecutionSource {
  readonly definition = Object.freeze({
    id: "claude" as const,
    label: "Claude Agents",
    description: "Claude Code agent view 中的后台与交互 session。",
    capabilities: Object.freeze({
      discovery: "cli-json" as const,
      updates: Object.freeze(["poll" as const]),
      details: false,
      import: true,
      continue: true,
      hierarchy: true,
      evidence: "official-structured" as const,
    }),
  });

  readonly #configuration: () => ExecutionBackendConfiguration;
  readonly #process: Pick<CliProcess, "run">;
  readonly #copyText?: (value: string) => void;
  readonly #cwd: string;
  readonly #now: () => string;

  constructor(options: ClaudeExternalExecutionSourceOptions) {
    this.#configuration = options.configuration;
    this.#process = options.process ?? new CliProcess();
    this.#copyText = options.copyText;
    this.#cwd = options.cwd ?? process.cwd();
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async refresh(scope: ExternalExecutionScope): Promise<readonly ExternalExecutionItem[]> {
    let configuration: ExecutionBackendConfiguration;
    try {
      configuration = this.#configuration();
    } catch (cause) {
      throw new ExternalExecutionSourceUnavailableError(cause instanceof Error ? cause.message : String(cause));
    }
    if (!configuration.executable) throw new Error(configuration.resolutionError ?? "Claude CLI 当前不可用");
    const capturedAt = this.#now();
    let payload: unknown;
    const result = await this.#process.run({
      executable: configuration.executable,
      prefixArgv: configuration.prefixArgv,
      argv: Object.freeze([
        "agents",
        "--json",
        "--all",
        ...(scope.kind === "project" ? ["--cwd", scope.projectPath] : []),
      ]),
      cwd: scope.kind === "project" ? scope.projectPath : this.#cwd,
      stdout: "json",
      maxLineBytes: 4 * 1024 * 1024,
      maxStdoutBytes: 4 * 1024 * 1024,
      maxStderrBytes: 256 * 1024,
      timeoutMs: 10_000,
    }, { onJson: (value) => { payload = value; } });
    if (result.exitCode !== 0) {
      throw new Error(result.stderrTail.trim() || `claude agents --json --all 退出码 ${String(result.exitCode)}`);
    }
    if (!Array.isArray(payload)) throw new Error("claude agents --json --all 未返回数组");
    if (payload.length > MAX_AGENT_RECORDS) throw new Error(`Claude agents 记录超过 ${MAX_AGENT_RECORDS} 条上限`);
    return Object.freeze(payload.map((item, index) => normalizeClaudeExternalExecution(item, capturedAt, index)));
  }

  async continue(item: ExternalExecutionItem): Promise<ContinueExternalExecutionResult> {
    if (item.sourceId !== "claude") throw new Error("Claude Source 收到非 Claude session");
    const command = item.process?.alive
      ? `claude attach ${JSON.stringify(item.nativeId)}`
      : `claude --resume ${JSON.stringify(item.session.sessionId ?? item.externalId)}`;
    this.#copyText?.(command);
    return Object.freeze({ kind: "command-copied", message: command });
  }
}
