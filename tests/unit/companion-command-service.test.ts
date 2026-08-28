// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionCommandReceiptStore } from "../../src/main/companion-command-receipt-store";
import { CompanionCommandService } from "../../src/main/companion-command-service";
import type { BoardRepository } from "../../src/main/board-repository";
import { snapshotExecutionProfile } from "../../src/shared/execution-profile";
import { snapshotTaskSpec } from "../../src/shared/execution-state";
import type { CompanionCommand } from "../../src/shared/companion-protocol";
import {
  BOARD_SCHEMA_VERSION,
  type BoardState,
  type KanbanTask,
} from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

const NOW = "2026-08-28T12:00:00.000Z";
const workflow = BUILTIN_ORCHESTRATION_CATALOG.workflows.find((candidate) => candidate.steps.some((step) => step.kind === "human-gate"));
const lead = BUILTIN_ORCHESTRATION_CATALOG.agents.find((candidate) => candidate.id === "lead");
const builder = BUILTIN_ORCHESTRATION_CATALOG.agents.find((candidate) => candidate.id === "builder");
if (!workflow || !lead || !builder) throw new Error("Companion command tests need built-in workflow and agents");
const gateDefinition = workflow.steps.find((step) => step.kind === "human-gate");
if (!gateDefinition || gateDefinition.kind !== "human-gate") throw new Error("Companion command tests need a human gate");

function task(id: string, extra: Partial<KanbanTask> = {}): KanbanTask {
  return Object.freeze({
    id,
    title: id,
    description: "",
    acceptanceCriteria: "",
    priority: "medium",
    projectPath: "/repo",
    projectName: "repo",
    trusted: true,
    executionTarget: Object.freeze({ kind: "manual" }),
    stage: "planned",
    specRevision: 1,
    executionAttempt: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  });
}

const COMMENT_TASK = task("task-comment");
const MENTION_TASK = task("task-mention");
const COORDINATOR_TASK = task("task-coordinator", { stage: "running", activeAgentTaskId: "agent-coordinator" });
const GATE_TASK = task("task-gate", { stage: "review", activeRunId: "run-gate" });
const REVIEW_TASK = task("task-review", {
  stage: "review",
  awaitingReviewExecution: Object.freeze({ kind: "agent-task", id: "agent-reported", attempt: 1 }),
});
const ABORT_TASK = task("task-abort", { stage: "running", activeAgentTaskId: "agent-active" });

function state(): BoardState {
  return Object.freeze({
    version: BOARD_SCHEMA_VERSION,
    tasks: Object.freeze([COMMENT_TASK, MENTION_TASK, COORDINATOR_TASK, GATE_TASK, REVIEW_TASK, ABORT_TASK]),
    runs: Object.freeze([Object.freeze({
      id: "run-gate",
      taskId: GATE_TASK.id,
      executionAttempt: 1,
      taskSpec: snapshotTaskSpec(GATE_TASK),
      executionProfile: snapshotExecutionProfile("pi.rpc"),
      workflow,
      agents: Object.freeze([builder]),
      status: "review" as const,
      acceptance: "not-ready" as const,
      currentStepId: gateDefinition.id,
      steps: Object.freeze(workflow.steps.map((step, index) => Object.freeze({
        id: step.id === gateDefinition.id ? "step-gate" : `step-${index}`,
        stepId: step.id,
        stepKind: step.kind,
        name: step.name,
        status: step.id === gateDefinition.id ? "waiting" as const : "pending" as const,
        ...(step.kind === "agent" ? { agentId: step.agentId } : {}),
      }))),
      startedAt: NOW,
      updatedAt: NOW,
    })]),
    activities: Object.freeze([]),
    comments: Object.freeze([]),
    agentTasks: Object.freeze([
      Object.freeze({
        id: "agent-coordinator", taskId: COORDINATOR_TASK.id, executionAttempt: 1,
        taskSpec: snapshotTaskSpec(COORDINATOR_TASK), executionProfile: snapshotExecutionProfile("pi.rpc"),
        agentSnapshot: lead, kind: "coordinator" as const, status: "waiting_human" as const,
        acceptance: "not-ready" as const, prompt: "coordinate", createdAt: NOW, updatedAt: NOW,
      }),
      Object.freeze({
        id: "agent-active", taskId: ABORT_TASK.id, executionAttempt: 1,
        taskSpec: snapshotTaskSpec(ABORT_TASK), executionProfile: snapshotExecutionProfile("pi.rpc"),
        agentSnapshot: builder, kind: "direct" as const, status: "running" as const,
        acceptance: "not-ready" as const, prompt: "build", runtimeToken: "runtime", createdAt: NOW, updatedAt: NOW,
      }),
    ]),
    customAgents: Object.freeze([]),
    squads: Object.freeze([]),
    autopilots: Object.freeze([]),
    autopilotRuns: Object.freeze([]),
  });
}

