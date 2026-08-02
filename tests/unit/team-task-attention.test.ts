// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deriveTeamTaskAttention } from "../../src/shared/team-task-attention";
import { EMPTY_BOARD_STATE, type AgentTask, type BoardState, type KanbanTask } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

const NOW = "2026-08-02T08:00:00.000Z";
const lead = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "lead");
if (!lead) throw new Error("测试目录缺少 lead");

function task(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return Object.freeze({
    id: "task",
    title: "研究任务",
    description: "",
    acceptanceCriteria: "可核查",
    priority: "medium",
    projectPath: "C:/project",
    projectName: "project",
    trusted: true,
    executionTarget: Object.freeze({ kind: "agent" as const, agentId: "lead" }),
    stage: "planned",
    specRevision: 1,
    executionAttempt: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

function waitingLead(): AgentTask {
  return Object.freeze({
    id: "lead-task",
    taskId: "task",
    executionAttempt: 1,
    taskSpec: Object.freeze({ revision: 1, title: "研究任务", description: "", acceptanceCriteria: "可核查", priority: "medium", executionTarget: Object.freeze({ kind: "agent" as const, agentId: "lead" }) }),
    agentSnapshot: lead,
    kind: "coordinator",
    status: "waiting_human",
    acceptance: "not-ready",
    prompt: "规划",
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("Team human-attention projection", () => {
  it("derives attention from a Coordinator waiting for the user", () => {
    const currentTask = task({ stage: "review", activeAgentTaskId: "lead-task" });
    const board: BoardState = Object.freeze({ ...EMPTY_BOARD_STATE, tasks: Object.freeze([currentTask]), agentTasks: Object.freeze([waitingLead()]) });

    expect(deriveTeamTaskAttention(board, currentTask)).toEqual({
      taskId: "task",
      requiresHuman: true,
      reasons: ["Coordinator 等待你的回复"],
    });
  });

  it("keeps ordinary queued work out of the human inbox", () => {
    const currentTask = task({ stage: "queued", activeAgentTaskId: "lead-task" });
    const queued = Object.freeze({ ...waitingLead(), status: "queued" as const });
    const board: BoardState = Object.freeze({ ...EMPTY_BOARD_STATE, tasks: Object.freeze([currentTask]), agentTasks: Object.freeze([queued]) });

    expect(deriveTeamTaskAttention(board, currentTask)).toMatchObject({ requiresHuman: false, reasons: [] });
  });
});
