import type { ExecutionBackendConfiguration } from "./execution-backend";
import { CodexAppServerClient, type CodexAppServerNotification } from "./codex-app-server-client";
import {
  type ContinueExternalExecutionResult,
  type ExternalExecutionDetailItem,
  type ExternalExecutionDetails,
  type ExternalExecutionDetailTurn,
  type ExternalExecutionItem,
  type ExternalExecutionScope,
  type ExternalExecutionState,
} from "../shared/external-execution";
import { ExternalExecutionSourceUnavailableError, type ExternalExecutionSource } from "./external-execution-source";

const DETAIL_TTL_MS = 30_000;
const MAX_DETAIL_TURNS = 100;
const MAX_TURN_ITEMS = 200;
const MAX_DETAIL_TEXT = 20_000;
const CODEX_SOURCE_KINDS = Object.freeze([
  "cli",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
] as const);

interface CodexAppServerContract {
  listThreads(params?: Readonly<Record<string, unknown>>): Promise<readonly Record<string, unknown>[]>;
  readThread(threadId: string): Promise<Record<string, unknown>>;
  listTurns(threadId: string): Promise<readonly Record<string, unknown>[]>;
  onNotification(listener: (notification: CodexAppServerNotification) => void): () => void;
  shutdown(): Promise<void>;
}

interface CodexExternalExecutionSourceOptions {
  readonly configuration: () => ExecutionBackendConfiguration;
  readonly client?: CodexAppServerContract;
  readonly copyText?: (value: string) => void;
  readonly cwd?: string;
  readonly now?: () => string;
  readonly clock?: () => number;
}

