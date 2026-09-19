import { useEffect, useState } from "react";
import type { ModelSummary } from "@shared/contracts";
import { DEFAULT_SOL_MODE, parseSolModeConfig, type SolModeConfig, type SolModeSnapshot } from "@shared/sol-mode";
import type { SolModeState } from "../hooks/use-sol-mode";
import "../styles/sol-mode.css";

export interface SolModeSettingProps {
  readonly state: SolModeState;
  readonly models: readonly ModelSummary[];
  readonly runtimeBusy: boolean;
  readonly onApply: (config: SolModeConfig) => void;
}
const PHASE_LABEL: Record<SolModeSnapshot["phase"], string> = {
  disabled: "已关闭 · 原生 Pi", loading: "正在加载", active: "已生效", error: "未生效 · 需要处理", stopped: "等待 Pi 启动",
};

export function SolModeSetting({ state, models, runtimeBusy, onApply }: SolModeSettingProps) {
  const saved = JSON.stringify(state.snapshot?.config ?? DEFAULT_SOL_MODE);
  const [draft, setDraft] = useState<SolModeConfig>(() => JSON.parse(saved) as SolModeConfig);
  useEffect(() => { setDraft(JSON.parse(saved) as SolModeConfig); }, [saved]);
  const dirty = JSON.stringify(draft) !== saved;
  let validation = "";
  try { parseSolModeConfig(draft); } catch (cause) { validation = cause instanceof Error ? cause.message : String(cause); }
  const disabled = state.busy || runtimeBusy;
  const toggle = (key: "enabled" | "actionFusion" | "observationPack" | "evidencePreservingReducer" | "onlineContextCompact", label: string, detail: string) => <label className="sol-setting__option">
    <span><strong>{label}</strong><small>{detail}</small></span>
    <input type="checkbox" role="switch" aria-label={label} checked={draft[key]} disabled={state.busy} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} />
  </label>;
  const selection = JSON.stringify([draft.reducerProvider, draft.reducerModel]);
  const selectedAvailable = models.some((model) => model.provider === draft.reducerProvider && model.id === draft.reducerModel);
  const snapshot = state.snapshot;
  return <section className="settings-section sol-setting" aria-label="Sol 模式">
    <div className="settings-section__heading"><span>Sol 模式</span><small role="status" className={`sol-setting__status is-${snapshot?.phase ?? "loading"}`}>{snapshot ? PHASE_LABEL[snapshot.phase] : "正在读取"}</small></div>
    <p>NVIDIA SoL-Pi 的可选优化扩展，运行在 GUI 内置的同一套官方 Pi 中。仅影响原生会话，不改变 Team、模型密钥或本机命令行安装。</p>
    {toggle("enabled", "启用 Sol 模式", "保存并重新加载后生效。可随时在空闲时关闭，原始会话保留。")}
    {draft.enabled && <div className="sol-setting__features">
      {toggle("actionFusion", "Action Fusion · 合并操作", "允许改文件后直接执行检查命令。组合执行前需要确认；命令失败仍保留已完成的文件修改。")}
      {toggle("observationPack", "ObservationPack · 日志按需召回", "大段工具输出先完整发送两次，再投影为可召回引用；不改写原始 JSONL。原文存于会话目录 sol-pi 文件夹，请一起备份。")}
      <details open={draft.evidencePreservingReducer || draft.onlineContextCompact || undefined}>
        <summary>高级机制 · 辅助模型与阶段压缩</summary>
        {toggle("evidencePreservingReducer", "EPR · 辅助模型提炼", "将符合条件的构建/测试日志发送给所选辅助模型，会产生额外调用与费用。通过原文引文校验后才使用提炼结果；失败保留原结果并显示原因。")}
        {draft.evidencePreservingReducer && <label className="sol-setting__field"><span>辅助模型 · 使用现有 Pi 凭据</span><select aria-label="Sol 辅助模型" value={selectedAvailable ? selection : ""} disabled={state.busy} onChange={(event) => {
          const [provider, model] = JSON.parse(event.target.value) as [string, string];
          setDraft({ ...draft, reducerProvider: provider, reducerModel: model });
        }}><option value="" disabled>{draft.reducerModel ? `不可用：${draft.reducerProvider}/${draft.reducerModel}` : "选择辅助模型"}</option>
          {models.map((model) => <option key={JSON.stringify([model.provider, model.id])} value={JSON.stringify([model.provider, model.id])}>{model.name} · {model.provider}</option>)}
        </select>{!models.length && <small>暂无可用模型，请先在模型配置页配置并测试连接。</small>}</label>}
        {toggle("onlineContextCompact", "OCC · 阶段压缩与续跑", "增加 update_plan 工具，在合适的阶段边界调用 Pi 原生压缩后继续任务。仍保留原生自动压缩，点击停止不会重新发起续跑。")}
        {draft.onlineContextCompact && <label className="sol-setting__field"><span>缓存写入 / 读取策略比例（非实测费用）</span><input aria-label="Sol 缓存策略比例" type="number" min="0.01" step="0.05" disabled={state.busy} value={draft.cacheWriteReadRatio} onChange={(event) => setDraft({ ...draft, cacheWriteReadRatio: Number(event.target.value) })} /><small>OCC 使用 Pi 实际保留尾部大小与合法压缩边界。该比例用于判断时机，不承诺节省金额。</small></label>}
      </details>
    </div>}
    {snapshot?.phase === "active" && <p className="sol-setting__effective">当前加载：{snapshot.features.join(" · ")}<br />本分支辅助模型：{(snapshot.auxiliaryTokens / 1_000_000).toFixed(4)} M tokens · 金额未知，以提供商账单为准</p>}
    {runtimeBusy && <p role="status">Pi 正在运行、压缩或处理队列。可以编辑设置；请等待空闲后应用，不会打断任务。</p>}
    {(state.error || snapshot?.error) && <p className="sol-setting__error" role="alert">{state.error ?? snapshot?.error}</p>}
    {validation && <p className="sol-setting__error" role="alert">{validation}</p>}
    <div className="sol-setting__actions"><button className="button-primary" type="button" disabled={disabled || !!validation || !snapshot || (!dirty && snapshot.phase !== "error" && snapshot.phase !== "stopped")} onClick={() => onApply(draft)}>{state.busy ? "正在应用并确认加载…" : "应用 Sol 设置"}</button>{dirty && <small>有未应用更改</small>}</div>
    {!!snapshot?.activities.length && <details className="sol-setting__activity"><summary>本次运行记录 · 最近 {snapshot.activities.length} 条</summary><ol>{[...snapshot.activities].reverse().map((activity, index) => <li key={`${activity.time}-${index}`} className={`is-${activity.level}`}><time>{new Date(activity.time).toLocaleTimeString()}</time><span>{activity.message}</span></li>)}</ol></details>}
    <small>此开关只管理 Stella 内置的 Sol 扩展。自行安装的第三方 SoL 或同名工具扩展需单独管理；冲突会明确报错。</small>
  </section>;
}
