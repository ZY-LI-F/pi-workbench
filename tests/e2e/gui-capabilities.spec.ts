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
  await writeFile(join(project, "preview.html"), "<!doctype html><h1>Isolated HTML preview</h1>", "utf8");
  await writeFile(join(project, "unsupported.ps1"), "Write-Output 'inspection only'\n", "utf8");
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

async function sessionState(window: Page): Promise<{
  readonly sessionId: string;
  readonly sessionName?: string;
  readonly sessionFile?: string;
  readonly messageCount: number;
}> {
  return window.evaluate(async () => {
    const response = await window.stella.command({ type: "get_state" });
    if (!response.success || !("data" in response)) throw new Error(response.success ? "get_state 没有返回 data" : response.error);
    return Object.freeze({
      sessionId: response.data.sessionId,
      sessionName: response.data.sessionName,
      sessionFile: response.data.sessionFile,
      messageCount: response.data.messageCount,
    });
  });
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  if (app) await app.close();
}

async function expectComposerInsideViewport(window: Page): Promise<void> {
  const composer = window.locator(".composer-wrap");
  await expect(composer).toBeVisible();
  await expect.poll(async () => window.evaluate(() => {
    const element = document.querySelector<HTMLElement>(".composer-wrap");
    if (!element) return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0
      && bounds.height > 0
      && bounds.top >= 0
      && bounds.left >= 0
      && bounds.right <= window.innerWidth
      && bounds.bottom <= window.innerHeight;
  }), { message: "聊天输入框必须完整位于当前窗口可视区域内" }).toBe(true);
}

test("persists the optional team surface while keeping the generic task board available", async ({}, testInfo) => {
  const paths = await createIsolatedAppPaths(testInfo);
  let running: ElectronApplication | undefined;

  try {
    const first = await launchIsolatedApp(paths);
    running = first.electronApp;
    await expect(first.window.getByRole("button", { name: "团队协作", exact: true })).toHaveCount(0);
    await expect(first.window.getByRole("button", { name: "任务看板", exact: true })).toBeVisible();
    await expect(first.window.getByRole("button", { name: "固化为任务" })).toBeVisible();
    await expect(first.window.locator(".capability-ledger .capability-dot")).toHaveCount(2);

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
    await first.window.getByRole("button", { name: "打开侧栏", exact: true }).click();
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
    await expect(second.window.getByRole("heading", { name: "任务星图" })).toBeVisible();
    await second.window.getByRole("button", { name: "打开侧栏", exact: true }).click();
    await expect(second.window.getByRole("button", { name: "团队协作", exact: true })).toHaveCount(0);
    await expect(second.window.getByRole("button", { name: "任务看板", exact: true })).toBeVisible();
    await expect(second.window.locator(".capability-ledger .capability-dot")).toHaveCount(2);
    await second.window.locator(".sidebar").getByRole("tab", { name: "PI 原生工作台", exact: true }).click();
    await second.window.getByRole("button", { name: "当前会话", exact: true }).click();
    await expect(second.window.getByLabel("给 Pi 的消息")).toBeVisible();
    await expect(second.window.getByRole("button", { name: "固化为任务" })).toBeVisible();
    expect(second.pageErrors).toEqual([]);
    await closeApp(running);
    running = undefined;

    const third = await launchIsolatedApp(paths);
    running = third.electronApp;
    await expect(third.window.getByRole("button", { name: "团队协作", exact: true })).toHaveCount(0);
    await expect(third.window.getByRole("button", { name: "任务看板", exact: true })).toBeVisible();
    expect(third.pageErrors).toEqual([]);
  } finally {
    await closeApp(running);
  }
});

