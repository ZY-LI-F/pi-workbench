import { describe, expect, it, vi } from "vitest";
import { MainCompanionControlPlane } from "../../src/main/companion-control-plane";
import type { BoardRepository } from "../../src/main/board-repository";
import { projectAgentActivity } from "../../src/shared/agent-projection";
import {
  COMPANION_PROJECTION_LIMITS,
  COMPANION_PROTOCOL_VERSION,
  type CompanionProjectedEvent,
  type CompanionSnapshot,
} from "../../src/shared/companion-protocol";
import { snapshotExecutionProfile } from "../../src/shared/execution-profile";
import type {
  ExternalExecutionCatalogSnapshot,
  ExternalExecutionDetails,
  ExternalExecutionItem,
  ExternalExecutionScope,
  ExternalExecutionSourceDefinition,
  ReadExternalExecutionDetailsInput,
} from "../../src/shared/external-execution";
import {
  BOARD_SCHEMA_VERSION,
  type AgentDefinition,
  type BoardState,
  type KanbanTask,
} from "../../src/shared/kanban";

const CREATED_AT = "2026-08-28T08:00:00.000Z";
const UPDATED_AT = "2026-08-28T08:01:00.000Z";
const HOST = Object.freeze({ id: "desktop-1", name: "Studio Mac", version: "0.5.0" });

const AGENT: AgentDefinition = Object.freeze({
  id: "coordinator",
  version: 1,
  name: "Coordinator",
  callsign: "lead",
  responsibility: "Coordinate work",
  instructions: "Coordinate",
  workspaceAccess: "write",
  allowedTools: Object.freeze([]),
  thinking: "medium",
  disableExtensions: false,
  disableSkills: false,
  disablePromptTemplates: false,
  disableContextFiles: true,
});

function task(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return Object.freeze({
    id: "task-1",
    title: "Deliver Companion",
    description: "Show desktop state on Android",
    acceptanceCriteria: "State remains authoritative",
    priority: "high",
    projectPath: "/workspace/stella",
    projectName: "stella",
    trusted: true,
    executionTarget: Object.freeze({ kind: "agent", agentId: AGENT.id }),
    executionProfileId: "pi.rpc",
    stage: "running",
    specRevision: 1,
    activeAgentTaskId: "agent-1",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  });
}

function board(overrides: Partial<BoardState> = {}): BoardState {
  const selectedTask = task();
  return Object.freeze({
    version: BOARD_SCHEMA_VERSION,
    tasks: Object.freeze([selectedTask]),
    runs: Object.freeze([]),
    activities: Object.freeze([Object.freeze({
      id: "activity-1",
      taskId: selectedTask.id,
      agentTaskId: "agent-1",
      kind: "agent" as const,
      summary: "Coordinator is waiting",
      detail: "Choose the next implementation step",
      createdAt: UPDATED_AT,
    })]),
    comments: Object.freeze([Object.freeze({
      id: "message-1",
      taskId: selectedTask.id,
      author: "user" as const,
      body: "Keep the mobile projection compact",
      createdAt: CREATED_AT,
    })]),
    agentTasks: Object.freeze([Object.freeze({
      id: "agent-1",
      taskId: selectedTask.id,
      executionAttempt: 1,
      taskSpec: Object.freeze({
        revision: 1,
        title: selectedTask.title,
        description: selectedTask.description,
        acceptanceCriteria: selectedTask.acceptanceCriteria,
        priority: selectedTask.priority,
        executionTarget: selectedTask.executionTarget,
        executionProfileId: "pi.rpc" as const,
      }),
      executionProfile: snapshotExecutionProfile("pi.rpc"),
      agentSnapshot: AGENT,
      kind: "coordinator" as const,
      status: "waiting_human" as const,
      acceptance: "not-ready" as const,
      prompt: "A private full prompt that must never enter the snapshot",
      output: `${"x".repeat(500)}RAW_OUTPUT_TAIL`,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    })]),
    customAgents: Object.freeze([]),
    squads: Object.freeze([]),
    autopilots: Object.freeze([]),
    autopilotRuns: Object.freeze([]),
    ...overrides,
  });
}

class MemoryBoardRepository implements BoardRepository {
  #board: BoardState;

  constructor(initial: BoardState) {
    this.#board = initial;
  }

  async read(): Promise<BoardState> {
    return this.#board;
  }

  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.#board = transform(this.#board);
    return this.#board;
  }
}

