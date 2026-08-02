// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deriveAgentTaskQueue, nextRunnableAgentTask } from "../../src/shared/agent-task-scheduler";
import {
  EMPTY_BOARD_STATE,
  type AgentTask,
  type BoardState,
  type KanbanTask,
  type TaskPriority,
} from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

const NOW = "2026-08-02T08:00:00.000Z";
const lead = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "lead");
const builder = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
if (!lead || !builder) throw new Error("测试目录缺少 lead 或 builder");

function task(id: string, rootId: string, priority: TaskPriority): KanbanTask {
  return Object.freeze({
    id,
    title: id,
    description: "",
    acceptanceCriteria: "可验证",
    priority,
    projectPath: "C:/project",
    projectName: "project",
    trusted: true,
    executionTarget: Object.freeze({ kind: "agent" as const, agentId: "lead" }),
    stage: "queued" as const,
    specRevision: 1,
    executionAttempt: 1,
    activeAgentTaskId: rootId,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function agentTask(input: {
  readonly id: string;
  readonly taskId: string;
  readonly priority: TaskPriority;
  readonly createdAt: string;
  readonly kind?: AgentTask["kind"];
  readonly status?: AgentTask["status"];
  readonly parentAgentTaskId?: string;
  readonly delegationRound?: number;
}): AgentTask {
  const agent = input.parentAgentTaskId ? builder : lead;
  return Object.freeze({
    id: input.id,
    taskId: input.taskId,
    executionAttempt: 1,
    taskSpec: Object.freeze({
      revision: 1,
      title: input.taskId,
      description: "",
      acceptanceCriteria: "可验证",
      priority: input.priority,
      executionTarget: Object.freeze({ kind: "agent" as const, agentId: "lead" }),
    }),
    agentSnapshot: agent,
    kind: input.kind ?? (input.parentAgentTaskId ? "delegated" : "coordinator"),
    status: input.status ?? "queued",
    acceptance: "not-ready",
    prompt: "执行",
    parentAgentTaskId: input.parentAgentTaskId,
    delegationRound: input.delegationRound,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

function board(tasks: readonly KanbanTask[], agentTasks: readonly AgentTask[]): BoardState {
  return Object.freeze({ ...EMPTY_BOARD_STATE, tasks: Object.freeze([...tasks]), agentTasks: Object.freeze([...agentTasks]) });
}

describe("AgentTask dependency-aware scheduler", () => {
  it("never lets a child overtake its queued parent even when UUID order would", () => {
    const createdAt = "2026-08-02T07:59:00.000Z";
    const root = agentTask({ id: "z-root", taskId: "task", priority: "medium", createdAt });
    const child = agentTask({ id: "a-child", taskId: "task", priority: "medium", createdAt, parentAgentTaskId: root.id });
    const state = board([task("task", root.id, "medium")], [root, child]);

    expect(nextRunnableAgentTask(state, NOW)?.agentTask.id).toBe(root.id);
    expect(deriveAgentTaskQueue(state, NOW).find((entry) => entry.agentTask.id === child.id)).toMatchObject({
      disposition: "blocked",
      queuePosition: undefined,
    });
  });

  it("orders ready work by priority and unbounded wait aging", () => {
    const freshUrgent = agentTask({ id: "urgent", taskId: "urgent-task", priority: "urgent", createdAt: "2026-08-02T07:59:00.000Z" });
    const oldLow = agentTask({ id: "old-low", taskId: "low-task", priority: "low", createdAt: "2026-08-02T07:00:00.000Z" });
    const state = board([
      task("urgent-task", freshUrgent.id, "urgent"),
      task("low-task", oldLow.id, "low"),
    ], [freshUrgent, oldLow]);

    const queue = deriveAgentTaskQueue(state, NOW);
    expect(queue.find((entry) => entry.agentTask.id === oldLow.id)).toMatchObject({ queuePosition: 1, effectivePriority: 4 });
    expect(queue.find((entry) => entry.agentTask.id === freshUrgent.id)).toMatchObject({ queuePosition: 2, effectivePriority: 3 });
  });

  it("makes children runnable only after the parent waits for reports", () => {
    const createdAt = "2026-08-02T07:59:00.000Z";
    const root = agentTask({ id: "root", taskId: "task", priority: "medium", createdAt, status: "waiting_children" });
    const child = agentTask({ id: "child", taskId: "task", priority: "medium", createdAt, parentAgentTaskId: root.id });
    const state = board([task("task", root.id, "medium")], [root, child]);

    expect(nextRunnableAgentTask(state, NOW)?.agentTask.id).toBe(child.id);
  });

  it("exposes stale queued work as invalid instead of silently running it", () => {
    const root = agentTask({ id: "root", taskId: "task", priority: "medium", createdAt: NOW });
    const state = board([Object.freeze({ ...task("task", root.id, "medium"), activeAgentTaskId: "another-root" })], [root]);

    expect(deriveAgentTaskQueue(state, NOW)[0]).toMatchObject({ disposition: "invalid" });
    expect(nextRunnableAgentTask(state, NOW)).toBeUndefined();
  });
});
