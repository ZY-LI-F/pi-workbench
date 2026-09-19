import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";
import { enableTeamFeatures } from "./helpers/team-features";
import { availableLoopbackPort } from "./helpers/native-fixture";

const expectedPiVersion = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
  .dependencies["@earendil-works/pi-coding-agent"] as string;

function packagedExecutable(): string | undefined {
  const explicit = process.env.STELLA_PACKAGED_EXECUTABLE;
  if (explicit) return resolve(explicit);

  const candidates =
    process.platform === "win32"
      ? ["release/win-unpacked/Stella Pi Workbench.exe"]
      : process.platform === "darwin"
        ? [
            "release/mac-arm64/Stella Pi Workbench.app/Contents/MacOS/Stella Pi Workbench",
            "release/mac/Stella Pi Workbench.app/Contents/MacOS/Stella Pi Workbench",
          ]
        : ["release/linux-unpacked/stella-pi-workbench"];
  return candidates.map((candidate) => resolve(candidate)).find(existsSync);
}

function withoutExecutableSearchPath(replacement: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "path"),
    ),
    PATH: replacement,
  };
}

test("packaged app boots its bundled Pi RPC runtime", async ({}, testInfo) => {
  const executablePath = packagedExecutable();
  const required = process.env.npm_lifecycle_event === "test:packaged";
  const explicitlySelected = typeof process.env.STELLA_PACKAGED_EXECUTABLE === "string";
  test.skip(!required && !explicitlySelected, "打包冒烟仅由 test:packaged 或显式可执行文件触发");
  if (!executablePath) {
    throw new Error("找不到已打包应用；请先运行 npm run package:dir，或设置 STELLA_PACKAGED_EXECUTABLE");
  }

  const emptyExecutableSearchPath = testInfo.outputPath("empty-path");
  const userData = testInfo.outputPath("electron-user-data");
  const projectPath = testInfo.outputPath("project");
  mkdirSync(emptyExecutableSearchPath, { recursive: true });
  mkdirSync(userData, { recursive: true });
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(userData, "stella-state.json"), `${JSON.stringify({
    lastProject: projectPath,
    recentProjects: [{ path: projectPath, trusted: false, lastOpened: "2026-07-26T00:00:00.000Z" }],
    executionBackends: {
      codex: { executablePath: join(emptyExecutableSearchPath, "codex-missing") },
      claude: { executablePath: join(emptyExecutableSearchPath, "claude-missing") },
    },
  }, null, 2)}\n`, "utf8");

  const electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`],
    env: {
      ...withoutExecutableSearchPath(emptyExecutableSearchPath),
      PI_CODING_AGENT_DIR: testInfo.outputPath("pi-user-data"),
      STELLA_WEBHOOK_PORT: String(await availableLoopbackPort()),
      STELLA_COMPANION_PORT: String(await availableLoopbackPort()),
    },
  });

  try {
    const window = await electronApp.firstWindow();
    const pageErrors: string[] = [];
    window.on("pageerror", (error) => pageErrors.push(error.message));
    await window.waitForLoadState("domcontentloaded");
    await expect(window.locator(".app-shell, .startup-screen--error")).toBeVisible({ timeout: 45_000 });

    const startupError = window.locator(".startup-screen--error");
    if (await startupError.isVisible()) {
      throw new Error(`打包应用内置 Pi RPC 启动失败:\n${await startupError.innerText()}`);
    }

    await expect(window.getByLabel(/Stella Pi Workbench/).first()).toBeVisible();
    await expect.poll(
      () => window.evaluate(() => window.stella.capabilities().then((health) => health.pi.state)),
      { timeout: 45_000, message: "bundled Pi capability should finish its independent startup" },
    ).toBe("ready");
    await expect.poll(
      () => window.evaluate(() => window.stella.capabilities().then((health) => health.task.state)),
      { timeout: 15_000, message: "Task Control capability should be ready" },
    ).toBe("ready");
    const externalBackends = await window.evaluate(() => window.stella.executionBackendsInitialize());
    expect(externalBackends.health.find((item) => item.backendId === "pi")?.state).toBe("ready");
    expect(externalBackends.health.find((item) => item.backendId === "codex")?.state).toBe("unavailable");
    expect(externalBackends.health.find((item) => item.backendId === "claude")?.state).toBe("unavailable");
    await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
    const composerResize = window.getByRole("separator", { name: "调整输入区高度" });
    await expect(composerResize).toBeVisible();
    await composerResize.press("ArrowUp");
    await expect(composerResize).toHaveAttribute("aria-valuetext", /像素$/);

    const packagedSession = await window.evaluate(async () => {
      const response = await window.stella.command({ type: "get_state" });
      if (!response.success || !("data" in response)) throw new Error(response.success ? "get_state 没有返回 data" : response.error);
      return Object.freeze({ sessionFile: response.data.sessionFile });
    });
    if (!packagedSession.sessionFile) throw new Error("打包态会话没有生成可追踪的 sessionFile");
    await electronApp.evaluate(({ clipboard }, expected) => {
      const audit: { action: string; matchesSession: boolean; length: number; at: number }[] = [];
      const originalWrite = clipboard.writeText.bind(clipboard);
      const originalRead = clipboard.readText.bind(clipboard);
      // Observe the real OS calls without changing their results. Do not record
      // pre-existing clipboard contents, which may belong to the desktop user.
      clipboard.writeText = (text, type) => {
        audit.push({ action: "write", matchesSession: text === expected, length: text.length, at: Date.now() });
        originalWrite(text, type);
      };
      clipboard.readText = (type) => {
        const text = originalRead(type);
        audit.push({ action: "read", matchesSession: text === expected, length: text.length, at: Date.now() });
        return text;
      };
      Object.assign(globalThis, { stellaPackagedClipboardAudit: audit });
    }, packagedSession.sessionFile);
    const sessionMore = window.getByRole("button", { name: "更多会话操作" });
    await expect(sessionMore).toBeVisible();
    await sessionMore.click();
    await window.bringToFront();
    const clipboardWritable = await electronApp.evaluate(({ clipboard }) => {
      const previous = clipboard.readText();
      clipboard.writeText("stella-packaged-clipboard-probe");
      const writable = clipboard.readText() === "stella-packaged-clipboard-probe";
      if (writable) clipboard.writeText(previous);
      return writable;
    });
    await window.getByRole("menu", { name: "更多会话操作" }).getByRole("menuitem", { name: /复制 Session 地址/ }).click();
    const copyNotice = window.locator(".toast").last();
    await expect(copyNotice).toContainText("Session 地址");
    try {
      if (clipboardWritable) {
        await expect(copyNotice).toContainText("已复制");
        await expect.poll(
          () => electronApp.evaluate(({ clipboard }) => clipboard.readText()),
          { message: "打包态复制动作完成后，系统剪贴板应包含当前 Session 文件地址" },
        ).toBe(packagedSession.sessionFile);
      } else {
        await expect(copyNotice).toContainText("失败");
        await expect(copyNotice).toContainText("系统剪贴板未接受待复制文本");
      }
    } finally {
      const clipboardAudit = await electronApp.evaluate(() => (globalThis as unknown as { stellaPackagedClipboardAudit: unknown }).stellaPackagedClipboardAudit);
      const auditPath = testInfo.outputPath("real-clipboard-audit.json");
      writeFileSync(auditPath, JSON.stringify(clipboardAudit, null, 2));
      await testInfo.attach("real-clipboard-audit.json", { path: auditPath, contentType: "application/json" });
    }

    await expect(window.getByRole("button", { name: "团队协作", exact: true })).toHaveCount(0);
    await expect(window.getByRole("button", { name: "任务看板", exact: true })).toBeVisible();
    await expect(window.locator(".capability-ledger .capability-dot")).toHaveCount(2);
    await enableTeamFeatures(window);
    await window.getByRole("button", { name: "任务看板", exact: true }).click();
    await expect(window.getByRole("button", { name: "新建看板任务" })).toBeVisible();
    await expect(window.getByRole("heading", { name: "任务星图" })).toBeVisible();
    await window.getByRole("tab", { name: "CLI Tasks", exact: true }).click();
    await expect(window.getByRole("region", { name: "外部 CLI 任务" })).toBeVisible();
    await expect(window.locator(".external-source-health")).toHaveCount(2);
    await window.getByRole("tab", { name: "全部", exact: true }).click();
    await expect(window.getByRole("region", { name: "外部 CLI 活动" })).toBeVisible();
    await window.getByRole("tab", { name: "Stella Tasks", exact: true }).click();
    expect(await window.evaluate(() => window.location.protocol)).toBe("file:");

    await window.evaluate(() => window.stella.modelConfigurationUpsertProvider({
      id: "packaged-smoke",
      name: "Packaged Smoke",
      baseUrl: "http://127.0.0.1:9/v1",
      api: "openai-completions",
      authHeader: false,
      models: [{
        id: "smoke-model",
        name: "Smoke Model",
        reasoning: false,
        imageInput: false,
        contextWindow: 8_192,
        maxTokens: 1_024,
      }],
    }));
    const modelConfiguration = await window.evaluate(() =>
      window.stella.modelConfigurationSaveApiKey({ providerId: "packaged-smoke", apiKey: "packaged-smoke-only" }),
    );
    expect(modelConfiguration.providers.find((provider) => provider.id === "packaged-smoke")).toMatchObject({
      configured: true,
      credentialType: "api_key",
      hasCustomConfiguration: true,
    });

    await window.locator(".sidebar").getByRole("tab", { name: "PI 原生工作台", exact: true }).click();
    await window.getByRole("button", { name: "模型配置", exact: true }).click();
    await expect(window.getByRole("heading", { name: "模型配置", exact: true })).toBeVisible({ timeout: 30_000 });
    const packagedProvider = window.getByLabel("Provider 列表").getByRole("button", { name: /Packaged Smoke/ });
    await expect(packagedProvider).toBeVisible();
    await packagedProvider.click();
    const currentKey = window.getByLabel("Packaged Smoke 当前 API key");
    await expect(currentKey).not.toHaveValue("packaged-smoke-only");
    await window.getByRole("button", { name: "查看当前 API key" }).click();
    await expect(currentKey).toHaveValue("packaged-smoke-only");
    await window.getByRole("button", { name: "隐藏当前 API key" }).click();
    await expect(currentKey).not.toHaveValue("packaged-smoke-only");
    expect(await window.getByRole("dialog").allTextContents()).toEqual([]);
    await window.locator(".sidebar").getByRole("tab", { name: "任务栏", exact: true }).click();
    await window.getByRole("button", { name: "任务看板", exact: true }).click();

    await window.getByRole("button", { name: "新建任务", exact: true }).click();
    await expect(window.getByRole("dialog", { name: "创建看板任务" })).toBeVisible();
    await window.getByRole("button", { name: "取消", exact: true }).click();

    const openSidebar = window.getByRole("button", { name: "打开侧栏", exact: true });
    if (await openSidebar.isVisible()) {
      await openSidebar.click();
      await expect(window.locator(".sidebar")).toHaveClass(/is-open/);
    }
    await window.getByRole("button", { name: "偏好设置", exact: true }).click();
    const settings = window.getByRole("dialog", { name: "偏好设置" });
    await expect(settings.getByText(`Pi Workbench · Pi v${expectedPiVersion}`, { exact: false })).toBeVisible();
    await expect(window.locator(".sidebar")).not.toHaveClass(/is-open/);
    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});
