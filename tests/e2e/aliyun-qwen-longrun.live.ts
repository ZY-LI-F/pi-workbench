import { createServer } from "node:net";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from "@playwright/test";

const APP_ROOT = resolve(process.cwd());
const LIVE_PROVIDER = process.env.STELLA_LIVE_PROVIDER ?? "aliyun-maas";
const EXPECTED_MODEL_LABEL = process.env.STELLA_QWEN_MODEL_LABEL ?? "Qwen 3.8 Max Preview (Aliyun MaaS)";
const EXPECTED_MODEL_ID = process.env.STELLA_QWEN_MODEL_ID ?? "qwen3.8-max-preview";

const RUNS_CSV = `run_id,scenario,started_at,duration_seconds,input_tokens,output_tokens,retries,status
R001,code_review,2026-07-28T09:00:00Z,112,42000,6800,0,success
R002,document_generation,2026-07-28T10:00:00Z,248,68000,15200,1,success
R003,data_analysis,2026-07-28T11:00:00Z,305,91000,18400,0,success
R004,code_review,2026-07-28T13:00:00Z,126,45000,7200,0,success
R005,document_generation,2026-07-28T14:00:00Z,410,74000,12600,2,failed
R006,data_analysis,2026-07-28T15:00:00Z,287,88000,17200,1,success
R007,code_review,2026-07-29T09:00:00Z,119,43800,6900,0,success
R008,document_generation,2026-07-29T10:00:00Z,263,70500,16100,0,success
R009,data_analysis,2026-07-29T11:00:00Z,332,95500,19600,1,success
R010,code_review,2026-07-29T13:00:00Z,138,47200,7600,1,success
R011,document_generation,2026-07-29T14:00:00Z,276,71600,15800,0,success
R012,data_analysis,2026-07-29T15:00:00Z,520,102000,11100,3,failed
R013,code_review,2026-07-30T09:00:00Z,107,40700,6500,0,success
R014,document_generation,2026-07-30T10:00:00Z,255,69300,15400,1,success
R015,data_analysis,2026-07-30T11:00:00Z,298,90600,18100,0,success
R016,code_review,2026-07-30T13:00:00Z,131,46100,7400,0,success
R017,document_generation,2026-07-30T14:00:00Z,284,72900,16600,1,success
R018,data_analysis,2026-07-30T15:00:00Z,319,93200,18900,1,success
R019,code_review,2026-07-31T09:00:00Z,144,48900,7800,1,success
R020,document_generation,2026-07-31T10:00:00Z,269,70800,15900,0,success
R021,data_analysis,2026-07-31T11:00:00Z,341,97800,20100,2,success
R022,code_review,2026-07-31T13:00:00Z,116,42600,6700,0,success
R023,document_generation,2026-07-31T14:00:00Z,292,75200,17100,1,success
R024,data_analysis,2026-07-31T15:00:00Z,310,91800,18300,0,success
`;

const INCIDENTS_JSON = `${JSON.stringify([
  { incident_id: "I-001", run_id: "R005", category: "provider_timeout", severity: "high", recovered: false, note: "第三次工具调用后上游连接超时" },
  { incident_id: "I-002", run_id: "R006", category: "rate_limit", severity: "medium", recovered: true, note: "一次退避重试后恢复" },
  { incident_id: "I-003", run_id: "R010", category: "tool_retry", severity: "low", recovered: true, note: "文件读取重试后成功" },
  { incident_id: "I-004", run_id: "R012", category: "protocol_error", severity: "high", recovered: false, note: "超长协议记录导致运行终止" },
  { incident_id: "I-005", run_id: "R021", category: "rate_limit", severity: "medium", recovered: true, note: "两次退避重试后恢复" },
], null, 2)}\n`;

