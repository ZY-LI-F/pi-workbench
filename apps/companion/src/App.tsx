import { useEffect, useMemo, useState } from "react";
import {
  MOCK_SCENARIOS,
  createMockCompanionHost,
  type MockAgentState,
  type MockCompanionSnapshot,
  type MockScenario,
} from "./mock-host";

const host = createMockCompanionHost();

const STATE_LABEL: Readonly<Record<MockAgentState, string>> = Object.freeze({
  working: "执行中",
  "needs-input": "需要处理",
  completed: "已完成",
  failed: "失败",
});

const SCENARIO_LABEL: Readonly<Record<MockScenario, string>> = Object.freeze({
  working: "Working",
  "needs-input": "Attention",
  completed: "Completed",
  failed: "Failed",
  offline: "Offline",
});

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1_000));
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  return `${Math.floor(seconds / 60)} 分钟前`;
}

function StatusMark({ state }: { readonly state: MockAgentState }) {
  return <span className={`status-mark is-${state}`} aria-hidden="true" />;
}

export function App() {
  const [snapshot, setSnapshot] = useState<MockCompanionSnapshot>(() => host.snapshot());
  const [tab, setTab] = useState<"attention" | "activity">("attention");
  useEffect(() => {
    const unsubscribe = host.subscribe(setSnapshot);
    const stop = host.start();
    return () => { unsubscribe(); stop(); };
  }, []);
  const attention = useMemo(() => snapshot.tasks.filter((task) => task.state === "needs-input" || task.state === "failed"), [snapshot.tasks]);
  const visible = tab === "attention" ? attention : snapshot.tasks;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">S</div>
        <div><strong>Stella Companion</strong><span>v0.5.0 · Mock Host</span></div>
        <button type="button" className="avatar" aria-label="设备设置">ZX</button>
      </header>

      <section className={`host-card is-${snapshot.connection}`}>
        <div className="host-card__signal"><i /><i /><i /></div>
        <div><small>DESKTOP HOST</small><h1>{snapshot.hostName}</h1><p>{snapshot.connection === "online" ? "实时连接" : "桌面离线 · 显示最后快照"} · {relativeTime(snapshot.capturedAt)}</p></div>
        <span>{snapshot.connection === "online" ? "在线" : "离线"}</span>
      </section>

      {snapshot.stale && <aside className="stale-banner" role="status"><b>离线快照</b><span>状态可能已变化；重新连接后会自动刷新。</span></aside>}

      <nav className="scenario-strip" aria-label="Mock host 场景">
        {MOCK_SCENARIOS.map((scenario) => <button type="button" key={scenario} onClick={() => host.select(scenario)}>{SCENARIO_LABEL[scenario]}</button>)}
      </nav>

      <section className="summary-grid">
        <article><span>需要处理</span><strong>{attention.length}</strong><small>Attention</small></article>
        <article><span>正在执行</span><strong>{snapshot.tasks.filter((task) => task.state === "working").length}</strong><small>Working</small></article>
        <article><span>Host 序列</span><strong>{snapshot.sequence}</strong><small>Live updates</small></article>
      </section>

      <section className="task-section">
        <header><div><small>AGENT ACTIVITY</small><h2>任务动态</h2></div><div className="segmented"><button className={tab === "attention" ? "is-active" : ""} onClick={() => setTab("attention")}>Attention</button><button className={tab === "activity" ? "is-active" : ""} onClick={() => setTab("activity")}>全部</button></div></header>
        <div className="task-list">
          {visible.map((task) => <article className={`task-card is-${task.state}`} key={task.id}>
            <header><span><StatusMark state={task.state} />{task.agent}</span><em>{STATE_LABEL[task.state]}</em></header>
            <h3>{task.title}</h3><p>{task.summary}</p>
            <footer><span>{task.project}</span><time>{relativeTime(task.updatedAt)}</time></footer>
            {task.state === "needs-input" && <button type="button">打开 Task Room <b>→</b></button>}
          </article>)}
          {visible.length === 0 && <div className="empty-state"><div>✓</div><strong>当前没有待处理事项</strong><p>切换到“全部”查看正在执行与最近完成的任务。</p></div>}
        </div>
      </section>

      <footer className="bottom-nav"><button className="is-active"><span>⌁</span>Attention</button><button><span>▦</span>Tasks</button><button><span>◌</span>Hosts</button></footer>
    </main>
  );
}
