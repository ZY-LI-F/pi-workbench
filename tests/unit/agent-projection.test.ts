import { describe, expect, it } from "vitest";
import { projectAgentActivity } from "../../src/shared/agent-projection";
import type { ExternalExecutionCatalogSnapshot, ExternalExecutionItem } from "../../src/shared/external-execution";
import { snapshotExecutionProfile } from "../../src/shared/execution-profile";
import { BOARD_SCHEMA_VERSION, type AgentDefinition, type BoardState, type KanbanTask } from "../../src/shared/kanban";

const NOW = "2026-08-28T08:00:00.000Z";
const EARLIER = "2026-08-28T07:00:00.000Z";

const AGENT: AgentDefinition = Object.freeze({
  id: "builder",
  version: 1,
  name: "Builder",
  callsign: "builder",
  responsibility: "Build",
  instructions: "Build the task",
  workspaceAccess: "write",
  allowedTools: Object.freeze([]),
  thinking: "medium",
  disableExtensions: false,
  disableSkills: false,
  disablePromptTemplates: false,
  disableContextFiles: true,
});

function task(id: string, stage: KanbanTask["stage"] = "running"): KanbanTask {
  return Object.freeze({
    id,
    title: `Task ${id}`,
    description: "",
    acceptanceCriteria: "",
    priority: "medium",
    projectPath: "/repo",
    projectName: "repo",
    trusted: true,
    executionTarget: Object.freeze({ kind: "agent", agentId: "builder" }),
    executionProfileId: "pi.rpc",
    stage,
    specRevision: 1,
    createdAt: EARLIER,
    updatedAt: NOW,
  });
}

function board(): BoardState {
  const waitingTask = task("waiting");
  const reviewTask = task("review", "review");
  const workflowTask = task("workflow");
  const taskSpec = (value: KanbanTask) => Object.freeze({
    revision: value.specRevision,
    title: value.title,
    description: value.description,
    acceptanceCriteria: value.acceptanceCriteria,
    priority: value.priority,
    executionTarget: value.executionTarget,
    executionProfileId: value.executionProfileId,
  });
  return Object.freeze({
    version: BOARD_SCHEMA_VERSION,
    tasks: Object.freeze([waitingTask, reviewTask, workflowTask]),
    agentTasks: Object.freeze([
      Object.freeze({
        id: "agent-review",
        taskId: reviewTask.id,
        executionAttempt: 1,
        taskSpec: taskSpec(reviewTask),
        executionProfile: snapshotExecutionProfile("pi.rpc"),
        agentSnapshot: AGENT,
        kind: "direct" as const,
        status: "reported" as const,
        acceptance: "pending" as const,
        prompt: "review me",
        output: "Ready for review",
        createdAt: EARLIER,
        updatedAt: NOW,
      }),
      Object.freeze({
        id: "agent-waiting",
        taskId: waitingTask.id,
        executionAttempt: 1,
        taskSpec: taskSpec(waitingTask),
        executionProfile: snapshotExecutionProfile("pi.rpc"),
        agentSnapshot: AGENT,
        kind: "coordinator" as const,
        status: "waiting_human" as const,
        acceptance: "not-ready" as const,
        prompt: "choose",
        createdAt: EARLIER,
        updatedAt: EARLIER,
      }),
    ]),
    runs: Object.freeze([Object.freeze({
      id: "run-gate",
      taskId: workflowTask.id,
      executionAttempt: 1,
      taskSpec: taskSpec(workflowTask),
      executionProfile: snapshotExecutionProfile("pi.rpc"),
      workflow: Object.freeze({
        id: "flow",
        version: 1,
        name: "Flow",
        shortName: "Flow",
        summary: "",
        teamId: "team",
        steps: Object.freeze([Object.freeze({ kind: "human-gate" as const, id: "gate", name: "Approve", summary: "", instructions: "Choose" })]),
      }),
      agents: Object.freeze([AGENT]),
      status: "running" as const,
      acceptance: "not-ready" as const,
      currentStepId: "gate-run",
      steps: Object.freeze([Object.freeze({ id: "gate-run", stepId: "gate", stepKind: "human-gate" as const, name: "Approve", status: "waiting" as const, startedAt: NOW })]),
      startedAt: EARLIER,
      updatedAt: NOW,
    })]),
    activities: Object.freeze([]),
    comments: Object.freeze([]),
    customAgents: Object.freeze([]),
    squads: Object.freeze([]),
    autopilots: Object.freeze([]),
    autopilotRuns: Object.freeze([]),
  });
}

