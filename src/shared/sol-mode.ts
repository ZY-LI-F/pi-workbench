/** Stella owns configuration only; all four mechanisms run inside the official Pi process. */
export const SOL_STATUS_KEY = "stella-sol-mode-v1";
export const SOL_LAUNCH_ENV = "STELLA_SOL_MODE";
export const SOL_UPSTREAM_REVISION = "bd005888b9b8a3fcdb511feb91fc27d3dfa8f2b1";

export interface SolModeConfig {
  readonly enabled: boolean;
  readonly actionFusion: boolean;
  readonly observationPack: boolean;
  readonly evidencePreservingReducer: boolean;
  readonly onlineContextCompact: boolean;
  readonly reducerProvider: string;
  readonly reducerModel: string;
  readonly cacheWriteReadRatio: number;
}
export const DEFAULT_SOL_MODE: SolModeConfig = Object.freeze({
  enabled: false, actionFusion: true, observationPack: true,
  evidencePreservingReducer: false, onlineContextCompact: false,
  reducerProvider: "", reducerModel: "", cacheWriteReadRatio: 1.25,
});
export interface SolModeLaunch {
  readonly id: string;
  readonly config: SolModeConfig;
  readonly keepRecentTokens: number;
}
export interface SolModeActivity {
  readonly time: string;
  readonly mechanism: "runtime" | "fusion" | "observation" | "reducer" | "compaction";
  readonly level: "info" | "warning" | "error";
  readonly message: string;
  readonly tokens?: number;
}
export interface SolModeReport {
  readonly launchId: string;
  readonly sessionId: string;
  readonly phase: "active" | "error";
  readonly features: readonly string[];
  readonly activity: SolModeActivity;
  readonly auxiliaryTokens: number;
}
export interface SolModeSnapshot {
  readonly config: SolModeConfig;
  readonly phase: "disabled" | "loading" | "active" | "error" | "stopped";
  readonly sessionId?: string;
  readonly features: readonly string[];
  readonly auxiliaryTokens: number;
  readonly activities: readonly SolModeActivity[];
  readonly error?: string;
}

export function parseSolModeConfig(value: unknown): SolModeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sol 配置必须是对象");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(DEFAULT_SOL_MODE, key)) throw new Error(`未知 Sol 配置项：${key}`);
  }
  for (const key of ["enabled", "actionFusion", "observationPack", "evidencePreservingReducer", "onlineContextCompact"] as const) {
    if (typeof record[key] !== "boolean") throw new Error(`Sol ${key} 必须是布尔值`);
  }
  for (const key of ["reducerProvider", "reducerModel"] as const) {
    if (typeof record[key] !== "string" || /[\r\n\0]/u.test(record[key])) throw new Error(`Sol ${key} 必须是有效字符串`);
  }
  if (typeof record.cacheWriteReadRatio !== "number" || !Number.isFinite(record.cacheWriteReadRatio) || record.cacheWriteReadRatio <= 0) {
    throw new Error("Sol 缓存写入/读取策略比例必须为正数");
  }
  const config = record as unknown as SolModeConfig;
  if (config.enabled && !config.actionFusion && !config.observationPack && !config.evidencePreservingReducer && !config.onlineContextCompact) {
    throw new Error("开启 Sol 模式至少需要选择一项机制");
  }
  if (config.enabled && config.evidencePreservingReducer && (!config.reducerProvider.trim() || !config.reducerModel.trim())) {
    throw new Error("辅助模型提炼需要选择已有 Pi 模型");
  }
  return Object.freeze({ ...config, reducerProvider: config.reducerProvider.trim(), reducerModel: config.reducerModel.trim() });
}

export function solFeatures(config: SolModeConfig): readonly string[] {
  return config.enabled ? [
    config.actionFusion && "Action Fusion", config.observationPack && "ObservationPack",
    config.evidencePreservingReducer && "EPR", config.onlineContextCompact && "OCC",
  ].filter((value): value is string => typeof value === "string") : [];
}

/** Extension output crosses a process boundary; malformed or stale reports must never mean active. */
export function parseSolModeReport(text: string): SolModeReport {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("Sol 加载回执格式错误");
  const report = value as SolModeReport;
  if (typeof report.launchId !== "string" || typeof report.sessionId !== "string"
    || !["active", "error"].includes(report.phase) || !Array.isArray(report.features)
    || report.features.some((feature) => typeof feature !== "string")
    || !Number.isFinite(report.auxiliaryTokens) || report.auxiliaryTokens < 0
    || !report.activity || typeof report.activity.message !== "string"
    || typeof report.activity.time !== "string" || !Number.isFinite(Date.parse(report.activity.time))
    || !["runtime", "fusion", "observation", "reducer", "compaction"].includes(report.activity.mechanism)
    || !["info", "warning", "error"].includes(report.activity.level)) throw new Error("Sol 加载回执格式错误");
  return report;
}
