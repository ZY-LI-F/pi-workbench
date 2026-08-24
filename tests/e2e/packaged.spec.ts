import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";
import { enableTeamFeatures } from "./helpers/team-features";

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
  }, null, 2)}\n`, "utf8");

  const electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`],
    env: {
      ...withoutExecutableSearchPath(emptyExecutableSearchPath),
      PI_CODING_AGENT_DIR: testInfo.outputPath("pi-user-data"),
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
    const sessionMore = window.getByRole("button", { name: "更多会话操作" });
    await expect(sessionMore).toBeVisible();
    await sessionMore.click();
    await window.getByRole("menu", { name: "更多会话操作" }).getByRole("menuitem", { name: /复制 Session 地址/ }).click();
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(packagedSession.sessionFile);

    await expect(window.getByRole("button", { name: "团队协作", exact: true })).toHaveCount(0);
    await expect(window.getByRole("button", { name: "任务看板", exact: true })).toBeVisible();
    await expect(window.locator(".capability-ledger .capability-dot")).toHaveCount(2);
    await enableTeamFeatures(window);
    await window.getByRole("button", { name: "任务看板", exact: true }).click();
    await expect(window.getByRole("button", { name: "新建看板任务" })).toBeVisible();
    await expect(window.getByRole("heading", { name: "任务星图" })).toBeVisible();
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
    await expect(settings.getByText(/Pi Workbench · Pi v0\.84\.2/)).toBeVisible();
    await expect(window.locator(".sidebar")).not.toHaveClass(/is-open/);
    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});
