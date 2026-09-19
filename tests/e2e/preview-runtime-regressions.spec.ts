import { expect, test } from "@playwright/test";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ServerResponse } from "node:http";
import { nativeFixture, protocolReply } from "./helpers/native-fixture";

function pdfFixture(): Buffer {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    "", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>", "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (const [index, text] of [[3, "Local PDF selectable text"], [5, "Second page evidence"]] as const) {
    const stream = `BT /F1 22 Tf 50 700 Td (${text}) Tj ET`;
    objects[index] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

test("real PPTX fits a narrow inspector and local PDF has selectable text without Chromium's extractor", async ({}, testInfo) => {
  let paths: string[] = [];
  const fixture = await nativeFixture(testInfo, (request, response) => protocolReply(response, request.model,
    `文件已就绪：\n${paths.map((path) => `**${path}**`).join("\n\n")}`), {}, async ({ projectDir }) => {
    paths = [join(projectDir, "研究 报告.pptx"), join(projectDir, "source.pdf")];
    await copyFile(join(process.cwd(), "docs", "PI-GUI_产品能力与交互说明.pptx"), paths[0]!);
    await writeFile(paths[1]!, pdfFixture());
  });
  const { window } = fixture;
  const rendererWarnings: string[] = [];
  window.on("console", (event) => { if (["error", "warning"].includes(event.type())) rendererWarnings.push(event.text()); });
  try {
    await fixture.openChat();
    await window.getByLabel("给 Pi 的消息").fill("给我查看交付物");
    await window.getByLabel("给 Pi 的消息").press("Enter");
    await window.getByRole("button", { name: `预览文件 ${paths[0]}`, exact: true }).click();
    await expect(window.getByRole("combobox", { name: "跳转幻灯片" })).toHaveValue("0", { timeout: 30_000 });
    await expect.poll(() => window.frameLocator('iframe[title="研究 报告.pptx 第 1 张"]').locator(".slide").evaluate((slide) => getComputedStyle(slide).isolation)).toBe("isolate");
    await window.getByRole("separator", { name: "调整检查器宽度" }).focus();
    await window.getByRole("separator", { name: "调整检查器宽度" }).press("Home");
    const geometry = async () => window.locator(".file-preview__slide-canvas").evaluate((canvas) => {
      const slide = canvas.querySelector(".file-preview__slide-frame")!.getBoundingClientRect();
      return { frameWidth: slide.width, frameHeight: slide.height, viewportWidth: canvas.clientWidth, viewportHeight: canvas.clientHeight,
        scrollWidth: canvas.scrollWidth, scrollHeight: canvas.scrollHeight };
    });
    await expect.poll(async () => { const g = await geometry(); return g.frameWidth > 0 && g.frameWidth <= g.viewportWidth && g.frameHeight <= g.viewportHeight; }).toBe(true);
    const toolbarHeight = await window.locator(".file-preview__pager").evaluate((element) => element.getBoundingClientRect().height);
    await window.getByRole("combobox", { name: "跳转幻灯片" }).selectOption("9");
    await expect(window.getByTitle("研究 报告.pptx 第 10 张")).toBeVisible();
    await window.getByRole("button", { name: "按原始尺寸预览" }).click();
    expect((await geometry()).scrollWidth).toBeGreaterThan((await geometry()).viewportWidth);
    expect(await window.locator(".file-preview__pager").evaluate((element) => element.getBoundingClientRect().height)).toBe(toolbarHeight);
    await window.getByRole("button", { name: "适应整页" }).click();
    await window.screenshot({ path: testInfo.outputPath("pptx-narrow-fit.png"), animations: "disabled" });
    const slide = window.getByTitle("研究 报告.pptx 第 10 张");
    await expect(slide).toHaveAttribute("sandbox", "");
    await window.getByRole("region", { name: "PowerPoint 幻灯片预览" }).focus();
    await window.keyboard.press("Home");
    await expect(window.getByRole("combobox", { name: "跳转幻灯片" })).toHaveValue("0");
    await window.getByRole("combobox", { name: "切换会话文件" }).selectOption(paths[1]!.toLowerCase());
    await expect(window.getByRole("region", { name: "PDF 本地阅读器" })).toBeVisible({ timeout: 30_000 });
    await expect(window.locator(".textLayer").getByText("Local PDF selectable text", { exact: true })).toBeAttached({ timeout: 30_000 });
    await expect(window.locator(".file-preview__pdf-page").first().getByRole("alert")).toHaveCount(0);
    const pdfCanvas = window.locator(".file-preview__pdf-page canvas").first();
    expect(await pdfCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(100);
    await window.getByRole("combobox", { name: "跳转 PDF 页" }).selectOption("2");
    await expect(window.locator(".textLayer").getByText("Second page evidence", { exact: true })).toBeAttached();
    await window.screenshot({ path: testInfo.outputPath("pdf-local-text-layer.png"), animations: "disabled" });
    expect(fixture.pageErrors).toEqual([]);
    expect(rendererWarnings.filter((line) => /Unable to load|Cannot load|Warning:|无法下载/.test(line))).toEqual([]);
  } finally { await fixture.close(); }
});

test("a 1,200-entry session refreshes through contextBridge and clicking the selected session returns from settings", async ({}, testInfo) => {
  let path = "";
  const fixture = await nativeFixture(testInfo, (request, response) => protocolReply(response, request.model, "LONG_SESSION_OK"), {}, async ({ projectDir, agentDir }) => {
    const encoded = `--${projectDir.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    const manager = SessionManager.create(projectDir, join(agentDir, "sessions", encoded));
    for (let index = 0; index < 1199; index++) manager.appendMessage({ role: "user", content: `历史记录 ${index}`, timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "历史最后回复" }], api: "openai-completions", provider: "stella-e2e", model: "stella-e2e-model", stopReason: "stop", timestamp: Date.now(),
      usage: { input: 50, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 60, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    path = manager.getSessionFile()!;
  });
  const { window } = fixture;
  try {
    await window.evaluate(async (path) => { await window.stella.command({ type: "switch_session", sessionPath: path }); }, path);
    await window.reload();
    await fixture.openChat();
    const snapshot = await window.evaluate(() => window.stella.refresh());
    expect(snapshot.entries.length).toBeGreaterThanOrEqual(1200);
    expect(snapshot.tree).toHaveLength(snapshot.entries.length);
    expect(snapshot.tree.flatMap((node) => node.children).every((id) => typeof id === "string")).toBe(true);
    await window.getByLabel("给 Pi 的消息").fill("继续验证，回复 LONG_SESSION_OK");
    await window.getByLabel("给 Pi 的消息").press("Enter");
    await expect(window.locator(".message--assistant").last()).toContainText("LONG_SESSION_OK", { timeout: 30_000 });
    const after = await window.evaluate(() => window.stella.refresh());
    expect(after.entries.length).toBeGreaterThan(snapshot.entries.length);
    expect(after.state.sessionFile).toBe(path);
    const beforeCount = after.entries.length;
    await window.getByRole("button", { name: "模型配置", exact: true }).click();
    await window.getByRole("tab", { name: "任务栏", exact: true }).click();
    await window.locator(".session-item.is-active").click();
    await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
    expect((await window.evaluate(() => window.stella.refresh())).entries).toHaveLength(beforeCount);
    await window.screenshot({ path: testInfo.outputPath("long-session-refreshed.png"), animations: "disabled" });
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("version settings compare the installed CLI with the bundled core and cancellation makes no update", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo);
  try {
    const before = await fixture.window.evaluate(() => window.stella.piVersionCheck());
    const metadata = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
    expect(before.bundledVersion).toBe(metadata.dependencies["@earendil-works/pi-coding-agent"]);
    await fixture.window.getByRole("button", { name: "偏好设置", exact: true }).click();
    await expect(fixture.window.getByRole("region", { name: "Pi 版本管理" })).toContainText(before.bundledVersion);
    await expect(fixture.window.getByText("Sol-Pi · 尚未接入", { exact: true })).toBeVisible();
    if (before.canSync) {
      await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
      await fixture.window.getByRole("button", { name: `同步到 v${before.bundledVersion}` }).click();
      await expect(fixture.window.getByText("已取消，本机 Pi 未作更改。", { exact: true })).toBeVisible();
      expect((await fixture.window.evaluate(() => window.stella.piVersionCheck())).localVersion).toBe(before.localVersion);
    }
    await fixture.window.screenshot({ path: testInfo.outputPath("pi-version-settings.png"), animations: "disabled" });
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("the GUI stop button ends a real nohup job after its launching shell has already exited", async ({}, testInfo) => {
  let turn = 0;
  const fixture = await nativeFixture(testInfo, (request, response) => {
    turn++;
    if (turn === 1) protocolReply(response, request.model, "", { id: "background-computation", name: "bash", args: {
      command: "nohup node background-worker.cjs >background.log 2>&1 & echo BACKGROUND_LAUNCHED",
    } });
    // Hold the next real request so the normal GUI stop button is available.
  }, {}, async ({ projectDir }) => {
    await writeFile(join(projectDir, "background-worker.cjs"), "const fs = require('fs'); setInterval(() => fs.appendFileSync('heartbeat.txt', 'tick\\n'), 100);");
  });
  try {
    await fixture.openChat();
    const input = fixture.window.getByLabel("给 Pi 的消息");
    await input.fill("启动本机后台计算并等待"); await input.press("Enter");
    const readHeartbeat = async () => readFile(join(fixture.projectDir, "heartbeat.txt"), "utf8").catch(() => "");
    await expect.poll(async () => (await readHeartbeat()).length, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => turn).toBe(2);
    await fixture.window.getByRole("button", { name: "停止", exact: true }).click();
    await expect(fixture.window.getByText(/Pi 已停止，并核查本机后台进程/)).toBeVisible();
    const stopped = await readHeartbeat();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await readHeartbeat()).toBe(stopped);
    expect((await fixture.window.evaluate(() => window.stella.refresh())).state.isStreaming).toBe(false);
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("native context and usage update while the next model response is still in flight", async ({}, testInfo) => {
  let responseInFlight: { response: ServerResponse; model: string } | undefined;
  let turn = 0;
  const fixture = await nativeFixture(testInfo, (request, response) => {
    turn++;
    if (turn === 1) protocolReply(response, request.model, "", { id: "read-evidence", name: "read", args: { path: "README.md" } }, 50_000);
    else responseInFlight = { response, model: request.model };
  });
  try {
    await fixture.openChat();
    await fixture.window.getByLabel("给 Pi 的消息").fill("读取证据，继续第二步");
    await fixture.window.getByLabel("给 Pi 的消息").press("Enter");
    await expect.poll(() => turn).toBe(2);
    if (!await fixture.window.getByRole("tab", { name: "上下文", exact: true }).isVisible()) {
      await fixture.window.keyboard.press("Control+i");
    }
    await fixture.window.getByRole("tab", { name: "上下文", exact: true }).click();
    await expect(fixture.window.locator('.metric-grid strong[title="50000 tokens"]')).toBeVisible();
    await expect(fixture.window.getByRole("button", { name: "停止", exact: true })).toBeVisible();
    await expect(fixture.window.locator(".context-caption span")).toHaveAttribute("title", /5\d{4} \/ 131072 tokens/);
    await fixture.window.screenshot({ path: testInfo.outputPath("live-context-statistics.png"), animations: "disabled" });
    protocolReply(responseInFlight!.response, responseInFlight!.model, "SECOND_STEP_FINISHED", undefined, 51000);
    await expect(fixture.window.locator(".message--assistant").last()).toContainText("SECOND_STEP_FINISHED");
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});
