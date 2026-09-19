import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowRight, BookOpen, Check, Copy, ExternalLink, ImagePlus, Keyboard, Monitor, Moon, RefreshCw, RotateCcw, ShieldCheck, ShieldOff, Smartphone, Sun, Unplug } from "lucide-react";
import type { RuntimeBootstrap } from "@shared/contracts";
import type { CompanionGatewayStatus, CompanionPairingOffer } from "@shared/companion-protocol";
import type {
  ConfigurableExecutionBackendId,
  ExecutionBackendCatalogSnapshot,
  ExecutionBackendHealth,
  ExecutionBackendId,
} from "@shared/execution-profile";
import type { SkinArtworkBySkin, SkinId } from "@shared/skin-artwork";
import type { FontSizePreference, Preferences, ThemePreference } from "../hooks/use-preferences";
import { SKIN_OPTIONS, skinDefinition } from "../lib/skins";
import { Modal } from "./Modal";
import { FeatureGuideDialog } from "../features/help/FeatureGuideDialog";
import { PiVersionSetting, type PiVersionSettingProps } from "./PiVersionSetting";
import { SolModeSetting, type SolModeSettingProps } from "./SolModeSetting";

interface SettingsDialogProps {
  readonly piVersion?: PiVersionSettingProps;
  readonly solMode?: SolModeSettingProps;
  readonly bootstrap?: RuntimeBootstrap;
  readonly preferences: Preferences;
  readonly customArtwork: SkinArtworkBySkin;
  readonly artworkBusySkin: SkinId | null;
  readonly executionBackends?: ExecutionBackendCatalogSnapshot;
  readonly executionBackendBusy: readonly ExecutionBackendId[];
  readonly executionBackendError?: string;
  readonly companionStatus?: CompanionGatewayStatus;
  readonly companionOffer?: CompanionPairingOffer;
  readonly companionBusy: boolean;
  readonly companionError?: string;
  readonly onPreferencesChange: (preferences: Preferences) => void;
  readonly onChooseSkinArtwork: (skin: SkinId) => void;
  readonly onResetSkinArtwork: (skin: SkinId) => void;
  readonly onConfigureExecutionBackend: (backendId: ConfigurableExecutionBackendId, executablePath?: string) => void;
  readonly onRetryExecutionBackend: (backendId: ExecutionBackendId) => void;
  readonly onRefreshCompanion: () => void;
  readonly onCreateCompanionOffer: () => void;
  readonly onRevokeCompanionDevice: (deviceId: string) => void;
  readonly onCopyCompanionOffer: (value: string) => void;
  readonly onAutoCompactionChange: (enabled: boolean) => void;
  readonly onSteeringModeChange: (mode: "all" | "one-at-a-time") => void;
  readonly onFollowUpModeChange: (mode: "all" | "one-at-a-time") => void;
  readonly onRestartTrust: (trusted: boolean) => void;
  readonly onOpenLink: (url: string) => void;
  readonly onClose: () => void;
}

const THEMES: readonly { readonly value: ThemePreference; readonly label: string; readonly icon: typeof Sun }[] = Object.freeze([
  Object.freeze({ value: "light", label: "月白", icon: Sun }),
  Object.freeze({ value: "dark", label: "星夜", icon: Moon }),
  Object.freeze({ value: "system", label: "跟随系统", icon: Monitor }),
]);

const FONT_SIZES: readonly { readonly value: FontSizePreference; readonly label: string }[] = Object.freeze([
  Object.freeze({ value: "small", label: "小（14px）" }),
  Object.freeze({ value: "default", label: "默认（16px）" }),
  Object.freeze({ value: "large", label: "大（19px）" }),
]);

