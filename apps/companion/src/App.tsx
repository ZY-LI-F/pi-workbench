import { App as CapacitorApp } from "@capacitor/app";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CompanionAgentSummary,
  CompanionCommand,
  CompanionCommandPreview,
  CompanionCommandResult,
  CompanionTaskAction,
  CompanionTaskDetail,
} from "../../../src/shared/companion-protocol";
import {
  CompanionCommandIndeterminateError,
  CompanionWebSocketClient,
  type CompanionClientState,
} from "./companion-client";
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

function idempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `android-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface CommandNotice {
  readonly state: "submitting" | "accepted" | "rejected" | "indeterminate" | "offline";
  readonly message: string;
  readonly command?: CompanionCommand;
}

function actionLabel(action: CompanionTaskAction): string {
  if (action.kind === "resolve-human-gate") return `人工关卡 · ${action.label}`;
  if (action.kind === "review-execution") return "执行报告待验收";
  return "当前执行可中止";
}

function TaskRoom({ taskId, sequence, online, onClose }: {
  readonly taskId: string;
  readonly sequence: number;
  readonly online: boolean;
  readonly onClose: () => void;
}) {
  const [detail, setDetail] = useState<CompanionTaskDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [decisionComment, setDecisionComment] = useState("");
  const [messageCommand, setMessageCommand] = useState<Extract<CompanionCommand, { readonly type: "add-task-message" }>>();
  const [messagePreview, setMessagePreview] = useState<CompanionCommandPreview>();
  const [notice, setNotice] = useState<CommandNotice>();

  const refresh = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    try {
      setDetail(await client.getTaskDetail(taskId));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [online, taskId]);

  useEffect(() => { void refresh(); }, [refresh, sequence]);

  const execute = useCallback(async (command: CompanionCommand) => {
    if (!online) {
      setNotice({ state: "offline", message: "当前离线，命令尚未发送", command });
      return;
    }
    setNotice({ state: "submitting", message: "桌面正在处理…", command });
    try {
      const result: CompanionCommandResult = await client.executeCommand(command);
      setNotice({
        state: result.status,
        message: result.message,
        ...(result.status === "indeterminate" ? { command } : {}),
      });
      if (result.status === "accepted") {
        if (command.type === "add-task-message") {
          setDraft("");
          setMessageCommand(undefined);
          setMessagePreview(undefined);
        }
        setDecisionComment("");
        await refresh();
      }
    } catch (cause) {
      const indeterminate = cause instanceof CompanionCommandIndeterminateError;
      setNotice({
        state: indeterminate ? "indeterminate" : online ? "rejected" : "offline",
        message: cause instanceof Error ? cause.message : String(cause),
        ...(indeterminate ? { command } : {}),
      });
    }
  }, [online, refresh]);

  const previewMessage = async () => {
    const command = Object.freeze({
      type: "add-task-message" as const,
      idempotencyKey: idempotencyKey(),
      taskId,
      body: draft,
      dispatchMentions: true,
    });
    try {
      const preview = await client.previewCommand(command);
      setMessageCommand(command);
      setMessagePreview(preview);
      setNotice(undefined);
    } catch (cause) {
      setMessageCommand(undefined);
      setMessagePreview(undefined);
      setNotice({ state: online ? "rejected" : "offline", message: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  const prepareAction = async (command: CompanionCommand) => {
    try {
      const preview = await client.previewCommand(command);
      if (preview.requiresConfirmation && !window.confirm(`${preview.summary}\n\n确认继续？`)) return;
      await execute(command);
    } catch (cause) {
      setNotice({ state: online ? "rejected" : "offline", message: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  const gateCommand = (action: Extract<CompanionTaskAction, { readonly kind: "resolve-human-gate" }>, decision: "approve" | "reject") => prepareAction(Object.freeze({
    type: "resolve-human-gate",
    idempotencyKey: idempotencyKey(),
    taskId: action.taskId,
    runId: action.runId,
    stepId: action.stepId,
    decision,
    comment: decisionComment,
  }));

  const reviewCommand = (action: Extract<CompanionTaskAction, { readonly kind: "review-execution" }>, decision: "accept" | "revision-requested" | "reject") => {
    if (decision !== "accept" && !decisionComment.trim()) {
      setNotice({ state: "rejected", message: "请求修订或拒绝时请填写理由" });
      return Promise.resolve();
    }
    return prepareAction(Object.freeze({
      type: "review-execution",
      idempotencyKey: idempotencyKey(),
      taskId: action.taskId,
      executionKind: action.executionKind,
      executionId: action.executionId,
      decision,
      comment: decisionComment,
    }));
  };

  return <section className="task-room" role="dialog" aria-modal="true" aria-label="Task Room">
    <header className="task-room__top"><button type="button" onClick={onClose}>←</button><div><small>TASK ROOM</small><h2>{detail?.task.title ?? "加载任务…"}</h2></div><button type="button" disabled={!online || loading} onClick={() => void refresh()}>刷新</button></header>
    {!online && <aside className="stale-banner"><b>Task Room 离线</b><span>可以阅读已加载内容，但不会排队或伪装命令已发送。</span></aside>}
    {error && <aside className="error-banner"><b>读取失败</b><span>{error}</span></aside>}
    {notice && <aside className={`command-notice is-${notice.state}`}><b>{notice.state === "accepted" ? "已接受" : notice.state === "indeterminate" ? "结果未知" : notice.state === "submitting" ? "提交中" : notice.state === "offline" ? "未发送" : "已拒绝"}</b><span>{notice.message}</span>{notice.command && notice.state === "indeterminate" && online && <button type="button" onClick={() => void execute(notice.command as CompanionCommand)}>使用同一 idempotency key 查询/重试</button>}</aside>}

    {detail && <>
      <section className="task-room__summary"><span>{detail.task.projectName}</span><b>{detail.task.stage}</b><p>{detail.task.description || "未填写任务描述"}</p><small>验收：{detail.task.acceptanceCriteria || "未填写"}</small></section>

      {detail.actions.length > 0 && <section className="task-room__actions"><header><small>HUMAN ACTIONS</small><h3>待处理决定</h3></header><textarea aria-label="决定说明" value={decisionComment} onChange={(event) => setDecisionComment(event.target.value)} placeholder="批准可选；请求修订或拒绝时必须填写理由" rows={3} />{detail.actions.map((action) => <article key={`${action.kind}:${"executionId" in action ? action.executionId : action.runId}`}><b>{actionLabel(action)}</b>{action.kind === "resolve-human-gate" && <div><button type="button" disabled={!online} onClick={() => void gateCommand(action, "approve")}>批准</button><button type="button" className="is-danger" disabled={!online} onClick={() => void gateCommand(action, "reject")}>驳回</button></div>}{action.kind === "review-execution" && <div><button type="button" disabled={!online} onClick={() => void reviewCommand(action, "accept")}>接受</button><button type="button" disabled={!online} onClick={() => void reviewCommand(action, "revision-requested")}>请求修订</button><button type="button" className="is-danger" disabled={!online} onClick={() => void reviewCommand(action, "reject")}>拒绝</button></div>}{action.kind === "abort-execution" && <div><button type="button" className="is-danger" disabled={!online} onClick={() => void prepareAction(Object.freeze({ type: "abort-execution", idempotencyKey: idempotencyKey(), taskId: action.taskId, executionKind: action.executionKind, executionId: action.executionId }))}>确认后中止精确 execution</button></div>}</article>)}</section>}

      <section className="task-room__timeline"><header><small>RECENT TIMELINE</small><h3>最近记录</h3></header>{detail.timeline.slice(-20).reverse().map((item) => <article key={item.id}><div><b>{item.title}</b><time>{relativeTime(item.createdAt)}</time></div>{(item.body || item.detail) && <p>{item.body ?? item.detail}</p>}</article>)}</section>

      <section className="task-room__composer"><small>MESSAGE EFFECT PREVIEW</small><textarea aria-label="Task Room 消息" value={draft} onChange={(event) => { setDraft(event.target.value); setMessageCommand(undefined); setMessagePreview(undefined); }} placeholder="普通文字只追加评论；允许的 @mention 会按桌面规则分发 Agent" rows={4} />{messagePreview && <aside><b>提交效果</b><span>{messagePreview.summary}</span></aside>}<div><button type="button" disabled={!online || !draft.trim()} onClick={() => void previewMessage()}>预览效果</button><button type="button" className="is-primary" disabled={!online || !messageCommand || !messagePreview} onClick={() => void execute(messageCommand as CompanionCommand)}>按预览提交</button></div></section>
    </>}
  </section>;
}

export function App() {
  const [state, setState] = useState<CompanionClientState>(() => client.state());
  const [pairingUri, setPairingUri] = useState("");
  const [pairingError, setPairingError] = useState<string>();
  const [tab, setTab] = useState<"attention" | "activity">("attention");
  const [taskRoomId, setTaskRoomId] = useState<string>();
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
              {agent.taskId && <button type="button" onClick={() => setTaskRoomId(agent.taskId)}>打开 Task Room <b>→</b></button>}
            </article>)}
            {visible.length === 0 && <div className="empty-state"><div>✓</div><strong>当前没有{tab === "attention" ? "待处理" : " Agent"}事项</strong><p>{tab === "attention" ? "切换到“全部”查看正在执行与最近完成的任务。" : "桌面有 Agent 活动后会自动显示。"}</p></div>}
          </div>
        </section>
      </>}

      <footer className="bottom-nav"><button className="is-active"><span>⌁</span>Attention</button><button><span>▦</span>Tasks</button><button><span>◌</span>Hosts</button></footer>
      {taskRoomId && snapshot && <TaskRoom taskId={taskRoomId} sequence={snapshot.sequence} online={state.connection === "online"} onClose={() => setTaskRoomId(undefined)} />}
    </main>
  );
}
