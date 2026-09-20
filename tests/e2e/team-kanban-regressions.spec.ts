import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { BoardStore } from "../../src/main/board-store";
import { BoardService } from "../../src/main/board-service";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { teamBoardFixture } from "../fixtures/team-board";
import { nativeFixture, protocolReply } from "./helpers/native-fixture";
import { enableTeamFeatures } from "./helpers/team-features";
import { e2eScreenshotPath } from "./helpers/screenshot-path";

test("manual cards move by dragging the title and body, with no model request", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo, undefined, {}, async ({ projectDir, userDataDir }) => {
    const repository = new BoardStore(join(userDataDir, "board", "board.json"));
    await repository.initialize();
    const board = new BoardService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined });
    await board.createTask({ title: "鼠标拖动验收", description: "拖动卡片正文或标题都应移动。", acceptanceCriteria: "真实保存阶段。",
      priority: "medium", projectPath: projectDir, projectName: "project", trusted: false, executionTarget: { kind: "manual" } });
  });
  try {
    const { window } = fixture;
    await window.getByRole("button", { name: "任务看板", exact: true }).click();
    const card = window.locator(".kanban-card", { hasText: "鼠标拖动验收" });
    await expect(card).toHaveAttribute("draggable", "true");
    await card.getByRole("button", { name: "鼠标拖动验收", exact: true }).dragTo(window.getByRole("region", { name: "执行中任务列表" }));
    await expect(window.locator(".kanban-lane--running .kanban-card")).toHaveCount(1);
    await card.locator(".manual-task-rail").dragTo(window.getByRole("region", { name: "待审核任务列表" }));
    await expect(window.locator(".kanban-lane--review .kanban-card")).toHaveCount(1);
    const saved = await window.evaluate(() => window.stella.boardInitialize());
    expect(saved.board.tasks[0]?.stage).toBe("review");
    expect(fixture.requests.filter((request) => request.body)).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("team navigation retains the selected channel and repeated reviews stay readable", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo, undefined, {}, async ({ projectDir, userDataDir }) => {
    const repository = new BoardStore(join(userDataDir, "board", "board.json"));
    await repository.initialize();
    await repository.update(() => teamBoardFixture(projectDir));
  });
  try {
    const { window } = fixture;
    await enableTeamFeatures(window);
    await window.getByRole("button", { name: "团队协作", exact: true }).click();
    await window.getByRole("button", { name: /多轮团队验收/ }).click();
    await expect(window.getByLabel("任务详情：多轮团队验收")).toBeVisible();
    await window.getByRole("button", { name: "任务看板", exact: true }).click();
    const rail = window.locator(".kanban-card .agent-task-rail");
    await expect(rail).toBeVisible();
    const railLayout = await rail.evaluate((element) => {
      const owner = element.querySelector("div")!.getBoundingClientRect();
      const status = element.querySelector("em")!.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      return { ownerBottom: owner.bottom, statusTop: status.top, statusRight: status.right, right: bounds.right };
    });
    expect(railLayout.statusTop).toBeGreaterThanOrEqual(railLayout.ownerBottom);
    expect(railLayout.statusRight).toBeLessThanOrEqual(railLayout.right);
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "kanban-card-fixed.png") });
    await window.getByRole("button", { name: "团队协作", exact: true }).click();
    await expect(window.getByLabel("任务详情：多轮团队验收")).toBeVisible();
    const reviews = window.locator(".agent-execution-node").filter({ hasText: "Leader 验收" });
    await expect(reviews).toHaveCount(2);
    const boxes = await reviews.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect(); return { x: rect.x, width: rect.width, top: rect.top, bottom: rect.bottom };
    }));
    expect(boxes[0]!.width).toBeGreaterThan(200);
    expect(boxes[1]!.width).toBeGreaterThan(200);
    expect(Math.abs(boxes[0]!.width - boxes[1]!.width)).toBeLessThan(1);
    expect(boxes[1]!.top).toBeGreaterThanOrEqual(boxes[0]!.bottom);
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "team-reviews-fixed.png") });
    await window.locator(".team-header").getByRole("button", { name: "新建任务", exact: true }).click();
    await expect(window.getByRole("region", { name: "任务启动台", exact: true })).toBeVisible();
    await window.getByRole("button", { name: /多轮团队验收/ }).click();
    await window.getByRole("button", { name: "项目看板", exact: true }).click();
    await window.getByRole("button", { name: "团队协作", exact: true }).click();
    await expect(window.getByLabel("任务详情：多轮团队验收")).toBeVisible();
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.requests.filter((request) => request.body)).toEqual([]);
  } finally { await fixture.close(); }
});