function Toggle({ checked, onChange, label }: { readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly label: string }) {
  return <button type="button" className={`toggle ${checked ? "is-on" : ""}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>;
}

function backendStatus(health: ExecutionBackendHealth | undefined): string {
  if (!health || health.state === "checking") return "正在探测";
  if (health.state !== "ready") return "不可用";
  if (health.authState === "required") return "需要登录";
  return "可用";
}

function ExecutionBackendSetting({
  backendId,
  health,
  busy,
  onConfigure,
  onRetry,
}: {
  readonly backendId: ConfigurableExecutionBackendId;
  readonly health?: ExecutionBackendHealth;
  readonly busy: boolean;
  readonly onConfigure: (backendId: ConfigurableExecutionBackendId, executablePath?: string) => void;
  readonly onRetry: (backendId: ExecutionBackendId) => void;
}) {
  const [path, setPath] = useState(health?.executableSource === "path" ? health.executablePath ?? "" : "");
  useEffect(() => {
    setPath(health?.executableSource === "path" ? health.executablePath ?? "" : "");
  }, [health?.executablePath, health?.executableSource]);
  const label = backendId === "codex" ? "Codex CLI" : "Claude CLI";
  return (
    <div className="execution-backend-setting">
      <div className="execution-backend-setting__heading">
        <span><strong>{label}</strong><small>{health?.version ? `v${health.version}` : "未识别版本"} · {health?.executableSource === "path" ? "指定路径" : "PATH 自动发现"}</small></span>
        <em className={`execution-backend-setting__status is-${health?.state ?? "checking"}`}>{backendStatus(health)}</em>
      </div>
      <label>
        <span className="sr-only">{label} 可执行文件路径</span>
        <input value={path} placeholder={health?.executablePath ?? `自动查找 ${backendId}`} onChange={(event) => setPath(event.target.value)} />
      </label>
      <div className="execution-backend-setting__actions">
        <button type="button" disabled={busy || path.trim().length === 0} onClick={() => onConfigure(backendId, path.trim())}>验证并保存</button>
        <button type="button" disabled={busy} onClick={() => onConfigure(backendId, undefined)}>使用自动发现</button>
        <button type="button" disabled={busy} onClick={() => onRetry(backendId)}><RefreshCw size={12} />重新探测</button>
      </div>
      <small className="execution-backend-setting__path">当前：{health?.executablePath ?? "未找到可执行文件"}</small>
      {health?.authState === "required" && <p>{backendId === "codex" ? "CLI 已安装，但尚未登录 Codex。" : "CLI 已安装，但尚未登录 Claude。"}</p>}
      {health?.error && <p role="alert">{health.error}</p>}
    </div>
  );
}

function CompanionSetting({
  status,
  offer,
  busy,
  error,
  onRefresh,
  onCreateOffer,
  onRevoke,
  onCopyOffer,
}: {
  readonly status?: CompanionGatewayStatus;
  readonly offer?: CompanionPairingOffer;
  readonly busy: boolean;
  readonly error?: string;
  readonly onRefresh: () => void;
  readonly onCreateOffer: () => void;
  readonly onRevoke: (deviceId: string) => void;
  readonly onCopyOffer: (value: string) => void;
}) {
  const [qrCode, setQrCode] = useState<string>();
  const [qrError, setQrError] = useState<string>();
  useEffect(() => {
    let active = true;
    if (!offer) {
      setQrCode(undefined);
      setQrError(undefined);
      return () => { active = false; };
    }
    void QRCode.toDataURL(offer.pairingUri, { width: 220, margin: 1, errorCorrectionLevel: "M" })
      .then((value) => { if (active) { setQrCode(value); setQrError(undefined); } })
      .catch((cause: unknown) => { if (active) setQrError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [offer]);
  const activeDevices = status?.devices.filter((device) => !device.revokedAt) ?? [];
  const stateLabel = status?.state === "listening" ? "正在监听" : status?.state === "error" ? "启动失败" : "已停止";
  return (
    <section className="settings-section settings-section--companion">
      <div className="settings-section__heading"><span>Android Companion</span><small>支持一部手机连接多台电脑</small></div>
      <div className="companion-gateway-card">
        <Smartphone size={19} />
        <span><strong>{status?.host.name ?? "Stella Desktop"}</strong><small>{stateLabel}{status?.port ? ` · 端口 ${status.port}` : ""}</small>{status?.connectionUrls[0] && <small title={status.connectionUrls[0]}>首选地址 · {status.connectionUrls[0]}</small>}</span>
        <div><button type="button" disabled={busy} onClick={onRefresh}><RefreshCw size={12} />刷新</button><button type="button" disabled={busy || status?.state !== "listening"} onClick={onCreateOffer}>生成配对码</button></div>
      </div>
      {offer && (
        <div className="companion-pairing-offer">
          <div className="companion-pairing-offer__qr">{qrCode ? <img src={qrCode} alt="Stella Companion 配对二维码" /> : <span>{qrError ?? "正在生成二维码…"}</span>}</div>
          <div><strong>用手机相机扫描</strong><small>配对码将在 {new Date(offer.expiresAt).toLocaleTimeString("zh-CN")} 失效，并且只能使用一次。</small><code>{offer.pairingUri}</code><button type="button" onClick={() => onCopyOffer(offer.pairingUri)}><Copy size={12} />复制配对链接</button></div>
        </div>
      )}
      <div className="companion-device-list">
        {activeDevices.map((device) => (
          <div key={device.id}>
            <span><strong>{device.name}</strong><small>{device.connected ? "当前在线" : device.lastSeenAt ? `上次连接 ${new Date(device.lastSeenAt).toLocaleString("zh-CN")}` : "尚未重新连接"}</small></span>
            <button type="button" disabled={busy} onClick={() => onRevoke(device.id)}><Unplug size={12} />撤销</button>
          </div>
        ))}
        {activeDevices.length === 0 && <p>尚未配对 Android 设备。</p>}
      </div>
      {(error || status?.error || qrError) && <p className="settings-execution-backend-error" role="alert">{error ?? status?.error ?? qrError}</p>}
    </section>
  );
}

export function SettingsDialog({
  piVersion,
  solMode,
  bootstrap,
  preferences,
  customArtwork,
  artworkBusySkin,
  executionBackends,
  executionBackendBusy,
  executionBackendError,
  companionStatus,
  companionOffer,
  companionBusy,
  companionError,
  onPreferencesChange,
  onChooseSkinArtwork,
  onResetSkinArtwork,
  onConfigureExecutionBackend,
  onRetryExecutionBackend,
  onRefreshCompanion,
  onCreateCompanionOffer,
  onRevokeCompanionDevice,
  onCopyCompanionOffer,
  onAutoCompactionChange,
  onSteeringModeChange,
  onFollowUpModeChange,
  onRestartTrust,
  onOpenLink,
  onClose,
}: SettingsDialogProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const selectedSkin = skinDefinition(preferences.skin);
  const selectedArtwork = customArtwork[preferences.skin];
  const artworkBusy = artworkBusySkin === preferences.skin;
  return (
    <><Modal title="偏好设置" eyebrow="STELLA SETTINGS" onClose={onClose} className="settings-dialog">
      <div className="settings-scroll">
        <button type="button" className="settings-guide-entry" onClick={() => setGuideOpen(true)}><BookOpen size={26} /><span><strong>功能介绍与操作说明</strong><small>项目看板、任务、Pi 会话与手机连接 · 图文三步上手</small></span><ArrowRight size={18} /></button>
        {piVersion && <PiVersionSetting {...piVersion} />}
        {solMode && <SolModeSetting {...solMode} />}
        <section className="settings-section settings-section--skins">
          <div className="settings-section__heading"><span>皮肤</span><small>选择一套完整的视觉性格</small></div>
          <div className="skin-options" role="radiogroup" aria-label="界面皮肤">
            {SKIN_OPTIONS.map((skin) => {
              const selected = preferences.skin === skin.value;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`skin-option skin-option--${skin.value} ${selected ? "is-active" : ""}`}
                  key={skin.value}
                  onClick={() => onPreferencesChange(Object.freeze({ ...preferences, skin: skin.value }))}
                >
                  <span className="skin-option__preview" aria-hidden="true">
                    {customArtwork[skin.value] && <img src={customArtwork[skin.value]?.url} alt="" />}
                    <i /><b />
                  </span>
                  <span className="skin-option__copy">
                    <span><strong>{skin.label}</strong><em>{skin.subtitle}</em></span>
                    <small>{skin.description}</small>
                    <i>{skin.inspiration}</i>
                  </span>
                  <span className="skin-option__check" aria-hidden="true">{selected && <Check size={13} />}</span>
                </button>
              );
            })}
          </div>
          <div className="skin-artwork-control">
            <span className={`skin-artwork-control__preview skin-option--${selectedSkin.value}`} aria-hidden="true">
              <span className="skin-option__preview">
                {selectedArtwork && <img src={selectedArtwork.url} alt="" />}
                <i /><b />
              </span>
            </span>
            <span className="skin-artwork-control__copy">
              <strong>{selectedSkin.label} · {selectedArtwork ? "自定义背景" : "内置背景"}</strong>
              <small>{selectedArtwork ? "图片已复制到应用用户数据目录，原文件移动后仍然有效。" : "使用随安装包提供的原创主题画面。"}</small>
              <i>PNG / JPEG / WebP · 最大 25 MB</i>
            </span>
            <span className="skin-artwork-control__actions">
              <button type="button" disabled={artworkBusy} onClick={() => onChooseSkinArtwork(preferences.skin)}>
                <ImagePlus size={14} />{artworkBusy ? "正在处理" : selectedArtwork ? "更换图片" : "选择图片"}
              </button>
              <button type="button" disabled={artworkBusy || !selectedArtwork} onClick={() => onResetSkinArtwork(preferences.skin)}>
                <RotateCcw size={13} />恢复内置
              </button>
            </span>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading"><span>明暗与密度</span><small>可与任意皮肤独立组合</small></div>
          <div className="theme-options">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button type="button" key={value} className={preferences.theme === value ? "is-active" : ""} onClick={() => onPreferencesChange(Object.freeze({ ...preferences, theme: value }))}>
                <Icon size={17} /><span>{label}</span>{preferences.theme === value && <Check size={13} />}
              </button>
            ))}
          </div>
          <div className="setting-row"><span><strong>紧凑密度</strong><small>减少消息与侧栏的垂直留白</small></span><Toggle label="紧凑密度" checked={preferences.density === "compact"} onChange={(checked) => onPreferencesChange(Object.freeze({ ...preferences, density: checked ? "compact" : "comfortable" }))} /></div>
          <label className="setting-row setting-row--select"><span><strong>字体大小</strong><small>调整全局界面字号，当前为{FONT_SIZES.find((item) => item.value === preferences.fontSize)?.label ?? "默认"}</small></span><select value={preferences.fontSize} onChange={(event) => onPreferencesChange(Object.freeze({ ...preferences, fontSize: event.target.value as FontSizePreference }))}>{FONT_SIZES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
        </section>

        <section className="settings-section settings-section--capabilities">
          <div className="settings-section__heading"><span>功能页面</span><small>Pi 工作台与扩展能力分层显示</small></div>
          <div className="setting-row">
            <span>
              <strong>显示团队功能（实验）</strong>
              <small>显示团队协作与自动化入口；任务看板始终可用，关闭不会删除已有任务。</small>
            </span>
            <Toggle
              label="显示团队功能"
              checked={preferences.teamFeaturesEnabled}
              onChange={(checked) => onPreferencesChange(Object.freeze({ ...preferences, teamFeaturesEnabled: checked }))}
            />
          </div>
          <p className="settings-capability-note">Pi 工作台保持独立；看板任务可按兼容性选择 Pi、Codex CLI 或 Claude CLI。</p>
        </section>

        <section className="settings-section settings-section--execution-backends">
          <div className="settings-section__heading"><span>任务执行环境</span><small>只探测安装、版本与登录状态，不发起模型请求</small></div>
          {(["codex", "claude"] as const).map((backendId) => (
            <ExecutionBackendSetting
              key={backendId}
              backendId={backendId}
              health={executionBackends?.health.find((item) => item.backendId === backendId)}
              busy={executionBackendBusy.includes(backendId)}
              onConfigure={onConfigureExecutionBackend}
              onRetry={onRetryExecutionBackend}
            />
          ))}
          {executionBackendError && <p className="settings-execution-backend-error" role="alert">{executionBackendError}</p>}
        </section>

        <CompanionSetting
          status={companionStatus}
          offer={companionOffer}
          busy={companionBusy}
          error={companionError}
          onRefresh={onRefreshCompanion}
          onCreateOffer={onCreateCompanionOffer}
          onRevoke={onRevokeCompanionDevice}
          onCopyOffer={onCopyCompanionOffer}
        />

        {bootstrap && <><section className="settings-section">
          <div className="settings-section__heading"><span>Pi 运行方式</span><small>立即作用于当前会话</small></div>
          <div className="setting-row"><span><strong>自动压缩上下文</strong><small>接近模型窗口上限时生成摘要</small></span><Toggle label="自动压缩上下文" checked={bootstrap.state.autoCompactionEnabled} onChange={onAutoCompactionChange} /></div>
          <div className="setting-row"><span><strong>自动重试</strong><small>提供方拥塞、限流或 5xx 时重试</small></span><Toggle label="自动重试" checked={preferences.autoRetry} onChange={(checked) => onPreferencesChange(Object.freeze({ ...preferences, autoRetry: checked }))} /></div>
          <label className="setting-row setting-row--select"><span><strong>引导消息</strong><small>工作中发送的 steer 消息如何交付</small></span><select value={bootstrap.state.steeringMode} onChange={(event) => onSteeringModeChange(event.target.value as "all" | "one-at-a-time")}><option value="one-at-a-time">逐条</option><option value="all">一次全部</option></select></label>
          <label className="setting-row setting-row--select"><span><strong>后续消息</strong><small>任务结束后排队消息如何交付</small></span><select value={bootstrap.state.followUpMode} onChange={(event) => onFollowUpModeChange(event.target.value as "all" | "one-at-a-time")}><option value="one-at-a-time">逐条</option><option value="all">一次全部</option></select></label>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading"><span>项目权限</span><small>{bootstrap.project.name}</small></div>
          <div className={`trust-status ${bootstrap.project.trusted ? "is-trusted" : ""}`}>
            {bootstrap.project.trusted ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
            <span><strong>{bootstrap.project.trusted ? "已信任项目资源" : "受限模式"}</strong><small>{bootstrap.project.trusted ? "项目级设置、扩展与技能已启用。" : "项目级可执行资源不会加载。"}</small></span>
            <button type="button" onClick={() => onRestartTrust(!bootstrap.project.trusted)}>{bootstrap.project.trusted ? "改为受限" : "信任并重启"}</button>
          </div>
        </section>

        </>}
        <section className="settings-section">
          <div className="settings-section__heading"><span>快捷键</span><Keyboard size={14} /></div>
          <div className="shortcut-grid"><span>当前页新建 <kbd>Ctrl N</kbd></span><span>搜索与命令 <kbd>Ctrl K</kbd></span><span>聚焦当前页输入 <kbd>Ctrl L</kbd></span><span>停止生成 <kbd>Esc</kbd></span><span>打开终端 <kbd>Ctrl `</kbd></span><span>切换检查器 <kbd>Ctrl I</kbd></span></div>
        </section>

        <section className="settings-section settings-about">
          <div><span className="settings-about__signature">Stella</span><p>Pi Workbench · {bootstrap ? `Pi v${bootstrap.piVersion}` : "Pi 尚未就绪"}</p></div>
          <div><button type="button" onClick={() => onOpenLink("https://github.com/earendil-works/pi")}>Pi 项目 <ExternalLink size={12} /></button><button type="button" onClick={() => onOpenLink("https://github.com/Fei-Away/Codex-Dream-Skin")}>视觉参考 <ExternalLink size={12} /></button></div>
        </section>
      </div>
    </Modal>{guideOpen && <FeatureGuideDialog onClose={() => setGuideOpen(false)} />}</>
  );
}
