import { App as CapacitorApp } from "@capacitor/app";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CompanionAgentSummary,
  CompanionCommand,
  CompanionCommandPreview,
  CompanionCommandResult,
  CompanionExternalExecutionDetail,
  CompanionExternalExecutionReference,
  CompanionTaskAction,
  CompanionTaskDetail,
} from "../../../src/shared/companion-protocol";
import {
  CompanionCommandIndeterminateError,
  type CompanionClientState,
} from "./companion-client";
import {
  CompanionHostFleet,
  type CompanionFleetState,
} from "./companion-host-fleet";
import { companionPairingScanner } from "./companion-pairing-scanner";
import { companionFleetStorage } from "./companion-storage";

const fleet = new CompanionHostFleet({ storage: companionFleetStorage });
const ALL_HOSTS = "__all_hosts__";

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

function TaskRoom({ hostId, hostName, taskId, sequence, online, onClose }: {
  readonly hostId: string;
  readonly hostName: string;
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
      setDetail(await fleet.getTaskDetail(hostId, taskId));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [hostId, online, taskId]);

  useEffect(() => { void refresh(); }, [refresh, sequence]);

  const execute = useCallback(async (command: CompanionCommand) => {
    if (!online) {
      setNotice({ state: "offline", message: "当前离线，命令尚未发送", command });
      return;
    }
    setNotice({ state: "submitting", message: "桌面正在处理…", command });
    try {
      const result: CompanionCommandResult = await fleet.executeCommand(hostId, command);
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
  }, [hostId, online, refresh]);

  const previewMessage = async () => {
    const command = Object.freeze({
      type: "add-task-message" as const,
      idempotencyKey: idempotencyKey(),
      taskId,
      body: draft,
      dispatchMentions: true,
    });
    try {
      const preview = await fleet.previewCommand(hostId, command);
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
      const preview = await fleet.previewCommand(hostId, command);
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
    <header className="task-room__top"><button type="button" onClick={onClose}>←</button><div><small>TASK ROOM · {hostName}</small><h2>{detail?.task.title ?? "加载任务…"}</h2></div><button type="button" disabled={!online || loading} onClick={() => void refresh()}>刷新</button></header>
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

const EXTERNAL_STATE_LABEL: Readonly<Record<CompanionExternalExecutionReference["state"], string>> = Object.freeze({
  working: "执行中",
  "needs-input": "等待输入",
  idle: "空闲",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  unknown: "未知",
});

interface HostContext {
  readonly hostId: string;
  readonly hostName: string;
  readonly state: CompanionClientState;
}

interface TaskSelection {
  readonly hostId: string;
  readonly taskId: string;
}

interface ExternalAgentEntry extends HostContext {
  readonly agent: CompanionAgentSummary;
}

function ExternalActivity({ hosts, onOpenTask }: {
  readonly hosts: readonly HostContext[];
  readonly onOpenTask: (selection: TaskSelection) => void;
}) {
  const externalAgents = useMemo<readonly ExternalAgentEntry[]>(() => hosts.flatMap((host) =>
    (host.state.snapshot?.agents ?? [])
      .filter((agent) => agent.kind === "external" && agent.external)
      .map((agent) => Object.freeze({ ...host, agent }))), [hosts]);
  const [source, setSource] = useState<CompanionExternalExecutionReference["sourceId"] | "all">("all");
  const [project, setProject] = useState("all");
  const [executionState, setExecutionState] = useState<CompanionExternalExecutionReference["state"] | "all">("all");
  const [details, setDetails] = useState<Readonly<Record<string, CompanionExternalExecutionDetail>>>(Object.freeze({}));
  const [loadingDetail, setLoadingDetail] = useState<string>();
  const [error, setError] = useState<string>();
  const projects = useMemo(() => [...new Set(externalAgents.map(({ agent }) => agent.projectPath))].sort(), [externalAgents]);
  const sources = useMemo(() => {
    const labels = new Map<CompanionExternalExecutionReference["sourceId"], string>();
    for (const host of hosts) {
      for (const item of host.state.snapshot?.externalSources ?? []) {
        if (!labels.has(item.id)) labels.set(item.id, item.label);
      }
    }
    return [...labels.entries()];
  }, [hosts]);
  const visible = externalAgents
    .filter(({ agent }) => source === "all" || agent.external?.sourceId === source)
    .filter(({ agent }) => project === "all" || agent.projectPath === project)
    .filter(({ agent }) => executionState === "all" || agent.external?.state === executionState);

  const loadDetail = async (hostId: string, external: CompanionExternalExecutionReference) => {
    const key = `${hostId}:${external.sourceId}:${external.externalId}`;
    if (details[key]) {
      setDetails((current) => {
        const next = { ...current };
        delete next[key];
        return Object.freeze(next);
      });
      return;
    }
    setLoadingDetail(key);
    setError(undefined);
    try {
      const detail = await fleet.getExternalExecutionDetail(hostId, external.sourceId, external.externalId);
      setDetails((current) => Object.freeze({ ...current, [key]: detail }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingDetail(undefined);
    }
  };

  return <section className="external-activity">
    <header><div><small>EXTERNAL EXECUTIONS</small><h2>Claude / Codex 只读活动</h2><p>状态由各台桌面的 Source 读取；手机不会运行 CLI，也不显示伪造的回复或 continue 控件。</p></div></header>
    <div className="external-filters"><label>来源<select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="all">全部来源</option>{sources.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>项目<select value={project} onChange={(event) => setProject(event.target.value)}><option value="all">全部项目</option>{projects.map((path) => <option value={path} key={path}>{path}</option>)}</select></label><label>状态<select value={executionState} onChange={(event) => setExecutionState(event.target.value as typeof executionState)}><option value="all">全部状态</option>{Object.entries(EXTERNAL_STATE_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
    {hosts.flatMap((host) => (host.state.snapshot?.externalSources ?? [])
      .filter((item) => source === "all" || item.id === source)
      .map((item) => item.state !== "ready" || item.stale ? <aside className={`external-source-state is-${item.state}`} key={`${host.hostId}:${item.id}`}><b>{host.hostName} · {item.label} · {item.stale ? "Last good" : item.state}</b><span>{item.stale ? `保留上次成功快照${item.lastSuccessfulAt ? ` · ${relativeTime(item.lastSuccessfulAt)}` : ""}` : item.error}</span>{item.stale && item.error && <small>{item.error}</small>}</aside> : null))}
    {error && <aside className="error-banner"><b>外部详情读取失败</b><span>{error}</span></aside>}
    <div className="external-list">{visible.map(({ hostId, hostName, state, agent }) => {
      const external = agent.external as CompanionExternalExecutionReference;
      const key = `${hostId}:${external.sourceId}:${external.externalId}`;
      const detail = details[key];
      return <article className={`external-card is-${external.state}`} key={`${hostId}:${agent.id}`}><header><span>{hostName} · {agent.sourceLabel ?? external.sourceId}</span><em>{EXTERNAL_STATE_LABEL[external.state]}</em></header><h3>{agent.title}</h3>{agent.summary && <p>{agent.summary}</p>}<dl><div><dt>电脑</dt><dd>{hostName}</dd></div><div><dt>项目</dt><dd>{agent.projectPath}</dd></div><div><dt>Session</dt><dd>{external.nativeId}</dd></div>{external.parentExternalId && <div><dt>Parent</dt><dd>{external.parentExternalId.slice(0, 16)}</dd></div>}<div><dt>更新</dt><dd>{relativeTime(agent.updatedAt)}</dd></div></dl>{agent.freshness?.stale && <aside>该 Source 当前 stale，正在显示 last-good 状态。</aside>}<footer>{external.association && <button type="button" onClick={() => onOpenTask({ hostId, taskId: external.association?.taskId ?? "" })}>打开{external.association.relation === "imported" ? "已导入" : "受管"} Task</button>}{external.detailsAvailable && <button type="button" disabled={state.connection !== "online" || loadingDetail === key} onClick={() => void loadDetail(hostId, external)}>{loadingDetail === key ? "读取中…" : detail ? "收起只读详情" : "查看只读详情"}</button>}<span>只读</span></footer>{detail && <section className="external-detail">{detail.turns.map((turn) => <article key={turn.id}><header><b>{turn.status}</b><time>{turn.completedAt ? relativeTime(turn.completedAt) : turn.startedAt ? relativeTime(turn.startedAt) : ""}</time></header>{turn.items.map((item) => <div key={item.id}><strong>{item.label}</strong>{item.status && <em>{item.status}</em>}{item.text && <pre>{item.text}</pre>}</div>)}</article>)}{detail.turns.length === 0 && <p>该 execution 暂无可显示的记录。</p>}</section>}</article>;
    })}{visible.length === 0 && <div className="empty-state"><div>◌</div><strong>当前筛选没有外部活动</strong><p>Source 尚未刷新、CLI 当前没有任务，或关联的 managed session 已在统一 Agent 视图中去重。</p></div>}</div>
  </section>;
}

export function App() {
  const [fleetState, setFleetState] = useState<CompanionFleetState>(() => fleet.state());
  const [pairingUri, setPairingUri] = useState("");
  const [pairingError, setPairingError] = useState<string>();
  const [pendingHostId, setPendingHostId] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [addingHost, setAddingHost] = useState(false);
  const [hostScope, setHostScope] = useState<string>(ALL_HOSTS);
  const [tab, setTab] = useState<"attention" | "activity">("attention");
  const [mainView, setMainView] = useState<"agents" | "external">("agents");
  const [taskRoom, setTaskRoom] = useState<TaskSelection>();

  const connect = useCallback(async (value: string) => {
    setPairingError(undefined);
    try {
      await fleet.start();
      const hostId = await fleet.pair(value, "Android Companion");
      setPendingHostId(hostId);
    } catch (cause) {
      setPendingHostId(undefined);
      setPairingError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const scanAndConnect = useCallback(async () => {
    setPairingError(undefined);
    setScanning(true);
    try {
      const value = await companionPairingScanner.scan();
      if (!value) return;
      setPairingUri(value);
      setAddingHost(true);
      await connect(value);
    } catch (cause) {
      setPairingError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScanning(false);
    }
  }, [connect]);

  useEffect(() => {
    const unsubscribe = fleet.subscribe(setFleetState);
    let active = true;
    let handledPairUrl: string | undefined;
    const pairUrl = (value: string | undefined) => {
      if (!active || !value?.startsWith("stella://pair") || value === handledPairUrl) return;
      handledPairUrl = value;
      setPairingUri(value);
      setPairingError(undefined);
      setAddingHost(true);
      void fleet.start().then(() => {
        if (active) void connect(value);
      }).catch((cause: unknown) => {
        if (active) setPairingError(cause instanceof Error ? cause.message : String(cause));
      });
    };
    void fleet.start().catch((cause: unknown) => {
      if (active) setPairingError(cause instanceof Error ? cause.message : String(cause));
    });
    let removeUrlListener: (() => Promise<void>) | undefined;
    void CapacitorApp.addListener("appUrlOpen", ({ url }) => pairUrl(url)).then((handle) => {
      if (active) removeUrlListener = () => handle.remove();
      else void handle.remove();
    });
    void CapacitorApp.getLaunchUrl().then((result) => pairUrl(result?.url));
    return () => {
      active = false;
      unsubscribe();
      fleet.stop();
      void removeUrlListener?.();
    };
  }, [connect]);

  const hosts = useMemo<readonly HostContext[]>(() => fleetState.hosts.map(({ hostId, state }) => Object.freeze({
    hostId,
    hostName: state.host?.name ?? state.snapshot?.host.name ?? `Host ${hostId.slice(0, 8)}`,
    state,
  })), [fleetState.hosts]);

  useEffect(() => {
    if (hostScope !== ALL_HOSTS && !hosts.some((host) => host.hostId === hostScope)) setHostScope(ALL_HOSTS);
    if (!pendingHostId) return;
    const pending = hosts.find((host) => host.hostId === pendingHostId);
    if (!pending) {
      setPendingHostId(undefined);
      return;
    }
    if (pending.state.connection === "online") {
      setHostScope(pendingHostId);
      setAddingHost(false);
      setPairingUri("");
      setPendingHostId(undefined);
    }
  }, [hostScope, hosts, pendingHostId]);

  const scopedHosts = hostScope === ALL_HOSTS
    ? hosts
    : hosts.filter((host) => host.hostId === hostScope);
  const singleHost = hostScope === ALL_HOSTS ? undefined : scopedHosts[0];
  const totalOnlineCount = hosts.filter((host) => host.state.connection === "online").length;
  const onlineCount = scopedHosts.filter((host) => host.state.connection === "online").length;
  const snapshots = scopedHosts.flatMap((host) => host.state.snapshot ? [{ host, snapshot: host.state.snapshot }] : []);
  const agentEntries = snapshots.flatMap(({ host, snapshot }) => snapshot.agents.map((agent) => Object.freeze({
    host,
    snapshot,
    agent,
    projectName: snapshot.projects.find((project) => project.path === agent.projectPath)?.name ?? agent.backendId ?? "Stella",
  })));
  const attention = agentEntries.filter(({ agent }) => agent.bucket === "attention");
  const visible = tab === "attention" ? attention : agentEntries;
  const workingCount = agentEntries.filter(({ agent }) => agent.bucket === "working").length;
  const stale = scopedHosts.some(({ state }) => state.connection !== "online" || Boolean(state.snapshot?.freshness.stale));
  const aggregateConnection: CompanionClientState["connection"] = hosts.length === 0
    ? "unpaired"
    : onlineCount === scopedHosts.length && scopedHosts.length > 0
      ? "online"
      : scopedHosts.some(({ state }) => state.connection === "pairing")
        ? "pairing"
        : scopedHosts.some(({ state }) => state.connection === "connecting" || state.connection === "reconnecting")
          ? "connecting"
          : "offline";
  const cardConnection = singleHost?.state.connection ?? aggregateConnection;
  const newestSnapshot = snapshots.reduce<(typeof snapshots)[number] | undefined>((latest, candidate) =>
    !latest || Date.parse(candidate.snapshot.capturedAt) > Date.parse(latest.snapshot.capturedAt) ? candidate : latest, undefined);
  const hostTitle = singleHost?.hostName ?? (hosts.length > 0 ? "全部电脑" : "尚未连接桌面");
  const hostStatus = singleHost ? connectionLabel(singleHost.state.connection) : hosts.length > 0 ? `${onlineCount}/${scopedHosts.length} 在线` : "未配对";
  const hostDescription = singleHost
    ? `${singleHost.state.connection === "online" ? "实时连接" : "桌面必须保持运行"}${singleHost.state.snapshot ? ` · ${relativeTime(singleHost.state.snapshot.capturedAt)}` : ""}`
    : hosts.length > 0
      ? `保持 ${hosts.length} 台电脑的独立连接${newestSnapshot ? ` · ${relativeTime(newestSnapshot.snapshot.capturedAt)}` : ""}`
      : "添加 Mac 或 Windows 后即可远程查看";
  const connectionError = pairingError ?? fleetState.error ?? scopedHosts.find(({ state }) => state.error)?.state.error;
  const pairing = Boolean(pendingHostId && hosts.some((host) => host.hostId === pendingHostId && host.state.connection === "pairing"));
  const showPairing = hosts.length === 0 || addingHost;
  const taskHost = taskRoom ? hosts.find((host) => host.hostId === taskRoom.hostId) : undefined;

  const selectHost = (hostId: string) => {
    setHostScope(hostId);
    setTaskRoom(undefined);
    void fleet.select(hostId).catch((cause: unknown) => {
      setPairingError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const forgetSelectedHost = () => {
    if (!singleHost || !window.confirm(`忘记“${singleHost.hostName}”并删除这台电脑的配对信息？\n\n其他电脑连接不会受影响。`)) return;
    const hostId = singleHost.hostId;
    setHostScope(ALL_HOSTS);
    if (taskRoom?.hostId === hostId) setTaskRoom(undefined);
    void fleet.forget(hostId).catch((cause: unknown) => {
      setPairingError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">S</div>
        <div><strong>Stella Companion</strong><span>v0.5.0 · Protocol 1</span></div>
        <div className="topbar-actions"><button type="button" aria-label="添加电脑" onClick={() => { setAddingHost(true); setPairingError(undefined); }}>＋</button><button type="button" aria-label="忘记当前电脑" disabled={!singleHost} onClick={forgetSelectedHost}>×</button></div>
      </header>

      {hosts.length > 0 && <nav className="host-switcher" aria-label="电脑范围">
        <button type="button" className={hostScope === ALL_HOSTS ? "is-active" : ""} onClick={() => { setHostScope(ALL_HOSTS); setTaskRoom(undefined); }}><i className={totalOnlineCount > 0 ? "is-online" : "is-offline"} />全部电脑</button>
        {hosts.map((host) => <button type="button" className={hostScope === host.hostId ? "is-active" : ""} key={host.hostId} onClick={() => selectHost(host.hostId)}><i className={`is-${host.state.connection}`} />{host.hostName}</button>)}
        <button type="button" onClick={() => { setAddingHost(true); setPairingError(undefined); }}>＋ 添加电脑</button>
      </nav>}

      <section className={`host-card is-${cardConnection}`}>
        <div className="host-card__signal"><i /><i /><i /></div>
        <div><small>{singleHost ? "DESKTOP HOST" : "HOST FLEET"}</small><h1>{hostTitle}</h1><p>{hostDescription}</p></div>
        <span>{hostStatus}</span>
      </section>

      {stale && snapshots.length > 0 && <aside className="stale-banner" role="status"><b>{singleHost ? "离线快照" : "部分电脑离线"}</b><span>在线电脑继续实时更新；离线电脑保留 last-good 快照，恢复 Tailscale 网络后会自动重连。</span></aside>}
      {connectionError && <aside className="error-banner" role="alert"><b>连接提示</b><span>{connectionError}</span></aside>}

      {showPairing && (
        <section className="pairing-card">
          <small>PAIR WITH DESKTOP</small>
          <h2>{hosts.length > 0 ? "添加另一台电脑" : "连接你的 Stella"}</h2>
          <p>Mac、Windows 和手机登录同一个 Tailscale 网络后，在目标电脑的“偏好设置 → Android Companion”生成配对码并直接扫描。每台电脑只需配对一次。</p>
          <button type="button" className="pairing-scan" disabled={scanning || pairing} onClick={() => void scanAndConnect()}>{scanning ? "正在打开相机…" : pairing ? "正在配对…" : "▣ 扫码配对"}</button>
          <div className="pairing-divider"><span>或粘贴配对链接</span></div>
          <textarea aria-label="Companion 配对链接" value={pairingUri} onChange={(event) => setPairingUri(event.target.value)} rows={4} placeholder="stella://pair?endpoint=…" />
          <div className="pairing-actions"><button type="button" className="is-secondary" disabled={!pairingUri.trim() || scanning || pairing} onClick={() => void connect(pairingUri)}>连接粘贴链接</button>{hosts.length > 0 && <button type="button" className="is-secondary" disabled={scanning || pairing} onClick={() => { setAddingHost(false); setPairingUri(""); setPairingError(undefined); }}>取消</button>}</div>
        </section>
      )}

      {snapshots.length > 0 && <>
        <section className="summary-grid">
          <article><span>需要处理</span><strong>{attention.length}</strong><small>Attention</small></article>
          <article><span>正在执行</span><strong>{workingCount}</strong><small>Working</small></article>
          <article><span>{singleHost ? "Host 序列" : "在线电脑"}</span><strong>{singleHost?.state.snapshot?.sequence ?? onlineCount}</strong><small>{stale ? "Partial / last good" : "Live updates"}</small></article>
        </section>

        {mainView === "agents" ? <section className="task-section">
          <header><div><small>AGENT ACTIVITY</small><h2>任务动态</h2></div><div className="segmented"><button className={tab === "attention" ? "is-active" : ""} onClick={() => setTab("attention")}>Attention</button><button className={tab === "activity" ? "is-active" : ""} onClick={() => setTab("activity")}>全部</button></div></header>
          <div className="task-list">
            {visible.map(({ host, agent, projectName }) => <article className={`task-card is-${agent.bucket}`} key={`${host.hostId}:${agent.id}`}>
              <header><span><StatusMark bucket={agent.bucket} />{agent.title}</span><em>{BUCKET_LABEL[agent.bucket]}</em></header>
              <h3>{agent.taskTitle ?? "未关联 Task"}</h3><p>{agent.waitingFor ?? agent.summary ?? "等待下一次状态更新"}</p>
              <footer><span>{host.hostName} · {projectName}</span><time>{relativeTime(agent.updatedAt)}</time></footer>
              {agent.taskId && <button type="button" onClick={() => setTaskRoom({ hostId: host.hostId, taskId: agent.taskId as string })}>打开 Task Room <b>→</b></button>}
            </article>)}
            {visible.length === 0 && <div className="empty-state"><div>✓</div><strong>当前没有{tab === "attention" ? "待处理" : " Agent"}事项</strong><p>{tab === "attention" ? "切换到“全部”查看正在执行与最近完成的任务。" : "所选电脑有 Agent 活动后会自动显示。"}</p></div>}
          </div>
        </section> : <ExternalActivity hosts={scopedHosts} onOpenTask={setTaskRoom} />}
      </>}

      <footer className="bottom-nav"><button className={mainView === "agents" && tab === "attention" ? "is-active" : ""} onClick={() => { setMainView("agents"); setTab("attention"); }}><span>⌁</span>Attention</button><button className={mainView === "agents" && tab === "activity" ? "is-active" : ""} onClick={() => { setMainView("agents"); setTab("activity"); }}><span>▦</span>Tasks</button><button className={mainView === "external" ? "is-active" : ""} onClick={() => setMainView("external")}><span>◌</span>External</button></footer>
      {taskRoom && taskHost?.state.snapshot && <TaskRoom hostId={taskHost.hostId} hostName={taskHost.hostName} taskId={taskRoom.taskId} sequence={taskHost.state.snapshot.sequence} online={taskHost.state.connection === "online"} onClose={() => setTaskRoom(undefined)} />}
    </main>
  );
}
