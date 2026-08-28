import { basename } from "node:path";
import type { BoardRepository } from "./board-repository";
import type { BoardService } from "./board-service";
import {
  externalExecutionScopeKey,
  type ContinueExternalExecutionInput,
  type ContinueExternalExecutionResult,
  type ExternalExecutionCatalogSnapshot,
  type ExternalExecutionDetails,
  type ExternalExecutionItem,
  type ExternalExecutionScope,
  type ExternalExecutionSourceId,
  type ExternalExecutionSourceSnapshot,
  type ImportExternalExecutionInput,
  type ImportExternalExecutionResult,
  type ReadExternalExecutionDetailsInput,
} from "../shared/external-execution";
import type { BoardState, KanbanTask } from "../shared/kanban";
import type { ExecutionSessionReference } from "../shared/execution-session";
import {
  ExternalExecutionSourceUnavailableError,
  type ExternalExecutionSource,
} from "./external-execution-source";

interface ExternalExecutionServiceOptions {
  readonly sources: readonly ExternalExecutionSource[];
  readonly repository: BoardRepository;
  readonly boardService: Pick<BoardService, "createTask">;
  readonly resolveProjectTrust: (projectPath: string) => Promise<boolean>;
  readonly now?: () => string;
}

interface CachedScope {
  readonly scope: ExternalExecutionScope;
  readonly capturedAt: string;
  readonly sources: ReadonlyMap<ExternalExecutionSourceId, ExternalExecutionSourceSnapshot>;
}

function cloneScope(scope: ExternalExecutionScope): ExternalExecutionScope {
  return scope.kind === "all"
    ? Object.freeze({ kind: "all" })
    : Object.freeze({ kind: "project", projectPath: scope.projectPath });
}

function sessionKeys(session: ExecutionSessionReference | undefined): readonly string[] {
  if (!session) return Object.freeze([]);
  return Object.freeze([
    ...(session.sessionId ? [`${session.backendId}:id:${session.sessionId}`] : []),
    ...(session.sessionPath ? [`${session.backendId}:path:${session.sessionPath}`] : []),
  ]);
}

function importedTask(state: BoardState, sourceId: ExternalExecutionSourceId, externalId: string): KanbanTask | undefined {
  return state.tasks.find((task) => task.externalOrigin?.sourceId === sourceId
    && task.externalOrigin.externalId === externalId);
}

function associationIndex(state: BoardState): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const agentTask of [...state.agentTasks].reverse()) {
    for (const key of sessionKeys(agentTask.session)) if (!index.has(key)) index.set(key, agentTask.taskId);
  }
  for (const run of [...state.runs].reverse()) {
    for (const step of run.steps) {
      for (const key of sessionKeys(step.session)) if (!index.has(key)) index.set(key, run.taskId);
      for (const key of sessionKeys(step.artifact?.session)) if (!index.has(key)) index.set(key, run.taskId);
    }
  }
  return index;
}

function withAssociation(item: ExternalExecutionItem, state: BoardState, managed: ReadonlyMap<string, string>): ExternalExecutionItem {
  const imported = importedTask(state, item.sourceId, item.externalId);
  if (imported) return Object.freeze({ ...item, association: Object.freeze({ taskId: imported.id, relation: "imported" }) });
  const managedTaskId = sessionKeys(item.session)
    .map((key) => managed.get(key))
    .find((taskId): taskId is string => Boolean(taskId));
  return managedTaskId
    ? Object.freeze({ ...item, association: Object.freeze({ taskId: managedTaskId, relation: "managed" }) })
    : Object.freeze({ ...item, association: undefined });
}

function assertSourceCapabilityContract(source: ExternalExecutionSource): void {
  const { capabilities } = source.definition;
  if (capabilities.updates.length === 0) throw new Error(`${source.definition.id} Source 必须声明至少一种更新机制`);
  if (capabilities.details !== Boolean(source.details)) {
    throw new Error(`${source.definition.id} Source 的 details 能力与实现不一致`);
  }
  if (capabilities.continue !== Boolean(source.continue)) {
    throw new Error(`${source.definition.id} Source 的 continue 能力与实现不一致`);
  }
}

export class ExternalExecutionService {
  readonly #sources: ReadonlyMap<ExternalExecutionSourceId, ExternalExecutionSource>;
  readonly #repository: BoardRepository;
  readonly #boardService: Pick<BoardService, "createTask">;
  readonly #resolveProjectTrust: (projectPath: string) => Promise<boolean>;
  readonly #now: () => string;
  readonly #cache = new Map<string, CachedScope>();
  readonly #generation = new Map<string, number>();
  #epoch = 0;

