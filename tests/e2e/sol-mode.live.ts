import { expect, test } from "@playwright/test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SOL_MODE } from "../../src/shared/sol-mode";
import { nativeFixture } from "./helpers/native-fixture";

/** Opt-in paid-model acceptance. No secrets are printed or attached to reports. */
test("real DeepSeek executes a diagnostic task with Sol and a Pi-authenticated auxiliary reducer", async ({}, testInfo) => {
  test.skip(process.env.STELLA_SOL_LIVE !== "1", "Requires explicit live-test opt-in and an existing local Pi provider");
  const provider = process.env.STELLA_SOL_LIVE_PROVIDER ?? "aliyun-maas";
  const model = process.env.STELLA_SOL_LIVE_MODEL ?? "deepseek-v4-flash";
  const existing = process.env.STELLA_SOL_LIVE_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const models = JSON.parse(await readFile(join(existing, "models.json"), "utf8"));
  const auth = JSON.parse(await readFile(join(existing, "auth.json"), "utf8"));
  if (!models.providers?.[provider]?.models?.some((item: { id: string }) => item.id === model)) throw new Error(`Local Pi model not configured: ${provider}/${model}`);
  const fixture = await nativeFixture(testInfo, () => { throw new Error("Live test must not call protocol fixture"); }, {
    defaultProvider: provider, defaultModel: model, compaction: { enabled: false }, retry: { enabled: false },
  }, async ({ agentDir, projectDir, userDataDir }) => {
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { [provider]: models.providers[provider] } }));
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ [provider]: auth[provider] }), { mode: 0o600 });
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ scripts: { test: "node checks.cjs" } }));
    await writeFile(join(projectDir, "checks.cjs"), 'const assert=require("node:assert/strict"); const values=[120.5,80,210,99.5]; assert.equal(values.reduce((a,b)=>a+b,0),510); for(let i=0;i<220;i++) console.log(`verified row ${i}: 4 paid records, exact total 510`); console.log("SOL_LIVE_ASSERTIONS_PASSED total=510 count=4");');
    await writeFile(join(userDataDir, "sol-mode.json"), JSON.stringify({ ...DEFAULT_SOL_MODE, enabled: true, actionFusion: false, evidencePreservingReducer: true, reducerProvider: provider, reducerModel: model }));
  });
  try {
    await fixture.openChat();
    await fixture.window.getByLabel("给 Pi 的消息").fill("这是隔离工作区的 Sol 接入验收。请只做以下事情：1. 用 read 读取 package.json 和 checks.cjs；2. 用 bash 执行 npm test，command 参数必须恰好为 npm test，不要附加管道、重定向、tail、head、grep 或 echo，不要截断日志；测试目的就是让完整日志经过 Sol EPR。不要安装依赖；3. 根据真实命令结果，用 write 生成 sol-result.md，写明加总结果、记录数和实际测试标记。不得更改 checks.cjs/package.json，不联网，不启动其他 Agent。完成后用中文简要汇报。请实际执行，不能只给操作说明。");
    await fixture.window.getByLabel("给 Pi 的消息").press("Enter");
    await expect.poll(async () => {
      const current = await fixture.window.evaluate(() => window.stella.refresh());
      const failed = current.messages.findLast((message) => message.role === "assistant" && message.stopReason === "error");
      if (failed && failed.role === "assistant") throw new Error(`Real model failed: ${failed.errorMessage ?? "unknown provider error"}`);
      try { return await readFile(join(fixture.projectDir, "sol-result.md"), "utf8"); } catch { return ""; }
    }, { timeout: 240_000 }).toContain("SOL_LIVE_ASSERTIONS_PASSED");
    await expect.poll(() => fixture.window.evaluate(async () => (await window.stella.refresh()).state.isStreaming), { timeout: 120_000 }).toBe(false);
    const state = await fixture.window.evaluate(() => window.stella.refresh());
    const sol = await fixture.window.evaluate(() => window.stella.solModeGet());
    expect(sol.phase).toBe("active");
    expect(sol.auxiliaryTokens).toBeGreaterThan(0);
    expect(sol.activities.some((activity) => activity.message.includes("已应用通过"))).toBe(true);
    const result = await readFile(join(fixture.projectDir, "sol-result.md"), "utf8");
    expect(result).toContain("510");
    await testInfo.attach("live-sol-observations", { body: JSON.stringify({ provider, model, sol, stats: state.stats, result }, null, 2), contentType: "application/json" });
    await fixture.window.getByRole("button", { name: "偏好设置", exact: true }).click();
    await fixture.window.getByRole("region", { name: "Sol 模式", exact: true }).scrollIntoViewIfNeeded();
    await fixture.window.screenshot({ path: testInfo.outputPath("sol-real-model.png") });
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    try { await fixture.close(); }
    finally {
      // These are this test's copies, never the user's configured Pi files.
      await Promise.all(["auth.json", "models.json"].map((name) => rm(join(fixture.agentDir, name), { force: true })));
    }
  }
});