test("imports a Skill folder and hot-loads it into the current Pi session", async ({}, testInfo) => {
  const paths = await createIsolatedAppPaths(testInfo);
  const skillFolder = testInfo.outputPath("e2e-hot-skill");
  await mkdir(skillFolder, { recursive: true });
  await writeFile(join(skillFolder, "SKILL.md"), [
    "---",
    "name: e2e-hot-skill",
    "description: Verify folder import and runtime hot loading.",
    "---",
    "",
    "# E2E hot Skill",
    "",
    "Return the exact text `E2E_SKILL_READY` when invoked.",
    "",
  ].join("\n"), "utf8");

  const { electronApp, window, pageErrors } = await launchIsolatedApp(paths);
  try {
    const before = await sessionState(window);
    await electronApp.evaluate(({ dialog }, selectedFolder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFolder] });
    }, skillFolder);

    const sidebar = window.locator(".sidebar");
    await sidebar.getByRole("tab", { name: "PI 原生工作台", exact: true }).click();
    await sidebar.getByRole("button", { name: "Skills 管理", exact: true }).click();
    await window.getByRole("button", { name: /选择文件夹并热加载/ }).click();

    await expect(window.locator(".skills-install-result")).toContainText("e2e-hot-skill 已热加载", { timeout: 30_000 });
    const skillRow = window.locator(".skill-row", { hasText: "e2e-hot-skill" });
    await expect(skillRow).toContainText("/skill:e2e-hot-skill");
    await expect(skillRow).toContainText("所有项目");
    const after = await sessionState(window);
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.messageCount).toBe(before.messageCount);
    const refreshed = await window.evaluate(() => window.stella.refresh());
    expect(refreshed.commands).toContainEqual(expect.objectContaining({
      name: "skill:e2e-hot-skill",
      source: "skill",
      location: "user",
    }));
    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

