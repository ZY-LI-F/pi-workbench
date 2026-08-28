import { useMemo, useState } from "react";
import { Bot, CheckCircle2, ChevronUp, Clock3, Copy, Eye, ExternalLink, Import, Link2, RefreshCw, ShieldAlert, TerminalSquare } from "lucide-react";
import type {
  ExternalExecutionCatalogSnapshot,
  ExternalExecutionDetails,
  ExternalExecutionItem,
  ExternalExecutionSourceId,
  ExternalExecutionState,
} from "@shared/external-execution";
import { projectExternalExecutionCards } from "@shared/agent-projection";
import { formatRelativeTime } from "./kanban-format";

const STATE_LABEL: Readonly<Record<ExternalExecutionState, string>> = Object.freeze({
  working: "执行中",
  "needs-input": "等待输入",
  idle: "空闲",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
  unknown: "未知",
});

interface ExternalExecutionBoardProps {
  readonly snapshot?: ExternalExecutionCatalogSnapshot;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error?: string;
  readonly busy: readonly string[];
  readonly details: Readonly<Record<string, ExternalExecutionDetails>>;
  readonly query: string;
  readonly onRefresh: () => Promise<unknown>;
  readonly onImport: (item: ExternalExecutionItem) => Promise<{ readonly taskId: string; readonly created: boolean }>;
  readonly onContinue: (item: ExternalExecutionItem) => Promise<{ readonly message: string }>;
  readonly onLoadDetails: (item: ExternalExecutionItem) => Promise<ExternalExecutionDetails>;
  readonly onOpenTask: (taskId: string) => void;
  readonly compact?: boolean;
  readonly hideManaged?: boolean;
}

function itemKey(item: ExternalExecutionItem): string {
  return `${item.sourceId}:${item.externalId}`;
}