const ACCEPTANCE_MD = `# 多步长稳定性分析验收标准

仅分析本目录提供的合成数据，不读取项目目录外的数据。

## 计算

1. 总运行数、成功数、失败数、总体成功率。
2. duration_seconds 的平均值、P50、P95；P95 使用 nearest-rank 口径并明确公式。
3. 输入、输出及合计 Token；报告换算成 M，保留 4 位小数。
4. 总重试次数、发生过重试的运行数、重试后成功的运行数。
5. 按 scenario 输出运行数、成功率、平均时长、P95 时长和平均重试次数。
6. 合并 incidents.json，计算事件数、恢复率及 high 严重性未恢复事件。

## summary.json 固定结构

必须包含：

- overall.totalRuns / successfulRuns / failedRuns / successRate / verdict
- overall.durationSeconds.mean / p50 / p95
- overall.tokens.input / output / total / inputM / outputM / totalM
- overall.retries.total / runsWithRetries / successfulAfterRetry
- scenarios 数组，每项包含 scenario / runs / successRate / meanDurationSeconds / p95DurationSeconds / meanRetries
- incidents.total / recovered / recoveryRate / unrecoveredHighSeverity

比例使用 0 到 1 的 number；M 字段是保留 4 位小数的 number。

## 交付物

- analyze.mjs：仅使用 Node.js 标准库，确定性生成 summary.json。
- stability-report.md：口径、总体结论、分场景表、事件、限制、明确判定。
- dashboard.html：单文件、无网络依赖，显示 KPI、分场景表和事件表。
- verify.mjs：不得导入 analyze.mjs，独立复核全部关键指标；不一致时非零退出。
- verification.md：实际命令、退出码、复核结果、上述输出文件 SHA-256。

## 判定

- PASS：成功率 >= 95%，且不存在 high 未恢复事件。
- CONDITIONAL：成功率 >= 90%，但存在 high 未恢复事件。
- FAIL：成功率 < 90%。

不允许删除失败样本、改写输入或伪造命令结果。
`;

interface RuntimeSample {
  readonly elapsedMs: number;
  readonly sessionId: string;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly messageCount: number;
  readonly pendingMessageCount: number;
  readonly totalTokens: number;
  readonly composerInsideViewport: boolean;
}

interface TurnResult {
  readonly sessionId: string;
  readonly messageCount: number;
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly navigationRoundTrip: boolean;
}

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePort);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配稳定性测试 Webhook 端口");
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function prepareProject(testInfo: TestInfo): Promise<{ readonly project: string; readonly userData: string }> {
  const project = testInfo.outputPath("qwen-longrun-project");
  const input = join(project, "input");
  const userData = testInfo.outputPath("electron-user-data");
  await Promise.all([mkdir(input, { recursive: true }), mkdir(userData, { recursive: true })]);
  await Promise.all([
    writeFile(join(input, "runs.csv"), RUNS_CSV, "utf8"),
    writeFile(join(input, "incidents.json"), INCIDENTS_JSON, "utf8"),
    writeFile(join(input, "acceptance.md"), ACCEPTANCE_MD, "utf8"),
    writeFile(join(project, "README.md"), "# Qwen 3.8 Preview long-run stability fixture\n", "utf8"),
    writeFile(join(userData, "stella-state.json"), `${JSON.stringify({
      lastProject: project,
      recentProjects: [{ path: project, trusted: true, lastOpened: new Date().toISOString() }],
    }, null, 2)}\n`, "utf8"),
  ]);
  return Object.freeze({ project, userData });
}