function controlPlane(repository: BoardRepository): MainCompanionControlPlane {
  let tick = 0;
  return new MainCompanionControlPlane({
    repository,
    host: HOST,
    now: () => `2026-08-28T09:00:0${tick++}.000Z`,
  });
}

const EXTERNAL_SOURCE: ExternalExecutionSourceDefinition = Object.freeze({
  id: "claude",
  label: "Claude Agents",
  description: "fixture",
  capabilities: Object.freeze({
    discovery: "cli-json",
    updates: Object.freeze(["poll"]),
    details: true,
    import: true,
    continue: true,
    hierarchy: true,
    evidence: "official-structured",
  }),
});

function externalItem(overrides: Partial<ExternalExecutionItem> = {}): ExternalExecutionItem {
  return Object.freeze({
    sourceId: "claude",
    externalId: "external-only",
    nativeId: "native-1",
    kind: "background",
    title: "Claude external execution",
    summary: "Read-only external status",
    projectPath: "/workspace/external",
    session: Object.freeze({ backendId: "claude", sessionId: "external-only" }),
    state: "working",
    needsInput: false,
    terminal: false,
    updatedAt: UPDATED_AT,
    ...overrides,
  });
}

function externalCatalog(items: readonly ExternalExecutionItem[], overrides: Partial<ExternalExecutionCatalogSnapshot> = {}): ExternalExecutionCatalogSnapshot {
  return Object.freeze({
    epoch: 1,
    scope: Object.freeze({ kind: "all" }),
    capturedAt: UPDATED_AT,
    sources: Object.freeze([Object.freeze({
      source: EXTERNAL_SOURCE,
      state: "error" as const,
      stale: true,
      error: "Claude refresh failed",
      lastSuccessfulAt: CREATED_AT,
      items: Object.freeze(items),
    })]),
    ...overrides,
  });
}

class FakeExternalProvider {
  refreshCount = 0;
  snapshotValue: ExternalExecutionCatalogSnapshot;
  readonly listeners = new Set<(snapshot: ExternalExecutionCatalogSnapshot) => void>();

  constructor(snapshot: ExternalExecutionCatalogSnapshot) {
    this.snapshotValue = snapshot;
  }

  async refresh(_scope: ExternalExecutionScope): Promise<ExternalExecutionCatalogSnapshot> {
    this.refreshCount += 1;
    for (const listener of [...this.listeners]) listener(this.snapshotValue);
    return this.snapshotValue;
  }

  async snapshot(_scope: ExternalExecutionScope): Promise<ExternalExecutionCatalogSnapshot> {
    return this.snapshotValue;
  }

  async details(input: ReadExternalExecutionDetailsInput): Promise<ExternalExecutionDetails> {
    return Object.freeze({
      sourceId: input.sourceId,
      externalId: input.externalId,
      title: "External detail",
      projectPath: "/workspace/external",
      fetchedAt: UPDATED_AT,
      turns: Object.freeze(Array.from({ length: 25 }, (_, turnIndex) => Object.freeze({
        id: `turn-${turnIndex}`,
        status: "completed",
        items: Object.freeze(Array.from({ length: 10 }, (_, itemIndex) => Object.freeze({
          id: `item-${turnIndex}-${itemIndex}`,
          type: "message",
          label: "Assistant",
          text: "x".repeat(COMPANION_PROJECTION_LIMITS.externalDetailText + 50),
        }))),
      }))),
    });
  }

