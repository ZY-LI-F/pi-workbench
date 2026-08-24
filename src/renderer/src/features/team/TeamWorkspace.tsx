import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bot, CircleAlert, CircleDot, Hash, Menu, MessageSquarePlus, Orbit, Pencil, Plus, Search, Sparkles, UsersRound, X } from "lucide-react";
import type { ProjectMeta, StellaDesktopApi } from "@shared/contracts";
import { deriveAgentPresences } from "@shared/agent-presence";
import { deriveAgentTaskQueue } from "@shared/agent-task-scheduler";
import { availableMentionAgentsForTask } from "@shared/agent-mentions";
import type { ProjectAgentDefinition } from "@shared/kanban";
import type { KanbanController } from "../../hooks/use-kanban";
import { AGENT_PRESENCE_LABEL, STAGE_LABEL, formatRelativeTime } from "../kanban/kanban-format";
import { TaskDetailPanel } from "../kanban/TaskDetailPanel";
import type { AgentMentionRequest } from "../kanban/AgentMentionInput";
import { TaskEditorDialog } from "../kanban/TaskEditorDialog";
import { AgentDraftDialog } from "./AgentDraftDialog";
import { TeamLaunchRoom } from "./TeamLaunchRoom";
import { useMediaQuery } from "../../hooks/use-media-query";
import { deriveTeamTaskAttention } from "@shared/team-task-attention";
import { HeaderOverflowMenu } from "../../components/HeaderOverflowMenu";
import { executionProfile, type ExecutionBackendCatalogSnapshot } from "@shared/execution-profile";

const TEAM_LAUNCH_ROOM_ID = "project-launch-room";
type ChannelFilter = "all" | "attention" | "active";

interface TeamWorkspaceProps {
  readonly api: StellaDesktopApi;
  readonly controller: KanbanController;
  readonly project?: ProjectMeta;
  readonly executionEnabled: boolean;
  readonly executionBackends?: ExecutionBackendCatalogSnapshot;
  readonly onOpenSidebar: () => void;
  readonly onNewTask: () => void;
  readonly focusLaunchRequest?: number;
  readonly availableSkillNames?: readonly string[];
  readonly modelLabel?: string;
  readonly taskCapabilityError?: string;
  readonly taskCapabilityRetrying?: boolean;
  readonly onRetryTaskCapability?: () => void;
  readonly onContinueTaskSession: (taskId: string, sessionPath: string) => Promise<void>;
  readonly onError: (message: string) => void;
}