export function ExternalExecutionBoard({
  snapshot,
  loading,
  refreshing,
  error,
  busy,
  details,
  query,
  onRefresh,
  onImport,
  onContinue,
  onLoadDetails,
  onOpenTask,
  compact = false,
  hideManaged = false,
}: ExternalExecutionBoardProps) {
  const [sourceFilter, setSourceFilter] = useState<ExternalExecutionSourceId | "all">("all");
  const [stateFilter, setStateFilter] = useState<ExternalExecutionState | "all">("all");
  const [notice, setNotice] = useState("");
  const [expandedDetails, setExpandedDetails] = useState<string>();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const items = useMemo(() => projectExternalExecutionCards(snapshot)
    .flatMap((card) => card.external ? [card.external] : [])
    .filter((item) => sourceFilter === "all" || item.sourceId === sourceFilter)
    .filter((item) => stateFilter === "all" || item.state === stateFilter)
    .filter((item) => !hideManaged || item.association?.relation !== "managed")
    .filter((item) => !normalizedQuery || `${item.title} ${item.summary ?? ""} ${item.projectPath} ${item.nativeId}`.toLocaleLowerCase().includes(normalizedQuery)),
  [hideManaged, normalizedQuery, snapshot, sourceFilter, stateFilter]);

  const perform = async (action: () => Promise<void>) => {
    setNotice("");
    try { await action(); } catch { /* Hook exposes the exact error. */ }
  };

  return (
    <section className={`external-execution-board ${compact ? "is-compact" : ""}`} aria-label={compact ? "外部 CLI 活动" : "外部 CLI 任务"}>
      <header className="external-execution-board__header">
        <div><small>EXTERNAL EXECUTIONS</small><h2>{compact ? "外部 CLI 活动" : "外部 CLI 任务"}</h2><p>{compact ? "已由 Stella 管理的 session 在全部视图中自动去重。" : "只读显示 CLI 原生状态；只有显式导入才会创建独立 Stella Task。"}</p></div>
        <button type="button" className="button-secondary" disabled={refreshing} onClick={() => void perform(async () => { await onRefresh(); })}><RefreshCw className={refreshing ? "is-spinning" : ""} size={14} />{refreshing ? "刷新中" : "刷新"}</button>
      </header>

      <div className="external-execution-board__filters">
        <div role="tablist" aria-label="外部任务来源">
          <button type="button" role="tab" aria-selected={sourceFilter === "all"} className={sourceFilter === "all" ? "is-active" : ""} onClick={() => setSourceFilter("all")}>全部来源</button>
          {snapshot?.sources.map((source) => <button type="button" role="tab" aria-selected={sourceFilter === source.source.id} className={sourceFilter === source.source.id ? "is-active" : ""} key={source.source.id} onClick={() => setSourceFilter(source.source.id)}>{source.source.label}<b>{source.items.length}</b></button>)}
        </div>
        <label><span>状态</span><select aria-label="外部任务状态" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as ExternalExecutionState | "all")}><option value="all">全部状态</option>{Object.entries(STATE_LABEL).map(([state, label]) => <option value={state} key={state}>{label}</option>)}</select></label>
      </div>

      {snapshot?.sources.map((source) => source.state !== "ready" || source.stale ? (
        <div className={`external-source-health is-${source.state}`} role="status" key={source.source.id}>
          <ShieldAlert size={14} /><strong>{source.source.label}</strong><span>{source.stale ? `正在显示 ${source.lastSuccessfulAt ? formatRelativeTime(source.lastSuccessfulAt) : "上次"}的最后成功快照` : source.error}</span>{source.stale && source.error && <small>{source.error}</small>}
        </div>
      ) : null)}
      {error && <div className="kanban-inline-error" role="alert">{error}</div>}
      {notice && <div className="external-execution-notice" role="status">{notice}</div>}

      {loading && !snapshot ? <div className="external-execution-empty"><RefreshCw className="is-spinning" size={20} /><strong>正在读取 CLI 原生任务</strong></div> : (
        <div className="external-execution-grid">
          {items.map((item) => {
            const key = itemKey(item);
            const source = snapshot?.sources.find((candidate) => candidate.source.id === item.sourceId)?.source;
            const importing = busy.includes(`import:${key}`);
            const continuing = busy.includes(`continue:${key}`);
            const loadingDetails = busy.includes(`details:${key}`);
            const detail = details[key];
            const detailsOpen = expandedDetails === key;
            return (
              <article className={`external-execution-card is-${item.state}`} data-readonly="true" key={key}>
                <header><span><Bot size={15} />{source?.label ?? item.sourceId}</span><em>{STATE_LABEL[item.state]}</em></header>
                <h3>{item.title}</h3>
                {item.summary && <p>{item.summary}</p>}
                <dl>
                  <div><dt><TerminalSquare size={12} />Session</dt><dd title={item.externalId}>{item.nativeId}</dd></div>
                  <div><dt><Clock3 size={12} />更新</dt><dd>{formatRelativeTime(item.updatedAt)}</dd></div>
                  <div><dt>目录</dt><dd title={item.projectPath}>{item.projectPath}</dd></div>
                  {item.process && <div><dt>Process</dt><dd>{item.process.pid ? `PID ${item.process.pid}` : "无活动进程"} · {item.process.status ?? (item.process.alive ? "alive" : "exited")}</dd></div>}
                  {item.parentExternalId && <div><dt>Parent</dt><dd title={item.parentExternalId}>{item.parentExternalId.slice(0, 12)}</dd></div>}
                </dl>
                {item.needsInput && <div className="external-execution-card__waiting"><ShieldAlert size={13} />{item.waitingFor ?? "Claude 正在等待你的输入"}</div>}
                <footer>
                  {item.association ? <button type="button" className="button-secondary" onClick={() => onOpenTask(item.association?.taskId ?? "")}><Link2 size={13} />{item.association.relation === "managed" ? "打开受管 Task" : "打开已导入 Task"}</button>
                    : source?.capabilities.import && <button type="button" className="button-secondary" disabled={importing} onClick={() => void perform(async () => { const result = await onImport(item); setNotice(result.created ? "已导入为独立手工 Task" : "该 session 已经导入"); onOpenTask(result.taskId); })}><Import size={13} />{importing ? "导入中" : "导入为 Task"}</button>}
                  {source?.capabilities.continue && <button type="button" className="button-secondary" disabled={continuing} onClick={() => void perform(async () => { const result = await onContinue(item); setNotice(`已复制继续命令：${result.message}`); })}>{continuing ? <RefreshCw className="is-spinning" size={13} /> : <Copy size={13} />}继续 Session</button>}
                  {source?.capabilities.details && <button type="button" className="button-secondary" disabled={loadingDetails} aria-expanded={detailsOpen} onClick={() => void perform(async () => {
                    if (detailsOpen) { setExpandedDetails(undefined); return; }
                    setExpandedDetails(key);
                    if (!detail) await onLoadDetails(item);
                  })}>{loadingDetails ? <RefreshCw className="is-spinning" size={13} /> : detailsOpen ? <ChevronUp size={13} /> : <Eye size={13} />}{detailsOpen ? "收起详情" : "查看详情"}</button>}
                  <span className="external-execution-card__readonly"><CheckCircle2 size={12} />只读</span>
                </footer>
                {detailsOpen && <section className="external-execution-card__details" aria-label={`${item.title} 详情`}>
                  {loadingDetails && !detail ? <div><RefreshCw className="is-spinning" size={14} />正在读取 Codex Turns</div> : detail?.turns.length ? detail.turns.map((turn) => <article key={turn.id}>
                    <header><strong>{turn.status}</strong><span>{turn.completedAt ? formatRelativeTime(turn.completedAt) : turn.startedAt ? formatRelativeTime(turn.startedAt) : turn.id.slice(0, 8)}</span></header>
                    {turn.items.map((entry) => <div className={`is-${entry.type}`} key={entry.id}><b>{entry.label}</b>{entry.status && <em>{entry.status}</em>}{entry.text && <pre>{entry.text}</pre>}</div>)}
                  </article>) : !loadingDetails && <div>该 Thread 暂无可显示的 Turn。</div>}
                </section>}
              </article>
            );
          })}
          {items.length === 0 && <div className="external-execution-empty"><ExternalLink size={20} /><strong>当前筛选没有外部任务</strong><p>当前 CLI 没有匹配的 Agent 或 Thread，或 Source 暂时不可用。</p></div>}
        </div>
      )}
    </section>
  );
}
