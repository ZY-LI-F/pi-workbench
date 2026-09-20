// @vitest-environment node
import { describe, expect, it } from "vitest";
import { activeTaskAgents } from "../../src/shared/active-task-agents";
import type { AgentTask, KanbanTask } from "../../src/shared/kanban";
import { teamBoardFixture } from "../fixtures/team-board";

const board = teamBoardFixture();
const task: KanbanTask = { ...board.tasks[0]!, activeAgentTaskId: "lead-root", awaitingReviewExecution: undefined, stage: "running" };
const root: AgentTask = { ...board.agentTasks[0]!, status: "waiting_children", acceptance: "not-ready", completedAt: undefined };
const worker: AgentTask = { ...board.agentTasks[2]!, status: "running", runtimeToken: "test", completedAt: undefined };

describe("current task executors", () => {
  it("shows the running worker rather than the waiting Lead", () => {
    expect(activeTaskAgents(task, [root, worker]).map((node) => node.id)).toEqual([worker.id]);
  });

  it("includes every running member, including nested delegates and a Leader review", () => {
    const coordinator: AgentTask = { ...root, id: "nested", parentAgentTaskId: root.id };
    const nested: AgentTask = { ...worker, id: "nested-worker", parentAgentTaskId: coordinator.id };
    const review: AgentTask = { ...board.agentTasks[1]!, status: "running", runtimeToken: "review", completedAt: undefined };
    expect(new Set(activeTaskAgents(task, [root, worker, coordinator, nested, review]).map((node) => node.id)))
      .toEqual(new Set([worker.id, nested.id, review.id]));
  });

  it("excludes queued, terminal, unrelated and superseded attempts", () => {
    const candidates: AgentTask[] = [
      root, { ...worker, status: "queued" }, { ...worker, id: "old-attempt", executionAttempt: 0 },
      { ...worker, id: "old-spec", taskSpec: { ...worker.taskSpec, revision: 0 } },
      { ...worker, id: "other-root", parentAgentTaskId: "past-root" },
      { ...worker, id: "other-task", taskId: "unrelated" },
      { ...worker, id: "reported", status: "reported" },
    ];
    expect(activeTaskAgents(task, candidates)).toEqual([]);
    expect(activeTaskAgents({ ...task, activeAgentTaskId: undefined }, [root, worker])).toEqual([]);
    expect(activeTaskAgents(task, [{ ...root, status: "protocol-invalid" }, worker])).toEqual([]);
  });

  it("supports a running root without inventing an executor while it awaits user input", () => {
    expect(activeTaskAgents(task, [{ ...root, status: "running" }]).map((node) => node.id)).toEqual([root.id]);
    expect(activeTaskAgents(task, [{ ...root, status: "waiting_human" }])).toEqual([]);
  });
});
