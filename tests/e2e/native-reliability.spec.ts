import { expect, test } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { nativeFixture, protocolReply } from "./helpers/native-fixture";

test("v0.6 native receipts, duplicate delivery, file references and private diagnostics work through Electron", async ({}, testInfo) => {
  let projectDir = "";
  const fixture = await nativeFixture(testInfo, (request, response) => protocolReply(response, request.model,
    `中文😀回复完成。\n\n参考文件：${join(projectDir, "README.md")}`));
  projectDir = fixture.projectDir;
  const { window, app } = fixture;
  try {
    await fixture.openChat();
    const input = window.getByLabel("给 Pi 的消息");
    for (let index = 0; index < 2; index += 1) {
      await input.fill("PRIVATE_NATIVE_PROMPT 中文😀重复输入"); await input.press("Enter");
      await expect(window.locator(".message--assistant")).toHaveCount(index + 1);
      await expect(input).toHaveValue("");
    }
    await expect(window.locator(".message--user")).toHaveCount(2);
    const snapshot = await window.evaluate(() => window.stella.refresh());
    const users = snapshot.messages.filter((message) => message.role === "user");
    expect(new Set(users.map((message) => message.stella?.entryId)).size).toBe(2);
    expect(users.every((message) => Boolean(message.stella?.entryId))).toBe(true);
    expect(snapshot.submissions).toHaveLength(2);
    expect(snapshot.submissions?.every((receipt) => receipt.status === "accepted")).toBe(true);
    const duplicate = await window.evaluate(async ({ id, sessionId }) => window.stella.submitNativeTurn({ id, sessionId,
      command: { type: "prompt", message: "PRIVATE_NATIVE_PROMPT 中文😀重复输入", images: [] } }), { id: snapshot.submissions![0]!.id, sessionId: snapshot.state.sessionId });
    expect(duplicate.receipt.status).toBe("accepted");
    expect(fixture.requests.filter((request) => request.body)).toHaveLength(2);

    await window.getByRole("button", { name: `预览文件 ${join(projectDir, "README.md")}`, exact: true }).last().click();
    await expect(window.getByText(/本机读取已验证/)).toBeVisible();
    const fileName = window.locator(".output-path__copy > strong").last();
    await expect(fileName).toHaveText("README.md");
    expect((await fileName.boundingBox())!.width).toBeGreaterThan(100);
    await input.fill("保留我的批注");
    await window.getByRole("button", { name: "引用文件到对话", exact: true }).click();
    await expect(input).toHaveValue(/保留我的批注[\s\S]*sha256:/);
    await expect(input).not.toHaveValue(/This is verifiable source evidence/);
    await writeFile(join(projectDir, "README.md"), "# Updated disk version\n");
    await window.getByRole("button", { name: "引用文件到对话", exact: true }).click();
    await expect(window.getByRole("alert").filter({ hasText: "文件版本已变化" })).toBeVisible();
    expect((await input.inputValue()).match(/\[本地文件引用\]/g)).toHaveLength(1);

    await window.getByRole("tab", { name: "活动", exact: true }).click();
    await expect(window.getByRole("region", { name: "原生提交回执" })).toContainText("Pi 已接收");
    await window.getByRole("tab", { name: "上下文", exact: true }).click();
    const outputPath = testInfo.outputPath("native-diagnostics.json");
    await app.evaluate(({ dialog, shell }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      shell.showItemInFolder = (revealed) => { if (revealed !== path) throw new Error("Wrong diagnostic export location"); };
    }, outputPath);
    await window.getByRole("button", { name: /导出本机诊断/ }).click();
    await expect(window.locator(".toast").filter({ hasText: "本机诊断已导出" })).toBeVisible();
    await expect(window.locator(".toast--error")).toHaveCount(0);
    const diagnostic = await readFile(outputPath, "utf8");
    expect(diagnostic).not.toContain("PRIVATE_NATIVE_PROMPT"); expect(diagnostic).not.toContain("stella-e2e-secret");
    const parsed = JSON.parse(diagnostic);
    expect(parsed.appVersion).toBe("0.6.0"); expect(parsed.submissions).toHaveLength(2);
    expect(parsed.requests.some((request: { id: string }) => request.id === snapshot.submissions![0]!.id)).toBe(true);
    await window.screenshot({ path: testInfo.outputPath("native-upgrade-diagnostics.png"), animations: "disabled" });

    await app.evaluate(({ shell }) => { shell.showItemInFolder = () => { throw new Error("TEST_ONLY_FILE_MANAGER_UNAVAILABLE"); }; });
    await window.getByRole("button", { name: /导出本机诊断/ }).click();
    await expect(window.locator(".toast--warning")).toContainText("已导出");
    await expect(window.locator(".toast--warning")).toContainText("TEST_ONLY_FILE_MANAGER_UNAVAILABLE");
    await expect(window.locator(".toast--error")).toHaveCount(0);

    const invalidOutput = testInfo.outputPath("existing-directory");
    await mkdir(invalidOutput);
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, invalidOutput);
    await window.getByRole("button", { name: /导出本机诊断/ }).click();
    await expect(window.locator(".toast--error")).toContainText("导出本机诊断失败");
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined }); });
    expect(await window.evaluate(() => window.stella.exportNativeDiagnostics({ width: 1200, height: 800, inspectorWidth: 400, inspectorOpen: true, sidebarOpen: true, fontSize: "default" }))).toBeNull();
    expect(fixture.pageErrors).toEqual([]); expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("pending crash receipts recover as unknown and require an explicit new-input decision, never replay", async ({}, testInfo) => {
  let sessionFile = "";
  const fixture = await nativeFixture(testInfo, undefined, {}, async ({ projectDir, agentDir, userDataDir }) => {
    const encodedCwd = `--${projectDir.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    const sessionDir = join(agentDir, "sessions", encodedCwd); await mkdir(sessionDir, { recursive: true });
    const session = SessionManager.create(projectDir, sessionDir);
    session.appendMessage({ role: "user", content: "恢复测试会话", timestamp: Date.now() });
    session.appendMessage({ role: "assistant", content: [{ type: "text", text: "已有历史记录" }], api: "openai-completions", provider: "stella-e2e", model: "stella-e2e-model", stopReason: "stop", timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    sessionFile = session.getSessionFile()!;
    await writeFile(join(userDataDir, "native-submissions.json"), JSON.stringify({ version: 1, receipts: [{ id: "crash-boundary-request", sessionId: session.getSessionId(), sessionFile,
      cwd: projectDir, generation: "retired-generation", command: "prompt", status: "pending", digest: "test-fixture-only", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }));
  });
  const { window } = fixture;
  try {
    await fixture.openChat();
    await window.locator(".sidebar").getByRole("tab", { name: "任务栏", exact: true }).click();
    await window.locator(".sidebar .session-item").filter({ hasText: "恢复测试会话" }).click();
    await expect(window.locator(".submission-warning")).toContainText("尚未确认");
    expect((await window.evaluate(() => window.stella.refresh())).state.sessionFile).toBe(sessionFile);
    expect(fixture.requests.filter((request) => request.body)).toHaveLength(0);
    const input = window.getByLabel("给 Pi 的消息");
    await input.fill("明确的新输入"); await input.press("Enter");
    await expect(window.getByRole("dialog", { name: "上次发送结果未知" })).toBeVisible();
    await window.getByRole("button", { name: "返回核对会话" }).click();
    await expect(input).toHaveValue("明确的新输入"); expect(fixture.requests.filter((request) => request.body)).toHaveLength(0);
    await input.press("Enter"); await window.getByRole("button", { name: "已核对，发送新输入" }).click();
    await expect(input).toHaveValue(""); await expect(window.locator(".message--assistant").last()).toContainText("OK");
    expect(fixture.requests.filter((request) => request.body)).toHaveLength(1);
    const receipts = (await window.evaluate(() => window.stella.refresh())).submissions;
    expect(receipts?.find((receipt) => receipt.id === "crash-boundary-request")?.status).toBe("unknown");
    await window.screenshot({ path: testInfo.outputPath("native-crash-recovery.png"), animations: "disabled" });
    expect(fixture.pageErrors).toEqual([]); expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("reconnects an unexpectedly terminated Pi to the exact session without replaying a turn or losing a draft", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo);
  const { app, window } = fixture;
  try {
    await fixture.openChat();
    const input = window.getByLabel("给 Pi 的消息");
    await input.fill("保留此会话用于断连恢复"); await input.press("Enter");
    await expect(window.locator(".message--assistant")).toContainText("OK");
    await expect(input).toHaveValue("");
    const before = await window.evaluate(() => window.stella.refresh());
    await input.fill("断连前正在编辑的草稿");
    const entryPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
    const entrySuffix = entryPath.replaceAll("\\", "/").slice(entryPath.replaceAll("\\", "/").lastIndexOf("/node_modules/"));
    await app.evaluate((_, rpcSuffix) => {
      // Test-only fault injection: identify exactly this fixture's Pi child by
      // its known executable argument; never terminate unrelated desktop apps.
      const runtimeProcess = process as unknown as { _getActiveHandles(): { spawnargs?: string[]; kill?: () => boolean }[] };
      const children = runtimeProcess._getActiveHandles().filter((handle) => handle.spawnargs?.some((argument) => argument.replaceAll("\\", "/").endsWith(rpcSuffix)));
      if (children.length !== 1 || !children[0]!.kill?.()) throw new Error("Could not terminate the fixture's unique Pi process");
    }, entrySuffix);
    await expect(window.locator(".chat-runtime-banner")).toContainText("Pi 暂不可用");
    await expect(input).toHaveValue("断连前正在编辑的草稿");
    const offlinePath = testInfo.outputPath("offline-diagnostics.json");
    await app.evaluate(({ dialog, shell }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      shell.showItemInFolder = (revealed) => { if (revealed !== path) throw new Error("Unexpected diagnostic target"); };
    }, offlinePath);
    const offlineExport = await window.evaluate(() => window.stella.exportNativeDiagnostics({ width: innerWidth, height: innerHeight, inspectorWidth: 400, inspectorOpen: false, sidebarOpen: true, fontSize: "default" }));
    expect(offlineExport).toEqual({ path: offlinePath });
    const offline = JSON.parse(await readFile(offlinePath, "utf8"));
    expect(offline.runtimeConnected).toBe(false);
    expect(offline.scope.sessionId).toBe(before.state.sessionId);
    expect(offline.submissions).toHaveLength(1);
    await window.getByRole("button", { name: "重试连接", exact: true }).click();
    await expect(window.locator(".chat-runtime-banner")).toHaveCount(0);
    const after = await window.evaluate(() => window.stella.refresh());
    expect(after.state.sessionId).toBe(before.state.sessionId);
    expect(after.state.sessionFile).toBe(before.state.sessionFile);
    expect(after.scope?.generation).not.toBe(before.scope?.generation);
    expect(after.messages).toEqual(before.messages);
    await expect(input).toHaveValue("断连前正在编辑的草稿");
    expect(fixture.requests.filter((request) => request.body)).toHaveLength(1);
    await input.press("Enter");
    await expect(window.locator(".message--assistant")).toHaveCount(2);
    expect(fixture.requests.filter((request) => request.body)).toHaveLength(2);
    await window.screenshot({ path: testInfo.outputPath("native-process-reconnect.png"), animations: "disabled" });
    expect(fixture.pageErrors).toEqual([]); expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});
