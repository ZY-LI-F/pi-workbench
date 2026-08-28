// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BoardRepository } from "../../src/main/board-repository";
import { BoardService } from "../../src/main/board-service";
import { ExternalExecutionService } from "../../src/main/external-execution-service";
import { ExternalExecutionSourceUnavailableError, type ExternalExecutionSource } from "../../src/main/external-execution-source";
import { snapshotExecutionProfile } from "../../src/shared/execution-profile";
import type { ExternalExecutionItem, ExternalExecutionScope, ExternalExecutionSourceId } from "../../src/shared/external-execution";
import { BOARD_SCHEMA_VERSION, parseBoardState, type BoardState } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

const NOW = "2026-08-24T08:00:00.000Z";

function emptyState(): BoardState {
  return parseBoardState({
    version: BOARD_SCHEMA_VERSION,
    tasks: [], runs: [], activities: [], comments: [], agentTasks: [], customAgents: [], squads: [], autopilots: [], autopilotRuns: [],
  });
}

class MemoryRepository implements BoardRepository {
  constructor(public state = emptyState()) {}
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

function execution(sourceId: ExternalExecutionSourceId, externalId: string, state: ExternalExecutionItem["state"] = "working"): ExternalExecutionItem {
  return Object.freeze({
    sourceId,
    externalId,
    nativeId: externalId.slice(0, 10),
    kind: sourceId === "claude" ? "background" : "cli",
    title: `${sourceId} ${externalId}`,
    summary: "外部执行摘要",
    projectPath: "/repo",
    session: Object.freeze({ backendId: sourceId, sessionId: externalId }),
    state,
    needsInput: state === "needs-input",
    terminal: state === "completed" || state === "failed" || state === "stopped",
    updatedAt: NOW,
  });
}

class FakeSource implements ExternalExecutionSource {
  readonly definition;
  items: readonly ExternalExecutionItem[];
  failure?: Error;
  readonly scopes: ExternalExecutionScope[] = [];

  constructor(id: ExternalExecutionSourceId, items: readonly ExternalExecutionItem[]) {
    this.definition = Object.freeze({
      id,
      label: `${id} source`,
      description: "fixture",
      capabilities: Object.freeze({
        discovery: "cli-json" as const,
        updates: Object.freeze(["poll" as const]),
        details: false,
        import: true,
        continue: false,
        hierarchy: false,
        evidence: "official-structured" as const,
      }),
    });
    this.items = items;
  }