  constructor(options: ExternalExecutionServiceOptions) {
    if (new Set(options.sources.map((source) => source.definition.id)).size !== options.sources.length) {
      throw new Error("ExternalExecution Source ID 重复");
    }
    for (const source of options.sources) assertSourceCapabilityContract(source);
    this.#sources = new Map(options.sources.map((source) => [source.definition.id, source] as const));
    this.#repository = options.repository;
    this.#boardService = options.boardService;
    this.#resolveProjectTrust = options.resolveProjectTrust;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async refresh(scope: ExternalExecutionScope): Promise<ExternalExecutionCatalogSnapshot> {
    const normalizedScope = cloneScope(scope);
    const key = externalExecutionScopeKey(normalizedScope);
    const generation = (this.#generation.get(key) ?? 0) + 1;
    this.#generation.set(key, generation);
    const previous = this.#cache.get(key);
    const results = await Promise.all([...this.#sources.values()].map(async (source) => {
      try {
        const items = await source.refresh(normalizedScope);
        return Object.freeze({ source, items, error: undefined });
      } catch (cause) {
        return Object.freeze({ source, items: undefined, error: cause });
      }
    }));

    if (this.#generation.get(key) !== generation) return this.snapshot(normalizedScope);
    const capturedAt = this.#now();
    const sourceSnapshots = new Map<ExternalExecutionSourceId, ExternalExecutionSourceSnapshot>();
    for (const result of results) {
      const prior = previous?.sources.get(result.source.definition.id);
      if (result.items) {
        sourceSnapshots.set(result.source.definition.id, Object.freeze({
          source: result.source.definition,
          state: "ready",
          stale: false,
          lastSuccessfulAt: capturedAt,
          items: Object.freeze(result.items.map((item) => Object.freeze({ ...item }))),
        }));
        continue;
      }
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      sourceSnapshots.set(result.source.definition.id, Object.freeze({
        source: result.source.definition,
        state: result.error instanceof ExternalExecutionSourceUnavailableError ? "unavailable" : "error",
        stale: Boolean(prior?.lastSuccessfulAt),
        error: message,
        lastSuccessfulAt: prior?.lastSuccessfulAt,
        items: prior?.items ?? Object.freeze([]),
      }));
    }
    this.#cache.set(key, Object.freeze({ scope: normalizedScope, capturedAt, sources: sourceSnapshots }));
    this.#epoch += 1;
    return this.snapshot(normalizedScope);
  }

  async snapshot(scope: ExternalExecutionScope): Promise<ExternalExecutionCatalogSnapshot> {
    const normalizedScope = cloneScope(scope);
    const cached = this.#cache.get(externalExecutionScopeKey(normalizedScope));
    const state = await this.#repository.read();
    const managed = associationIndex(state);
    const sources = [...this.#sources.values()].map((source) => {
      const snapshot = cached?.sources.get(source.definition.id);
      if (!snapshot) return Object.freeze({
        source: source.definition,
        state: "unavailable" as const,
        stale: false,
        error: "尚未刷新",
        items: Object.freeze([]),
      });
      return Object.freeze({
        ...snapshot,
        items: Object.freeze(snapshot.items.map((item) => withAssociation(item, state, managed))),
      });
    });
    return Object.freeze({
      epoch: this.#epoch,
      scope: normalizedScope,
      capturedAt: cached?.capturedAt ?? this.#now(),
      sources: Object.freeze(sources),
    });
  }

  async import(input: ImportExternalExecutionInput): Promise<ImportExternalExecutionResult> {
    const source = this.#sources.get(input.sourceId);
    if (!source?.definition.capabilities.import) throw new Error(`${input.sourceId} Source 不支持导入 Task`);
    const item = this.#findItem(input.sourceId, input.externalId);
    const before = await this.#repository.read();
    const existing = importedTask(before, item.sourceId, item.externalId);
    if (existing) return Object.freeze({ taskId: existing.id, created: false });
    const importedAt = this.#now();
    const trusted = await this.#resolveProjectTrust(item.projectPath);
    try {
      const bootstrap = await this.#boardService.createTask(Object.freeze({
        title: item.title,
        description: [item.summary, `来源：${item.sourceId} · ${item.nativeId}`].filter(Boolean).join("\n\n"),
        acceptanceCriteria: "",
        priority: item.needsInput ? "high" : "medium",
        projectPath: item.projectPath,
        projectName: basename(item.projectPath) || item.projectPath,
        trusted,
        executionTarget: Object.freeze({ kind: "manual" }),
        sourceSession: item.session,
        externalOrigin: Object.freeze({
          sourceId: item.sourceId,
          externalId: item.externalId,
          session: item.session,
          projectPath: item.projectPath,
          importedAt,
        }),
      }));
      const created = importedTask(bootstrap.board, item.sourceId, item.externalId);
      if (!created) throw new Error("外部执行导入后找不到新 Task");
      return Object.freeze({ taskId: created.id, created: true });
    } catch (cause) {
      const latest = importedTask(await this.#repository.read(), item.sourceId, item.externalId);
      if (latest) return Object.freeze({ taskId: latest.id, created: false });
      throw cause;
    }
  }

  async continue(input: ContinueExternalExecutionInput): Promise<ContinueExternalExecutionResult> {
    const item = this.#findItem(input.sourceId, input.externalId);
    const source = this.#sources.get(input.sourceId);
    if (!source?.definition.capabilities.continue || !source.continue) throw new Error(`${input.sourceId} Source 不支持继续 session`);
    return source.continue(item);
  }

  async details(input: ReadExternalExecutionDetailsInput): Promise<ExternalExecutionDetails> {
    const item = this.#findItem(input.sourceId, input.externalId);
    const source = this.#sources.get(input.sourceId);
    if (!source?.definition.capabilities.details || !source.details) throw new Error(`${input.sourceId} Source 不支持读取详情`);
    return source.details(item);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.#sources.values()].map((source) => source.shutdown?.()));
  }

  #findItem(sourceId: ExternalExecutionSourceId, externalId: string): ExternalExecutionItem {
    for (const cached of this.#cache.values()) {
      const item = cached.sources.get(sourceId)?.items.find((candidate) => candidate.externalId === externalId);
      if (item) return item;
    }
    throw new Error(`找不到外部执行: ${sourceId}/${externalId}`);
  }
}
