import { AlertCircle, ArrowUpRight, Pin } from "lucide-react";
import type { ProjectBoardCard, ProjectTaskSummary } from "@shared/project-board";
import { PROJECT_STAGES, PROJECT_STAGE_LABEL, type ProjectDirectoryStatus, type ProjectStage } from "@shared/project-registry";
import { LANE_CONFIG } from "../kanban/kanban-format";

export function ProjectProgress({ summary }: { readonly summary?: ProjectTaskSummary }) {
  if (!summary) return <p className="project-card__unknown">任务统计暂不可用</p>;
  if (!summary.total) return <p className="project-card__unknown">尚无任务</p>;
  return <div className="project-progress">
    <div className="project-progress__label"><span>已完成 {summary.completed} / {summary.total} 项</span><strong>{summary.completionPercent}%</strong></div>
    <div className="project-progress__track" role="img" aria-label={LANE_CONFIG.map((lane) => `${lane.label} ${summary.stages[lane.id]} 项`).join("，")}>
      {LANE_CONFIG.map((lane) => summary.stages[lane.id] > 0 && <span key={lane.id} className={`project-stage-color--${lane.id}`} style={{ flex: summary.stages[lane.id] }} title={`${lane.label} ${summary.stages[lane.id]} 项`} />)}
    </div>
    <div className="project-progress__counts"><span className={summary.attention.length ? "needs-attention" : ""}>{summary.attention.length} 需处理</span><span>{summary.stages.running} 执行中</span><span>{summary.stages.queued} 排队</span></div>
  </div>;
}

interface Props {
  readonly card: ProjectBoardCard;
  readonly directory?: ProjectDirectoryStatus;
  readonly current: boolean;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onPin: () => void;
  readonly onStage: (stage: ProjectStage) => void;
}

export function ProjectCard({ card: { project, summary }, directory, current, selected, busy, onSelect, onPin, onStage }: Props) {
  return <article className={`project-card ${selected ? "is-selected" : ""}`} aria-label={`项目 ${project.name}`} draggable={!busy && !project.archived}
    onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-stella-project", project.id); }}>
    <header><span className={`project-card__stage project-card__stage--${project.stage}`}>{PROJECT_STAGE_LABEL[project.stage]}</span>{current && <span className="project-card__current">当前工作区</span>}
      <button type="button" className={`icon-button ${project.pinned ? "is-pinned" : ""}`} aria-label={`${project.pinned ? "取消置顶" : "置顶"} ${project.name}`} aria-pressed={project.pinned} disabled={busy} onClick={onPin}><Pin size={14} /></button></header>
    <button type="button" className="project-card__body" aria-label={`查看项目 ${project.name}`} aria-pressed={selected} onClick={onSelect}>
      <h2>{project.name}<ArrowUpRight size={16} /></h2><p className="project-card__description">{project.description || "添加说明，记录项目目标与当前重点"}</p><code title={project.path}>{project.path}</code>
      <ProjectProgress summary={summary} />
      {directory && directory.state !== "available" && <span className="project-card__directory-error"><AlertCircle size={13} />{directory.state === "missing" ? "目录不存在" : directory.state === "moved" ? "目录位置已变化" : "目录不可访问"}</span>}
      {project.stage === "completed" && summary && summary.total > summary.completed && <span className="project-card__unfinished">仍有 {summary.total - summary.completed} 项任务未完成</span>}
    </button>
    <footer><label>项目阶段<select aria-label={`项目阶段 ${project.name}`} value={project.stage} disabled={busy} onChange={(event) => onStage(event.target.value as ProjectStage)}>{PROJECT_STAGES.map((stage) => <option key={stage} value={stage}>{PROJECT_STAGE_LABEL[stage]}</option>)}</select></label></footer>
  </article>;
}