  async refresh(scope: ExternalExecutionScope): Promise<readonly ExternalExecutionItem[]> {
    this.scopes.push(scope);
    if (this.failure) throw this.failure;
    return this.items;
  }
}

function fixture(sources: readonly ExternalExecutionSource[]) {
  const repository = new MemoryRepository();
  let nextId = 0;
  const boardService = new BoardService({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    emitChanged: () => undefined,
    projectIdentity: (value) => value,
    now: () => NOW,
    id: () => `generated-${++nextId}`,
  });
  const service = new ExternalExecutionService({
    sources,
    repository,
    boardService,
    resolveProjectTrust: async () => true,
    now: () => NOW,
  });
  return { repository, boardService, service };
}

describe("ExternalExecutionService", () => {
  it("rejects Source capability claims that have no implementation path", () => {
    const source = new FakeSource("claude", []);
    const inconsistent = Object.assign(source, {
      definition: Object.freeze({
        ...source.definition,
        capabilities: Object.freeze({ ...source.definition.capabilities, details: true }),
      }),
    });

    expect(() => fixture([inconsistent])).toThrow("details 能力与实现不一致");
  });

  it("keeps a last-good snapshot per source and per scope when refresh fails", async () => {
    const claude = new FakeSource("claude", [execution("claude", "claude-1")]);
    const codex = new FakeSource("codex", [execution("codex", "codex-1")]);
    const { service } = fixture([claude, codex]);

    const first = await service.refresh({ kind: "all" });
    expect(first.epoch).toBe(1);
    expect(first.sources.map((source) => [source.source.id, source.items.length])).toEqual([["claude", 1], ["codex", 1]]);

    claude.failure = new Error("Claude catalog failed");
    codex.items = [execution("codex", "codex-2")];
    const stale = await service.refresh({ kind: "all" });
    expect(stale.epoch).toBe(2);
    expect(stale.sources.find((source) => source.source.id === "claude")).toMatchObject({
      state: "error", stale: true, error: "Claude catalog failed", items: [expect.objectContaining({ externalId: "claude-1" })],
    });
    expect(stale.sources.find((source) => source.source.id === "codex")).toMatchObject({ state: "ready", stale: false, items: [expect.objectContaining({ externalId: "codex-2" })] });

    claude.failure = new ExternalExecutionSourceUnavailableError("Claude CLI 不可用");
    const project = await service.refresh({ kind: "project", projectPath: "/repo" });
    expect(project.sources.find((source) => source.source.id === "claude")).toMatchObject({ state: "unavailable", stale: false, items: [] });
    expect(claude.scopes.at(-1)).toEqual({ kind: "project", projectPath: "/repo" });
  });

  it("imports exactly once as an independent manual Task with immutable origin", async () => {
    const claude = new FakeSource("claude", [execution("claude", "session-1", "needs-input")]);
    const { repository, boardService, service } = fixture([claude]);
    await service.refresh({ kind: "all" });

    const [first, duplicate] = await Promise.all([
      service.import({ sourceId: "claude", externalId: "session-1" }),
      service.import({ sourceId: "claude", externalId: "session-1" }),
    ]);
    expect(new Set([first.created, duplicate.created])).toEqual(new Set([true, false]));
    expect(first.taskId).toBe(duplicate.taskId);
    expect(repository.state.tasks).toHaveLength(1);
    expect(repository.state.tasks[0]).toMatchObject({
      id: first.taskId,
      priority: "high",
      stage: "planned",
      executionTarget: { kind: "manual" },
      sourceSession: { backendId: "claude", sessionId: "session-1" },
      externalOrigin: { sourceId: "claude", externalId: "session-1", projectPath: "/repo", importedAt: NOW },
    });

    await boardService.moveTask(first.taskId, "running");
    claude.items = [execution("claude", "session-1", "completed")];
    const refreshed = await service.refresh({ kind: "all" });
    expect(repository.state.tasks[0]).toMatchObject({ stage: "running", externalOrigin: { externalId: "session-1" } });
    expect(refreshed.sources[0]?.items[0]?.association).toEqual({ taskId: first.taskId, relation: "imported" });
  });

  it.each([
    ["claude", "claude.print"],
    ["codex", "codex.exec"],
  ] as const)("associates a managed %s session without importing another Task", async (sourceId, profileId) => {
    const source = new FakeSource(sourceId, [execution(sourceId, "managed-session")]);
    const { repository, boardService, service } = fixture([source]);
    await boardService.createTask({
      title: "Managed Task",
      description: "",
      acceptanceCriteria: "",
      priority: "medium",
      projectPath: "/repo",
      projectName: "repo",
      trusted: true,
      executionTarget: { kind: "agent", agentId: "builder" },
      executionProfileId: profileId,
    });
    const task = repository.state.tasks[0];
    const builder = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
    if (!task || !builder) throw new Error("fixture incomplete");
    repository.state = parseBoardState({
      ...repository.state,
      agentTasks: [{
        id: "agent-task-1",
        taskId: task.id,
        executionAttempt: 1,
        taskSpec: {
          revision: 1,
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          priority: task.priority,
          executionTarget: task.executionTarget,
          executionProfileId: profileId,
        },
        executionProfile: snapshotExecutionProfile(profileId),
        agentSnapshot: builder,
        kind: "direct",
        status: "failed",
        acceptance: "not-ready",
        prompt: "execute",
        session: { backendId: sourceId, sessionId: "managed-session" },
        createdAt: NOW,
        updatedAt: NOW,
        completedAt: NOW,
      }],
    });

    const snapshot = await service.refresh({ kind: "all" });
    expect(snapshot.sources[0]?.items[0]?.association).toEqual({ taskId: task.id, relation: "managed" });
    expect(repository.state.tasks).toHaveLength(1);
  });
});