class MemoryRepository implements BoardRepository {
  constructor(public board: BoardState = state()) {}
  async read(): Promise<BoardState> { return this.board; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.board = transform(this.board);
    return this.board;
  }
}

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "stella-command-service-"));
  directories.push(directory);
  const receiptPath = join(directory, "receipts.json");
  const receipts = new CompanionCommandReceiptStore(receiptPath, { now: () => NOW });
  await receipts.initialize();
  const repository = new MemoryRepository();
  const handlers = {
    addComment: vi.fn(async () => undefined),
    resolveGate: vi.fn(async () => undefined),
    reviewExecution: vi.fn(async () => undefined),
    abortExecution: vi.fn(async () => undefined),
  };
  const service = new CompanionCommandService({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    receipts,
    handlers,
    now: () => NOW,
  });
  return { service, handlers, repository, receiptPath };
}

function message(idempotencyKey = "message-1"): CompanionCommand {
  return Object.freeze({
    type: "add-task-message",
    idempotencyKey,
    taskId: COMMENT_TASK.id,
    body: "普通评论",
    dispatchMentions: true,
  });
}

describe("CompanionCommandService", () => {
  it("previews comment, mention, and waiting Coordinator effects using desktop rules", async () => {
    const { service } = await fixture();
    await expect(service.preview(message())).resolves.toMatchObject({ effect: "comment-only" });
    await expect(service.preview({ ...message("mention"), taskId: MENTION_TASK.id, body: "请 @builder 开始实现" }))
      .resolves.toMatchObject({ effect: "dispatch-agent-tasks", summary: expect.stringContaining(builder.name) });
    await expect(service.preview({ ...message("reply"), taskId: COORDINATOR_TASK.id, body: "同意，请继续" }))
      .resolves.toMatchObject({ effect: "resume-coordinator" });
  });

  it("returns the original receipt for retries and rejects key reuse without duplicate mutation", async () => {
    const { service, handlers, receiptPath, repository } = await fixture();
    const [first, retry] = await Promise.all([
      service.execute("device-1", message()),
      service.execute("device-1", message()),
    ]);
    expect(first).toMatchObject({ status: "accepted", code: "accepted" });
    expect(retry).toEqual(first);
    expect(handlers.addComment).toHaveBeenCalledTimes(1);

    await expect(service.execute("device-1", { ...message(), body: "另一条内容" }))
      .resolves.toMatchObject({ status: "rejected", code: "idempotency-conflict" });
    expect(handlers.addComment).toHaveBeenCalledTimes(1);

    const reopened = new CompanionCommandReceiptStore(receiptPath, { now: () => NOW });
    await reopened.initialize();
    const afterRestartHandler = vi.fn(async () => undefined);
    const afterRestart = new CompanionCommandService({
      repository,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      receipts: reopened,
      handlers: { ...handlers, addComment: afterRestartHandler },
      now: () => NOW,
    });
    await expect(afterRestart.execute("device-1", message())).resolves.toEqual(first);
    expect(afterRestartHandler).not.toHaveBeenCalled();
  });

  it("routes fenced gate, review, and abort commands and rejects stale execution ids", async () => {
    const { service, handlers } = await fixture();
    const gate: CompanionCommand = Object.freeze({
      type: "resolve-human-gate", idempotencyKey: "gate", taskId: GATE_TASK.id,
      runId: "run-gate", stepId: "step-gate", decision: "approve", comment: "通过",
    });
    const review: CompanionCommand = Object.freeze({
      type: "review-execution", idempotencyKey: "review", taskId: REVIEW_TASK.id,
      executionKind: "agent-task", executionId: "agent-reported", decision: "revision-requested", comment: "补测试",
    });
    const abort: CompanionCommand = Object.freeze({
      type: "abort-execution", idempotencyKey: "abort", taskId: ABORT_TASK.id,
      executionKind: "agent-task", executionId: "agent-active",
    });

    await expect(service.execute("device-1", gate)).resolves.toMatchObject({ status: "accepted" });
    await expect(service.execute("device-1", review)).resolves.toMatchObject({ status: "accepted" });
    await expect(service.execute("device-1", abort)).resolves.toMatchObject({ status: "accepted" });
    expect(handlers.resolveGate).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-gate", stepId: "step-gate" }));
    expect(handlers.reviewExecution).toHaveBeenCalledWith(expect.objectContaining({ executionId: "agent-reported" }));
    expect(handlers.abortExecution).toHaveBeenCalledWith(expect.objectContaining({ executionId: "agent-active" }));

    await expect(service.execute("device-1", { ...gate, idempotencyKey: "stale-gate", stepId: "old-step" }))
      .resolves.toMatchObject({ status: "rejected", code: "stale-execution" });
    await expect(service.execute("device-1", { ...review, idempotencyKey: "stale-review", executionId: "old-review" }))
      .resolves.toMatchObject({ status: "rejected", code: "stale-execution" });
    await expect(service.execute("device-1", { ...abort, idempotencyKey: "stale-abort", executionId: "old-active" }))
      .resolves.toMatchObject({ status: "rejected", code: "stale-execution" });
    expect(handlers.resolveGate).toHaveBeenCalledTimes(1);
    expect(handlers.reviewExecution).toHaveBeenCalledTimes(1);
    expect(handlers.abortExecution).toHaveBeenCalledTimes(1);
  });
});
