import { randomUUID } from "node:crypto";
import { DEFAULT_SOL_MODE, parseSolModeConfig, parseSolModeReport, solFeatures, type SolModeConfig, type SolModeLaunch, type SolModeSnapshot } from "../shared/sol-mode";
import type { JsonFileStorage } from "./atomic-json-file";

export class SolModeService {
  #state: SolModeSnapshot = { config: DEFAULT_SOL_MODE, phase: "disabled", features: [], auxiliaryTokens: 0, activities: [] };
  #launchId: string | undefined;
  #configurationError: string | undefined;
  constructor(readonly storage: JsonFileStorage, readonly emit: (state: SolModeSnapshot) => void) {}
  snapshot(): SolModeSnapshot { return this.#state; }
  async initialize(): Promise<void> {
    try {
      const stored = await this.storage.read();
      const config = stored === undefined ? DEFAULT_SOL_MODE : parseSolModeConfig(stored);
      this.#set({ ...this.#state, config, phase: config.enabled ? "stopped" : "disabled" });
    } catch (error) { this.#configurationError = `Sol 配置读取失败：${String(error)}`; this.fail(this.#configurationError); }
  }
  async configure(value: unknown): Promise<SolModeConfig> {
    const config = parseSolModeConfig(value);
    await this.storage.write(config);
    this.#configurationError = undefined;
    this.#set({ ...this.#state, config });
    return config;
  }
  begin(keepRecentTokens: number): SolModeLaunch {
    if (this.#configurationError) throw new Error(this.#configurationError);
    this.#launchId = randomUUID();
    this.#set({ config: this.#state.config, phase: "loading", features: [], auxiliaryTokens: 0, activities: [] });
    return { id: this.#launchId, config: this.#state.config, keepRecentTokens };
  }
  accept(text: string): void {
    try {
      const report = parseSolModeReport(text);
      if (report.launchId !== this.#launchId || !this.#state.config.enabled) return;
      const expected = solFeatures(this.#state.config);
      if (report.phase === "active" && JSON.stringify(report.features) !== JSON.stringify(expected)) {
        throw new Error("Sol 实际加载机制与配置不一致");
      }
      this.#set({ ...this.#state, phase: report.phase, sessionId: report.sessionId,
        features: report.features, auxiliaryTokens: report.auxiliaryTokens,
        // A display window only, not an execution cap. The Pi journal retains mechanism history.
        activities: [...this.#state.activities, report.activity].slice(-30),
        error: report.phase === "error" ? report.activity.message : undefined });
    } catch (error) { this.fail(String(error)); }
  }
  ready(): void {
    if (!this.#state.config.enabled) {
      this.#set({ ...this.#state, phase: "disabled", features: [], error: undefined });
    } else if (this.#state.phase !== "active") {
      this.fail(this.#state.error ?? "Pi 已启动，但 Sol 未返回加载确认；请检查扩展错误或关闭 Sol 模式后重新应用。");
      throw new Error(this.#state.error);
    }
  }
  stopped(): void {
    this.#launchId = undefined;
    if (this.#state.config.enabled) this.#set({ ...this.#state, phase: "stopped", features: [] });
  }
  fail(error: string): void { this.#set({ ...this.#state, phase: "error", error }); }
  #set(state: SolModeSnapshot): void { this.#state = Object.freeze(state); this.emit(this.#state); }
}
