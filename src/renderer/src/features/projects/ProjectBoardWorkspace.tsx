import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Archive, ArrowRight, FolderKanban, FolderOpen, Menu, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import type { ProjectMeta, StellaDesktopApi } from "@shared/contracts";
import { filterProjectBoard, projectBoardCards, type ProjectBoardCard, type ProjectBoardFilter } from "@shared/project-board";
import { PROJECT_STAGES, PROJECT_STAGE_LABEL, type ProjectStage, type RegisteredProject } from "@shared/project-registry";
import { sameProjectPath } from "@shared/project-path";
import type { KanbanController } from "../../hooks/use-kanban";
import type { ProjectRegistryController } from "../../hooks/use-project-registry";
import { LANE_CONFIG, PRIORITY_LABEL, STAGE_LABEL } from "../kanban/kanban-format";
import { ProjectCard, ProjectProgress } from "./ProjectCard";
import { ProjectEditorDialog } from "./ProjectEditorDialog";

interface Props {
  readonly api: StellaDesktopApi;
  readonly controller: ProjectRegistryController;
  readonly kanban: KanbanController;
  readonly project?: ProjectMeta;
  readonly taskError?: string;
  readonly onOpenSidebar: () => void;
  readonly onViewTasks: (path: string, taskId?: string) => void;
  readonly onOpenWorkspace: (path: string) => Promise<void>;
  readonly onRetryTasks: () => void;
  readonly onError: (message: string) => void;
  readonly createRequest: number;
  readonly onCreateRequestConsumed: () => void;
}