test("executes native session, modal, command palette, and terminal interactions", async ({}, testInfo) => {
  const paths = await createIsolatedAppPaths(testInfo);
  const { electronApp, window, pageErrors } = await launchIsolatedApp(paths);
  try {
    await expectComposerInsideViewport(window);
    const markdownPreview = await window.evaluate(async (path) => {
      const preview = await window.stella.readLocalFilePreview(path);
      return {
        kind: preview.kind,
        mimeType: preview.mimeType,
        sizeBytes: preview.sizeBytes,
        text: new TextDecoder().decode(preview.bytes),
        byteContainer: preview.bytes.constructor.name,
      };
    }, join(paths.project, "README.md"));
    expect(markdownPreview).toMatchObject({
      kind: "markdown",
      mimeType: "text/markdown",
      text: "# Isolated Stella GUI E2E\n",
      byteContainer: "Uint8Array",
    });
    expect(markdownPreview.sizeBytes).toBeGreaterThan(0);
    const htmlInspection = await window.evaluate((path) => window.stella.inspectLocalPath(path), join(paths.project, "preview.html"));
    expect(htmlInspection.preview).toMatchObject({ kind: "html", mimeType: "text/html" });
    const unsupportedInspection = await window.evaluate((path) => window.stella.inspectLocalPath(path), join(paths.project, "unsupported.ps1"));
    expect(unsupportedInspection.preview).toBeUndefined();
    await expect(window.evaluate((path) => window.stella.readLocalFilePreview(path), join(paths.project, "unsupported.ps1")))
      .rejects.toThrow("暂不支持预览该文件类型");

    const thinking = window.getByLabel("思考级别");
    await expect(thinking).toHaveValue("off");
    await expect(thinking.locator("option")).toHaveCount(1);

    const before = await sessionState(window);
    await window.keyboard.press("Control+N");
    await expect.poll(() => sessionState(window).then((state) => state.sessionId)).not.toBe(before.sessionId);
    const currentSession = await sessionState(window);
    expect(currentSession.sessionFile).toBeTruthy();

    const composerInput = window.getByLabel("给 Pi 的消息");
    const composerResizeHandle = window.getByRole("separator", { name: "调整输入区高度" });
    const initialComposerHeight = await composerInput.evaluate((element) => element.getBoundingClientRect().height);
    const composerResizeBox = await composerResizeHandle.boundingBox();
    if (!composerResizeBox) throw new Error("输入区高度拖拽柄不可见");
    await window.mouse.move(composerResizeBox.x + composerResizeBox.width / 2, composerResizeBox.y + composerResizeBox.height / 2);
    await window.mouse.down();
    await window.mouse.move(composerResizeBox.x + composerResizeBox.width / 2, composerResizeBox.y - 96, { steps: 4 });
    await window.mouse.up();
    await expect.poll(() => composerInput.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(initialComposerHeight + 70);
    await expect.poll(() => window.evaluate(() => {
      const stored = localStorage.getItem("stella.preferences.v2");
      if (!stored) return 0;
      const value = JSON.parse(stored) as { composerHeight?: unknown };
      return typeof value.composerHeight === "number" ? value.composerHeight : 0;
    })).toBeGreaterThan(initialComposerHeight + 70);
    await expectComposerInsideViewport(window);

    const inspector = window.locator(".inspector.is-open");
    const resizeHandle = inspector.getByRole("separator", { name: "调整检查器宽度" });
    const initialInspectorWidth = await inspector.evaluate((element) => element.getBoundingClientRect().width);
    const resizeBox = await resizeHandle.boundingBox();
    if (!resizeBox) throw new Error("检查器宽度拖拽柄不可见");
    await window.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + 120);
    await window.mouse.down();
    await window.mouse.move(resizeBox.x - 88, resizeBox.y + 120, { steps: 4 });
    await window.mouse.up();
    await expect.poll(() => inspector.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(initialInspectorWidth + 60);
    await expect.poll(() => window.evaluate(() => {
      const stored = localStorage.getItem("stella.preferences.v2");
      if (!stored) return 0;
      const value = JSON.parse(stored) as { inspectorWidth?: unknown };
      return typeof value.inspectorWidth === "number" ? value.inspectorWidth : 0;
    })).toBeGreaterThan(initialInspectorWidth + 60);
    const topbar = window.locator(".topbar");
    await expect(topbar.getByRole("button", { name: "更多会话操作" })).toBeVisible();
    await expect(topbar.getByLabel("思考级别")).toBeHidden();
    await expect.poll(() => topbar.evaluate((element) => {
      const sessionTrack = element.querySelector<HTMLElement>(".topbar__session-track")?.getBoundingClientRect();
      const controls = element.querySelector<HTMLElement>(".topbar__controls")?.getBoundingClientRect();
      return Boolean(sessionTrack && controls && sessionTrack.right <= controls.left + 1);
    }), { message: "检查器变宽后，顶部会话入口不能与右侧控件重叠" }).toBe(true);
    await topbar.getByRole("button", { name: "更多会话操作" }).click();
    const topbarOverflow = topbar.getByRole("menu", { name: "更多会话操作" });
    await expect(topbarOverflow.getByRole("menuitem", { name: /固化为任务/ })).toBeVisible();
    await expect(topbarOverflow.getByRole("menuitem", { name: /新建会话/ })).toBeVisible();
    await topbarOverflow.getByRole("menuitem", { name: /复制 Session 地址/ }).click();
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(currentSession.sessionFile);
    await inspector.getByRole("tab", { name: "文件", exact: true }).click();
    await expect(inspector.getByText("选择一个会话文件", { exact: true })).toBeVisible();
    await inspector.getByRole("tab", { name: "上下文", exact: true }).click();
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

    await window.locator(".sidebar").getByRole("tab", { name: "PI 原生工作台", exact: true }).click();
    await window.locator(".sidebar").getByRole("button", { name: "Skills 管理", exact: true }).click();
    await expect(window.getByRole("heading", { name: "Skills 管理", exact: true })).toBeVisible();
    await expect(window.getByText("只支持文件夹", { exact: true })).toBeVisible();
    await window.locator(".sidebar").getByRole("button", { name: "当前会话", exact: true }).click();
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
    await expectComposerInsideViewport(window);
    const chatMore = window.getByRole("button", { name: "更多会话操作" });
    await expect(chatMore).toBeVisible();
    await chatMore.click();
    const chatMoreMenu = window.getByRole("menu", { name: "更多会话操作" });
    await expect(chatMoreMenu.getByRole("menuitem", { name: /模型配置/ })).toBeVisible();
    await expect(chatMoreMenu.getByRole("menuitem", { name: /会话检查器/ })).toBeVisible();
    await chatMoreMenu.getByRole("menuitem", { name: /设置/ }).click();
    await expect(settings).toBeVisible();
    await window.keyboard.press("Escape");
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
    await window.setViewportSize({ width: 980, height: 680 });
    await expectComposerInsideViewport(window);
    await window.setViewportSize({ width: 1440, height: 900 });
    const sessionTrack = window.locator(".topbar__session-track");
    await expect(sessionTrack.getByRole("button", { name: "聚焦当前会话" })).toBeVisible();
    await expect(sessionTrack.getByRole("button", { name: "新建会话" })).toBeVisible();
    const composerWrap = window.locator(".composer-wrap");
    await expect(composerWrap).toBeVisible();
    await expect.poll(async () => {
      const box = await composerWrap.boundingBox();
      return box ? Math.ceil(box.y + box.height) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(900);
    await expect(window.getByRole("button", { name: /当前模型：.+打开模型配置/ })).toBeVisible();

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
    await expect(window.getByText("草稿已保存至本机")).toBeVisible({ timeout: 15_000 });

    await window.locator(".sidebar").getByRole("tab", { name: "PI 原生工作台", exact: true }).click();
    await window.locator(".sidebar").getByRole("button", { name: "模型配置", exact: true }).click();
    await expect(window.getByRole("heading", { name: "模型配置" })).toBeVisible();
    await window.locator(".sidebar").getByRole("button", { name: "当前会话", exact: true }).click();
    await expect(composer).toHaveValue("带附件的任务草稿：持续保留研究上下文");
    await expect(window.getByAltText("target-context.png")).toBeVisible();

    const sidebar = window.locator(".sidebar");
    await sidebar.getByRole("button", { name: "关闭侧栏" }).click();
    await expect(window.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect.poll(() => window.evaluate(() => {
      const stored = localStorage.getItem("stella.preferences.v2");
      if (!stored) return undefined;
      return (JSON.parse(stored) as { sidebarCollapsed?: unknown }).sidebarCollapsed;
    })).toBe(true);
    await expect.poll(async () => {
      const box = await composerWrap.boundingBox();
      return box ? Math.ceil(box.y + box.height) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(900);
    const openSidebar = window.getByRole("button", { name: "打开侧栏", exact: true });
    await expect(openSidebar).toBeVisible();
    await expect(openSidebar).toBeFocused();
    await openSidebar.click();
    await expect(sidebar).toHaveClass(/is-open/);
    await expect(sidebar.getByRole("button", { name: "关闭侧栏" })).toBeFocused();
    await expect.poll(() => window.evaluate(() => {
      const stored = localStorage.getItem("stella.preferences.v2");
      if (!stored) return undefined;
      return (JSON.parse(stored) as { sidebarCollapsed?: unknown }).sidebarCollapsed;
    })).toBe(false);

    await window.locator(".project-switcher__trigger").click();
    await window.locator(".project-menu").getByRole("button").filter({ hasText: "comparison-project" }).click();
    await expect(window.locator(".project-switcher__trigger")).toContainText("comparison-project", { timeout: 30_000 });
    await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
    await expect(window.locator(".topbar__session-track")).toContainText("当前会话");
    await expect(window.locator(".topbar__session-track")).toContainText("新建会话");

    await window.screenshot({ path: testInfo.outputPath("chat-session-path.png") });
    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

test("restores a session-scoped text and attachment draft after restarting the desktop app", async ({}, testInfo) => {
  const paths = await createIsolatedAppPaths(testInfo);
  let running: ElectronApplication | undefined;
  try {
    const first = await launchIsolatedApp(paths);
    running = first.electronApp;
    const composer = first.window.getByLabel("给 Pi 的消息");
    await composer.fill("关闭应用后继续保留这段任务上下文");
    await first.window.locator('.composer input[type="file"]').setInputFiles({
      name: "restart-evidence.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    });
    await expect(first.window.getByText("草稿已保存至本机")).toBeVisible({ timeout: 15_000 });
    await closeApp(running);
    running = undefined;

    const second = await launchIsolatedApp(paths);
    running = second.electronApp;
    await expect(second.window.getByLabel("给 Pi 的消息")).toHaveValue("关闭应用后继续保留这段任务上下文");
    await expect(second.window.getByAltText("restart-evidence.png")).toBeVisible();
    await expect(second.window.getByText("已恢复上次未发送草稿")).toBeVisible();
    expect(second.pageErrors).toEqual([]);
  } finally {
    await closeApp(running);
  }
});