async function launchLongRunApp(
  testInfo: TestInfo,
): Promise<{ readonly electronApp: ElectronApplication; readonly window: Page; readonly project: string; readonly clearCredentials: () => Promise<void> }> {
  const { project, userData } = await prepareProject(testInfo);
  const sourceAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const isolatedAgentDir = testInfo.outputPath("pi-agent-live");
  await mkdir(isolatedAgentDir, { recursive: true });
  const privateCopies = ["auth.json", "models.json", "models-store.json"].map((name) => join(isolatedAgentDir, name));
  const clearCredentials = async () => { await Promise.all(privateCopies.map((path) => rm(path, { force: true }))); };
  try {
    await copyFile(join(sourceAgentDir, "models.json"), privateCopies[1]!);
    await copyFile(join(sourceAgentDir, "auth.json"), privateCopies[0]!);
    await writeFile(join(isolatedAgentDir, "settings.json"), JSON.stringify({ defaultProvider: LIVE_PROVIDER, defaultModel: EXPECTED_MODEL_ID }));
  } catch (cause) { await clearCredentials(); throw cause; }
  let electronApp: ElectronApplication;
  try {
  electronApp = await electron.launch({
    args: [APP_ROOT, `--user-data-dir=${userData}`],
    cwd: project,
    env: Object.freeze({ ...process.env, PI_CODING_AGENT_DIR: isolatedAgentDir, STELLA_WEBHOOK_PORT: String(await availableLoopbackPort()), STELLA_COMPANION_PORT: String(await availableLoopbackPort()) }),
  });
  } catch (cause) { await clearCredentials(); throw cause; }
  try {
  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await expect(window.locator(".app-shell, .startup-screen--error")).toBeVisible({ timeout: 45_000 });
  const startupError = window.locator(".startup-screen--error");
  if (await startupError.isVisible()) throw new Error(`Qwen 长测启动失败：\n${await startupError.innerText()}`);
  await expect.poll(
    () => window.evaluate(() => window.stella.capabilities().then((health) => health.pi.state)),
    { timeout: 60_000 },
  ).toBe("ready");
  await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
  return Object.freeze({ electronApp, window, project, clearCredentials });
  } catch (cause) {
    try { await electronApp.close(); } finally { await clearCredentials(); }
    throw cause;
  }
}

async function runtimeState(window: Page) {
  return window.evaluate(async () => {
    const [state, stats] = await Promise.all([
      window.stella.command({ type: "get_state" }),
      window.stella.command({ type: "get_session_stats" }),
    ]);
    if (!state.success || !("data" in state)) throw new Error(state.success ? "get_state 缺少 data" : state.error);
    if (!stats.success || !("data" in stats)) throw new Error(stats.success ? "get_session_stats 缺少 data" : stats.error);
    const composer = document.querySelector<HTMLElement>(".composer-wrap");
    const bounds = composer?.getBoundingClientRect();
    const composerInsideViewport = Boolean(bounds
      && bounds.width > 0
      && bounds.height > 0
      && bounds.top >= 0
      && bounds.left >= 0
      && bounds.right <= window.innerWidth
      && bounds.bottom <= window.innerHeight);
    return Object.freeze({
      sessionId: state.data.sessionId,
      isStreaming: state.data.isStreaming,
      isCompacting: state.data.isCompacting,
      messageCount: state.data.messageCount,
      pendingMessageCount: state.data.pendingMessageCount,
      totalTokens: stats.data.tokens.total,
      composerInsideViewport,
    });
  });
}

async function waitForTurn(
  window: Page,
  previousMessageCount: number,
  samples: RuntimeSample[],
  timeoutMs: number,
  exerciseNavigation: boolean,
): Promise<TurnResult> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let sawStreaming = false;
  let navigationRoundTrip = false;
  let expectedSessionId: string | undefined;

  while (Date.now() < deadline) {
    const current = await runtimeState(window);
    expectedSessionId ??= current.sessionId;
    expect(current.sessionId).toBe(expectedSessionId);
    samples.push(Object.freeze({ ...current, elapsedMs: Date.now() - startedAt }));
    sawStreaming ||= current.isStreaming;

    if (exerciseNavigation && sawStreaming && !navigationRoundTrip && Date.now() - startedAt >= 5_000) {
      await window.locator(".sidebar").getByRole("tab", { name: "PI 原生工作台", exact: true }).click();
      await window.locator(".sidebar").getByRole("button", { name: "模型配置", exact: true }).click();
      await expect(window.getByRole("heading", { name: "模型配置" })).toBeVisible();
      await window.locator(".sidebar").getByRole("button", { name: "当前会话", exact: true }).click();
      await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
      const afterNavigation = await runtimeState(window);
      expect(afterNavigation.sessionId).toBe(expectedSessionId);
      expect(afterNavigation.composerInsideViewport).toBe(true);
      navigationRoundTrip = true;
    }

    const completed = !current.isStreaming
      && !current.isCompacting
      && current.pendingMessageCount === 0
      && current.messageCount >= previousMessageCount + 2;
    if ((sawStreaming || current.messageCount >= previousMessageCount + 2) && completed) {
      const modelError = await window.evaluate(async () => {
        const response = await window.stella.command({ type: "get_messages" });
        if (!response.success) throw new Error(response.error);
        if (response.command !== "get_messages") throw new Error("Unexpected get_messages response");
        const assistant = response.data.messages.filter((message) => message.role === "assistant").at(-1);
        return assistant?.role === "assistant" ? assistant.errorMessage : undefined;
      });
      if (modelError) throw new Error(`真实模型运行失败：${modelError}`);
      return Object.freeze({
        sessionId: current.sessionId,
        messageCount: current.messageCount,
        totalTokens: current.totalTokens,
        durationMs: Date.now() - startedAt,
        navigationRoundTrip,
      });
    }
    await window.waitForTimeout(3_000);
  }
  throw new Error(`Qwen 多步任务在 ${timeoutMs}ms 内未完成；sawStreaming=${sawStreaming}`);
}

