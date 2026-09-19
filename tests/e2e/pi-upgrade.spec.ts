import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import type { BridgeEvent, PiResponse } from "../../src/shared/contracts";
import { nativeFixture, protocolReply } from "./helpers/native-fixture";

type UpgradeTestWindow = Window & {
  upgradeEvents: Extract<BridgeEvent, { source: "pi" }>["payload"][];
  compactOutcome?: Promise<{ response?: PiResponse; error?: string }>;
};

test("compacts a large real tool result before the next assistant request and settles only after continuation", async ({}, testInfo) => {
  let turn = 0;
  const requestKinds: string[] = [];
  const evidence = Array.from({ length: 100 }, (_, index) => `EVIDENCE_${index}: ${"source-data ".repeat(18)}`).join("\n");
  const fixture = await nativeFixture(testInfo, (request, response) => {
    turn += 1;
    const summaryRequest = JSON.stringify(request.messages).includes("context summarization assistant");
    requestKinds.push(summaryRequest ? "summary" : "assistant");
    if (turn === 1) {
      return protocolReply(response, request.model, `BASELINE_READY\n${"Prior context. ".repeat(1_000)}`);
    }
    if (turn === 2) {
      // Reported usage is below the threshold. Only the subsequent real read
      // result pushes context over it; no paid large-context request is made.
      return protocolReply(response, request.model, "", { id: "large-read", name: "read", args: { path: "evidence.md" } }, 112_000);
    }
    if (summaryRequest) {
      expect(request.tools ?? []).toHaveLength(0);
      return protocolReply(response, request.model, "## Summary\nUPGRADE_COMPACTION_SUMMARY: The evidence was read. Continue the user's report task.");
    }
    expect(request.tools?.some((tool) => tool.function.name === "read")).toBe(true);
    protocolReply(response, request.model, "UPGRADE_CONTINUATION_COMPLETE");
  // Keep the entire tool call/result pair and provide an earlier legal summary
  // boundary. A one-token tail cannot cut inside a trailing tool result.
  }, { compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 8_000 }, retry: { enabled: false } }, async ({ projectDir }) => {
    await writeFile(join(projectDir, "evidence.md"), evidence);
  });
  const { window } = fixture;
  try {
    await fixture.openChat();
    const input = window.getByLabel("给 Pi 的消息");
    await input.fill("建立一个可保留的前序对话，随后再读取资料。");
    await input.press("Enter");
    await expect(window.locator(".message--assistant").last()).toContainText("BASELINE_READY");
    await expect.poll(() => window.evaluate(async () => (await window.stella.refresh()).state.isStreaming)).toBe(false);
    await window.evaluate(() => {
      const observed = window as UpgradeTestWindow;
      observed.upgradeEvents = [];
      window.stella.onEvent((event) => { if (event.source === "pi") observed.upgradeEvents.push(event.payload); });
    });
    await input.fill("读取 evidence.md 后完成报告，压缩不能提前结束任务。");
    await input.press("Enter");
    await expect(window.locator(".message--assistant").last()).toContainText("UPGRADE_CONTINUATION_COMPLETE", { timeout: 30_000 });
    await expect.poll(() => window.evaluate(() => (window as UpgradeTestWindow).upgradeEvents.filter((event) => event.type === "agent_settled").length)).toBe(1);
    const events = await window.evaluate(() => (window as UpgradeTestWindow).upgradeEvents.map((event) => event.type));
    const diagnostics = await window.evaluate(() => window.stella.refresh());
    await testInfo.attach("compaction-observations", { body: JSON.stringify({ requestKinds, events, model: diagnostics.state.model, stats: diagnostics.stats, entries: diagnostics.entries }, null, 2), contentType: "application/json" });
    expect(requestKinds).toEqual(["assistant", "assistant", "summary", "assistant"]);
    expect(JSON.stringify(fixture.requests.findLast((request) => request.body)?.body?.messages)).toContain("UPGRADE_COMPACTION_SUMMARY");
    const toolEnd = events.indexOf("tool_execution_end");
    const compactStart = events.indexOf("compaction_start");
    const compactEnd = events.indexOf("compaction_end");
    expect(toolEnd).toBeGreaterThan(-1);
    expect(compactStart).toBeGreaterThan(toolEnd);
    expect(compactEnd).toBeGreaterThan(compactStart);
    expect(events.indexOf("agent_settled")).toBeGreaterThan(compactEnd);
    const snapshot = await window.evaluate(() => window.stella.refresh());
    expect(snapshot.state.isStreaming).toBe(false);
    expect(snapshot.state.isCompacting).toBe(false);
    expect(snapshot.entries.filter((entry) => entry.type === "compaction")).toHaveLength(1);
    expect(turn).toBe(4);
    const history = await readFile(snapshot.state.sessionFile!, "utf8");
    expect(history).toContain("EVIDENCE_99");
    expect(history).toContain("UPGRADE_CONTINUATION_COMPLETE");
    await expect(window.getByText("已压缩 1 次", { exact: true })).toBeVisible();
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("aborts in-flight manual compaction without a false success or a stuck GUI and accepts the next turn", async ({}, testInfo) => {
  let turn = 0;
  const fixture = await nativeFixture(testInfo, (request, response) => {
    turn += 1;
    if (turn === 2) {
      expect(JSON.stringify(request.messages)).toContain("context summarization assistant");
      // Hold the real HTTP request open until Pi's abort cancels it.
      return;
    }
    protocolReply(response, request.model, turn === 1 ? "BEFORE_MANUAL_COMPACTION" : "AFTER_COMPACTION_ABORT");
  }, { compaction: { enabled: false, reserveTokens: 16384, keepRecentTokens: 1 } });
  const { window } = fixture;
  try {
    await fixture.openChat();
    const input = window.getByLabel("给 Pi 的消息");
    await input.fill("保留此消息用于验证压缩取消");
    await input.press("Enter");
    await expect(window.locator(".message--assistant").last()).toContainText("BEFORE_MANUAL_COMPACTION");
    await expect.poll(() => window.evaluate(async () => (await window.stella.refresh()).state.isStreaming)).toBe(false);
    await window.evaluate(() => {
      const observed = window as UpgradeTestWindow;
      observed.upgradeEvents = [];
      window.stella.onEvent((event) => { if (event.source === "pi") observed.upgradeEvents.push(event.payload); });
      observed.compactOutcome = window.stella.command({ type: "compact" }).then(
        (response) => ({ response }), (error: unknown) => ({ error: String(error) }),
      );
    });
    await expect.poll(() => turn).toBe(2);
    expect(await window.evaluate(() => window.stella.command({ type: "abort" }))).toMatchObject({ command: "abort", success: true });
    const outcome = await window.evaluate(() => (window as UpgradeTestWindow).compactOutcome!);
    if (outcome.response) expect(outcome.response).toMatchObject({ success: false, error: expect.stringMatching(/cancel|abort/i) });
    else expect(outcome.error).toMatch(/cancel|abort/i);
    const compactEnd = await window.evaluate(() => (window as UpgradeTestWindow).upgradeEvents.find((event) => event.type === "compaction_end"));
    expect(compactEnd).toMatchObject({ reason: "manual", aborted: true });
    const snapshot = await window.evaluate(() => window.stella.refresh());
    expect(snapshot.state.isCompacting).toBe(false);
    expect(snapshot.entries.filter((entry) => entry.type === "compaction")).toHaveLength(0);
    await input.fill("取消后继续正常对话");
    await input.press("Enter");
    await expect(window.locator(".message--assistant").last()).toContainText("AFTER_COMPACTION_ABORT");
    expect(turn).toBe(3);
    expect(await window.evaluate(() => window.stella.command({ type: "clear_queue" }))).toMatchObject({
      command: "clear_queue", success: true, data: { steering: [], followUp: [] },
    });
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("automatically compacts by message size when the provider omits usage", async ({}, testInfo) => {
  let turn = 0;
  const fixture = await nativeFixture(testInfo, (request, response) => {
    turn += 1;
    protocolReply(response, request.model, turn === 1 ? "MISSING_USAGE_INITIAL" : "## Summary\nKeep the source evidence and user's task.", undefined, null);
  }, { compaction: { enabled: true, reserveTokens: 1024, keepRecentTokens: 1 }, retry: { enabled: false } }, async ({ agentDir }) => {
    const path = join(agentDir, "models.json");
    const models = JSON.parse(await readFile(path, "utf8"));
    const model = models.providers["stella-e2e"].models[0];
    model.contextWindow = 8192;
    model.maxTokens = 1024;
    await writeFile(path, JSON.stringify(models));
  });
  const { window } = fixture;
  try {
    await fixture.openChat();
    const input = window.getByLabel("给 Pi 的消息");
    await input.fill(`请保留以下测试资料。\n${"source evidence ".repeat(2_500)}`);
    await input.press("Enter");
    await expect.poll(() => window.evaluate(async () => (await window.stella.refresh()).entries.filter((entry) => entry.type === "compaction").length), { timeout: 30_000 }).toBe(1);
    const snapshot = await window.evaluate(() => window.stella.refresh());
    expect(snapshot.state.isCompacting).toBe(false);
    expect(snapshot.state.isStreaming).toBe(false);
    const assistant = snapshot.messages.find((message) => message.role === "assistant");
    expect(assistant?.role === "assistant" && assistant.usage?.totalTokens).toBe(0);
    expect(turn).toBe(2);
    const history = await readFile(snapshot.state.sessionFile!, "utf8");
    expect(history).toContain("MISSING_USAGE_INITIAL");
    expect(history).toContain("source evidence");
    await expect(window.getByText("已压缩 1 次", { exact: true })).toBeVisible();
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("clears both native message queues without aborting or replaying the active turn", async ({}, testInfo) => {
  let pending: { response: ServerResponse; model: string } | undefined;
  const fixture = await nativeFixture(testInfo, (request, response) => { pending = { response, model: request.model }; });
  const { window } = fixture;
  try {
    await fixture.openChat();
    const input = window.getByLabel("给 Pi 的消息");
    await input.fill("只运行当前回合");
    await input.press("Enter");
    await expect.poll(() => Boolean(pending)).toBe(true);
    expect(await window.evaluate(() => window.stella.command({ type: "steer", message: "REMOVE_STEERING" }))).toMatchObject({ success: true });
    expect(await window.evaluate(() => window.stella.command({ type: "follow_up", message: "REMOVE_FOLLOWUP" }))).toMatchObject({ success: true });
    expect(await window.evaluate(async () => (await window.stella.refresh()).state.pendingMessageCount)).toBe(2);
    expect(await window.evaluate(() => window.stella.command({ type: "clear_queue" }))).toMatchObject({
      command: "clear_queue", success: true, data: { steering: ["REMOVE_STEERING"], followUp: ["REMOVE_FOLLOWUP"] },
    });
    const during = await window.evaluate(() => window.stella.refresh());
    expect(during.state.isStreaming).toBe(true);
    expect(during.state.pendingMessageCount).toBe(0);
    protocolReply(pending!.response, pending!.model, "ACTIVE_TURN_PRESERVED");
    await expect(window.locator(".message--assistant").last()).toContainText("ACTIVE_TURN_PRESERVED");
    await expect.poll(() => window.evaluate(async () => (await window.stella.refresh()).state.isStreaming)).toBe(false);
    expect(fixture.requests.filter((request) => request.body)).toHaveLength(1);
    const snapshot = await window.evaluate(() => window.stella.refresh());
    expect(JSON.stringify(snapshot.messages)).not.toContain("REMOVE_STEERING");
    expect(JSON.stringify(snapshot.messages)).not.toContain("REMOVE_FOLLOWUP");
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});
