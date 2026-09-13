import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeFixture, protocolReply } from "./helpers/native-fixture";

test("shows a real Pi automatic compaction and retains the append-only session history", async ({}, testInfo) => {
  let turn = 0;
  const fixture = await nativeFixture(testInfo, (request, response) => {
    turn += 1;
    // Usage is intentionally injected by a protocol test fixture to cross the
    // 131072 - 16384 threshold without a paid 120k-token model request.
    protocolReply(response, request.model, turn === 1 ? "INITIAL_RESULT" : "## Summary\nRetain the user's original task and INITIAL_RESULT.", undefined, turn === 1 ? 120_000 : 400);
  }, { compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 1 } });
  try {
    await fixture.openChat();
    await fixture.window.getByLabel("给 Pi 的消息").fill("记住此任务并正常回答，验证自动压缩链路。");
    await fixture.window.getByLabel("给 Pi 的消息").press("Enter");
    await expect.poll(() => fixture.window.evaluate(async () => (await window.stella.refresh()).entries.filter((entry) => entry.type === "compaction").length), { timeout: 30_000 }).toBe(1);
    const snapshot = await fixture.window.evaluate(() => window.stella.refresh());
    expect(snapshot.state.isCompacting).toBe(false);
    expect(snapshot.state.isStreaming).toBe(false);
    expect(turn).toBe(2);
    expect(snapshot.state.sessionFile).toBeTruthy();
    const history = await readFile(snapshot.state.sessionFile!, "utf8");
    expect(history).toContain("INITIAL_RESULT");
    expect(history).toContain('"type":"compaction"');
    await expect(fixture.window.getByText("已压缩 1 次", { exact: true })).toBeVisible();
    await fixture.window.screenshot({ path: testInfo.outputPath("automatic-compaction.png"), animations: "disabled" });
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("selects a Skill with the keyboard, sends with Enter and copies its invocation without expanded instructions", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo);
  const { window } = fixture;
  try {
    await fixture.openChat();
    const input = window.getByLabel("给 Pi 的消息");
    await input.fill("/技能");
    await expect(window.getByRole("option", { name: /e2e-enter-skill/ })).toBeVisible();
    // Pi also discovers user-wide Skills. Select by identity, never global list order.
    await input.fill("/skill:e2e-enter");
    await input.press("ArrowDown");
    await input.press("Tab");
    await expect(input).toHaveValue("/skill:e2e-enter-skill ");
    await input.pressSequentially("验证 Enter 发送");
    await input.press("Enter");
    const skill = window.locator(".skill-invocation");
    await expect(skill.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    await expect(window.getByText("验证 Enter 发送", { exact: true })).toBeVisible();
    await expect(window.getByText("E2E_SKILL_BODY_SHOULD_STAY_COLLAPSED", { exact: true })).toHaveCount(0);
    await expect(window.locator(".message--assistant").last()).toContainText("OK", { timeout: 30_000 });
    await expect(input).toHaveValue("");
    expect(JSON.stringify(fixture.requests)).toContain("E2E_SKILL_BODY_SHOULD_STAY_COLLAPSED");
    await window.locator(".message--user").getByRole("button", { name: "复制", exact: true }).click();
    await expect.poll(() => fixture.app.evaluate(({ clipboard }) => clipboard.readText())).toBe("/skill:e2e-enter-skill 验证 Enter 发送");
    await skill.getByRole("button").click();
    await expect(window.getByText("E2E_SKILL_BODY_SHOULD_STAY_COLLAPSED", { exact: true })).toBeVisible();
    await window.screenshot({ path: testInfo.outputPath("native-skill-expanded.png"), animations: "disabled" });
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("runs a real multi-tool file task, previews artifacts and preserves reading position across sessions and layout changes", async ({}, testInfo) => {
  let turn = 0;
  let projectDir = "";
  const fixture = await nativeFixture(testInfo, (request, response) => {
    turn += 1;
    if (turn === 1) return protocolReply(response, request.model, "", { id: "read-source", name: "read", args: { path: "README.md" } });
    if (turn === 2) return protocolReply(response, request.model, "", { id: "write-report", name: "write", args: { path: "analysis.md", content: "# Verified report\n\nThis is verifiable source evidence.\n\n| Check | Result |\n| --- | --- |\n| Native tools | Passed |\n" } });
    if (turn === 3) return protocolReply(response, request.model, "", { id: "write-html", name: "write", args: { path: "index.html", content: '<!doctype html><html><body><h1>Verified HTML report</h1><p>Real local file tool output.</p></body></html>' } });
    const paragraphs = Array.from({ length: 45 }, (_, index) => `### 阅读段落 ${index + 1}\n\n已通过真实 Pi 文件工具读取资料、生成 Markdown 和 HTML。测试模型响应是确定性协议夹具，不代表真实大模型推理质量。`).join("\n\n");
    protocolReply(response, request.model, `${paragraphs}\n\n产物：\n\n- ${join(projectDir, "analysis.md")}\n- ${join(projectDir, "index.html")}\n\nMULTISTEP_COMPLETE`);
  });
  projectDir = fixture.projectDir;
  const { window } = fixture;
  try {
    await fixture.openChat();
    await window.setViewportSize({ width: 1440, height: 960 });
    const input = window.getByLabel("给 Pi 的消息");
    await input.fill("阅读资料并生成报告，验证文件工具和阅读体验");
    await input.press("Enter");
    await expect(window.locator(".message--assistant").last()).toContainText("MULTISTEP_COMPLETE", { timeout: 45_000 });
    await expect(window.getByLabel("已完成", { exact: true })).toHaveCount(3);
    expect(turn).toBe(4);
    expect(await readFile(join(projectDir, "analysis.md"), "utf8")).toContain("verifiable source evidence");
    expect(await readFile(join(projectDir, "index.html"), "utf8")).toContain("Verified HTML report");

    const scroll = window.getByRole("region", { name: "会话消息" });
    await expect.poll(() => scroll.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4);
    await window.getByRole("button", { name: `预览文件 ${join(projectDir, "analysis.md")}`, exact: true }).click();
    await expect(window.getByRole("region", { name: "预览 analysis.md", exact: true })).toContainText("Verified report");
    const options = await window.getByLabel("切换会话文件").locator("option").allTextContents();
    const htmlOption = options.find((option) => option.includes("index.html"));
    if (!htmlOption) throw new Error("HTML artifact missing from session file picker");
    await window.getByLabel("切换会话文件").selectOption({ label: htmlOption });
    await expect(window.frameLocator('iframe[title="index.html HTML 预览"]').getByRole("heading", { name: "Verified HTML report" })).toBeVisible();
    await window.getByRole("button", { name: "关闭检查器" }).click();

    await scroll.hover();
    await window.mouse.wheel(0, -100_000);
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(4);
    await expect(window.getByRole("button", { name: "回到最新消息" })).toBeVisible();
    await window.mouse.wheel(0, 720);
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(400);
    const readingPosition = await scroll.evaluate((element) => element.scrollTop);
    await window.setViewportSize({ width: 1050, height: 780 });
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(400);
    await window.getByRole("button", { name: "打开侧栏", exact: true }).click();
    await window.locator(".sidebar").getByRole("button", { name: /新建会话/ }).click();
    await expect(window.locator(".sidebar")).toHaveAttribute("aria-hidden", "true");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(window.locator(".message--assistant")).toHaveCount(0);
    await input.fill("另一个会话的草稿");
    await window.getByRole("button", { name: "打开侧栏", exact: true }).click();
    await window.locator(".sidebar").getByRole("tab", { name: "任务栏", exact: true }).click();
    await window.locator(".sidebar .session-item").filter({ hasText: "阅读资料并生成报告" }).click();
    await expect(window.locator(".message--assistant").last()).toContainText("MULTISTEP_COMPLETE");
    await expect(window.getByLabel("已完成", { exact: true })).toHaveCount(3);
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(readingPosition - 80);
    // Recreate the renderer: persisted anchors and selected artifact must survive,
    // not merely an in-memory Map retained while navigating between pages.
    await window.reload();
    await expect(window.locator(".message--assistant").last()).toContainText("MULTISTEP_COMPLETE");
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(readingPosition - 80);
    await expect(window.getByRole("button", { name: "回到最新消息" })).toBeVisible();
    expect(await window.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("stella.native-session-views")!);
      return JSON.stringify(saved).includes("index.html");
    })).toBe(true);
    await window.getByRole("button", { name: "回到最新消息" }).click();
    await expect.poll(() => scroll.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4);
    await expect(window.getByRole("button", { name: "回到最新消息" })).toHaveCount(0);
    await expect(input).toHaveValue("");
    const box = await input.boundingBox();
    expect(box && box.height > 20 && box.y + box.height <= 780).toBeTruthy();
    await window.screenshot({ path: testInfo.outputPath("native-multistep-narrow.png"), animations: "disabled" });
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});
