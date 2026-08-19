import { createServer } from "node:net";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";
import { enableTeamFeatures } from "./helpers/team-features";

const APP_ROOT = resolve(process.cwd());
const MODEL_VALUE = "aliyun-maas/deepseek-v4-flash";
const MODEL_LABEL = "DeepSeek V4 Flash (Aliyun MaaS)";

const ORDERS_CSV = `order_id,region,status,amount
O-001,east,paid,120.5
O-002,west,paid,80
O-003,east,refunded,50
O-004,north,paid,210
O-005,west,pending,40
O-006,east,paid,99.5
`;

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePort);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法为 DeepSeek 真实任务分配本机端口");
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

test("executes and accepts a real Kanban Agent task with Alibaba Bailian DeepSeek V4 Flash", async ({}, testInfo) => {
  test.setTimeout(720_000);
  const auditId = `DEEPSEEK_V4_FLASH_${Date.now()}`;
  const project = testInfo.outputPath("deepseek-task-project");
  const inputDirectory = join(project, "input");
  const outputDirectory = join(project, "output");
  const userData = testInfo.outputPath("electron-user-data");
  await Promise.all([mkdir(inputDirectory, { recursive: true }), mkdir(userData, { recursive: true })]);
  await Promise.all([
    writeFile(join(inputDirectory, "orders.csv"), ORDERS_CSV, "utf8"),
    writeFile(join(inputDirectory, "acceptance.md"), [
      "# DeepSeek V4 Flash 真实任务验收",
      "",
      `审计编号：${auditId}`,
      "",
      "必须生成 output/summary.json 与 output/report.md。",
      "summary.json 必须包含 auditId、totalOrders、statusCounts、paidRevenue、paidRevenueByRegion。",
      "金额按 CSV 原始数值求和，不得修改 input 目录。",
    ].join("\n"), "utf8"),
    writeFile(join(project, "README.md"), "# Isolated DeepSeek V4 Flash task fixture\n", "utf8"),
    writeFile(join(userData, "stella-state.json"), `${JSON.stringify({
      lastProject: project,
      recentProjects: [{ path: project, trusted: true, lastOpened: new Date().toISOString() }],
    }, null, 2)}\n`, "utf8"),
  ]);

  const electronApp = await electron.launch({
    args: [APP_ROOT, `--user-data-dir=${userData}`],
    cwd: project,
    env: Object.freeze({ ...process.env, STELLA_WEBHOOK_PORT: String(await availableLoopbackPort()) }),
  });
  const pageErrors: string[] = [];
  let stderrTail = "";
  let unexpectedExit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
  try {
    const window = await electronApp.firstWindow();
    window.on("pageerror", (error) => pageErrors.push(error.message));
    electronApp.process().once("exit", (code, signal) => { unexpectedExit = Object.freeze({ code, signal }); });
    electronApp.process().stderr?.on("data", (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-32_768);
    });

    await window.waitForLoadState("domcontentloaded");
    await expect(window.locator(".app-shell, .startup-screen--error")).toBeVisible({ timeout: 45_000 });
    const startupError = window.locator(".startup-screen--error");
    if (await startupError.isVisible()) throw new Error(`DeepSeek 任务应用启动失败：\n${await startupError.innerText()}`);
    await expect.poll(
      () => window.evaluate(() => window.stella.capabilities().then((health) => health.pi.state)),
      { timeout: 60_000, message: "Pi Runtime 应在 DeepSeek 任务前就绪" },
    ).toBe("ready");

    const globalModel = window.getByRole("combobox", { name: "全局模型" });
    const options = await globalModel.locator("option").evaluateAll((elements) => elements.map((element) => ({
      value: (element as HTMLOptionElement).value,
      label: element.textContent?.trim() ?? "",
    })));
    const deepseek = options.find((option) => option.value === MODEL_VALUE && option.label.includes(MODEL_LABEL));
    if (!deepseek) throw new Error(`模型目录缺少 ${MODEL_LABEL} (${MODEL_VALUE})；实际模型：${options.map((option) => `${option.label} [${option.value}]`).join("、")}`);
    await globalModel.selectOption(MODEL_VALUE);
    await expect(globalModel).toHaveValue(MODEL_VALUE);
    await expect(window.getByLabel("全局运行模型")).toContainText(MODEL_LABEL);

    await enableTeamFeatures(window);
    await window.getByRole("button", { name: "任务看板", exact: true }).click();
    await expect(window.getByRole("heading", { name: "任务星图" })).toBeVisible();
    await window.getByRole("button", { name: "新建任务", exact: true }).click();
    const dialog = window.getByRole("dialog", { name: "创建看板任务" });
    await dialog.getByLabel(/任务标题/).fill("DeepSeek V4 Flash 真实执行验证");
    await dialog.getByLabel("任务说明").fill([
      "读取 input/acceptance.md 与 input/orders.csv，禁止修改 input 目录。",
      "计算订单总数、各状态数量、paid 金额合计，以及按 region 汇总的 paid 金额。",
      "创建 output/summary.json 和 output/report.md；JSON 必须是有效 UTF-8，报告必须写明计算口径与审计编号。",
      "完成后重新读取两个文件，自检所有数字，并在最终回复中列出绝对路径。",
    ].join("\n"));
    await dialog.getByLabel("验收标准").fill([
      `auditId=${auditId}；totalOrders=6；statusCounts={paid:4,pending:1,refunded:1}；`,
      "paidRevenue=510；paidRevenueByRegion={east:220,north:210,west:80}；",
      "report.md 包含审计编号、4/6 和 510；任务不得修改 input 文件。",
    ].join(""));
    await dialog.getByRole("tab", { name: "单 Agent" }).click();
    await dialog.getByRole("button", { name: /实现工程师/ }).click();
    await dialog.getByRole("button", { name: "创建任务", exact: true }).click();

    const card = window.locator(".kanban-card", { hasText: "DeepSeek V4 Flash 真实执行验证" });
    await expect(card.getByLabel("任务归属：TEAM")).toBeVisible();
    await card.getByRole("button", { name: "DeepSeek V4 Flash 真实执行验证", exact: true }).click();
    const taskRoom = window.getByLabel("任务详情：DeepSeek V4 Flash 真实执行验证");
    await taskRoom.getByRole("button", { name: "开始执行" }).click();

    const review = taskRoom.locator(".execution-review-card", { hasText: "验收本次执行报告" });
    await expect(review).toBeVisible({ timeout: 600_000 });
    await expect(taskRoom.getByText("验收 · 待验收", { exact: true })).toBeVisible();
    await expect.poll(async () => (await stat(join(outputDirectory, "summary.json"))).size, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await stat(join(outputDirectory, "report.md"))).size, { timeout: 30_000 }).toBeGreaterThan(0);

    const summary = JSON.parse(await readFile(join(outputDirectory, "summary.json"), "utf8")) as Record<string, unknown>;
    expect(summary).toMatchObject({
      auditId,
      totalOrders: 6,
      statusCounts: { paid: 4, pending: 1, refunded: 1 },
      paidRevenue: 510,
      paidRevenueByRegion: { east: 220, north: 210, west: 80 },
    });
    const report = await readFile(join(outputDirectory, "report.md"), "utf8");
    expect(report).toContain(auditId);
    expect(report).toContain("510");
    expect(report).toMatch(/4\s*\/\s*6/);

    const beforeAcceptance = await window.evaluate(() => window.stella.boardInitialize());
    const task = beforeAcceptance.board.tasks.find((candidate) => candidate.title === "DeepSeek V4 Flash 真实执行验证");
    if (!task) throw new Error("Board 中找不到 DeepSeek 真实任务");
    const rootAgentTask = [...beforeAcceptance.board.agentTasks].reverse().find((candidate) => candidate.taskId === task.id && !candidate.parentAgentTaskId);
    if (!rootAgentTask?.sessionPath) throw new Error("DeepSeek AgentTask 没有持久化 sessionPath");
    expect(rootAgentTask).toMatchObject({ status: "reported", acceptance: "pending" });
    expect(rootAgentTask.inputTokens ?? 0).toBeGreaterThan(0);
    expect(rootAgentTask.outputTokens ?? 0).toBeGreaterThan(0);
    const sessionEntries = (await readFile(rootAgentTask.sessionPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const modelChange = sessionEntries.find((entry) => entry.type === "model_change");
    expect(modelChange).toMatchObject({ provider: "aliyun-maas", modelId: "deepseek-v4-flash" });

    await review.getByPlaceholder(/接受可选填说明/).fill("固定输入计算与独立断言一致，接受本次 DeepSeek V4 Flash 交付。");
    await review.getByRole("button", { name: "接受报告" }).click();
    await expect(taskRoom.getByText("验收 · 已接受", { exact: true })).toBeVisible();
    const accepted = await window.evaluate(() => window.stella.boardInitialize());
    const acceptedTask = accepted.board.tasks.find((candidate) => candidate.id === task.id);
    const acceptedExecution = accepted.board.agentTasks.find((candidate) => candidate.id === rootAgentTask.id);
    expect(acceptedTask?.stage).toBe("completed");
    expect(acceptedExecution?.acceptance).toBe("accepted");
    expect(pageErrors).toEqual([]);
    expect(unexpectedExit).toBeUndefined();

    const evidence = Object.freeze({
      auditId,
      provider: "aliyun-maas",
      model: deepseek,
      taskId: task.id,
      agentTaskId: rootAgentTask.id,
      sessionPath: rootAgentTask.sessionPath,
      inputTokens: rootAgentTask.inputTokens,
      outputTokens: rootAgentTask.outputTokens,
      result: summary,
      finalTaskStage: acceptedTask?.stage,
      finalAcceptance: acceptedExecution?.acceptance,
      pageErrors,
      stderrTail,
    });
    await writeFile(testInfo.outputPath("deepseek-v4-flash-task-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await window.screenshot({ path: testInfo.outputPath("deepseek-v4-flash-task-final.png"), animations: "disabled" });
  } finally {
    await electronApp.close();
  }
});
