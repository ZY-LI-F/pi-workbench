// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "../../src/main/board-store";
import { BoardService } from "../../src/main/board-service";
import { AgentTaskService } from "../../src/main/agent-task-service";
import { discoverKnownProjects } from "../../src/main/project-discovery";
import { EMPTY_BOARD_STATE, parseBoardFile, parseBoardState, type CreateTaskInput } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { projectPathKey } from "../../src/shared/project-path";
import { availableMentionAgentsForTask } from "../../src/shared/agent-mentions";
import { projectBoardCards } from "../../src/shared/project-board";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const input: CreateTaskInput = { title: "先记录想法", description: "无需选择项目", acceptanceCriteria: "可验收", priority: "medium", projectName: "未归属项目", trusted: false, executionTarget: { kind: "manual" } };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "stella-unassigned-"));
  temporary.push(root);
  const path = join(root, "board.json");
  const repository = new BoardStore(path);
  await repository.initialize();
  const service = new BoardService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, projectIdentity: projectPathKey });
  return { root, path, repository, service };
}

describe("Tasks without a project", () => {
  it("persists, edits, comments and manually completes a Task without inventing a directory or consulting skills", async () => {
    const f = await fixture();
    const created = await f.service.createTask(input);
    const task = created.board.tasks[0]!;
    expect(task.projectPath).toBeUndefined();
    expect(task.trusted).toBe(false);
    await f.service.updateTask({ ...input, taskId: task.id, title: "完善想法" });
    const assertAgentsReady = vi.fn();
    const agents = new AgentTaskService({ repository: f.repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, skills: { assertAgentsReady } });
    await agents.addComment({ taskId: task.id, body: "@builder 是记录的文本", dispatchMentions: false });
    expect(assertAgentsReady).not.toHaveBeenCalled();
    await f.service.moveTask(task.id, "running");
    await f.service.moveTask(task.id, "review");
    await f.service.moveTask(task.id, "completed");
    const restarted = await new BoardStore(f.path).initialize();
    expect(restarted.tasks[0]).toMatchObject({ id: task.id, title: "完善想法", stage: "completed", trusted: false });
    expect(restarted.tasks[0]?.projectPath).toBeUndefined();
    expect(restarted.comments).toHaveLength(1);
    expect(restarted.agentTasks).toHaveLength(0);
    expect(discoverKnownProjects([], restarted)).toEqual([]);
    expect(availableMentionAgentsForTask(restarted.tasks[0]!, BUILTIN_ORCHESTRATION_CATALOG, [])).toEqual([]);
    expect(projectBoardCards([], restarted)).toEqual([]);
    await f.service.deleteTask(task.id);
    expect((await f.repository.read()).tasks).toHaveLength(0);
  });

  it("requires a real binding for execution, preserves Task identity when bound and refuses a second assignment", async () => {
    const f = await fixture();
    const task = (await f.service.createTask(input)).board.tasks[0]!;
    await expect(f.service.updateTask({ ...input, taskId: task.id, executionTarget: { kind: "agent", agentId: "builder" } })).rejects.toThrow("先绑定工作区");
    await expect(f.service.createTask({ ...input, trusted: true })).rejects.toThrow("未归属项目");
    const directory = join(f.root, "real-project");
    await mkdir(directory);
    await f.service.moveTask(task.id, "review");
    const result = await f.service.assignTaskProject(task.id, { path: directory, name: "实际项目", trusted: false });
    expect(result.board.tasks[0]).toMatchObject({ id: task.id, projectPath: directory, projectName: "实际项目", stage: "review", specRevision: task.specRevision + 1 });
    expect(result.board.activities.some((activity) => activity.summary.includes("已绑定项目"))).toBe(true);
    await expect(f.service.assignTaskProject(task.id, { path: directory, name: "另一个", trusted: true })).rejects.toThrow("已经归属项目");
    await f.service.updateTask({ ...input, taskId: task.id, executionTarget: { kind: "agent", agentId: "builder" }, executionProfileId: "pi.rpc" });
    expect((await f.repository.read()).tasks[0]?.stage).toBe("planned");
  });

  it("backs up schema v9 and preserves every existing project binding while migrating to v10", async () => {
    const f = await fixture();
    const task = (await f.service.createTask({ ...input, projectPath: f.root, projectName: "旧项目" })).board.tasks[0]!;
    const legacy = JSON.stringify({ ...await f.repository.read(), version: 9 });
    await writeFile(f.path, legacy);
    const migrated = await new BoardStore(f.path).initialize();
    expect(migrated.version).toBe(10);
    expect(migrated.tasks[0]).toEqual(task);
    const backup = (await readdir(f.root)).find((name) => name.includes(".v9.") && name.endsWith(".bak"));
    expect(backup).toBeDefined();
    expect(await readFile(join(f.root, backup!), "utf8")).toBe(legacy);
    expect(JSON.parse(await readFile(f.path, "utf8")).version).toBe(10);
    expect(() => parseBoardFile({ ...EMPTY_BOARD_STATE, version: 9, tasks: [{ ...task, projectPath: undefined }] })).toThrow("projectPath");
  });

  it("rejects execution and session history attached to an unassigned Task at the storage boundary", async () => {
    const f = await fixture();
    const board = (await f.service.createTask(input)).board;
    expect(() => parseBoardState({ ...board, tasks: [{ ...board.tasks[0], executionAttempt: 1 }] })).toThrow("未归属项目");
    expect(() => parseBoardState({ ...board, tasks: [{ ...board.tasks[0], executionTarget: { kind: "agent", agentId: "builder" }, executionProfileId: "pi.rpc" }] })).toThrow("未归属项目");
  });
});
