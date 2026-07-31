import {
  ChevronDown,
  GitBranch,
  Menu,
  MoonStar,
  ListPlus,
  MessagesSquare,
  PanelRight,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import type { PiThinkingLevel, RuntimeBootstrap } from "@shared/contracts";

interface TopbarProps {
  readonly bootstrap: RuntimeBootstrap;
  readonly streaming: boolean;
  readonly compacting: boolean;
  readonly retrying: boolean;
  readonly online: boolean;
  readonly onOpenSidebar: () => void;
  readonly onFocusSession: () => void;
  readonly onNewSession: () => void;
  readonly onToggleInspector: () => void;
  readonly onOpenSettings: () => void;
  readonly onThinkingChange: (level: string) => void;
  readonly onAbortRetry: () => void;
  readonly onSolidifyTask?: () => void;
}

function activityLabel(streaming: boolean, compacting: boolean, retrying: boolean, online: boolean): string {
  if (!online) return "Pi 暂不可用";
  if (compacting) return "正在压缩上下文";
  if (retrying) return "等待重试";
  if (streaming) return "Pi 正在工作";
  return "已就绪";
}

export function Topbar({
  bootstrap,
  streaming,
  compacting,
  retrying,
  online,
  onOpenSidebar,
  onFocusSession,
  onNewSession,
  onToggleInspector,
  onOpenSettings,
  onThinkingChange,
  onAbortRetry,
  onSolidifyTask,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar__project">
        <button type="button" className="icon-button topbar__menu" aria-label="打开侧栏" onClick={onOpenSidebar}>
          <Menu size={18} />
        </button>
        <nav className="topbar__session-track" aria-label="会话快捷操作">
          <button type="button" className="is-current" aria-current="page" aria-label="聚焦当前会话" onClick={onFocusSession}><MessagesSquare size={13} /><span>当前会话</span></button>
          <button type="button" disabled={!online} onClick={onNewSession}><Plus size={13} /><span>新建会话</span></button>
        </nav>
        <div className="project-breadcrumb">
          <span>{bootstrap.project.name}</span>
          {bootstrap.project.branch && <><i>/</i><GitBranch size={13} /><strong>{bootstrap.project.branch}</strong></>}
        </div>
      </div>

      <div className="topbar__controls">
        {onSolidifyTask && (
          <button type="button" className="button-secondary topbar__task-bridge" onClick={onSolidifyTask}>
            <ListPlus size={14} /><span>固化为任务</span>
          </button>
        )}
        <label className="select-control thinking-control">
          <MoonStar size={13} />
          <span className="sr-only">思考级别</span>
          <select value={bootstrap.state.thinkingLevel} disabled={!online} onChange={(event) => onThinkingChange(event.target.value)}>
            {bootstrap.thinkingLevels.map((level: PiThinkingLevel) => <option key={level} value={level}>{level}</option>)}
          </select>
          <ChevronDown size={13} />
        </label>
        {retrying ? (
          <button type="button" className="activity-pill is-active" aria-label="停止自动重试" onClick={onAbortRetry}>
          <span />{activityLabel(streaming, compacting, retrying, online)}<X size={12} />
          </button>
        ) : (
          <span className={`activity-pill ${streaming ? "is-active" : ""} ${online ? "" : "is-offline"}`}>
            <span />{activityLabel(streaming, compacting, retrying, online)}
          </span>
        )}
        <button type="button" className="icon-button" aria-label="会话检查器" disabled={!online} onClick={onToggleInspector}>
          <PanelRight size={17} />
        </button>
        <button type="button" className="icon-button" aria-label="设置" onClick={onOpenSettings}>
          <Settings2 size={17} />
        </button>
      </div>
    </header>
  );
}