async function sendPrompt(window: Page, prompt: string): Promise<number> {
  const before = await runtimeState(window);
  const composer = window.getByLabel("给 Pi 的消息");
  await expect(composer).toBeVisible();
  await composer.fill(prompt);
  await window.getByRole("button", { name: "发送", exact: true }).click();
  await expect(window.locator(".message--user").last()).toContainText(prompt.slice(0, 28), { timeout: 15_000 });
  return before.messageCount;
}

test("keeps a configured real model multi-step tool task stable across two turns", async ({}, testInfo) => {
  test.setTimeout(1_500_000);
  const { electronApp, window, project, clearCredentials } = await launchLongRunApp(testInfo);
  const pageErrors: string[] = [];
  const samples: RuntimeSample[] = [];
  let unexpectedExit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
  let stderrTail = "";
  window.on("pageerror", (error) => pageErrors.push(error.message));
  electronApp.process().once("exit", (code, signal) => { unexpectedExit = Object.freeze({ code, signal }); });
  electronApp.process().stderr?.on("data", (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-32_768);
  });
  const testStartedAt = Date.now();

  try {
    const globalModel = window.getByRole("combobox", { name: "全局模型" });
    const options = await globalModel.locator("option").evaluateAll((elements) => elements.map((element) => ({
      value: (element as HTMLOptionElement).value,
      label: element.textContent?.trim() ?? "",
    })));
    const qwen = options.find((option) => option.value === `${LIVE_PROVIDER}/${EXPECTED_MODEL_ID}`);
    if (!qwen) throw new Error(`没有找到 ${EXPECTED_MODEL_LABEL}；实际模型：${options.map((option) => option.label).join("、")}`);
    await globalModel.selectOption(qwen.value);
    await expect(globalModel).toHaveValue(qwen.value);
    await expect(window.getByLabel("全局运行模型")).toContainText(EXPECTED_MODEL_LABEL);
    await window.getByLabel("思考级别").selectOption("off");
    expect((await runtimeState(window)).composerInsideViewport).toBe(true);

    const firstPrompt = [
      "请执行真实的多步稳定性分析，连续完成全部步骤，不要中途询问。",
      "只允许读写当前项目；不要安装依赖、不要执行 Git、不要改写 input。",
      "不要开启子 Agent，不要调用任何团队委派功能，不要读取项目外的 Skills。由当前 Pi 会话直接执行此隔离测试。",
      "先读取 input/acceptance.md、input/runs.csv、input/incidents.json，并先给出执行计划。",
      "然后校验数据，编写并实际执行 analyze.mjs，生成 summary.json、stability-report.md、dashboard.html。",
      "再编写实现独立的 verify.mjs 并实际执行；不一致必须非零退出。",
      "生成 verification.md，记录真实命令、退出码、复核结果和输出文件 SHA-256。",
      "最后重新读取全部产物，逐项对照验收标准；发现错误就修复并重新执行验证。",
      "最终回复必须报告完成步骤、关键指标、判定、实际耗时和绝对文件路径；错误必须直接暴露。",
    ].join("\n");
    const beforeFirst = await sendPrompt(window, firstPrompt);
    const firstTurn = await waitForTurn(window, beforeFirst, samples, 720_000, true);
    expect(firstTurn.navigationRoundTrip).toBe(true);
    expect(await readFile(join(project, "input", "runs.csv"), "utf8")).toBe(RUNS_CSV);
    expect(await readFile(join(project, "input", "incidents.json"), "utf8")).toBe(INCIDENTS_JSON);

    const requiredOutputs = [
      "analyze.mjs",
      "summary.json",
      "stability-report.md",
      "dashboard.html",
      "verify.mjs",
      "verification.md",
    ];
    for (const output of requiredOutputs) {
      expect((await stat(join(project, output))).size, `${output} 应该是非空文件`).toBeGreaterThan(0);
    }
    const summary = JSON.parse(await readFile(join(project, "summary.json"), "utf8")) as {
      readonly overall?: {
        readonly totalRuns?: number;
        readonly successfulRuns?: number;
        readonly failedRuns?: number;
        readonly successRate?: number;
        readonly verdict?: string;
      };
      readonly incidents?: { readonly total?: number; readonly recovered?: number; readonly recoveryRate?: number };
    };
    expect(summary.overall).toMatchObject({
      totalRuns: 24,
      successfulRuns: 22,
      failedRuns: 2,
      verdict: "CONDITIONAL",
    });
    expect(summary.overall?.successRate).toBeCloseTo(22 / 24, 4);
    expect(summary.incidents).toMatchObject({ total: 5, recovered: 3 });
    expect(summary.incidents?.recoveryRate).toBeCloseTo(3 / 5, 4);
    await expect(window.locator(".message--assistant").last().locator(".assistant-error")).toHaveCount(0);

    const auditNonce = `QWEN38_FOLLOWUP_${Date.now()}`;
    const secondPrompt = [
      `第二阶段同会话回归复核，审计编号：${auditNonce}。`,
      "不要修改 input、summary.json、stability-report.md、dashboard.html、analyze.mjs 或 verify.mjs。",
      "重新读取 runs.csv、incidents.json 与已有交付物，用第三种独立计算过程复核总运行数、Token 合计、nearest-rank P95、成功率和事件恢复率。",
      "把复核公式、实际数值、与 summary.json 的逐项一致性、审计编号和当前时间写入 followup-audit.md。",
      "实际读取 followup-audit.md 后再回复；任何不一致都必须明确报告。",
    ].join("\n");
    const beforeSecond = await sendPrompt(window, secondPrompt);
    const secondTurn = await waitForTurn(window, beforeSecond, samples, 420_000, false);
    expect(secondTurn.sessionId).toBe(firstTurn.sessionId);
    expect(secondTurn.messageCount).toBeGreaterThan(firstTurn.messageCount);
    expect(secondTurn.totalTokens).toBeGreaterThan(firstTurn.totalTokens);
    const followupAudit = await readFile(join(project, "followup-audit.md"), "utf8");
    expect(followupAudit).toContain(auditNonce);
    await expect(window.locator(".message--assistant").last().locator(".assistant-error")).toHaveCount(0);

    const finalRuntime = await runtimeState(window);
    expect(finalRuntime.isStreaming).toBe(false);
    expect(finalRuntime.pendingMessageCount).toBe(0);
    expect(finalRuntime.isCompacting).toBe(false);
    expect(finalRuntime.composerInsideViewport).toBe(true);
    expect(finalRuntime.totalTokens).toBeGreaterThan(0);
    expect(samples.filter((sample) => sample.isStreaming).length).toBeGreaterThan(1);
    expect(samples.every((sample) => sample.composerInsideViewport)).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(unexpectedExit).toBeUndefined();

    const evidence = Object.freeze({
      provider: LIVE_PROVIDER,
      model: qwen,
      sessionId: firstTurn.sessionId,
      totalDurationMs: Date.now() - testStartedAt,
      firstTurn,
      secondTurn,
      finalRuntime,
      samples,
      outputFiles: [...requiredOutputs, "followup-audit.md"],
      pageErrors,
      stderrTail,
    });
    const evidencePath = testInfo.outputPath("native-longrun-evidence.json");
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await window.screenshot({ path: testInfo.outputPath("native-longrun-final.png"), animations: "disabled" });
    await testInfo.attach("native-longrun-evidence.json", {
      body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8"),
      contentType: "application/json",
    });
  } finally {
    try { await electronApp.close(); } finally { await clearCredentials(); }
  }
});