test("a delegated worker is shown live and only human acceptance completes the task", async ({}, testInfo) => {
  // The provider is deterministic test infrastructure. The Pi tool protocol,
  // task scheduler, IPC, rendering and human acceptance are the actual app.
  let releaseWorker!: () => void;
  const workerGate = new Promise<void>((resolve) => { releaseWorker = resolve; });
  let delegated = false;
  const fixture = await nativeFixture(testInfo, async (request, response) => {
    if (request.tools?.some((tool) => tool.function.name === "coordinator_action")) {
      const action = delegated
        ? { action: "complete", summary: "协议夹具完成；等待人工验收。", delegations: [] }
        : { action: "delegate", summary: "协议夹具：委派 BUILD，验收实时状态。", delegations: [{ agentId: "builder", objective: "返回协议夹具验证说明，不修改业务文件。", acceptanceCriteria: "完成协议往返。" }] };
      delegated = true;
      protocolReply(response, request.model, "", { id: `coordinator-${action.action}`, name: "coordinator_action", args: action });
    } else {
      await workerGate;
      protocolReply(response, request.model, "这是协议夹具 Worker 报告，不是真实模型生成的业务产物。");
    }
  });
  try {
    const { window } = fixture;
    await enableTeamFeatures(window);
    await window.getByRole("button", { name: "团队协作", exact: true }).click();
    await window.getByLabel("选择负责人并输入团队任务").fill("@LEAD 执行者显示回归");
    await window.locator(".team-launch-room__acceptance textarea").fill("Worker 执行时正确显示；收到报告后仍需人工接受。");
    await window.getByRole("button", { name: "创建任务并交给 LEAD", exact: true }).click();
    await expect(window.getByLabel("任务详情：执行者显示回归")).toBeVisible();
    await window.getByRole("button", { name: "任务看板", exact: true }).click();
    const card = window.locator(".kanban-card", { hasText: "执行者显示回归" });
    await expect(card.getByLabel("当前 Agent：实现工程师", { exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(card.getByLabel("当前 Agent：通用调度负责人", { exact: true })).toHaveCount(0);
    await expect(card.locator(".agent-task-rail")).toContainText("协调负责人");
    await expect(card.locator(".agent-task-rail")).toContainText("等待子任务");
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "kanban-live-worker-fixed.png") });
    await window.getByRole("button", { name: "团队协作", exact: true }).click();
    await expect(window.getByLabel("任务详情：执行者显示回归")).toBeVisible();
    releaseWorker();
    await expect(window.getByRole("button", { name: "接受报告", exact: true })).toBeVisible({ timeout: 45_000 });
    const before = await window.evaluate(() => window.stella.boardInitialize());
    expect(before.board.tasks[0]?.stage).toBe("review");
    await window.getByRole("button", { name: "接受报告", exact: true }).click();
    await window.getByRole("button", { name: "任务看板", exact: true }).click();
    await expect(window.locator(".kanban-lane--completed .kanban-card")).toContainText("执行者显示回归");
    const after = await window.evaluate(() => window.stella.boardInitialize());
    expect(after.board.tasks[0]?.id).toBe(before.board.tasks[0]?.id);
    expect(after.board.tasks[0]?.stage).toBe("completed");
    expect(after.board.agentTasks.find((node) => node.kind === "coordinator")?.acceptance).toBe("accepted");
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.providerErrors).toEqual([]);
  } finally { releaseWorker(); await fixture.close(); }
});
