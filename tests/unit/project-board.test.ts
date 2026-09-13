import { describe, expect, it } from "vitest";
import { EMPTY_BOARD_STATE, type AgentTask, type KanbanTask, type WorkflowRun } from "../../src/shared/kanban";
import { filterProjectBoard, projectBoardCards } from "../../src/shared/project-board";
import { projectPathKey, sameProjectPath } from "../../src/shared/project-path";
import type { RegisteredProject } from "../../src/shared/project-registry";

const project = (id: string, path = `C:/work/${id}`): RegisteredProject => ({ id, path, name: id, description: "", stage: "planned", pinned: false, archived: false, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" });
const task = (id: string, extra: Partial<KanbanTask> = {}): KanbanTask => ({ id, title: id, description: "", acceptanceCriteria: "验收", priority: "medium", projectPath: "c:\\WORK\\alpha\\", projectName: "旧名称", trusted: false, executionTarget: { kind: "manual" }, stage: "planned", specRevision: 1, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-12T00:00:00Z", ...extra });

describe("project paths and task projection", () => {
  it("groups Windows aliases and UNC paths while preserving POSIX case and project boundaries", () => {
    expect(sameProjectPath("C:/Work/Alpha/", "c:\\work\\alpha\\.")).toBe(true);
    expect(sameProjectPath("\\\\Server\\Share\\Repo", "//server/share/repo/")).toBe(true);
    expect(projectPathKey("//server/share/../repo")).toBe("//server/share/repo");
    expect(sameProjectPath("/work/Alpha", "/work/alpha")).toBe(false);
    expect(sameProjectPath("/work/a", "/work/ab")).toBe(false);
    expect(sameProjectPath(undefined, "")).toBe(false);
    expect(projectPathKey("/a/./b/../c")).toBe("/a/c");
  });

  it("counts Tasks once, uses only current execution attention, and never treats project completion as Task acceptance", () => {
    const board = { ...EMPTY_BOARD_STATE, tasks: [task("manual-review", { stage: "review" }), task("done", { stage: "completed" }),
      task("waiting", { stage: "running", executionTarget: { kind: "agent", agentId: "lead" }, activeAgentTaskId: "current" }),
      task("reported", { stage: "review", executionTarget: { kind: "agent", agentId: "lead" }, awaitingReviewExecution: { kind: "agent-task", id: "report", attempt: 1 } }),
      task("old-failure"), task("gate", { stage: "review", executionTarget: { kind: "workflow", workflowId: "flow" }, activeRunId: "gate-run" })],
      agentTasks: [{ id: "old", taskId: "old-failure", status: "waiting_human" }, { id: "current", taskId: "waiting", status: "waiting_human" }, { id: "child", taskId: "waiting", status: "reported", parentAgentTaskId: "current" }] as AgentTask[],
      runs: [{ id: "gate-run", taskId: "gate", currentStepId: "check", steps: [{ stepId: "check", name: "检查", stepKind: "human-gate", status: "waiting" }] }] as WorkflowRun[],
    };
    const before = JSON.stringify(board);
    const [card] = projectBoardCards([{ ...project("alpha"), stage: "completed" }], board);
    expect(card?.summary).toMatchObject({ total: 6, completed: 1, completionPercent: 17, stages: { review: 3, running: 1, completed: 1, planned: 1 } });
    expect(card?.summary?.attention.map((item) => item.taskId).sort()).toEqual(["gate", "manual-review", "reported", "waiting"]);
    expect(JSON.stringify(board)).toBe(before);
  });

  it("distinguishes unavailable task data, empty projects and real completion", () => {
    expect(projectBoardCards([project("alpha")])[0]?.summary).toBeUndefined();
    expect(projectBoardCards([project("alpha")], EMPTY_BOARD_STATE)[0]?.summary).toMatchObject({ total: 0, completionPercent: undefined });
    expect(projectBoardCards([project("alpha")], { ...EMPTY_BOARD_STATE, tasks: [task("done", { stage: "completed" })] })[0]?.summary?.completionPercent).toBe(100);
  });

  it("filters metadata and task content, respects archive and pins, and isolates similarly named paths", () => {
    const cards = projectBoardCards([project("alpha"), { ...project("beta"), pinned: true }, { ...project("archived"), archived: true }], {
      ...EMPTY_BOARD_STATE, tasks: [task("needle", { title: "发布验收", stage: "blocked" }), task("queued", { projectPath: "C:/work/beta", stage: "queued" }), task("other", { projectPath: "C:/work/alphabet" })],
    });
    const filter = { query: "", archived: false, activity: "all", sort: "name" } as const;
    expect(filterProjectBoard(cards, filter).map((card) => card.project.id)).toEqual(["beta", "alpha"]);
    expect(filterProjectBoard(cards, { ...filter, query: "发布验收" }).map((card) => card.project.id)).toEqual(["alpha"]);
    expect(filterProjectBoard(cards, { ...filter, activity: "attention" }).map((card) => card.project.id)).toEqual(["alpha"]);
    expect(filterProjectBoard(cards, { ...filter, activity: "executing" }).map((card) => card.project.id)).toEqual(["beta"]);
    expect(filterProjectBoard(cards, { ...filter, archived: true }).map((card) => card.project.id)).toEqual(["archived"]);
    expect(cards[0]?.summary?.total).toBe(1);
  });
});