export function TeamWorkspace({ api, controller, project, executionEnabled, executionBackends, onOpenSidebar, onNewTask, focusLaunchRequest, availableSkillNames, modelLabel, taskCapabilityError, taskCapabilityRetrying = false, onRetryTaskCapability, onContinueTaskSession, onError }: TeamWorkspaceProps) {
  const { state } = controller;
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [selectedChannelId, setSelectedChannelId] = useState(TEAM_LAUNCH_ROOM_ID);
  const [agentDraft, setAgentDraft] = useState<ProjectAgentDefinition | "new">();
  const [editingTask, setEditingTask] = useState(false);
  const [localError, setLocalError] = useState("");
  const [mentionRequest, setMentionRequest] = useState<AgentMentionRequest>();
  const [pulseOpen, setPulseOpen] = useState(false);
  const compactPulse = useMediaQuery("(max-width: 1060px)");
  const mentionRequestSequence = useRef(0);
  const bootstrap = state.bootstrap;
  const board = bootstrap?.board;
  const catalog = bootstrap?.catalog;

  const projectTasks = useMemo(() => {
    if (!board) return [];
    return board.tasks
      .filter((task) => !project || task.projectPath === project.cwd)
      .sort((left, right) => Number(Boolean(right.activeRunId || right.activeAgentTaskId)) - Number(Boolean(left.activeRunId || left.activeAgentTaskId)) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }, [board, project]);

  const attentionByTask = useMemo(() => board
    ? new Map(projectTasks.map((task) => [task.id, deriveTeamTaskAttention(board, task)]))
    : new Map(), [board, projectTasks]);

  const tasks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return projectTasks
      .filter((task) => !normalized || `${task.title} ${task.description} ${task.acceptanceCriteria}`.toLocaleLowerCase().includes(normalized))
      .filter((task) => channelFilter === "all"
        || (channelFilter === "attention" && attentionByTask.get(task.id)?.requiresHuman)
        || (channelFilter === "active" && Boolean(task.activeRunId || task.activeAgentTaskId)));
  }, [attentionByTask, channelFilter, projectTasks, query]);

  useEffect(() => {
    if (selectedChannelId === TEAM_LAUNCH_ROOM_ID || projectTasks.some((task) => task.id === selectedChannelId)) return;
    setSelectedChannelId(TEAM_LAUNCH_ROOM_ID);
  }, [projectTasks, selectedChannelId]);

  useEffect(() => setMentionRequest(undefined), [selectedChannelId]);

  useEffect(() => {
    if (!focusLaunchRequest) return;
    setSelectedChannelId(TEAM_LAUNCH_ROOM_ID);
  }, [focusLaunchRequest]);

  if (!bootstrap || !board || !catalog) {
    const failure = state.error ?? taskCapabilityError;
    return <main className="team-workspace team-workspace--loading">
      {failure ? <><X size={30} /><h1>团队中继暂不可用</h1><p role="alert">{failure}</p><div className="capability-workspace__actions"><button type="button" className="button-primary" disabled={taskCapabilityRetrying} onClick={onRetryTaskCapability}>{taskCapabilityRetrying ? "正在重试" : "重试 Task Control"}</button><button type="button" className="button-secondary" onClick={onOpenSidebar}>打开导航</button></div></> : <><div className="kanban-loading-orbit"><span /><span /><span /></div><h1>正在连接团队中继</h1><p>读取 Task Room 与 Agent Presence。</p></>}
    </main>;
  }

  const selectedTask = selectedChannelId === TEAM_LAUNCH_ROOM_ID ? undefined : projectTasks.find((task) => task.id === selectedChannelId);
  const taskRuns = selectedTask ? board.runs.filter((run) => run.taskId === selectedTask.id) : [];
  const taskActivities = selectedTask ? board.activities.filter((activity) => activity.taskId === selectedTask.id) : [];
  const taskAgentTasks = selectedTask ? board.agentTasks.filter((agentTask) => agentTask.taskId === selectedTask.id) : [];
  const taskComments = selectedTask ? board.comments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const presences = deriveAgentPresences(board, catalog, project?.cwd);
  const agentTaskQueue = deriveAgentTaskQueue(board, Date.now());
  const lead = catalog.agents.find((agent) => agent.id === "lead");
  const launchAgents = Object.freeze(presences.map((presence) => presence.agent));
  const mentionableAgentIds = new Set(selectedTask ? availableMentionAgentsForTask(selectedTask, catalog, board.squads).map((agent) => agent.id) : []);
  const busy = selectedTask ? state.pending.includes(selectedTask.id) : false;
  const selectedExecutionAvailability = (() => {
    if (!selectedTask?.executionProfileId) return { enabled: false, reason: "任务未选择执行环境" } as const;
    const profile = executionProfile(selectedTask.executionProfileId);
    if (profile.backendId === "pi") return executionEnabled
      ? { enabled: true } as const
      : { enabled: false, reason: "Pi Runtime 当前不可用" } as const;
    const availability = executionBackends?.profiles.find((item) => item.profile.id === selectedTask.executionProfileId);
    return availability?.available
      ? { enabled: true } as const
      : { enabled: false, reason: availability?.reason ?? `${profile.label} 尚未完成探测` } as const;
  })();
  const selectedTaskMentionBlock = selectedTask?.activeRunId || selectedTask?.activeAgentTaskId
    ? "当前任务正在执行"
    : selectedTask?.stage === "completed"
      ? "已完成任务需先移回待规划"
      : undefined;

  const perform = async <T,>(action: () => Promise<T>): Promise<T> => {
    setLocalError("");
    try { return await action(); } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setLocalError(message);
      onError(message);
      throw cause;
    }
  };

  const launchFromRoom = async (body: string, acceptanceCriteria: string): Promise<void> => {
    const existingTaskIds = new Set(board.tasks.map((task) => task.id));
    setLocalError("");
    try {
      const next = await controller.launchTeamTask(Object.freeze({ body, acceptanceCriteria }));
      const created = next.board.tasks[0];
      if (!created || existingTaskIds.has(created.id)) throw new Error("团队启动事务没有返回新任务");
      setQuery("");
      setSelectedChannelId(created.id);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  };

  return (
    <main className="team-workspace">
      <header className="team-header">
        <div className="team-header__identity"><button type="button" className="icon-button" aria-label="打开侧栏" onClick={onOpenSidebar}><Menu size={18} /></button><span className="team-header__mark"><UsersRound size={19} /><i /></span><div><small>STELLA TEAM RELAY</small><h1>团队协作</h1></div><em>Stella</em></div>
        <div className="team-header__status"><span className="current-model-chip" title="所有页面共享的当前 Pi 模型"><Bot size={12} />{modelLabel ?? "未选择模型"}</span><span><i className={executionEnabled ? "is-live" : ""} />{executionEnabled ? "PI RUNTIME ONLINE" : "BOARD ONLY"}</span><button type="button" className="button-secondary team-pulse-toggle" aria-expanded={pulseOpen} aria-controls="team-pulse-panel" onClick={() => setPulseOpen(true)}><UsersRound size={14} />Agent</button><button type="button" className="button-primary" onClick={onNewTask}><Plus size={14} />新建任务</button><HeaderOverflowMenu className="team-header__more" ariaLabel="更多团队操作" status={`${executionEnabled ? "Pi Runtime 在线" : "仅看板模式"} · ${modelLabel ?? "未选择模型"}`} actions={[{ id: "agents", label: "Agent 状态", description: "查看成员状态并创建项目 Agent", icon: <UsersRound size={14} />, onSelect: () => setPulseOpen(true) }, { id: "new-task", label: "新建任务", description: "创建新的 Team 任务", icon: <Plus size={14} />, onSelect: onNewTask }]} /></div>
      </header>

      <div className="team-grid">
        <aside className="team-channels" aria-label="任务频道">
          <header><div><small>TEAM ROOMS</small><h2>协作频道</h2></div><span>{tasks.length + 1}</span></header>
          <div className="team-channel-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已创建任务" aria-label="搜索已创建任务" /></div>
          <div className="team-channel-filters" aria-label="任务频道筛选">
            <button type="button" className={channelFilter === "all" ? "is-active" : ""} onClick={() => setChannelFilter("all")}>全部 <b>{projectTasks.length}</b></button>
            <button type="button" className={channelFilter === "attention" ? "is-active" : ""} onClick={() => setChannelFilter("attention")}><CircleAlert size={11} />待我处理 <b>{projectTasks.filter((task) => attentionByTask.get(task.id)?.requiresHuman).length}</b></button>
            <button type="button" className={channelFilter === "active" ? "is-active" : ""} onClick={() => setChannelFilter("active")}>执行中 <b>{projectTasks.filter((task) => task.activeRunId || task.activeAgentTaskId).length}</b></button>
          </div>
          <div className="team-channel-list">
            <button type="button" className={`team-channel--launch ${selectedChannelId === TEAM_LAUNCH_ROOM_ID ? "is-active" : ""}`} onClick={() => setSelectedChannelId(TEAM_LAUNCH_ROOM_ID)}><span className="team-channel__hash team-channel__launch-mark"><Orbit size={13} /><i /></span><span><strong>任务启动台</strong><small>@LEAD 协调 · @Worker 直派</small></span><time>入口</time></button>
            <div className="team-channel-list__divider"><span>任务频道</span><b>{tasks.length}</b></div>
            {tasks.map((task) => {
              const messages = board.comments.filter((comment) => comment.taskId === task.id).length;
              const active = Boolean(task.activeRunId || task.activeAgentTaskId);
              const attention = attentionByTask.get(task.id);
              return <button type="button" key={task.id} className={task.id === selectedChannelId ? "is-active" : ""} title={attention?.reasons.join("；")} onClick={() => setSelectedChannelId(task.id)}><span className="team-channel__hash"><Hash size={13} />{active && <i />}{attention?.requiresHuman && <CircleAlert className="team-channel__attention" size={11} />}</span><span><strong>{task.title}</strong><small>{attention?.requiresHuman ? "待我处理" : STAGE_LABEL[task.stage]} · {messages} 条消息</small></span><time>{formatRelativeTime(task.updatedAt)}</time></button>;
            })}
            {tasks.length === 0 && <div className="team-empty"><MessageSquarePlus size={20} /><strong>还没有任务频道</strong><p>在上方任务启动台指定一个负责人，第一条消息会直接成为任务。</p></div>}
          </div>
        </aside>

        <section className="team-conversation" aria-label="团队对话">
          {selectedTask ? <TaskDetailPanel
            key={selectedTask.id}
            variant="workspace"
            task={selectedTask}
            catalog={catalog}
            squads={board.squads}
            runs={taskRuns}
            agentTasks={taskAgentTasks}
            agentTaskQueue={agentTaskQueue}
            comments={taskComments}
            activities={taskActivities}
            busy={busy}
            executionEnabled={selectedExecutionAvailability.enabled}
            executionDisabledReason={selectedExecutionAvailability.reason}
            onClose={() => undefined}
            onEdit={() => setEditingTask(true)}
            onDispatch={() => perform(() => controller.dispatchTask(selectedTask.id)).then(() => undefined)}
            onAbort={() => perform(() => controller.abortTask(selectedTask.id)).then(() => undefined)}
            onDelete={() => perform(() => controller.deleteTask(selectedTask.id)).then(() => setSelectedChannelId(TEAM_LAUNCH_ROOM_ID))}
            onAddComment={(body) => perform(() => controller.addComment({ taskId: selectedTask.id, body })).then(() => undefined)}
            onMove={(stage) => perform(() => controller.moveTask(selectedTask.id, stage)).then(() => undefined)}
            onResolveGate={(input) => perform(() => controller.resolveGate(input)).then(() => undefined)}
            onReviewExecution={(input) => perform(() => controller.reviewExecution(input)).then(() => undefined)}
            onRevealPath={(path) => void api.revealPath(path)}
            onContinueInPi={(sessionPath) => onContinueTaskSession(selectedTask.id, sessionPath)}
            agentPresences={presences}
            mentionRequest={mentionRequest}
            availableSkillNames={availableSkillNames}
          /> : <TeamLaunchRoom
            project={project}
            lead={lead}
            agents={launchAgents}
            presences={presences}
            mentionRequest={mentionRequest}
            focusRequest={focusLaunchRequest}
            availableSkillNames={availableSkillNames}
            busy={state.pending.includes("team:launch")}
            executionEnabled={executionEnabled}
            onLaunch={launchFromRoom}
          />}
          {localError && <p className="team-workspace__error" role="alert">{localError}</p>}
        </section>

        {compactPulse && pulseOpen && <button type="button" className="team-pulse-scrim" aria-label="关闭 Agent 状态面板" onClick={() => setPulseOpen(false)} />}
        <aside id="team-pulse-panel" className={`team-pulse ${pulseOpen ? "is-open" : ""}`} aria-label="Agent Presence" aria-hidden={compactPulse && !pulseOpen} inert={compactPulse && !pulseOpen}>
          <header><div><small>TEAM PULSE</small><h2>星队状态</h2></div><button type="button" className="icon-button team-pulse__close" aria-label="关闭 Agent 状态面板" onClick={() => setPulseOpen(false)}><X size={15} /></button><span className="team-pulse__orbit"><i /><b /><Sparkles size={13} /></span></header>
          <div className="team-pulse__legend"><span><i className="running" />执行</span><span><i className="waiting" />等待</span><span><i className="available" />可用</span></div>
          <div className="team-pulse__list">
            {presences.map((presence, index) => {
              const scoped = presence.agent as Partial<ProjectAgentDefinition>;
              const missingSkills = (presence.agent.requiredSkills ?? []).filter((skill) => !(availableSkillNames ?? []).includes(skill));
              const skillBlock = missingSkills.length > 0 ? `缺少 Skill：${missingSkills.join("、")}` : undefined;
              const membershipBlock = selectedTask && !mentionableAgentIds.has(presence.agent.id) ? "不属于当前 Task Room 的可 @ 范围" : undefined;
              const mentionBlock = selectedTask
                ? selectedTaskMentionBlock ?? membershipBlock ?? skillBlock
                : !project
                  ? "请先打开一个项目"
                  : !executionEnabled
                    ? "Pi Runtime 尚未就绪"
                    : skillBlock;
              return <article key={presence.agent.id} className={`agent-presence agent-presence--${presence.state}`} style={{ "--orbit-index": index } as CSSProperties}>
                <button type="button" className="agent-presence__mention" disabled={Boolean(mentionBlock)} title={mentionBlock} aria-label={`${selectedTask ? "在 Task Room" : "在任务启动台"} @${presence.agent.name}`} onClick={() => {
                  setLocalError("");
                  mentionRequestSequence.current += 1;
                  setMentionRequest(Object.freeze({ requestId: mentionRequestSequence.current, agentId: presence.agent.id }));
                }}>
                  <span className="agent-presence__avatar"><Bot size={14} /><i /></span>
                  <span className="agent-presence__identity"><strong>{presence.agent.name}</strong><small>@{presence.agent.callsign} · {presence.detail}</small>{presence.activeTaskTitle && <em>{presence.activeTaskTitle}</em>}</span>
                  <span className="agent-presence__state"><b>{AGENT_PRESENCE_LABEL[presence.state]}</b><small>{presence.workload > 0 ? `${presence.workload} 个任务` : `@${presence.agent.callsign}`}</small></span>
                </button>
                {scoped.projectPath && <button type="button" className="agent-presence__edit" aria-label={`编辑 ${presence.agent.name}`} onClick={() => setAgentDraft(scoped as ProjectAgentDefinition)}><Pencil size={11} /></button>}
              </article>;
            })}
          </div>
          <footer><button type="button" className="button-secondary" disabled={!project} onClick={() => setAgentDraft("new")}><Plus size={13} />创建 Agent</button><small><CircleDot size={10} />状态来自 Workflow / AgentTask，不手工维护</small></footer>
        </aside>
      </div>

      {agentDraft && project && <AgentDraftDialog
        project={project}
        agent={agentDraft === "new" ? undefined : agentDraft}
        busy={state.pending.includes("agent:create") || (agentDraft !== "new" && state.pending.includes(`agent:${agentDraft.id}`))}
        onClose={() => setAgentDraft(undefined)}
        onCreate={(input) => controller.createAgent(input).then(() => undefined)}
        onUpdate={(input) => controller.updateAgent(input).then(() => undefined)}
        onDelete={(agentId) => controller.deleteAgent(agentId).then(() => undefined)}
      />}
      {editingTask && selectedTask && <TaskEditorDialog
        task={selectedTask}
        project={Object.freeze({ cwd: selectedTask.projectPath, name: selectedTask.projectName, trusted: selectedTask.trusted, requiresTrust: false, requiresSelection: false })}
        workflows={catalog.workflows}
        agents={catalog.agents.filter((agent) => !("projectPath" in agent) || (agent as ProjectAgentDefinition).projectPath === selectedTask.projectPath)}
        squads={board.squads}
        executionBackends={executionBackends}
        piExecutionEnabled={executionEnabled}
        busy={state.pending.includes(selectedTask.id)}
        onClose={() => setEditingTask(false)}
        onCreate={(input) => controller.createTask(input).then(() => undefined)}
        onUpdate={(input) => controller.updateTask(input).then(() => undefined)}
      />}
    </main>
  );
}
