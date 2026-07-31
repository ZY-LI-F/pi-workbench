import { expect, test, _electron as electron, type ElectronApplication, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

interface IsolatedAppPaths {
  readonly appRoot: string;
  readonly userData: string;
  readonly agentDir: string;
  readonly project: string;
  readonly comparisonProject: string;
}

interface LaunchedApp {
  readonly electronApp: ElectronApplication;
  readonly window: Page;
  readonly pageErrors: string[];
}

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePort);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法为 GUI E2E 分配本机 Webhook 端口");
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function createIsolatedAppPaths(testInfo: TestInfo): Promise<IsolatedAppPaths> {
  const appRoot = resolve(process.cwd());
  const userData = testInfo.outputPath("electron-user-data");
  const agentDir = testInfo.outputPath("pi-agent");
  const project = testInfo.outputPath("project");
  const comparisonProject = testInfo.outputPath("comparison-project");
  await Promise.all([
    mkdir(userData, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
    mkdir(project, { recursive: true }),
    mkdir(comparisonProject, { recursive: true }),
  ]);
  await writeFile(join(project, "README.md"), "# Isolated Stella GUI E2E\n", "utf8");
  await writeFile(join(comparisonProject, "README.md"), "# Comparison project\n", "utf8");
  await writeFile(join(userData, "stella-state.json"), `${JSON.stringify({
    lastProject: project,
    recentProjects: [
      { path: project, trusted: false, lastOpened: "2026-07-30T00:00:00.000Z" },
      { path: comparisonProject, trusted: false, lastOpened: "2026-07-29T00:00:00.000Z" },
    ],
  }, null, 2)}\n`, "utf8");
  return Object.freeze({ appRoot, userData, agentDir, project, comparisonProject });
}

async function launchIsolatedApp(paths: IsolatedAppPaths): Promise<LaunchedApp> {
  const electronApp = await electron.launch({
    args: [paths.appRoot, `--user-data-dir=${paths.userData}`],
    cwd: paths.project,
    env: Object.freeze({
      ...process.env,
      PI_CODING_AGENT_DIR: paths.agentDir,
      STELLA_WEBHOOK_PORT: String(await availableLoopbackPort()),
    }),
  });
  const window = await electronApp.firstWindow();
  const pageErrors: string[] = [];
  window.on("pageerror", (error) => pageErrors.push(error.message));
  await window.waitForLoadState("domcontentloaded");
  await expect(window.locator(".app-shell, .startup-screen--error")).toBeVisible({ timeout: 45_000 });
  const startupError = window.locator(".startup-screen--error");
  if (await startupError.isVisible()) throw new Error(`隔离 GUI 启动失败：\n${await startupError.innerText()}`);
  await expect.poll(
    () => window.evaluate(() => window.stella.capabilities().then((health) => health.pi.state)),
    { timeout: 45_000 },
  ).toBe("ready");
  await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
  return Object.freeze({ electronApp, window, pageErrors });
}

async function sessionState(window: Page): Promise<{ readonly sessionId: string; readonly sessionName?: string }> {
  return window.evaluate(async () => {
    const response = await window.stella.command({ type: "get_state" });
    if (!response.success || !("data" in response)) throw new Error(response.success ? "get_state 没有返回 data" : response.error);
    return Object.freeze({ sessionId: response.data.sessionId, sessionName: response.data.sessionName });
  });
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  if (app) await app.close();
}

test("persists the optional team surface and returns to native Pi when it is disabled", async ({}, testInfo) => {
  const paths = await createIsolatedAppPaths(testInfo);
  let running: ElectronApplication | undefined;

  try {
    const first = await launchIsolatedApp(paths);
    running = first.electronApp;
    await expect(first.window.getByRole("button", { name: "团队协作", exact: true })).toHaveCount(0);
    await expect(first.window.getByRole("button", { name: "任务看板", exact: true })).toHaveCount(0);
    await expect(first.window.locator(".capability-ledger .capability-dot")).toHaveCount(1);

    await first.window.getByRole("button", { name: "偏好设置", exact: true }).click();
    const firstSettings = first.window.getByRole("dialog", { name: "偏好设置" });
    await expect(firstSettings.getByRole("button", { name: "关闭" })).toBeFocused();
    await first.window.keyboard.press("Shift+Tab");
    expect(await firstSettings.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    const firstToggle = firstSettings.getByRole("switch", { name: "显示团队功能" });
    await expect(firstToggle).toHaveAttribute("aria-checked", "false");
    await firstToggle.click();
    await first.window.keyboard.press("Escape");
    await expect(firstSettings).toBeHidden();
    await expect(first.window.getByRole("button", { name: "团队协作", exact: true })).toBeVisible();
    await expect(first.window.getByRole("button", { name: "任务看板", exact: true })).toBeVisible();
    await expect(first.window.locator(".capability-ledger .capability-dot")).toHaveCount(4);
    expect(first.pageErrors).toEqual([]);
    await closeApp(running);
    running = undefined;

    const second = await launchIsolatedApp(paths);
    running = second.electronApp;
    await expect(second.window.getByRole("button", { name: "团队协作", exact: true })).toBeVisible();
    await second.window.getByRole("button", { name: "团队协作", exact: true }).click();
    await expect(second.window.getByRole("heading", { name: "团队协作" })).toBeVisible();
    await second.window.getByRole("button", { name: "偏好设置", exact: true }).click();
    const secondSettings = second.window.getByRole("dialog", { name: "偏好设置" });
    const secondToggle = secondSettings.getByRole("switch", { name: "显示团队功能" });
    await expect(secondToggle).toHaveAttribute("aria-checked", "true");
    await secondToggle.click();
    await second.window.keyboard.press("Escape");
    await expect(second.window.getByLabel("给 Pi 的消息")).toBeVisible();
    await expect(second.window.getByRole("button", { name: "团队协作", exact: true })).toHaveCount(0);
    await expect(second.window.getByRole("button", { name: "任务看板", exact: true })).toHaveCount(0);
    await expect(second.window.getByRole("button", { name: "固化为任务" })).toHaveCount(0);
    await expect(second.window.locator(".capability-ledger .capability-dot")).toHaveCount(1);
    expect(second.pageErrors).toEqual([]);
    await closeApp(running);
    running = undefined;

    const third = await launchIsolatedApp(paths);
    running = third.electronApp;
    await expect(third.window.getByRole("button", { name: "团队协作", exact: true })).toHaveCount(0);
    await expect(third.window.getByRole("button", { name: "任务看板", exact: true })).toHaveCount(0);
    expect(third.pageErrors).toEqual([]);
  } finally {
    await closeApp(running);
  }
});

test("executes native session, modal, command palette, and terminal interactions", async ({}, testInfo) => {
  const paths = await createIsolatedAppPaths(testInfo);
  const { electronApp, window, pageErrors } = await launchIsolatedApp(paths);
  try {
    const thinking = window.getByLabel("思考级别");
    await expect(thinking).toHaveValue("off");
    await expect(thinking.locator("option")).toHaveCount(1);

    const before = await sessionState(window);
    await window.keyboard.press("Control+N");
    await expect.poll(() => sessionState(window).then((state) => state.sessionId)).not.toBe(before.sessionId);

    const inspector = window.locator(".inspector.is-open");
    await expect(inspector.getByRole("button", { name: /导出 HTML/ })).toBeVisible();
    await inspector.getByRole("button", { name: /重命名/ }).click();
    const rename = window.getByRole("dialog", { name: "重命名会话" });
    await rename.getByLabel("会话名称").fill("GUI 原生能力验证");
    await rename.getByLabel("会话名称").press("Enter");
    await expect(rename).toBeHidden();
    await expect.poll(() => sessionState(window).then((state) => state.sessionName)).toBe("GUI 原生能力验证");

    await window.keyboard.press("Control+K");
    const palette = window.getByRole("dialog", { name: "搜索与命令" });
    const paletteInput = palette.getByPlaceholder("搜索操作、技能或提示词…");
    await expect(paletteInput).toBeFocused();
    await paletteInput.fill("新建会话");
    await expect(palette.getByRole("option", { name: /新建会话/ })).toBeVisible();
    await expect(palette.getByRole("option", { name: /团队/ })).toHaveCount(0);
    await window.keyboard.press("Escape");

    await window.locator(".sidebar").getByRole("button", { name: "运行命令", exact: true }).click();
    const terminal = window.locator(".terminal-drawer.is-open");
    const terminalInput = terminal.getByPlaceholder("输入 PowerShell / shell 命令…");
    const successNonce = `STELLA_GUI_TERMINAL_${Date.now()}`;
    const successCommand = `node -e \"process.stdout.write('${successNonce}')\"`;
    await terminalInput.fill(successCommand);
    await terminalInput.press("Enter");
    const successEntry = terminal.locator(".terminal-entry").last();
    await expect(successEntry.locator("pre")).toContainText(successNonce);
    await expect(successEntry).toContainText("exit 0");
    await terminalInput.press("ArrowUp");
    await expect(terminalInput).toHaveValue(successCommand);

    const errorNonce = `STELLA_GUI_ERROR_${Date.now()}`;
    await terminalInput.fill(`node -e \"process.stderr.write('${errorNonce}');process.exit(7)\"`);
    await terminalInput.press("Enter");
    const errorEntry = terminal.locator(".terminal-entry").last();
    await expect(errorEntry.locator("pre")).toContainText(errorNonce);
    await expect(errorEntry).toContainText("exit 7");

    await terminalInput.fill("node -e \"setTimeout(() => {}, 30000)\"");
    await terminalInput.press("Enter");
    const cancelledEntry = terminal.locator(".terminal-entry").last();
    await expect(terminal.getByRole("button", { name: "停止" })).toBeVisible();
    await terminal.getByRole("button", { name: "停止" }).click();
    await expect(cancelledEntry).toContainText("已取消", { timeout: 15_000 });
    await terminal.getByRole("button", { name: "关闭终端" }).click();
    await expect(terminal).toBeHidden();

    await window.getByRole("button", { name: "偏好设置", exact: true }).click();
    const settings = window.getByRole("dialog", { name: "偏好设置" });
    await settings.getByLabel("字体大小").selectOption("large");
    await expect(window.locator("html")).toHaveAttribute("data-font-size", "large");
    await window.keyboard.press("Escape");

    await window.setViewportSize({ width: 760, height: 720 });
    const sidebar = window.locator(".sidebar");
    await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
    await window.getByRole("button", { name: "打开侧栏", exact: true }).click();
    await expect(sidebar).toHaveClass(/is-open/);
    await expect(sidebar.getByRole("button", { name: "关闭侧栏" })).toBeFocused();
    await window.getByRole("button", { name: "关闭侧栏", exact: true }).click();
    await expect(sidebar).not.toHaveClass(/is-open/);

    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

test("keeps the chat path, attachment draft, session actions, and desktop sidebar continuous", async ({}, testInfo) => {
  const paths = await createIsolatedAppPaths(testInfo);
  const { electronApp, window, pageErrors } = await launchIsolatedApp(paths);
  try {
    await window.setViewportSize({ width: 1440, height: 900 });
    const sessionTrack = window.locator(".topbar__session-track");
    await expect(sessionTrack.getByRole("button", { name: "聚焦当前会话" })).toBeVisible();
    await expect(sessionTrack.getByRole("button", { name: "新建会话" })).toBeVisible();

    await window.getByRole("button", { name: "实现功能", exact: true }).click();
    const composer = window.getByLabel("给 Pi 的消息");
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue(/请分析现有代码并实现下面的需求/);
    await composer.fill("带附件的任务草稿：持续保留研究上下文");
    await window.locator('.composer input[type="file"]').setInputFiles({
      name: "target-context.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    });
    await expect(window.getByAltText("target-context.png")).toBeVisible();
    await expect(window.getByText("1 个附件已保留在当前会话草稿中")).toBeVisible();

    await window.locator(".sidebar").getByRole("button", { name: "模型配置", exact: true }).click();
    await expect(window.getByRole("heading", { name: "模型配置" })).toBeVisible();
    await window.locator(".sidebar").getByRole("button", { name: "当前会话", exact: true }).click();
    await expect(composer).toHaveValue("带附件的任务草稿：持续保留研究上下文");
    await expect(window.getByAltText("target-context.png")).toBeVisible();

    const sidebar = window.locator(".sidebar");
    await sidebar.getByRole("button", { name: "关闭侧栏" }).click();
    await expect(window.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    const openSidebar = window.getByRole("button", { name: "打开侧栏", exact: true });
    await expect(openSidebar).toBeVisible();
    await expect(openSidebar).toBeFocused();
    await openSidebar.click();
    await expect(sidebar).toHaveClass(/is-open/);
    await expect(sidebar.getByRole("button", { name: "关闭侧栏" })).toBeFocused();

    await window.locator(".project-switcher__trigger").click();
    await window.locator(".project-menu").getByRole("button").filter({ hasText: "comparison-project" }).click();
    await expect.poll(
      () => window.evaluate(() => window.stella.refresh().then((bootstrap) => bootstrap.project.cwd)),
      { timeout: 30_000 },
    ).toBe(paths.comparisonProject);
    await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
    await expect(window.locator(".topbar__session-track")).toContainText("当前会话");
    await expect(window.locator(".topbar__session-track")).toContainText("新建会话");

    await window.screenshot({ path: testInfo.outputPath("chat-session-path.png") });
    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});
