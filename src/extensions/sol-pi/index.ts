import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseSolModeConfig, SOL_LAUNCH_ENV, SOL_STATUS_KEY, solFeatures, type SolModeActivity, type SolModeLaunch, type SolModeReport } from "../../shared/sol-mode";
import { createActionFusionExtension } from "./vendor/extensions/action-fusion/index";
import { createObservationPackExtension } from "./vendor/extensions/observation-pack/index";
import { createEvidencePreservingReducerExtension, REDUCER_EVENT_TYPE } from "./vendor/extensions/evidence-preserving-reducer/index";
import { createOnlineContextCompactExtension } from "./vendor/extensions/online-context-compact/index";

export function parseLaunch(raw: string | undefined): SolModeLaunch {
  if (!raw) throw new Error("Sol 扩展仅由 Stella 的显式模式配置加载");
  const value = JSON.parse(raw) as SolModeLaunch;
  if (!value || typeof value.id !== "string" || !value.id || !Number.isSafeInteger(value.keepRecentTokens) || value.keepRecentTokens < 1) {
    throw new Error("Sol 启动配置无效");
  }
  return { ...value, config: parseSolModeConfig(value.config) };
}

export function createStellaSolExtension(launch: SolModeLaunch): (pi: ExtensionAPI) => void {
  return (pi) => {
    const { config } = launch;
    let context: ExtensionContext | undefined;
    let initialized = false;
    let failed = false;
    let auxiliaryTokens = 0;
    let cancelRevision = 0;
    const report = (mechanism: SolModeActivity["mechanism"], message: string, level: SolModeActivity["level"] = "info") => {
      if (!context) return;
      const payload: SolModeReport = { launchId: launch.id, sessionId: context.sessionManager.getSessionId(),
        phase: failed ? "error" : "active", features: failed ? [] : solFeatures(config), auxiliaryTokens,
        activity: { time: new Date().toISOString(), mechanism, level, message } };
      context.ui.setStatus(SOL_STATUS_KEY, JSON.stringify(payload));
    };
    const onControl = (value: unknown) => {
      if (value && typeof value === "object" && "type" in value && value.type === "stella:sol-cancel") {
        cancelRevision += 1;
        report("compaction", "已请求停止：不会由 Sol 发起新的阶段续跑");
      }
    };
    pi.on("session_shutdown", () => { cancelRevision += 1; process.off("message", onControl); });
    const restoreUsage = (ctx: ExtensionContext) => {
      auxiliaryTokens = ctx.sessionManager.getBranch().reduce((total, entry) => {
        if (entry.type !== "custom" || entry.customType !== REDUCER_EVENT_TYPE) return total;
        const data = entry.data as { kind?: string; usage?: { totalTokens?: number } } | undefined;
        const tokens = data?.kind === "provider_response" ? data.usage?.totalTokens : undefined;
        return total + (typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0 ? tokens : 0);
      }, 0);
    };
    pi.on("session_start", async (_event, ctx) => {
      context = ctx;
      process.off("message", onControl);
      process.on("message", onControl);
      restoreUsage(ctx);
      if (!config.enabled) return;
      if (initialized) { report("runtime", "Sol 已随当前会话恢复"); return; }
      initialized = true;
      try {
        const names = [...(config.observationPack ? ["obs_recall"] : []), ...(config.onlineContextCompact ? ["update_plan"] : []),
          ...(config.actionFusion ? ["write", "edit", "bash"] : [])];
        const conflicts = pi.getAllTools().filter((tool) => names.includes(tool.name) && tool.sourceInfo.source !== "builtin");
        if (conflicts.length) throw new Error(`Sol 与已有工具扩展冲突：${conflicts.map((tool) => `${tool.name} (${tool.sourceInfo.path})`).join("、")}。请关闭相应 Sol 机制或移除重复扩展。`);
        if (config.evidencePreservingReducer && !ctx.modelRegistry.find(config.reducerProvider, config.reducerModel)) {
          throw new Error(`Sol 辅助模型不可用：${config.reducerProvider}/${config.reducerModel}`);
        }
        if (config.actionFusion) createActionFusionExtension({
          beforeThenRun: async (command, toolContext) => {
            if (!pi.getActiveTools().includes("bash")) throw new Error("Action Fusion 不能运行命令：当前会话未启用 bash；文件尚未修改。");
            // A fused call is an edit/write event, not a second bash event. Ask before either side effect.
            const accepted = await toolContext.ui.confirm("Sol · 文件修改与命令", `本次会先修改文件，再执行以下命令。此组合操作不会单独触发第三方 bash 工具钩子，请确认命令符合当前项目权限。\n\n${command}`);
            if (!accepted) throw new Error("已取消组合操作；文件和命令均未执行。");
          },
          onActivity: (message, warning) => report("fusion", message, warning ? "warning" : "info"),
        })(pi);
        if (config.observationPack) createObservationPackExtension((message, warning) => report("observation", message, warning ? "warning" : "info"))(pi);
        if (config.evidencePreservingReducer) {
          const observedPi: ExtensionAPI = { ...pi, appendEntry(customType, data) {
            pi.appendEntry(customType, data);
            if (customType !== REDUCER_EVENT_TYPE) return;
            const entry = data as { kind?: string; reason?: string; errorMessage?: string; usage?: { totalTokens?: number } };
            if (entry.kind === "provider_response") {
              const tokens = entry.usage?.totalTokens;
              if (typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0) auxiliaryTokens += tokens;
              report("reducer", "辅助模型调用已完成；用量单独统计，费用请以提供商账单为准");
            } else if (entry.kind === "fallback") report("reducer", `未应用提炼，保留原始结果：${entry.reason ?? "未知原因"}${entry.errorMessage ? ` · ${entry.errorMessage}` : ""}`, "warning");
            else if (entry.kind === "applied") report("reducer", "已应用通过原文引文校验的日志提炼；完整原文保存在会话归档中");
          } };
          createEvidencePreservingReducerExtension({ reducerProvider: config.reducerProvider, reducerModel: config.reducerModel,
            onError: (error) => report("reducer", `未应用提炼，保留原始结果：${error}`, "warning") })(observedPi);
        }
        if (config.onlineContextCompact) createOnlineContextCompactExtension({ keepRecentTokens: launch.keepRecentTokens,
          cacheWriteReadRatio: config.cacheWriteReadRatio, cancellationRevision: () => cancelRevision,
          onActivity: (message, warning) => report("compaction", message, warning ? "warning" : "info") })(pi);
        report("runtime", "Sol 已通过官方 Pi 扩展接口加载；不包含第二套 Pi 核心");
      } catch (error) {
        failed = true;
        report("runtime", error instanceof Error ? error.message : String(error), "error");
        throw error;
      }
    });
    pi.on("session_tree", (_event, ctx) => { context = ctx; restoreUsage(ctx); report("runtime", "已恢复当前分支的 Sol 状态"); });
  };
}

export default function stellaSolMode(pi: ExtensionAPI): void {
  createStellaSolExtension(parseLaunch(process.env[SOL_LAUNCH_ENV]))(pi);
}
