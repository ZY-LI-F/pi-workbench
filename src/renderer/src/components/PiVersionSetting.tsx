import { RefreshCw } from "lucide-react";
import type { PiVersionState } from "../hooks/use-pi-version";

export interface PiVersionSettingProps {
  readonly state: PiVersionState;
  readonly onCheck: () => void;
  readonly onSync: () => void;
}

export function PiVersionSetting({ state, onCheck, onSync }: PiVersionSettingProps) {
  const { snapshot, busy, error, result } = state;
  return <section className="settings-section pi-version-setting" aria-label="Pi 版本管理">
    <div className="settings-section__heading"><span>Pi 版本管理</span><small>{snapshot ? `GUI v${snapshot.guiVersion}` : "正在读取"}</small></div>
    <dl className="pi-version-setting__versions">
      <div><dt>GUI 内置 Pi · 同步目标</dt><dd>{snapshot ? `v${snapshot.bundledVersion}` : "—"}</dd></div>
      <div><dt>本机命令行 Pi</dt><dd>{snapshot?.localVersion ? `v${snapshot.localVersion}` : snapshot?.status === "missing" ? "未安装" : "未识别"}</dd></div>
    </dl>
    <p>{snapshot?.detail ?? (busy ? "正在查找本机 Pi 与 npm 安装位置…" : "尚未取得检测结果。")}</p>
    {snapshot?.localPath && <small className="pi-version-setting__path">命令位置：{snapshot.localPath}</small>}
    {snapshot?.installPrefix && <small className="pi-version-setting__path">安装目录：{snapshot.installPrefix}</small>}
    <div className="pi-version-setting__actions">
      <button type="button" className="button-secondary" disabled={!!busy} onClick={onCheck}><RefreshCw size={14} className={busy === "checking" ? "spin" : undefined} />{busy === "checking" ? "检查中…" : "检查 Pi 版本"}</button>
      {snapshot?.status === "mismatch" && <button type="button" className="button-primary" disabled={!!busy || !snapshot.canSync} onClick={onSync}>{busy === "syncing" ? "正在确认 / 同步…" : `同步到 v${snapshot.bundledVersion}`}</button>}
    </div>
    <small>启动时自动检查，更新前会询问。这里只同步本机命令行安装；GUI 始终使用随安装包发布的同一套 Pi 核心。</small>
    {busy === "syncing" && <p role="status">请在确认窗口选择是否更新。确认后需下载依赖；完成前请保持 GUI 打开。</p>}
    {error && <p className="pi-version-setting__error" role="alert">{error}</p>}
    {result && <p role="status">{result}</p>}
    <div className="pi-version-setting__sol"><strong>Sol-Pi · 尚未接入</strong><small>目前只有可行性研究，没有可开启的 Sol 模式。本次版本同步不会安装 Sol-Pi，也不会增加第二套 Pi 核心。</small></div>
  </section>;
}

export function PiVersionNotice({ state, onSettings, onDismiss }: { readonly state: PiVersionState; readonly onSettings: () => void; readonly onDismiss: () => void }) {
  return <aside className="pi-version-notice" role="status" aria-label="Pi 版本不一致">
    <strong>是否同步本机 Pi？</strong>
    <p>本机 v{state.snapshot?.localVersion} · GUI 对应 v{state.snapshot?.bundledVersion}。GUI 内置 Pi 可继续正常使用。</p>
    <div><button type="button" className="button-primary" onClick={onSettings}>查看版本并更新</button><button type="button" className="button-secondary" onClick={onDismiss}>暂不更新</button></div>
  </aside>;
}
