import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeFixture } from "./helpers/native-fixture";
import { e2eScreenshotPath } from "./helpers/screenshot-path";
import { BoardStore } from "../../src/main/board-store";
import { BoardService } from "../../src/main/board-service";
import { pathComparisonKey } from "../../src/main/path-security";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import type { ProjectRegistry } from "../../src/shared/project-registry";

async function openProjects(window: Page) {
  await window.locator(".sidebar").getByRole("tab", { name: "任务栏", exact: true }).click();
  await window.locator(".sidebar").getByRole("button", { name: "项目看板", exact: true }).click();
  await expect(window.getByRole("heading", { name: "项目看板", exact: true })).toBeVisible();
}

test("project planning, real task drilldown and restart persistence work independently from the native session", async ({}, testInfo) => {
  let taskId = "";
  const secondary = testInfo.outputPath("产品验收");
  const reference = testInfo.outputPath("研究资料");
  await Promise.all([mkdir(secondary, { recursive: true }), mkdir(reference, { recursive: true })]);
  // The local protocol fixture is explicit test infrastructure. This scenario
  // performs no model requests; project persistence and Task actions are real.
  const fixture = await nativeFixture(testInfo, undefined, {}, async ({ projectDir, userDataDir }) => {
    const repository = new BoardStore(join(userDataDir, "board", "board.json"));
    await repository.initialize();
    const board = new BoardService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, projectIdentity: pathComparisonKey });
    const created = await board.createTask({ title: "完成项目看板交互验收", description: "验证任务归属与项目阶段独立。", acceptanceCriteria: "项目收尾后仍能独立验收任务。", priority: "high", projectPath: secondary, projectName: "产品验收", trusted: false, executionTarget: { kind: "manual" } });
    taskId = created.board.tasks[0]!.id;
    await board.moveTask(taskId, "review");
    await board.createTask({ title: "整理设计说明", description: "统一项目、任务、执行的术语。", acceptanceCriteria: "设计与实际行为一致。", priority: "medium", projectPath: projectDir, projectName: "Stella 工作台", trusted: false, executionTarget: { kind: "manual" } });
  });
  let saved: ProjectRegistry | undefined;
  try {
    const { window, app } = fixture;
    await fixture.openChat();
    await window.getByLabel("给 Pi 的消息").fill("保留当前会话草稿");
    const original = await window.evaluate(() => window.stella.refresh());
    await openProjects(window);
    await expect(window.locator(".project-card")).toHaveCount(2);
    await expect(window.getByRole("button", { name: "查看项目 产品验收" })).toContainText("1 需处理");
    await window.getByRole("button", { name: "查看项目 project", exact: true }).click();
    await window.getByRole("button", { name: "编辑项目", exact: true }).click();
    let editor = window.getByRole("dialog", { name: "编辑项目" });
    await editor.getByLabel("项目名称", { exact: true }).fill("Stella 工作台");
    await editor.getByLabel("项目说明", { exact: true }).fill("统一项目计划、任务执行与验收。当前重点是跨项目导航和本地可靠性。");
    await editor.getByRole("button", { name: "保存项目" }).click();
    await expect(editor).not.toBeVisible();
    await window.getByRole("button", { name: "置顶 Stella 工作台", exact: true }).click();
    await window.getByLabel("项目阶段 Stella 工作台", { exact: true }).selectOption("active");
    await expect(window.getByLabel("项目阶段 Stella 工作台", { exact: true })).toHaveValue("active");
    await window.getByRole("button", { name: "关闭项目详情" }).click();

    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, reference);
    await window.locator(".project-header").getByRole("button", { name: "添加项目", exact: true }).click();
    editor = window.getByRole("dialog", { name: "添加项目" });
    await editor.getByRole("button", { name: "选择目录" }).click();
    await editor.getByLabel("项目说明", { exact: true }).fill("保存 Orca、Multica、Plane 等项目的设计研究与一手证据。");
    await editor.getByRole("button", { name: "添加项目", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(window.locator(".project-card")).toHaveCount(3);
    await window.getByLabel("项目阶段 产品验收", { exact: true }).selectOption("completed");
    await expect(window.getByLabel("项目阶段 产品验收", { exact: true })).toHaveValue("completed");
    await expect(window.getByRole("button", { name: "查看项目 产品验收" })).toContainText("仍有 1 项任务未完成");
    expect((await window.evaluate(() => window.stella.boardInitialize())).board.tasks.find((task) => task.id === taskId)?.stage).toBe("review");
    const afterBrowsing = await window.evaluate(() => window.stella.refresh());
    expect(afterBrowsing.state.sessionId).toBe(original.state.sessionId);
    expect(afterBrowsing.project.cwd).toBe(original.project.cwd);

    await window.screenshot({ path: e2eScreenshotPath(testInfo, "project-board-overview.png") });
    await window.getByRole("button", { name: "阶段看板", exact: true }).click();
    await window.getByRole("article", { name: "项目 研究资料", exact: true }).dragTo(window.getByRole("region", { name: "暂缓项目", exact: true }));
    await expect(window.getByLabel("项目阶段 研究资料", { exact: true })).toHaveValue("paused");
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "project-board-stages.png") });
    await window.getByRole("button", { name: "总览", exact: true }).click();
    await window.getByLabel("搜索项目").fill("完成项目看板交互验收");
    await expect(window.locator(".project-card")).toHaveCount(1);
    await window.getByRole("button", { name: "查看项目 产品验收" }).click();
    await window.locator(".project-detail__tasks").getByRole("button", { name: /完成项目看板交互验收/ }).click();
    await expect(window.getByLabel("筛选任务项目")).toHaveValue(secondary);
    await expect(window.locator(".task-detail")).toContainText("当前以只读方式查看");
    await expect(window.locator(".kanban-header").getByRole("button", { name: "新建任务", exact: true })).toBeDisabled();
    expect((await window.evaluate(() => window.stella.refresh())).state.sessionId).toBe(original.state.sessionId);
    await window.locator(".task-detail").getByRole("button", { name: "打开项目", exact: true }).click();
    await expect(window.getByLabel("手动移动任务")).toBeVisible({ timeout: 45_000 });
    await window.getByLabel("手动移动任务").selectOption("completed");
    await expect.poll(async () => (await window.evaluate(() => window.stella.boardInitialize())).board.tasks.find((task) => task.id === taskId)?.stage).toBe("completed");
    await openProjects(window);
    await window.getByRole("button", { name: "查看项目 产品验收" }).click();
    await window.getByRole("button", { name: "编辑项目", exact: true }).click();
    editor = window.getByRole("dialog", { name: "编辑项目" });
    await editor.getByRole("checkbox", { name: /归档项目/ }).check();
    await editor.getByRole("button", { name: "保存项目" }).click();
    await expect(window.getByRole("button", { name: "查看项目 产品验收" })).toHaveCount(0);
    await window.getByLabel("项目归档筛选").selectOption("archived");
    await window.getByRole("button", { name: "查看项目 产品验收" }).click();
    await expect(window.locator(".project-detail")).toContainText("已完成 1 / 1 项");
    await window.getByRole("button", { name: "恢复项目", exact: true }).click();
    await expect(window.getByRole("heading", { name: "暂无归档项目" })).toBeVisible();
    await window.getByLabel("项目归档筛选").selectOption("active");
    for (const toast of await window.getByRole("button", { name: "关闭通知" }).all()) await toast.click();
    await window.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "project-board-light.png") });
    await app.evaluate(({ BrowserWindow }) => { const main = BrowserWindow.getAllWindows()[0]!; main.setMinimumSize(400, 400); main.setSize(720, 800); });
    await expect.poll(() => window.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await window.getByRole("button", { name: "查看项目 Stella 工作台" }).click();
    await expect.poll(() => window.evaluate(() => {
      const grid = document.querySelector(".project-grid")!.getBoundingClientRect();
      const detail = document.querySelector(".project-detail")!.getBoundingClientRect();
      return grid.bottom <= detail.top;
    })).toBe(true);
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "project-board-narrow.png") });
    const headerAction = await window.locator(".project-header").getByRole("button", { name: "添加项目", exact: true }).boundingBox();
    expect(headerAction!.x + headerAction!.width).toBeLessThanOrEqual(await window.evaluate(() => window.innerWidth));
    saved = JSON.parse(await readFile(join(fixture.userDataDir, "projects.json"), "utf8")) as ProjectRegistry;
    expect(saved.projects).toHaveLength(3);
    expect(saved.projects.find((item) => item.path === reference)?.name).toBe("研究资料");
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.requests.filter((request) => request.body)).toEqual([]);
  } finally { await fixture.close(); }

  const restarted = await nativeFixture(testInfo);
  try {
    await openProjects(restarted.window);
    await expect(restarted.window.locator(".project-card")).toHaveCount(3);
    const registry = await restarted.window.evaluate(() => window.stella.projectsInitialize());
    expect(registry.projects.map((item) => item.id)).toEqual(saved!.projects.map((item) => item.id));
    expect(registry.projects.find((item) => item.name === "Stella 工作台")).toMatchObject({ pinned: true, stage: "active" });
    await expect(restarted.window.getByLabel("项目阶段 产品验收", { exact: true })).toHaveValue("completed");
    expect(restarted.pageErrors).toEqual([]);
  } finally { await restarted.close(); }
});

