import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_SOL_MODE } from "../../src/shared/sol-mode";
import { nativeFixture, protocolReply } from "./helpers/native-fixture";
import type { ProtocolRequest } from "./helpers/native-fixture";

function messageText(request: ProtocolRequest): string {
  return request.messages.map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n");
}

test("a first-run workspace can enable and disable Sol before choosing any model", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo, undefined, {}, async ({ agentDir }) => {
    for (const name of ["models.json", "auth.json", "settings.json"]) await writeFile(join(agentDir, name), "{}");
  });
  try {
    const before = await fixture.window.evaluate(() => window.stella.refresh());
    expect(before.state.model?.api).toBe("unknown");
    const active = await fixture.window.evaluate((config) => window.stella.solModeApply(config), { ...DEFAULT_SOL_MODE, enabled: true });
    expect(active.phase).toBe("active");
    const after = await fixture.window.evaluate(() => window.stella.refresh());
    expect(after.state.sessionId).toBe(before.state.sessionId);
    expect(after.state.model).toEqual(before.state.model);
    expect((await fixture.window.evaluate((config) => window.stella.solModeApply(config), DEFAULT_SOL_MODE)).phase).toBe("disabled");
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.requests).toHaveLength(0);
  } finally { await fixture.close(); }
});

test("a saved Sol startup failure leaves settings available for explicit recovery", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo, undefined, {}, async ({ userDataDir }) => {
    await writeFile(join(userDataDir, "sol-mode.json"), JSON.stringify({ ...DEFAULT_SOL_MODE, enabled: true,
      evidencePreservingReducer: true, reducerProvider: "missing-provider", reducerModel: "missing-model" }));
  });
  try {
    await expect.poll(() => fixture.window.evaluate(() => window.stella.solModeGet().then((state) => state.phase))).toBe("error");
    await fixture.window.getByRole("button", { name: "偏好设置", exact: true }).click();
    const setting = fixture.window.getByRole("region", { name: "Sol 模式", exact: true });
    await expect(setting.getByRole("alert")).toContainText("辅助模型不可用");
    await setting.getByRole("switch", { name: "启用 Sol 模式", exact: true }).click();
    await setting.getByRole("button", { name: "应用 Sol 设置", exact: true }).click();
    await expect(setting.getByRole("status")).toHaveText("已关闭 · 原生 Pi", { timeout: 30_000 });
    await fixture.window.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await expect(fixture.window.getByLabel("给 Pi 的消息")).toBeVisible();
    await fixture.window.getByLabel("给 Pi 的消息").fill("明确关闭失败扩展后验证恢复");
    await fixture.window.getByLabel("给 Pi 的消息").press("Enter");
    await expect(fixture.window.locator(".message--assistant").last()).toContainText("OK");
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("conflicting tools fail visibly and disabling Sol recovers the original empty session", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo, undefined, {}, async ({ agentDir }) => {
    const directory = join(agentDir, "extensions");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "custom-write.ts"), 'import { Type } from "typebox"; export default function(pi) { pi.registerTool({ name: "write", label: "custom write", description: "conflict fixture", parameters: Type.Object({}), async execute() { throw new Error("should not execute"); } }); }');
  });
  try {
    await fixture.openChat();
    const before = await fixture.window.evaluate(() => window.stella.refresh());
    const result = await fixture.window.evaluate(async (config) => {
      try { await window.stella.solModeApply(config); return "unexpected success"; } catch (error) { return String(error); }
    }, { ...DEFAULT_SOL_MODE, enabled: true });
    expect(result).toContain("工具扩展冲突");
    expect((await fixture.window.evaluate(() => window.stella.solModeGet())).phase).toBe("error");
    await fixture.window.evaluate((config) => window.stella.solModeApply(config), DEFAULT_SOL_MODE);
    const recovered = await fixture.window.evaluate(() => window.stella.refresh());
    expect(recovered.state.sessionId).toBe(before.state.sessionId);
    expect(recovered.messages).toEqual([]);
    expect((await fixture.window.evaluate(() => window.stella.solModeGet())).phase).toBe("disabled");
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("Sol setting loads the extension in the same Pi and disables it without losing session or draft", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo, (request, response) => protocolReply(response, request.model, "SOL_SESSION_PRESERVED"));
  const { window } = fixture;
  try {
    await fixture.openChat();
    const input = window.getByLabel("给 Pi 的消息");
    await input.fill("保留这段会话，测试 Sol 模式切换");
    await input.press("Enter");
    await expect(window.locator(".message--assistant").last()).toContainText("SOL_SESSION_PRESERVED");
    await expect.poll(() => window.evaluate(async () => (await window.stella.refresh()).state.isStreaming)).toBe(false);
    const before = await window.evaluate(() => window.stella.refresh());
    await input.fill("未发送草稿 / attachment state must survive");
    await window.getByRole("button", { name: "偏好设置", exact: true }).click();
    const setting = window.getByRole("region", { name: "Sol 模式", exact: true });
    await expect(setting).toContainText("已关闭 · 原生 Pi");
    await setting.getByRole("switch", { name: "启用 Sol 模式", exact: true }).click();
    await setting.getByRole("button", { name: "应用 Sol 设置", exact: true }).click();
    await expect(setting.getByRole("status")).toHaveText("已生效", { timeout: 30_000 });
    const active = await window.evaluate(() => window.stella.solModeGet());
    expect(active.features).toEqual(["Action Fusion", "ObservationPack"]);
    const after = await window.evaluate(() => window.stella.refresh());
    expect(after.state.sessionId).toBe(before.state.sessionId);
    expect(after.state.model?.id).toBe(before.state.model?.id);
    expect(after.messages).toEqual(before.messages);
    await setting.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await window.screenshot({ path: testInfo.outputPath("sol-settings-active.png") });
    await window.setViewportSize({ width: 900, height: 720 });
    expect(await setting.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const toggle = setting.getByRole("switch", { name: "启用 Sol 模式", exact: true });
    await toggle.focus(); await toggle.press("Space");
    const apply = setting.getByRole("button", { name: "应用 Sol 设置", exact: true });
    await apply.focus(); await apply.press("Enter");
    await expect(setting.getByRole("status")).toHaveText("已关闭 · 原生 Pi", { timeout: 30_000 });
    await window.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await expect(input).toHaveValue("未发送草稿 / attachment state must survive");
    expect((await window.evaluate(() => window.stella.refresh())).state.sessionId).toBe(before.state.sessionId);
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("Action Fusion confirms before mutation, exposes command failures, and rejects reconfiguration while busy", async ({}, testInfo) => {
  let turn = 0;
  const fixture = await nativeFixture(testInfo, (request, response) => {
    turn += 1;
    if (turn === 1) return protocolReply(response, request.model, "", { id: "denied", name: "write", args: { path: "denied.txt", content: "must not exist", then_run: { command: "printf NEVER" } } });
    if (turn === 2) {
      expect(messageText(request)).toContain("已取消组合操作");
      return protocolReply(response, request.model, "", { id: "accepted", name: "write", args: { path: "accepted.txt", content: "saved", then_run: { command: "printf SOL_FUSED_OK" } } });
    }
    if (turn === 3) {
      expect(messageText(request)).toContain("[then_run:succeeded]");
      return protocolReply(response, request.model, "", { id: "failed", name: "write", args: { path: "kept.txt", content: "keep despite command failure", then_run: { command: "exit 7" } } });
    }
    expect(messageText(request)).toContain("[then_run:failed]");
    protocolReply(response, request.model, "SOL_FUSION_VERIFIED");
  }, { compaction: { enabled: false } }, async ({ userDataDir }) => {
    await writeFile(join(userDataDir, "sol-mode.json"), JSON.stringify({ ...DEFAULT_SOL_MODE, enabled: true, observationPack: false }));
  });
  try {
    await fixture.openChat();
    await fixture.window.getByLabel("给 Pi 的消息").fill("验证组合工具的确认和失败保留。");
    await fixture.window.getByLabel("给 Pi 的消息").press("Enter");
    const confirm = fixture.window.getByRole("dialog", { name: "Sol · 文件修改与命令" });
    await expect(confirm).toBeVisible();
    await expect(readFile(join(fixture.projectDir, "denied.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    const rejection = await fixture.window.evaluate(async (config) => {
      try { await window.stella.solModeApply(config); return "unexpected success"; } catch (error) { return String(error); }
    }, DEFAULT_SOL_MODE);
    expect(rejection).toMatch(/正在|等待/u);
    await confirm.getByRole("button", { name: "否", exact: true }).click();
    await expect(confirm).toContainText("SOL_FUSED_OK");
    await confirm.getByRole("button", { name: "确认", exact: true }).click();
    await expect(confirm).toContainText("exit 7");
    await confirm.getByRole("button", { name: "确认", exact: true }).click();
    await expect(fixture.window.locator(".message--assistant").last()).toContainText("SOL_FUSION_VERIFIED");
    expect(await readFile(join(fixture.projectDir, "accepted.txt"), "utf8")).toBe("saved");
    expect(await readFile(join(fixture.projectDir, "kept.txt"), "utf8")).toBe("keep despite command failure");
    await expect(readFile(join(fixture.projectDir, "denied.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fixture.window.evaluate(() => window.stella.solModeGet())).phase).toBe("active");
    expect(fixture.providerErrors).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

for (const valid of [true, false]) test(`EPR ${valid ? "verifies quotes" : "rejects invented evidence"} using Pi-managed model calls and records separate usage`, async ({}, testInfo) => {
  let mainTurn = 0; let reducerCalls = 0;
  const log = `${"build diagnostic evidence\n".repeat(300)}ALL_CHECKS_PASSED\n`;
  const fixture = await nativeFixture(testInfo, (request, response) => {
    const text = messageText(request);
    if (text.includes("lossless test/build output reducer")) {
      reducerCalls += 1;
      const hash = text.match(/source_sha256=([a-f0-9]{64})/u)![1];
      return protocolReply(response, request.model, JSON.stringify({ schema: "sol-pi-evidence-receipt/1", source_sha256: hash, status: "success", uncertain: false,
        evidence: [{ kind: "summary", quote: valid ? "ALL_CHECKS_PASSED" : "THIS_WAS_NOT_IN_THE_LOG" }] }));
    }
    mainTurn += 1;
    if (mainTurn === 1) return protocolReply(response, request.model, "", { id: "run-test", name: "bash", args: { command: "npm test -- --runInBand" } });
    if (valid) expect(text).toContain("sol_pi_evidence_receipt_v1");
    else { expect(text).not.toContain("sol_pi_evidence_receipt_v1"); expect(text).toContain("build diagnostic evidence"); }
    protocolReply(response, request.model, "SOL_EPR_VERIFIED");
  }, { compaction: { enabled: false } }, async ({ projectDir, userDataDir }) => {
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ scripts: { test: "node test-log.cjs" } }));
    await writeFile(join(projectDir, "test-log.cjs"), `process.stdout.write(${JSON.stringify(log)});`);
    await writeFile(join(userDataDir, "sol-mode.json"), JSON.stringify({ ...DEFAULT_SOL_MODE, enabled: true, actionFusion: false, observationPack: false,
      evidencePreservingReducer: true, reducerProvider: "stella-e2e", reducerModel: "stella-e2e-model" }));
  });
  try {
    await fixture.openChat();
    await fixture.window.getByLabel("给 Pi 的消息").fill("运行项目测试并检查日志。");
    await fixture.window.getByLabel("给 Pi 的消息").press("Enter");
    await expect(fixture.window.locator(".message--assistant").last()).toContainText("SOL_EPR_VERIFIED", { timeout: 30_000 });
    expect(reducerCalls).toBe(1);
    const sol = await fixture.window.evaluate(() => window.stella.solModeGet());
    expect(sol.auxiliaryTokens).toBe(500);
    expect(sol.activities.some((entry) => entry.message.includes(valid ? "已应用通过" : "unverifiable-quote"))).toBe(true);
    const session = await fixture.window.evaluate(() => window.stella.refresh());
    const journal = await readFile(session.state.sessionFile!, "utf8");
    expect(journal).toContain('"kind":"provider_response"');
    // An idle configuration restart restores auxiliary usage from the active branch, not zero.
    await fixture.window.evaluate(async () => window.stella.solModeApply((await window.stella.solModeGet()).config));
    expect((await fixture.window.evaluate(() => window.stella.solModeGet())).auxiliaryTokens).toBe(500);
    expect(fixture.providerErrors).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

for (const cancel of [false, true]) test(`OCC calls native compaction and ${cancel ? "does not resurrect a stopped task" : "continues the current task"}`, async ({}, testInfo) => {
  let turn = 0; let summaries = 0; let continuations = 0;
  const fixture = await nativeFixture(testInfo, (request, response) => {
    const text = messageText(request);
    if (text.includes("context summarization assistant")) {
      summaries += 1;
      if (cancel) return;
      return protocolReply(response, request.model, "## Summary\nSOL_PHASE_SUMMARY: phase one verified; continue phase two.");
    }
    turn += 1;
    if (turn === 1) return protocolReply(response, request.model, `SOL_BASELINE\n${"Phase one source evidence. ".repeat(400)}`);
    if (turn <= 3) return protocolReply(response, request.model, "", { id: `plan-${turn}`, name: "update_plan", args: { steps: [
      { id: "1", goal: "verify first phase", status: turn === 2 ? "in_progress" : "completed" },
      { id: "2", goal: "produce output", status: turn === 2 ? "pending" : "in_progress" },
    ], ...(turn === 3 ? { progress: { files_changed: [], verification: ["source checked"], decisions: [] } } : {}) } }, 124_000);
    continuations += 1;
    if (!cancel) expect(text).toContain("SOL_PHASE_SUMMARY");
    protocolReply(response, request.model, cancel ? "SOL_AFTER_STOP" : "SOL_PHASE_CONTINUED");
  }, { compaction: { enabled: false, reserveTokens: 16384, keepRecentTokens: 1 }, retry: { enabled: false } }, async ({ userDataDir }) => {
    await writeFile(join(userDataDir, "sol-mode.json"), JSON.stringify({ ...DEFAULT_SOL_MODE, enabled: true, actionFusion: false, observationPack: false, onlineContextCompact: true }));
  });
  try {
    await fixture.openChat();
    const input = fixture.window.getByLabel("给 Pi 的消息");
    await input.fill("建立可压缩的第一阶段前序上下文"); await input.press("Enter");
    await expect(fixture.window.locator(".message--assistant").last()).toContainText("SOL_BASELINE");
    await expect.poll(() => fixture.window.evaluate(async () => (await window.stella.refresh()).state.isStreaming)).toBe(false);
    await input.fill("更新计划并完成第一阶段，随后继续第二阶段"); await input.press("Enter");
    // A split turn can require both a history summary and a turn-prefix summary.
    await expect.poll(() => summaries, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    if (cancel) {
      expect(await fixture.window.evaluate(() => window.stella.command({ type: "abort" }))).toMatchObject({ success: true });
      await expect.poll(() => fixture.window.evaluate(async () => (await window.stella.solModeGet()).activities
        .some((activity) => activity.message.includes("已请求停止")))).toBe(true);
      await expect.poll(() => fixture.window.evaluate(async () => (await window.stella.refresh()).state.isCompacting)).toBe(false);
      expect(continuations).toBe(0);
      await input.fill("停止后手动开启下一轮"); await input.press("Enter");
      await expect(fixture.window.locator(".message--assistant").last()).toContainText("SOL_AFTER_STOP");
    } else {
      await expect(fixture.window.locator(".message--assistant").last()).toContainText("SOL_PHASE_CONTINUED", { timeout: 30_000 });
      expect(continuations).toBe(1);
      expect((await fixture.window.evaluate(() => window.stella.refresh())).entries.filter((entry) => entry.type === "compaction")).toHaveLength(1);
    }
    expect(fixture.providerErrors).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("ObservationPack keeps original evidence and recalls it through the real Pi tool", async ({}, testInfo) => {
  let turn = 0;
  const evidence = Array.from({ length: 180 }, (_, i) => `SOL_EVIDENCE_${i}: ${"precise source ".repeat(8)}`).join("\n");
  const fixture = await nativeFixture(testInfo, (request, response) => {
    turn += 1;
    if (turn === 1) return protocolReply(response, request.model, "", { id: "read-large", name: "read", args: { path: "large.md" } });
    if (turn <= 3) return protocolReply(response, request.model, "", { id: `small-${turn}`, name: "read", args: { path: "README.md" } });
    if (turn === 4) {
      const projected = request.messages.filter((message) => message.role === "tool").map((message) => String(message.content)).join("\n");
      expect(projected).toContain("large tool result replaced");
      const id = projected.match(/obs_[a-f0-9]{24}/u)?.[0];
      expect(id).toBeTruthy();
      return protocolReply(response, request.model, "", { id: "recall-large", name: "obs_recall", args: { id, offset: 0 } });
    }
    expect(JSON.stringify(request.messages)).toContain("[obs_recall id=");
    protocolReply(response, request.model, "SOL_RECALL_COMPLETE");
  }, { compaction: { enabled: false } }, async ({ projectDir, userDataDir }) => {
    await writeFile(join(projectDir, "large.md"), evidence);
    await writeFile(join(userDataDir, "sol-mode.json"), JSON.stringify({ ...DEFAULT_SOL_MODE, enabled: true, actionFusion: false }));
  });
  try {
    await fixture.openChat();
    await fixture.window.getByLabel("给 Pi 的消息").fill("读取大文件、多次继续，然后按引用召回原文。");
    await fixture.window.getByLabel("给 Pi 的消息").press("Enter");
    await expect(fixture.window.locator(".message--assistant").last()).toContainText("SOL_RECALL_COMPLETE", { timeout: 30_000 });
    expect(turn).toBe(5);
    const state = await fixture.window.evaluate(() => window.stella.refresh());
    expect(await readFile(state.state.sessionFile!, "utf8")).toContain("SOL_EVIDENCE_179");
    expect((await fixture.window.evaluate(() => window.stella.solModeGet())).activities.some((entry) => entry.mechanism === "observation")).toBe(true);
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});