  subscribe(listener: (snapshot: ExternalExecutionCatalogSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

describe("MainCompanionControlPlane", () => {
  it("returns a compact authoritative snapshot with attention, managed Agents, and freshness", async () => {
    const control = controlPlane(new MemoryBoardRepository(board()));

    const snapshot = await control.getSnapshot();

    expect(snapshot).toMatchObject({
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      sequence: 1,
      host: HOST,
      freshness: { state: "live", stale: false },
      projects: [{ path: "/workspace/stella", taskCount: 1, attentionCount: 1 }],
      tasks: [{ id: "task-1", stage: "running", attentionCount: 1, agentCount: 1 }],
      agents: [{ id: "managed:agent-task:agent-1", bucket: "attention", attentionReason: "waiting-human" }],
      attention: [{ agentId: "managed:agent-task:agent-1", reason: "waiting-human", taskId: "task-1" }],
    });
    expect(snapshot.recentTimeline.map((item) => item.source)).toEqual(["activity", "message"]);
    expect(snapshot.freshness.capturedAt).toBe(snapshot.capturedAt);
    expect(Object.isFrozen(snapshot)).toBe(true);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("RAW_OUTPUT_TAIL");
    expect(serialized).not.toContain("private full prompt");
    expect(snapshot).not.toHaveProperty("board");
    expect(snapshot).not.toHaveProperty("runs");
    expect(snapshot).not.toHaveProperty("comments");
    expect(snapshot.agents[0]).not.toHaveProperty("external");
  });

  it("caps initial data deterministically and loads bounded Task detail lazily", async () => {
    const selectedTask = task({
      description: "d".repeat(COMPANION_PROJECTION_LIMITS.detailText + 100),
      acceptanceCriteria: "a".repeat(COMPANION_PROJECTION_LIMITS.detailText + 100),
    });
    const comments = Object.freeze(Array.from({ length: 130 }, (_, index) => Object.freeze({
      id: `message-${String(index).padStart(3, "0")}`,
      taskId: selectedTask.id,
      author: "agent" as const,
      authorAgentId: AGENT.id,
      messageKind: "execution-report" as const,
      body: `${index}:${"m".repeat(COMPANION_PROJECTION_LIMITS.detailText + 100)}`,
      createdAt: new Date(Date.parse(CREATED_AT) + index * 1_000).toISOString(),
    })));
    const largeBoard = board({ tasks: Object.freeze([selectedTask]), comments });
    const control = controlPlane(new MemoryBoardRepository(largeBoard));

    const snapshot = await control.getSnapshot();
    expect(snapshot.recentTimeline).toHaveLength(COMPANION_PROJECTION_LIMITS.recentTimeline);
    expect(Math.max(...snapshot.recentTimeline.map((item) => item.body?.length ?? 0)))
      .toBeLessThanOrEqual(COMPANION_PROJECTION_LIMITS.summaryText);
    expect(JSON.stringify(snapshot)).not.toContain("acceptanceCriteria");

    const detail = await control.getTaskDetail(selectedTask.id);
    expect(detail.sequence).toBe(snapshot.sequence);
    expect(detail.timeline).toHaveLength(COMPANION_PROJECTION_LIMITS.taskTimeline);
    expect(detail.task.description).toHaveLength(COMPANION_PROJECTION_LIMITS.detailText);
    expect(detail.task.acceptanceCriteria).toHaveLength(COMPANION_PROJECTION_LIMITS.detailText);
    expect(detail.actions).toEqual([{
      kind: "abort-execution",
      taskId: selectedTask.id,
      executionKind: "agent-task",
      executionId: "agent-1",
    }]);
    expect(detail.timeline[0]?.id).toBe("message:message-033");
    expect(Math.max(...detail.timeline.map((item) => item.body?.length ?? 0)))
      .toBeLessThanOrEqual(COMPANION_PROJECTION_LIMITS.detailText);
    expect(Math.max(...detail.timeline.map((item) => item.artifact?.content.length ?? 0)))
      .toBeLessThanOrEqual(COMPANION_PROJECTION_LIMITS.artifactText);
    expect(Object.isFrozen(detail.timeline)).toBe(true);
  });

  it("publishes every committed projection in sequence and replaces state after a client gap", async () => {
    const repository = new MemoryBoardRepository(board());
    const control = controlPlane(repository);
    const initial = await control.getSnapshot();
    const delivered: CompanionProjectedEvent[] = [];
    control.subscribe(() => { throw new Error("broken transport"); });
    const unsubscribe = control.subscribe((event) => { delivered.push(event); });

    const secondBoard = await repository.update((current) => Object.freeze({
      ...current,
      tasks: Object.freeze(current.tasks.map((item) => Object.freeze({ ...item, title: "Committed second", updatedAt: "2026-08-28T08:02:00.000Z" }))),
    }));
    await control.publishCommitted(secondBoard);
    const thirdBoard = await repository.update((current) => Object.freeze({
      ...current,
      tasks: Object.freeze(current.tasks.map((item) => Object.freeze({ ...item, title: "Committed third", updatedAt: "2026-08-28T08:03:00.000Z" }))),
    }));
    await control.publishCommitted(thirdBoard);
    unsubscribe();

    expect(delivered.map((event) => event.sequence)).toEqual([initial.sequence + 1, initial.sequence + 2]);
    expect(delivered.map((event) => event.snapshot.tasks[0]?.title)).toEqual(["Committed second", "Committed third"]);
    expect(delivered.every((event) => event.protocolVersion === COMPANION_PROTOCOL_VERSION)).toBe(true);
    expect(delivered.every((event) => event.capturedAt === event.snapshot.capturedAt)).toBe(true);

    let clientSnapshot: CompanionSnapshot = initial;
    const onlyThirdEvent = delivered[1];
    expect(onlyThirdEvent).toBeDefined();
    if (onlyThirdEvent && onlyThirdEvent.sequence !== clientSnapshot.sequence + 1) {
      clientSnapshot = await control.getSnapshot();
    }
    expect(clientSnapshot.sequence).toBe(onlyThirdEvent?.sequence);
    expect(clientSnapshot.tasks[0]?.title).toBe("Committed third");
  });

  it("rejects unknown Task detail without leaking the Board", async () => {
    const control = controlPlane(new MemoryBoardRepository(board()));

    await expect(control.getTaskDetail("missing")).rejects.toThrow("Companion Task 不存在: missing");
  });

  it("uses the desktop projection for external cards, preserves source freshness, and removes managed duplicates", async () => {
    const repository = new MemoryBoardRepository(board());
    const external = externalCatalog([
      externalItem(),
      externalItem({
        externalId: "managed-duplicate",
        nativeId: "managed-duplicate",
        projectPath: "/workspace/stella",
        session: Object.freeze({ backendId: "claude", sessionId: "managed-duplicate" }),
        association: Object.freeze({ taskId: "task-1", relation: "managed" }),
      }),
      externalItem({
        externalId: "imported",
        nativeId: "imported",
        projectPath: "/workspace/stella",
        session: Object.freeze({ backendId: "claude", sessionId: "imported" }),
        association: Object.freeze({ taskId: "task-1", relation: "imported" }),
        state: "needs-input",
        needsInput: true,
      }),
    ]);
    const provider = new FakeExternalProvider(external);
    const control = controlPlane(repository);
    control.attachExternalExecutions(provider);

    const snapshot = await control.getSnapshot();
    const desktopIds = projectAgentActivity({ board: await repository.read(), external }).cards
      .filter((card) => card.kind === "external")
      .map((card) => card.id);
    const mobileExternal = snapshot.agents.filter((agent) => agent.kind === "external");

    expect(mobileExternal.map((agent) => agent.id)).toEqual(desktopIds);
    expect(mobileExternal.map((agent) => agent.id)).not.toContain("external:claude:managed-duplicate");
    expect(mobileExternal.find((agent) => agent.id === "external:claude:imported")).toMatchObject({
      taskId: "task-1",
      external: { association: { taskId: "task-1", relation: "imported" }, detailsAvailable: true },
      freshness: { state: "error", stale: true, lastSuccessfulAt: CREATED_AT },
    });
    expect(snapshot.externalSources).toEqual([expect.objectContaining({
      id: "claude",
      state: "error",
      stale: true,
      itemCount: 3,
      error: "Claude refresh failed",
    })]);
  });

  it("bounds lazy external details and polls only while a realtime consumer is subscribed", async () => {
    vi.useFakeTimers();
    try {
      const provider = new FakeExternalProvider(externalCatalog([externalItem()]));
      const control = new MainCompanionControlPlane({
        repository: new MemoryBoardRepository(board()),
        host: HOST,
        externalPollIntervalMs: 100,
        now: () => UPDATED_AT,
      });
      control.attachExternalExecutions(provider);
      await control.getSnapshot();
      expect(provider.refreshCount).toBe(0);

      const delivered: CompanionProjectedEvent[] = [];
      const unsubscribe = control.subscribe((event) => { delivered.push(event); });
      await vi.advanceTimersByTimeAsync(250);
      expect(provider.refreshCount).toBe(3);
      expect(delivered.length).toBeGreaterThanOrEqual(3);
      const stoppedAt = provider.refreshCount;
      unsubscribe();
      await vi.advanceTimersByTimeAsync(500);
      expect(provider.refreshCount).toBe(stoppedAt);

      const detail = await control.getExternalExecutionDetail("claude", "external-only");
      expect(detail.turns).toHaveLength(COMPANION_PROJECTION_LIMITS.externalDetailTurns);
      expect(detail.turns[0]?.id).toBe("turn-5");
      expect(detail.turns.flatMap((turn) => turn.items)).toHaveLength(COMPANION_PROJECTION_LIMITS.externalDetailItems);
      expect(Math.max(...detail.turns.flatMap((turn) => turn.items.map((item) => item.text?.length ?? 0))))
        .toBe(COMPANION_PROJECTION_LIMITS.externalDetailText);
    } finally {
      vi.useRealTimers();
    }
  });
});