test("a damaged project registry stays visible as an error without blocking Pi or resetting project data", async ({}, testInfo) => {
  const contents = '{"version":99,"revision":4,"projects":[]}';
  const fixture = await nativeFixture(testInfo, undefined, {}, async ({ userDataDir }) => {
    await writeFile(join(userDataDir, "projects.json"), contents);
  });
  try {
    await fixture.openChat();
    await expect(fixture.window.getByLabel("给 Pi 的消息")).toBeVisible();
    await openProjects(fixture.window);
    await expect(fixture.window.getByRole("alert").filter({ hasText: "不支持项目清单版本 99" })).toBeVisible();
    await fixture.window.getByRole("button", { name: "重新读取项目", exact: true }).click();
    await expect(fixture.window.getByRole("alert").filter({ hasText: "不支持项目清单版本 99" })).toBeVisible();
    expect(await readFile(join(fixture.userDataDir, "projects.json"), "utf8")).toBe(contents);
    expect((await fixture.window.evaluate(() => window.stella.capabilities())).pi.state).toBe("ready");
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("unassigned Tasks work before choosing a project and long Task lists remain scrollable", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo, undefined, {}, async ({ projectDir, userDataDir }) => {
    const repository = new BoardStore(join(userDataDir, "board", "board.json"));
    await repository.initialize();
    // Seed a large real Board in one transaction. UI mutations below still go
    // through the application's actual IPC and durable BoardService operations.
    const time = new Date().toISOString();
    await repository.update((state) => ({ ...state, tasks: Array.from({ length: 60 }, (_, index) => {
      const base = { id: `unassigned-${index}`, title: `独立待办 ${String(index).padStart(2, "0")}`, description: "滚动验证", acceptanceCriteria: "可查看最末项", priority: "medium" as const,
        projectName: "未归属项目", trusted: false, executionTarget: { kind: "manual" as const }, stage: "planned" as const, specRevision: 1, executionAttempt: 0, createdAt: time, updatedAt: time };
      return [base, { ...base, id: `assigned-${index}`, title: `项目任务 ${String(index).padStart(2, "0")}`, projectPath: projectDir, projectName: "project" }];
    }).flat() }));
    // A real first-run state: no remembered workspace and no selected project.
    await writeFile(join(userDataDir, "stella-state.json"), JSON.stringify({ recentProjects: [] }));
  });
  let createdId = "";
  try {
    const { window } = fixture;
    await expect.poll(() => window.evaluate(() => window.stella.capabilities().then((state) => state.task.error ?? state.task.state))).toBe("ready");
    expect((await window.evaluate(() => window.stella.refresh())).project.requiresSelection).toBe(true);
    await window.getByRole("button", { name: "任务看板", exact: true }).click();
    await expect(window.getByLabel("筛选任务项目")).toHaveValue("all");
    await expect(window.locator(".kanban-card")).toHaveCount(120);
    await window.keyboard.press("Control+n");
    const editor = window.getByRole("dialog", { name: "创建看板任务" });
    await expect(editor.getByLabel("任务所属项目")).toHaveValue("none");
    await editor.getByPlaceholder("清楚描述要交付的结果").fill("无需项目即可创建");
    await editor.getByRole("button", { name: "创建任务", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(window.getByLabel("筛选任务项目")).toHaveValue("unassigned");
    await expect(window.locator(".kanban-card")).toHaveCount(61);
    await window.locator(".kanban-card").filter({ hasText: "无需项目即可创建" }).getByRole("button", { name: /无需项目即可创建/ }).click();
    await expect(window.locator(".task-detail")).toContainText("未归属项目：可以直接编辑");
    await window.getByPlaceholder("记录进展、决定或阻塞…").fill("没有项目也能保存进展");
    await window.getByRole("button", { name: "发送评论", exact: true }).click();
    await window.getByLabel("手动移动任务").selectOption("review");
    // selectOption dispatches the UI event; it does not await the Board commit.
    await expect(window.locator(".task-detail__badges .status-chip")).toHaveText("任务 · 待审核");
    const created = (await window.evaluate(() => window.stella.boardInitialize())).board.tasks.find((task) => task.title === "无需项目即可创建")!;
    createdId = created.id;
    expect(created.projectPath).toBeUndefined();
    expect(created.stage).toBe("review");
    await window.getByRole("button", { name: "关闭任务详情" }).click();
    const lane = window.locator(".kanban-lane--planned .kanban-lane__body");
    await expect.poll(() => lane.evaluate((element) => element.scrollHeight > element.clientHeight && element.clientHeight > 0)).toBe(true);
    await lane.hover();
    await window.mouse.wheel(0, 30_000);
    await expect.poll(() => lane.evaluate((element) => element.scrollTop > 0)).toBe(true);
    const lastCard = lane.locator(".kanban-card").last();
    await lastCard.scrollIntoViewIfNeeded();
    const lastTitle = await lastCard.locator(".kanban-card__title").innerText();
    await lastCard.getByRole("button", { name: new RegExp(lastTitle) }).click();
    await expect(window.locator(".task-detail")).toContainText(lastTitle);
    await window.getByRole("button", { name: "关闭任务详情" }).click();
    await openProjects(window);
    await window.getByRole("button", { name: "查看项目 project", exact: true }).click();
    const list = window.getByRole("region", { name: "项目任务", exact: true });
    await expect.poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await list.getByRole("button").last().scrollIntoViewIfNeeded();
    await expect.poll(() => list.evaluate((element) => element.scrollTop > 0)).toBe(true);
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "project-board-many-tasks.png") });
    await window.getByRole("button", { name: "打开工作区", exact: true }).click();
    await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
    await window.locator(".sidebar").getByRole("tab", { name: "任务栏", exact: true }).click();
    await window.getByRole("button", { name: "任务看板", exact: true }).click();
    await window.getByLabel("筛选任务项目").selectOption("unassigned");
    await window.locator(".kanban-card").filter({ hasText: "无需项目即可创建" }).getByRole("button", { name: /无需项目即可创建/ }).click();
    const rejectedBinding = await window.evaluate(async ({ taskId, projectPath }) => {
      try { await window.stella.boardAssignTaskProject(taskId, projectPath); return ""; }
      catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
    }, { taskId: createdId, projectPath: join(fixture.projectDir, "different-workspace") });
    expect(rejectedBinding).toContain("当前工作区已变化");
    expect((await window.evaluate(() => window.stella.boardInitialize())).board.tasks.find((task) => task.id === createdId)?.projectPath).toBeUndefined();
    await window.getByRole("button", { name: "绑定到 project", exact: true }).click();
    await expect(window.getByLabel("筛选任务项目")).toHaveValue("all");
    const bound = (await window.evaluate(() => window.stella.boardInitialize())).board.tasks.find((task) => task.id === createdId)!;
    expect(bound.projectPath).toBe(fixture.projectDir);
    expect(bound.stage).toBe("review");
    await window.getByLabel("手动移动任务").selectOption("completed");
    await window.getByLabel("筛选任务项目").selectOption("unassigned");
    await expect(window.locator(".task-detail")).toBeHidden();
    await window.getByLabel("筛选任务项目").selectOption("all");
    await fixture.app.evaluate(({ BrowserWindow }) => { const main = BrowserWindow.getAllWindows()[0]!; main.setMinimumSize(400, 400); main.setSize(720, 800); });
    const board = window.getByLabel("任务看板", { exact: true });
    await expect.poll(() => board.evaluate((element) => element.scrollWidth > element.clientWidth && element.clientWidth > 0)).toBe(true);
    await board.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect.poll(() => board.evaluate((element) => element.scrollLeft > 0)).toBe(true);
    const createAction = await window.locator(".kanban-header").getByRole("button", { name: "新建任务", exact: true }).boundingBox();
    expect(createAction!.height).toBeLessThan(48);
    expect(createAction!.x + createAction!.width).toBeLessThanOrEqual(await window.evaluate(() => window.innerWidth));
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "task-board-scroll.png") });
    expect(fixture.requests.filter((request) => request.body)).toHaveLength(0);
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
  const restarted = await nativeFixture(testInfo);
  try {
    await expect.poll(() => restarted.window.evaluate(() => window.stella.capabilities().then((state) => state.task.error ?? state.task.state)), { timeout: 45_000 }).toBe("ready");
    const board = (await restarted.window.evaluate(() => window.stella.boardInitialize())).board;
    expect(board.tasks.filter((task) => task.projectPath === undefined)).toHaveLength(60);
    expect(board.tasks.find((task) => task.id === createdId)).toMatchObject({ stage: "completed", projectPath: restarted.projectDir });
  } finally { await restarted.close(); }
});