export function ProjectBoardWorkspace({ api, controller, kanban, project, taskError, onOpenSidebar, onViewTasks, onOpenWorkspace, onRetryTasks, onError, createRequest, onCreateRequestConsumed }: Props) {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [activity, setActivity] = useState<ProjectBoardFilter["activity"]>("all");
  const [sort, setSort] = useState<ProjectBoardFilter["sort"]>("activity");
  const [view, setView] = useState<"overview" | "stages">("overview");
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<RegisteredProject | "new">();
  const [opening, setOpening] = useState(false);
  const [dropStage, setDropStage] = useState<ProjectStage>();
  const detailRef = useRef<HTMLElement>(null);
  // Parent requests are consumed once; direct in-page actions use the same editor.
  const showCreate = createRequest > 0 || editing === "new";
  const closeEditor = () => { setEditing(undefined); onCreateRequestConsumed(); };
  const boardError = taskError ?? kanban.state.error;
  const board = !boardError && kanban.state.phase === "ready" ? kanban.state.bootstrap?.board : undefined;
  const cards = useMemo(() => projectBoardCards(controller.snapshot?.projects ?? [], board), [controller.snapshot?.projects, board]);
  const visible = useMemo(() => filterProjectBoard(cards, { query, archived, activity: board ? activity : "all", sort }), [cards, query, archived, activity, sort, board]);
  const selected = visible.find((card) => card.project.id === selectedId);
  useEffect(() => {
    const detail = detailRef.current;
    if (!detail || !window.matchMedia("(max-width: 900px)").matches) return;
    const content = detail.parentElement;
    if (content) content.scrollTo({ top: content.scrollTop + detail.getBoundingClientRect().top - content.getBoundingClientRect().top });
    detail.focus({ preventScroll: true });
  }, [selected?.project.id]);
  const busy = controller.busy || opening;
  const report = (cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause));
  const update = (value: Parameters<ProjectRegistryController["update"]>[0]) => { void controller.update(value).catch(report); };
  const openWorkspace = async (path: string) => {
    setOpening(true);
    try { await onOpenWorkspace(path); }
    catch (cause) { report(cause); }
    finally { setOpening(false); }
  };
  const drop = (event: DragEvent, stage: ProjectStage) => {
    event.preventDefault();
    setDropStage(undefined);
    const id = event.dataTransfer.getData("application/x-stella-project");
    const item = visible.find((card) => card.project.id === id);
    if (!busy && item && !item.project.archived && item.project.stage !== stage) update({ projectId: id, stage });
  };
  const renderCard = (card: ProjectBoardCard) => <ProjectCard key={card.project.id} card={card} directory={controller.snapshot?.directories[card.project.id]}
    current={sameProjectPath(card.project.path, project?.cwd) && !project?.requiresSelection} selected={card.project.id === selected?.project.id} busy={busy}
    onSelect={() => setSelectedId(card.project.id)} onPin={() => update({ projectId: card.project.id, pinned: !card.project.pinned })} onStage={(stage) => update({ projectId: card.project.id, stage })} />;

  return <main className="project-workspace">
    <header className="project-header"><button type="button" className="icon-button" aria-label="打开侧栏" onClick={onOpenSidebar}><Menu size={18} /></button>
      <span className="project-header__icon"><FolderKanban size={22} /></span><div><small>STELLA PROJECTS</small><h1>项目看板</h1></div>
      <div className="project-header__actions"><button type="button" className="button-secondary" disabled={controller.loading || busy} onClick={() => { void controller.refresh(); }}><RefreshCw size={15} />{controller.loading ? "正在刷新" : "刷新项目"}</button>
        <button type="button" className="button-primary" disabled={busy || Boolean(controller.error)} onClick={() => setEditing("new")}><Plus size={15} />添加项目</button></div>
    </header>
    <div className="project-toolbar"><label className="project-search"><Search size={15} /><input aria-label="搜索项目" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、目录或任务…" />{query && <button type="button" aria-label="清除项目搜索" onClick={() => setQuery("")}><X size={13} /></button>}</label>
      <label className="project-filter">范围<select aria-label="项目归档筛选" value={archived ? "archived" : "active"} onChange={(event) => setArchived(event.target.value === "archived")}><option value="active">活跃项目</option><option value="archived">已归档</option></select></label>
      <label className="project-filter">任务<select aria-label="项目活动筛选" value={board ? activity : "all"} disabled={!board} onChange={(event) => setActivity(event.target.value as ProjectBoardFilter["activity"])}><option value="all">全部</option><option value="attention">需处理</option><option value="executing">有执行或排队</option></select></label>
      <label className="project-filter">排序<select aria-label="项目排序" value={sort} onChange={(event) => setSort(event.target.value as ProjectBoardFilter["sort"])}><option value="activity">最近活动</option><option value="name">名称</option></select></label>
    </div>
    <div className="project-viewbar"><div className="project-view-switch" role="group" aria-label="项目显示方式"><button type="button" aria-pressed={view === "overview"} onClick={() => setView("overview")}>总览</button><button type="button" aria-pressed={view === "stages"} onClick={() => setView("stages")}>阶段看板</button></div>
      <span>{visible.length} 个项目{board && ` · ${visible.reduce((sum, card) => sum + (card.summary?.attention.length ?? 0), 0)} 项需处理`}</span></div>
    {controller.error && <div className="project-error" role="alert">项目清单操作失败：{controller.error}。请重新读取以核对已保存状态。<button type="button" disabled={controller.loading} onClick={() => { void controller.refresh(); }}>重新读取项目</button></div>}
    {controller.snapshot?.discoveryWarning && <div className="project-notice" role="status">{controller.snapshot.discoveryWarning}</div>}
    {!board && <div className="project-notice" role={boardError ? "alert" : "status"}>{boardError ? `任务统计暂不可用：${boardError}` : "正在读取任务状态…"}{boardError && <button type="button" onClick={onRetryTasks}>重试任务数据</button>}</div>}
    <div className={`project-content ${selected ? "has-selection" : ""}`}>
      <section className="project-list" aria-label={archived ? "已归档项目" : "活跃项目"} aria-busy={controller.loading}>
        {!controller.snapshot && controller.loading ? <div className="project-empty"><RefreshCw size={26} /><h2>正在读取项目清单</h2><p>恢复本机项目与历史任务归属。</p></div>
          : !visible.length ? <div className="project-empty"><FolderKanban size={32} /><h2>{controller.error && !controller.snapshot ? "项目清单没有加载成功" : query || activity !== "all" ? "没有符合筛选条件的项目" : archived ? "暂无归档项目" : "把项目放到同一张看板"}</h2>
            <p>{query || activity !== "all" ? "调整搜索词或任务筛选，查看其他项目。" : archived ? "归档项目会保留任务和目录，可随时恢复。" : "添加一个本地目录；已有项目会从访问与任务记录中恢复。"}</p>
            {query || activity !== "all" ? <button type="button" className="button-secondary" onClick={() => { setQuery(""); setActivity("all"); }}>清除筛选</button> : !archived && !controller.error && <button type="button" className="button-primary" onClick={() => setEditing("new")}><Plus size={15} />添加第一个项目</button>}</div>
            : view === "overview" ? <div className="project-grid">{visible.map(renderCard)}</div>
              : <><p className="project-stage-hint">拖动卡片或选择阶段来整理项目。任务运行与验收按各自状态推进。</p><div className="project-lanes">{PROJECT_STAGES.map((stage) => <section key={stage} aria-label={`${PROJECT_STAGE_LABEL[stage]}项目`} className={`project-lane ${dropStage === stage ? "is-drop-target" : ""}`}
                onDragOver={(event) => { if (!busy && event.dataTransfer.types.includes("application/x-stella-project")) { event.preventDefault(); setDropStage(stage); } }} onDragLeave={() => setDropStage(undefined)} onDrop={(event) => drop(event, stage)}>
                <h2>{PROJECT_STAGE_LABEL[stage]}<span>{visible.filter((card) => card.project.stage === stage).length}</span></h2>{visible.filter((card) => card.project.stage === stage).map(renderCard)}
                {!visible.some((card) => card.project.stage === stage) && <p className="project-lane__empty">暂无项目</p>}</section>)}</div></>}
      </section>
      {selected && <aside ref={detailRef} tabIndex={-1} className="project-detail" aria-label={`项目详情 ${selected.project.name}`}>
        <header><small>PROJECT DETAIL</small><button type="button" className="icon-button" aria-label="关闭项目详情" onClick={() => setSelectedId(undefined)}><X size={16} /></button></header>
        <h2>{selected.project.name}</h2><p className="project-detail__description">{selected.project.description || "尚未填写项目说明"}</p><code>{selected.project.path}</code>
        <div className="project-detail__directory" role="status">{controller.snapshot?.directories[selected.project.id]?.state === "available" ? "目录已检查，可打开工作区" : controller.snapshot?.directories[selected.project.id]?.detail ?? "目录尚未检查"}</div>
        <div className="project-detail__actions"><button type="button" className="button-secondary" disabled={busy} onClick={() => setEditing(selected.project)}><Pencil size={14} />编辑项目</button>
          <button type="button" className="button-secondary" disabled={busy || controller.snapshot?.directories[selected.project.id]?.state !== "available"} onClick={() => { void openWorkspace(selected.project.path); }}><FolderOpen size={14} />{opening ? "正在打开…" : "打开工作区"}</button></div>
        {selected.project.archived && <p className="project-notice"><Archive size={14} />此项目已归档<button type="button" disabled={busy} onClick={() => update({ projectId: selected.project.id, archived: false })}>恢复项目</button></p>}
        <ProjectProgress summary={selected.summary} />
        {selected.summary && <div className="project-detail__stages">{LANE_CONFIG.map((lane) => <span key={lane.id}><i className={`project-stage-color--${lane.id}`} />{lane.label}<strong>{selected.summary?.stages[lane.id]}</strong></span>)}</div>}
        <button type="button" className="button-primary project-detail__view-tasks" onClick={() => onViewTasks(selected.project.path)}>查看任务看板<ArrowRight size={15} /></button>
        <ProjectTaskList card={selected} onViewTasks={onViewTasks} />
      </aside>}
    </div>
    {(showCreate || editing) && <ProjectEditorDialog project={editing && editing !== "new" ? editing : undefined} api={api} controller={controller} onClose={closeEditor} />}
  </main>;
}

function ProjectTaskList({ card, onViewTasks }: { readonly card: ProjectBoardCard; readonly onViewTasks: Props["onViewTasks"] }) {
  const reasons = new Map(card.summary?.attention.map((item) => [item.taskId, item.reasons.join("；")]));
  return <section className="project-detail__tasks" aria-label="项目任务" tabIndex={0}><h3>项目任务{card.summary && <span>{card.summary.total}</span>}</h3>
    {!card.summary ? <p>任务数据恢复后显示项目任务。</p> : card.summary.tasks.length ? card.summary.tasks.map((task) => <button type="button" key={task.id} onClick={() => onViewTasks(card.project.path, task.id)}>
      <span><strong>{task.title}</strong><small>{PRIORITY_LABEL[task.priority]}优先级 · {STAGE_LABEL[task.stage]}</small>{reasons.has(task.id) && <em>{reasons.get(task.id)}</em>}</span><ArrowRight size={13} /></button>) : <p>打开工作区后，可以在任务看板中新建任务。</p>}
  </section>;
}