function externalItem(overrides: Partial<ExternalExecutionItem> = {}): ExternalExecutionItem {
  return Object.freeze({
    sourceId: "claude",
    externalId: "session-1",
    nativeId: "session-1",
    kind: "background",
    title: "External agent",
    projectPath: "/repo",
    session: Object.freeze({ backendId: "claude", sessionId: "session-1" }),
    state: "working",
    needsInput: false,
    terminal: false,
    updatedAt: NOW,
    ...overrides,
  });
}

function external(items: readonly ExternalExecutionItem[]): ExternalExecutionCatalogSnapshot {
  return Object.freeze({
    epoch: 1,
    scope: Object.freeze({ kind: "all" }),
    capturedAt: NOW,
    sources: Object.freeze([Object.freeze({
      source: Object.freeze({
        id: "claude",
        label: "Claude Agents",
        description: "fixture",
        capabilities: Object.freeze({
          discovery: "cli-json",
          updates: Object.freeze(["poll"]),
          details: false,
          import: true,
          continue: true,
          hierarchy: true,
          evidence: "official-structured",
        }),
      }),
      state: "error",
      stale: true,
      error: "refresh failed",
      lastSuccessfulAt: EARLIER,
      items: Object.freeze(items),
    })]),
  });
}

describe("Agent Projection", () => {
  it("prioritizes human gates, waiting agents, and pending reviews deterministically", () => {
    const result = projectAgentActivity({ board: board() });

    expect(result.cards.map((card) => [card.id, card.bucket, card.attentionReason])).toEqual([
      ["managed:workflow-step:run-gate:gate-run", "attention", "human-gate"],
      ["managed:agent-task:agent-waiting", "attention", "waiting-human"],
      ["managed:agent-task:agent-review", "attention", "review"],
    ]);
    expect(result.cards[0]?.state).toEqual({ domain: "workflow-step", value: "waiting" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.cards)).toBe(true);
    expect(Object.isFrozen(result.buckets.attention)).toBe(true);
  });

  it("preserves hierarchy, stale evidence, associations, and separate state domains", () => {
    const inputBoard = board();
    const snapshot = external([
      externalItem({
        externalId: "child",
        nativeId: "child",
        parentExternalId: "parent",
        state: "needs-input",
        needsInput: true,
        waitingFor: "Choose a plan",
        association: Object.freeze({ taskId: "review", relation: "imported" }),
      }),
      externalItem({ externalId: "parent", nativeId: "parent", updatedAt: EARLIER }),
    ]);

    const result = projectAgentActivity({ board: inputBoard, external: snapshot });
    const child = result.cards.find((card) => card.id === "external:claude:child");

    expect(child).toMatchObject({
      bucket: "attention",
      state: { domain: "external", value: "needs-input" },
      parentId: "external:claude:parent",
      taskId: "review",
      taskStage: "review",
      waitingFor: "Choose a plan",
      freshness: { state: "error", stale: true, error: "refresh failed", lastSuccessfulAt: EARLIER },
    });
    expect(child?.external?.association).toEqual({ taskId: "review", relation: "imported" });
    expect(Object.isFrozen(child?.external)).toBe(true);
  });

  it("suppresses an external duplicate when the same session is already represented by a managed Task card", () => {
    const result = projectAgentActivity({
      board: board(),
      external: external([externalItem({
        externalId: "managed-review",
        nativeId: "managed-review",
        association: Object.freeze({ taskId: "review", relation: "managed" }),
      })]),
    });

    expect(result.cards.some((card) => card.id === "managed:agent-task:agent-review")).toBe(true);
    expect(result.cards.some((card) => card.id === "external:claude:managed-review")).toBe(false);
  });

  it("omits unavailable optional facts instead of inventing them", () => {
    const card = projectAgentActivity({ external: external([externalItem()]) }).cards[0];

    expect(card).not.toHaveProperty("waitingFor");
    expect(card).not.toHaveProperty("attentionReason");
    expect(card).not.toHaveProperty("summary");
    expect(card?.bucket).toBe("working");
  });
});
