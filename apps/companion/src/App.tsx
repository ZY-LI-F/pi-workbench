import { App as CapacitorApp } from "@capacitor/app";
import { useEffect, useMemo, useState } from "react";
import type { CompanionAgentSummary } from "../../../src/shared/companion-protocol";
import { CompanionWebSocketClient, type CompanionClientState } from "./companion-client";
import { companionStorage } from "./companion-storage";

const client = new CompanionWebSocketClient({ storage: companionStorage });

const BUCKET_LABEL: Readonly<Record<CompanionAgentSummary["bucket"], string>> = Object.freeze({
  attention: "需要处理",
  working: "执行中",
  recent: "最近更新",
  idle: "等待中",
});

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1_000));
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} 分钟前`;
  return `${Math.floor(seconds / 3_600)} 小时前`;
}

function connectionLabel(connection: CompanionClientState["connection"]): string {
  if (connection === "online") return "在线";
  if (connection === "pairing") return "配对中";
  if (connection === "connecting") return "连接中";
  if (connection === "reconnecting") return "重连中";
  if (connection === "incompatible") return "版本不兼容";
  if (connection === "unpaired") return "未配对";
  return "离线";
}

function StatusMark({ bucket }: { readonly bucket: CompanionAgentSummary["bucket"] }) {
  return <span className={`status-mark is-${bucket}`} aria-hidden="true" />;
}

export function App() {
  const [state, setState] = useState<CompanionClientState>(() => client.state());
  const [pairingUri, setPairingUri] = useState("");
  const [pairingError, setPairingError] = useState<string>();
  const [tab, setTab] = useState<"attention" | "activity">("attention");
  useEffect(() => {
    const unsubscribe = client.subscribe(setState);
    let handledPairUrl: string | undefined;
    const pairUrl = (value: string | undefined) => {
      if (!value?.startsWith("stella://pair") || value === handledPairUrl) return;
      handledPairUrl = value;
      setPairingUri(value);
      setPairingError(undefined);
      void client.pair(value, "Android Companion").catch((cause: unknown) => {
        setPairingError(cause instanceof Error ? cause.message : String(cause));
      });
    };
    void client.start();
    let removeUrlListener: (() => Promise<void>) | undefined;
    void CapacitorApp.addListener("appUrlOpen", ({ url }) => pairUrl(url)).then((handle) => { removeUrlListener = () => handle.remove(); });
    void CapacitorApp.getLaunchUrl().then((result) => pairUrl(result?.url));
    return () => {
      unsubscribe();
      client.stop();
      void removeUrlListener?.();
    };
  }, []);

  const snapshot = state.snapshot;
  const agents = snapshot?.agents ?? [];
  const attention = useMemo(() => agents.filter((agent) => agent.bucket === "attention"), [agents]);
  const visible = tab === "attention" ? attention : agents;
  const stale = Boolean(snapshot && (state.connection !== "online" || snapshot.freshness.stale));
  const hostName = state.host?.name ?? snapshot?.host.name ?? "尚未连接桌面";
  const connect = () => {
    setPairingError(undefined);
    void client.pair(pairingUri, "Android Companion").catch((cause: unknown) => {
      setPairingError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">S</div>
        <div><strong>Stella Companion</strong><span>v0.5.0 · Protocol 1</span></div>
        <button type="button" className="avatar" aria-label="忘记当前桌面" disabled={!state.host} onClick={() => {
          if (window.confirm("忘记当前桌面并删除本机配对信息？")) void client.forget();
        }}>ZX</button>
      </header>

      <section className={`host-card is-${state.connection}`}>
        <div className="host-card__signal"><i /><i /><i /></div>
        <div><small>DESKTOP HOST</small><h1>{hostName}</h1><p>{state.connection === "online" ? "实时连接" : "桌面必须保持运行"}{snapshot ? ` · ${relativeTime(snapshot.capturedAt)}` : ""}</p></div>
        <span>{connectionLabel(state.connection)}</span>
      </section>

      {stale && <aside className="stale-banner" role="status"><b>离线快照</b><span>状态可能已变化；恢复网络后会自动重新协商并全量刷新。</span></aside>}
      {(state.error || pairingError) && <aside className="error-banner" role="alert"><b>连接提示</b><span>{pairingError ?? state.error}</span></aside>}

      {(state.connection === "unpaired" || state.connection === "pairing" || (!snapshot && state.connection === "offline")) && (
        <section className="pairing-card">
          <small>PAIR WITH DESKTOP</small>
          <h2>连接你的 Stella</h2>
          <p>在桌面端“偏好设置 → Android Companion”生成配对码。可以扫码打开本应用，也可以粘贴配对链接。</p>
          <textarea aria-label="Companion 配对链接" value={pairingUri} onChange={(event) => setPairingUri(event.target.value)} rows={4} placeholder="stella://pair?endpoint=…" />
          <button type="button" disabled={!pairingUri.trim() || state.connection === "pairing"} onClick={connect}>{state.connection === "pairing" ? "正在配对…" : "连接桌面"}</button>
        </section>
      )}

      {snapshot && <>
        <section className="summary-grid">
          <article><span>需要处理</span><strong>{attention.length}</strong><small>Attention</small></article>
          <article><span>正在执行</span><strong>{agents.filter((agent) => agent.bucket === "working").length}</strong><small>Working</small></article>
          <article><span>Host 序列</span><strong>{snapshot.sequence}</strong><small>{stale ? "Last good" : "Live updates"}</small></article>
        </section>

        <section className="task-section">
          <header><div><small>AGENT ACTIVITY</small><h2>任务动态</h2></div><div className="segmented"><button className={tab === "attention" ? "is-active" : ""} onClick={() => setTab("attention")}>Attention</button><button className={tab === "activity" ? "is-active" : ""} onClick={() => setTab("activity")}>全部</button></div></header>
          <div className="task-list">
            {visible.map((agent) => <article className={`task-card is-${agent.bucket}`} key={agent.id}>
              <header><span><StatusMark bucket={agent.bucket} />{agent.title}</span><em>{BUCKET_LABEL[agent.bucket]}</em></header>
              <h3>{agent.taskTitle ?? "未关联 Task"}</h3><p>{agent.waitingFor ?? agent.summary ?? "等待下一次状态更新"}</p>
              <footer><span>{snapshot.projects.find((project) => project.path === agent.projectPath)?.name ?? agent.backendId ?? "Stella"}</span><time>{relativeTime(agent.updatedAt)}</time></footer>
              {agent.bucket === "attention" && agent.taskId && <button type="button">打开 Task Room <b>→</b></button>}
            </article>)}
            {visible.length === 0 && <div className="empty-state"><div>✓</div><strong>当前没有{tab === "attention" ? "待处理" : " Agent"}事项</strong><p>{tab === "attention" ? "切换到“全部”查看正在执行与最近完成的任务。" : "桌面有 Agent 活动后会自动显示。"}</p></div>}
          </div>
        </section>
      </>}

      <footer className="bottom-nav"><button className="is-active"><span>⌁</span>Attention</button><button><span>▦</span>Tasks</button><button><span>◌</span>Hosts</button></footer>
    </main>
  );
}
