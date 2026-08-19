import {
  BrainCircuit,
  ChevronDown,
  Copy,
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
import { HeaderOverflowMenu } from "./HeaderOverflowMenu";

interface TopbarProps {
  readonly bootstrap: RuntimeBootstrap;
  readonly streaming: boolean;
  readonly compacting: boolean;
  readonly retrying: boolean;
  readonly online: boolean;
  readonly onOpenSidebar: () => void;
  readonly onFocusSession: () => void;
  readonly onNewSession: () => void;
  readonly sessionAddress?: string;
  readonly onCopySessionAddress: (address: string) => void;
  readonly onToggleInspector: () => void;
  readonly onOpenModels: () => void;
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
  sessionAddress,
  onCopySessionAddress,
  onToggleInspector,
  onOpenModels,
  onOpenSettings,
  onThinkingChange,
  onAbortRetry,
  onSolidifyTask,
}: TopbarProps) {
  const currentModel = bootstrap.state.model;
  const currentModelLabel = currentModel
    ? `${currentModel.provider} / ${currentModel.name || currentModel.id}`
    : "未选择模型";

  return (
    <header className="topbar">
      <div className="topbar__project">
        <button type="button" className="icon-button topbar__menu" aria-label="打开侧栏" onClick={onOpenSidebar}>
          <Menu size={18} />
        </button>
        <nav className="topbar__session-track" aria-label="会话快捷操作">
          <button type="button" className="is-current" aria-current="page" aria-label="聚焦当前会话" onClick={onFocusSession}><MessagesSquare size={13} /><span>当前会话</span></button>
          <button type="button" disabled={!online} onClick={onNewSession}><Plus size={13} /><span>新建会话</span></button>
          <button
            type="button"
            aria-label="复制 Session 地址"
            title={sessionAddress ?? "当前会话尚未生成 session 文件"}
            disabled={!sessionAddress}
            onClick={() => { if (sessionAddress) onCopySessionAddress(sessionAddress); }}
          ><Copy size={13} /><span>复制地址</span></button>
        </nav>
        <div className="project-breadcrumb">
          <span>{bootstrap.project.name}</span>
          {bootstrap.project.branch && <><i>/</i><GitBranch size={13} /><strong>{bootstrap.project.branch}</strong></>}
        </div>
      </div>

      <div className="topbar__controls">
        <button
          type="button"
          className="topbar__model"
          aria-label={`当前模型：${currentModelLabel}，打开模型配置`}
          title={`${currentModel?.provider ?? "Pi Runtime"} / ${currentModel?.id ?? "未选择"}`}
          onClick={onOpenModels}
        >
          <BrainCircuit size={14} />
          <span>{currentModelLabel}</span>
        </button>
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
        <HeaderOverflowMenu
          className="topbar__more"
          ariaLabel="更多会话操作"
          status={activityLabel(streaming, compacting, retrying, online)}
          actions={[
            {
              id: "focus-session",
              label: "当前会话",
              description: "返回并聚焦当前 Pi 会话",
              icon: <MessagesSquare size={14} />,
              onSelect: onFocusSession,
            },
            {
              id: "new-session",
              label: "新建会话",
              description: "在当前项目中开始新的 Pi 会话",
              icon: <Plus size={14} />,
              disabled: !online,
              onSelect: onNewSession,
            },
            {
              id: "copy-session-address",
              label: "复制 Session 地址",
              description: sessionAddress ?? "当前会话尚未生成 session 文件",
              icon: <Copy size={14} />,
              disabled: !sessionAddress,
              onSelect: () => { if (sessionAddress) onCopySessionAddress(sessionAddress); },
            },
            {
              id: "models",
              label: "模型配置",
              description: currentModelLabel,
              icon: <BrainCircuit size={14} />,
              onSelect: onOpenModels,
            },
            ...(onSolidifyTask ? [{
              id: "solidify-task",
              label: "固化为任务",
              description: "把当前 Pi 会话加入任务看板",
              icon: <ListPlus size={14} />,
              onSelect: onSolidifyTask,
            }] : []),
            ...bootstrap.thinkingLevels.map((level: PiThinkingLevel) => ({
              id: `thinking-${level}`,
              label: `思考级别：${level}`,
              description: level === bootstrap.state.thinkingLevel ? "当前选择" : "切换当前会话思考级别",
              icon: <MoonStar size={14} />,
              disabled: !online,
              selected: level === bootstrap.state.thinkingLevel,
              onSelect: () => onThinkingChange(level),
            })),
            ...(retrying ? [{
              id: "abort-retry",
              label: "停止自动重试",
              description: "终止当前等待中的重试",
              icon: <X size={14} />,
              onSelect: onAbortRetry,
            }] : []),
            {
              id: "inspector",
              label: "会话检查器",
              description: "查看上下文、活动、分支和文件",
              icon: <PanelRight size={14} />,
              disabled: !online,
              onSelect: onToggleInspector,
            },
            {
              id: "settings",
              label: "设置",
              description: "调整界面、字体和运行偏好",
              icon: <Settings2 size={14} />,
              onSelect: onOpenSettings,
            },
          ]}
        />
      </div>
    </header>
  );
}