interface CachedDetails {
  readonly expiresAt: number;
  readonly details: ExternalExecutionDetails;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function epochDate(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const date = new Date(value < 10_000_000_000 ? value * 1_000 : value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function truncate(value: string | undefined, limit = MAX_DETAIL_TEXT): string | undefined {
  if (!value) return undefined;
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… <Stella 已截断详情> …`;
}

function sourceKind(value: unknown): string {
  if (typeof value === "string") return value;
  const source = optionalRecord(value);
  if (!source) return "unknown";
  const subAgent = source.subAgent;
  if (typeof subAgent === "string") {
    if (subAgent === "review") return "subAgentReview";
    if (subAgent === "compact") return "subAgentCompact";
    return "subAgent";
  }
  const subAgentRecord = optionalRecord(subAgent);
  if (subAgentRecord?.thread_spawn) return "subAgentThreadSpawn";
  if (subAgentRecord?.other) return "subAgentOther";
  return "subAgent";
}

function subAgentParent(value: unknown): string | undefined {
  const source = optionalRecord(value);
  const subAgent = optionalRecord(source?.subAgent);
  const spawn = optionalRecord(subAgent?.thread_spawn);
  return text(spawn?.parent_thread_id);
}

function statusShape(value: unknown): { readonly state: ExternalExecutionState; readonly needsInput: boolean; readonly waitingFor?: string; readonly terminal: boolean } {
  const status = optionalRecord(value);
  const type = text(status?.type) ?? text(value);
  const flags = Array.isArray(status?.activeFlags) ? status.activeFlags.filter((flag): flag is string => typeof flag === "string") : [];
  if (type === "active") {
    const waitingOnApproval = flags.includes("waitingOnApproval");
    const waitingOnUser = flags.includes("waitingOnUserInput");
    const needsInput = waitingOnApproval || waitingOnUser;
    return Object.freeze({
      state: needsInput ? "needs-input" : "working",
      needsInput,
      waitingFor: waitingOnApproval ? "等待执行审批" : waitingOnUser ? "等待用户输入" : undefined,
      terminal: false,
    });
  }
  if (type === "systemError") return Object.freeze({ state: "failed", needsInput: false, terminal: true });
  if (type === "idle" || type === "notLoaded") return Object.freeze({ state: "idle", needsInput: false, terminal: false });
  return Object.freeze({ state: "unknown", needsInput: false, terminal: false });
}

function titleFrom(thread: Record<string, unknown>, nativeId: string): string {
  const value = text(thread.name) ?? text(thread.preview)?.split(/\r?\n/u)[0];
  if (!value) return `Codex ${nativeId.slice(0, 8)}`;
  return value.length <= 120 ? value : `${value.slice(0, 117)}…`;
}

export function normalizeCodexExternalExecution(
  value: unknown,
  capturedAt: string,
  statusOverride?: unknown,
  index = 0,
): ExternalExecutionItem {
  const thread = record(value, `Codex threads[${index}]`);
  const nativeId = text(thread.id);
  if (!nativeId) throw new Error(`Codex threads[${index}].id 缺失`);
  const projectPath = text(thread.cwd);
  if (!projectPath) throw new Error(`Codex threads[${index}].cwd 缺失`);
  const kind = sourceKind(thread.source);
  const status = statusShape(statusOverride ?? thread.status);
  return Object.freeze({
    sourceId: "codex",
    externalId: nativeId,
    nativeId,
    kind,
    title: titleFrom(thread, nativeId),
    summary: text(thread.preview),
    projectPath,
    parentExternalId: text(thread.parentThreadId) ?? subAgentParent(thread.source) ?? text(thread.forkedFromId),
    session: Object.freeze({ backendId: "codex", sessionId: nativeId, sessionPath: text(thread.path) }),
    state: status.state,
    needsInput: status.needsInput,
    waitingFor: status.waitingFor,
    terminal: status.terminal,
    startedAt: epochDate(thread.createdAt),
    updatedAt: epochDate(thread.updatedAt ?? thread.recencyAt) ?? capturedAt,
  });
}

function joinedText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const pieces = value.flatMap((part) => {
    if (typeof part === "string") return [part];
    const item = optionalRecord(part);
    return text(item?.text) ? [text(item?.text) as string] : [];
  });
  return pieces.length > 0 ? pieces.join("\n") : undefined;
}

function detailItem(value: unknown, index: number): ExternalExecutionDetailItem {
  const item = record(value, `Codex turn item[${index}]`);
  const type = text(item.type) ?? "unknown";
  const id = text(item.id) ?? `${type}-${index}`;
  if (type === "userMessage") return Object.freeze({ id, type, label: "用户", text: truncate(joinedText(item.content)) });
  if (type === "agentMessage") return Object.freeze({ id, type, label: "Codex", text: truncate(text(item.text)) });
  if (type === "reasoning") return Object.freeze({ id, type, label: "推理摘要", text: truncate(joinedText(item.summary) ?? joinedText(item.content)) });
  if (type === "commandExecution") return Object.freeze({
    id,
    type,
    label: text(item.command) ?? "命令执行",
    text: truncate(text(item.aggregatedOutput)),
    status: text(item.status),
  });
  if (type === "fileChange") {
    const count = Array.isArray(item.changes) ? item.changes.length : 0;
    return Object.freeze({ id, type, label: `${count} 项文件变更`, status: text(item.status) });
  }
  if (type === "collabAgentToolCall") return Object.freeze({
    id,
    type,
    label: `Sub-agent · ${text(item.tool) ?? "协作"}`,
    text: truncate(text(item.prompt)),
    status: text(item.status),
  });
  if (type === "contextCompaction") return Object.freeze({ id, type, label: "上下文已压缩" });
  return Object.freeze({ id, type, label: type, status: text(item.status) });
}

function detailTurn(value: unknown, index: number): ExternalExecutionDetailTurn {
  const turn = record(value, `Codex turns[${index}]`);
  const id = text(turn.id) ?? `turn-${index}`;
  const items = Array.isArray(turn.items) ? turn.items.slice(0, MAX_TURN_ITEMS) : [];
  return Object.freeze({
    id,
    status: text(turn.status) ?? "unknown",
    startedAt: epochDate(turn.startedAt),
    completedAt: epochDate(turn.completedAt),
    items: Object.freeze(items.map(detailItem)),
  });
}

export class CodexExternalExecutionSource implements ExternalExecutionSource {
  readonly definition = Object.freeze({
    id: "codex" as const,
    label: "Codex Threads",
    description: "Codex CLI、Exec、App Server 与 Sub-agent Thread。",
    supportsDetails: true,
    supportsImport: true,
    supportsContinue: true,
  });

  readonly #configuration: () => ExecutionBackendConfiguration;
  readonly #client: CodexAppServerContract;
  readonly #copyText?: (value: string) => void;
  readonly #now: () => string;
  readonly #clock: () => number;
  readonly #details = new Map<string, CachedDetails>();
  readonly #statusOverrides = new Map<string, unknown>();
  readonly #unsubscribe: () => void;

  constructor(options: CodexExternalExecutionSourceOptions) {
    this.#configuration = options.configuration;
    this.#client = options.client ?? new CodexAppServerClient({
      configuration: options.configuration,
      cwd: options.cwd ?? process.cwd(),
    });
    this.#copyText = options.copyText;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#clock = options.clock ?? (() => Date.now());
    this.#unsubscribe = this.#client.onNotification((notification) => this.#acceptNotification(notification));
  }

  async refresh(scope: ExternalExecutionScope): Promise<readonly ExternalExecutionItem[]> {
    try {
      this.#configuration();
    } catch (cause) {
      throw new ExternalExecutionSourceUnavailableError(cause instanceof Error ? cause.message : String(cause));
    }
    const capturedAt = this.#now();
    const threads = await this.#client.listThreads({
      archived: false,
      cwd: scope.kind === "project" ? scope.projectPath : undefined,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: CODEX_SOURCE_KINDS,
    });
    return Object.freeze(threads.map((thread, index) => {
      const threadId = text(thread.id);
      return normalizeCodexExternalExecution(thread, capturedAt, threadId ? this.#statusOverrides.get(threadId) : undefined, index);
    }));
  }

  async details(item: ExternalExecutionItem): Promise<ExternalExecutionDetails> {
    if (item.sourceId !== "codex") throw new Error("Codex Source 收到非 Codex thread");
    const cached = this.#details.get(item.externalId);
    if (cached && cached.expiresAt > this.#clock()) return cached.details;
    const [thread, turns] = await Promise.all([
      this.#client.readThread(item.externalId),
      this.#client.listTurns(item.externalId),
    ]);
    const details = Object.freeze({
      sourceId: "codex" as const,
      externalId: item.externalId,
      title: titleFrom(thread, item.nativeId),
      projectPath: text(thread.cwd) ?? item.projectPath,
      fetchedAt: this.#now(),
      turns: Object.freeze(turns.slice(0, MAX_DETAIL_TURNS).map(detailTurn)),
    });
    this.#details.set(item.externalId, Object.freeze({ expiresAt: this.#clock() + DETAIL_TTL_MS, details }));
    return details;
  }

  async continue(item: ExternalExecutionItem): Promise<ContinueExternalExecutionResult> {
    if (item.sourceId !== "codex") throw new Error("Codex Source 收到非 Codex thread");
    const command = `codex resume ${item.externalId}`;
    this.#copyText?.(command);
    return Object.freeze({ kind: "command-copied", message: command });
  }

  async shutdown(): Promise<void> {
    this.#unsubscribe();
    await this.#client.shutdown();
  }

  #acceptNotification(notification: CodexAppServerNotification): void {
    const params = optionalRecord(notification.params);
    const thread = optionalRecord(params?.thread);
    const threadId = text(params?.threadId) ?? text(thread?.id);
    if (!threadId) return;
    this.#details.delete(threadId);
    if (notification.method === "thread/status/changed" && params?.status !== undefined) {
      this.#statusOverrides.set(threadId, params.status);
    } else if (notification.method === "thread/started" && thread?.status !== undefined) {
      this.#statusOverrides.set(threadId, thread.status);
    }
  }
}
