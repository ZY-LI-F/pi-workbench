import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Archive,
  FileOutput,
  FolderOpen,
  GitFork,
  LayoutDashboard,
  ListPlus,
  Menu,
  MessageSquarePlus,
  MessagesSquare,
  Plus,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  UsersRound,
} from "lucide-react";
import type {
  ModelSummary,
  PiThinkingLevel,
  PiResponse,
  RecentProject,
  SessionSummary,
  SlashCommandSummary,
  StellaDesktopApi,
} from "@shared/contracts";
import type { LocalPathInspection } from "@shared/local-path";
import type { SkinArtworkDescriptor, SkinId } from "@shared/skin-artwork";
import { isReportedRuntimeError, usePiRuntime } from "./hooks/use-pi-runtime";
import { useKanban } from "./hooks/use-kanban";
import { useCapabilities } from "./hooks/use-capabilities";
import { useMediaQuery } from "./hooks/use-media-query";
import { usePreferences } from "./hooks/use-preferences";
import { useSessionComposerDraft } from "./hooks/use-session-composer-draft";
import { useSkinArtwork } from "./hooks/use-skin-artwork";
import type { SkinPreference } from "./lib/skins";
import chenxiArtwork from "./assets/skins/chenxi.png";
import dingyangArtwork from "./assets/skins/dingyang.png";
import jojoArtwork from "./assets/skins/jojo.png";
import kuroshitsujiArtwork from "./assets/skins/kuroshitsuji.png";
import qihunArtwork from "./assets/skins/qihun.png";
import xuriArtwork from "./assets/skins/xuri.png";
import yuehuaArtwork from "./assets/skins/yuehua.png";
import { skinDefinition } from "./lib/skins";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { Composer, type ComposerImage } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { ExtensionDialog } from "./components/ExtensionDialog";
import {
  constrainInspectorWidth,
  DEFAULT_INSPECTOR_WIDTH,
  FILE_INSPECTOR_WIDTH,
  Inspector,
  type InspectorTab,
} from "./components/Inspector";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar, type WorkspaceView } from "./components/Sidebar";
import { TerminalDrawer } from "./components/TerminalDrawer";
import { TextPromptDialog } from "./components/TextPromptDialog";
import { ToastStack } from "./components/ToastStack";
import { Topbar } from "./components/Topbar";
import { WindowControls } from "./components/WindowControls";
import { KanbanWorkspace } from "./features/kanban/KanbanWorkspace";
import { createPiTaskDraft, type PiTaskDraft } from "./features/kanban/pi-task-draft";
import { TeamWorkspace } from "./features/team/TeamWorkspace";
import { ModelConfigurationWorkspace } from "./features/models/ModelConfigurationWorkspace";
import { parseBashResult } from "./lib/pi-bash-result";
import { sessionFileReferences } from "./lib/session-files";

interface AppProps {
  readonly api: StellaDesktopApi;
}

function responseData(response: PiResponse): unknown {
  if (!response.success) throw new Error(response.error);
  if (!("data" in response)) throw new Error(`命令 ${response.command} 没有返回数据`);
  return response.data;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function exportedPath(value: unknown): string {
  if (typeof value !== "object" || value === null || !("path" in value) || typeof value.path !== "string") {
    throw new Error("Pi 没有返回有效的导出路径");
  }
  return value.path;
}

function wasCancelled(value: unknown, command: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Pi 命令 ${command} 没有返回有效的取消状态`);
  }
  const cancelled = (value as Record<string, unknown>).cancelled;
  if (typeof cancelled !== "boolean") throw new Error(`Pi 命令 ${command} 的 cancelled 字段无效`);
  return cancelled;
}

const SKIN_ARTWORK: Readonly<Partial<Record<SkinPreference, string>>> = Object.freeze({
  chenxi: chenxiArtwork,
  dingyang: dingyangArtwork,
  xuri: xuriArtwork,
  yuehua: yuehuaArtwork,
  kuroshitsuji: kuroshitsujiArtwork,
  jojo: jojoArtwork,
  qihun: qihunArtwork,
});

const ARTWORK_IDENTITIES = new Set<SkinPreference>(["xuri", "yuehua", "kuroshitsuji", "jojo", "qihun"]);

function SkinBackdrop({ skin, customArtwork }: { readonly skin: SkinPreference; readonly customArtwork?: SkinArtworkDescriptor }) {
  const artwork = customArtwork?.url ?? SKIN_ARTWORK[skin];
  const definition = skinDefinition(skin);
  return (
    <div className="stellar-backdrop" aria-hidden="true">
      {artwork && <img className={`stellar-backdrop__art stellar-backdrop__art--${skin}`} src={artwork} alt="" />}
      {ARTWORK_IDENTITIES.has(skin) && (
        <span className={`stellar-backdrop__identity stellar-backdrop__identity--${skin}`}>
          <strong>{definition.label}</strong><small>{definition.subtitle}</small>
        </span>
      )}
      <svg viewBox="0 0 1600 900" preserveAspectRatio="none">
        <path className="stellar-backdrop__orbit" d="M-120 240 C 240 40, 490 90, 710 310 S 1220 580, 1710 180" />
        <path className="stellar-backdrop__trail" d="M180 940 C 310 610, 650 690, 830 510 S 1260 120, 1640 380" />
        <g className="stellar-backdrop__stars"><circle cx="365" cy="105" r="2" /><circle cx="709" cy="309" r="3" /><circle cx="1180" cy="500" r="2" /><circle cx="1410" cy="270" r="3" /><circle cx="830" cy="510" r="2" /></g>
      </svg>
    </div>
  );
}

export function App({ api }: AppProps) {
  const controller = usePiRuntime(api);
  const kanban = useKanban(api);
  const capabilities = useCapabilities(api);
  const { state } = controller;
  const [preferences, setPreferences, preferencesStorageError] = usePreferences();
  const skinArtwork = useSkinArtwork(api);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 1280);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("context");
  const [inspectorWidth, setInspectorWidth] = useState(() => constrainInspectorWidth(DEFAULT_INSPECTOR_WIDTH, window.innerWidth));
  const [filePreview, setFilePreview] = useState<LocalPathInspection>();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [modelChanging, setModelChanging] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("chat");
  const [createTaskRequest, setCreateTaskRequest] = useState(0);
  const [teamLaunchRequest, setTeamLaunchRequest] = useState(0);
  const [createTaskDraft, setCreateTaskDraft] = useState<PiTaskDraft>();
  const [queueMode, setQueueMode] = useState<"steer" | "followUp">(
    preferences.defaultQueueMode,
  );
  const appliedRetryPreference = useRef<string | undefined>(undefined);
  const capabilitySnapshot = capabilities.state.snapshot;
  const piHealth = capabilitySnapshot?.pi;
  const taskHealth = capabilitySnapshot?.task;
  const bootstrap = state.bootstrap;
  const composerDraft = useSessionComposerDraft(bootstrap, api);
  const compactSidebar = useMediaQuery("(max-width: 1060px)");
  const sidebarVisible = compactSidebar ? sidebarOpen : !sidebarCollapsed;
  const piReady = piHealth?.state === "ready" && Boolean(bootstrap);
  const teamFeaturesEnabled = preferences.teamFeaturesEnabled;
  const activeView: WorkspaceView = !teamFeaturesEnabled && (workspaceView === "team" || workspaceView === "kanban")
    ? "chat"
    : workspaceView;
  const sessionFiles = useMemo(() => sessionFileReferences(state.messages), [state.messages]);

  const reportActionError = (action: string, cause: unknown) => {
    if (isReportedRuntimeError(cause)) return;
    controller.notify(`${action}失败：${errorMessage(cause)}`, "error");
  };

  const runAction = (action: string, operation: () => Promise<unknown>) => {
    void operation().catch((cause: unknown) => reportActionError(action, cause));
  };

  const retryPi = async () => {
    const snapshot = await capabilities.retry("pi");
    if (snapshot.pi.state === "ready") await controller.refresh();
  };

  useEffect(() => {
    if (!skinArtwork.loadError) return;
    controller.notify(`自定义背景加载失败：${skinArtwork.loadError}`, "error");
    skinArtwork.clearLoadError();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- controller/skinArtwork 每次渲染都是新引用；只需在 loadError 变化时提示一次
  }, [skinArtwork.loadError]);

  const runtimeNotify = controller.notify;
  useEffect(() => {
    if (!preferencesStorageError) return;
    runtimeNotify(preferencesStorageError, "error");
  }, [preferencesStorageError, runtimeNotify]);

  useEffect(() => {
    if (teamFeaturesEnabled || (workspaceView !== "team" && workspaceView !== "kanban")) return;
    setWorkspaceView("chat");
    setSidebarOpen(false);
  }, [teamFeaturesEnabled, workspaceView]);

  const runtimeCommand = controller.command;
  useEffect(() => {
    const bootstrap = state.bootstrap;
    if (state.phase !== "ready" || !bootstrap) return;
    const preferenceKey = `${bootstrap.project.cwd}:${bootstrap.state.sessionId}:${String(preferences.autoRetry)}`;
    if (appliedRetryPreference.current === preferenceKey) return;
    appliedRetryPreference.current = preferenceKey;
    void runtimeCommand({ type: "set_auto_retry", enabled: preferences.autoRetry }).catch(() => {
      if (appliedRetryPreference.current === preferenceKey) appliedRetryPreference.current = undefined;
    });
  }, [runtimeCommand, preferences.autoRetry, state.bootstrap, state.phase]);

  const focusComposer = () => {
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="给 Pi 的消息"]')?.focus(), 0);
  };

  const openFilePreview = (inspection: LocalPathInspection) => {
    setFilePreview(inspection);
    setInspectorTab("files");
    setInspectorWidth((current) => Math.max(current, constrainInspectorWidth(FILE_INSPECTOR_WIDTH, window.innerWidth)));
    setInspectorOpen(true);
  };

  const openInspector = (tab: InspectorTab = "context") => {
    setInspectorTab(tab);
    setInspectorOpen(true);
  };

  useEffect(() => {
    setFilePreview(undefined);
    setInspectorTab((current) => current === "files" ? "context" : current);
  }, [bootstrap?.state.sessionId]);

  useEffect(() => {
    const constrainCurrentWidth = () => setInspectorWidth((current) => constrainInspectorWidth(current, window.innerWidth));
    window.addEventListener("resize", constrainCurrentWidth);
    return () => window.removeEventListener("resize", constrainCurrentWidth);
  }, []);

  const openSidebar = () => {
    if (compactSidebar) {
      setSidebarOpen(true);
      window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".sidebar__close")?.focus());
    } else {
      setSidebarCollapsed(false);
      window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".sidebar__close")?.focus());
    }
  };

  const closeSidebar = () => {
    if (compactSidebar) {
      setSidebarOpen(false);
      window.requestAnimationFrame(() => {
        const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="打开侧栏"]'))
          .find((button) => button.getClientRects().length > 0 && !button.disabled);
        trigger?.focus();
      });
    } else {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement.closest(".sidebar")) activeElement.blur();
      setSidebarCollapsed(true);
      window.requestAnimationFrame(() => {
        const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label="打开侧栏"]'))
          .find((button) => button.getClientRects().length > 0 && !button.disabled);
        trigger?.focus();
      });
    }
  };

  const openSettings = () => {
    closeSidebar();
    setSettingsOpen(true);
  };

  const newSession = async () => {
    if (!bootstrap) {
      controller.notify("Pi Runtime 尚未就绪", "warning");
      return;
    }
    await composerDraft.flush();
    const response = await controller.command({ type: "new_session" }, true);
    if (wasCancelled(responseData(response), "new_session")) {
      controller.notify("新建会话已由 Pi 扩展取消", "warning");
      return;
    }
    setWorkspaceView("chat");
    focusComposer();
  };

  const newTask = () => {
    if (!teamFeaturesEnabled) {
      controller.notify("请先在偏好设置中开启“显示团队功能”", "warning");
      openSettings();
      return;
    }
    if (!bootstrap) {
      controller.notify("需要先选择一个可用项目，才能新建任务", "warning");
      return;
    }
    setCreateTaskDraft(undefined);
    setWorkspaceView("kanban");
    setCreateTaskRequest((value) => value + 1);
  };

  const newTeamTask = () => {
    if (!teamFeaturesEnabled) {
      controller.notify("请先在偏好设置中开启“显示团队功能”", "warning");
      openSettings();
      return;
    }
    if (!bootstrap) {
      controller.notify("需要先选择一个可用项目，才能启动团队任务", "warning");
      return;
    }
    setWorkspaceView("team");
    setTeamLaunchRequest((value) => value + 1);
  };

  const solidifyCurrentSession = () => {
    if (!teamFeaturesEnabled) {
      controller.notify("请先在偏好设置中开启“显示团队功能”", "warning");
      openSettings();
      return;
    }
    if (!bootstrap) {
      controller.notify("Pi Runtime 尚未就绪，无法读取当前会话", "warning");
      return;
    }
    if (taskHealth?.state !== "ready") {
      controller.notify(`Task Control 不可用：${taskHealth?.error ?? taskHealth?.state ?? "尚未初始化"}`, "error");
      return;
    }
    try {
      setCreateTaskDraft(createPiTaskDraft(bootstrap));
      setWorkspaceView("kanban");
      setCreateTaskRequest((value) => value + 1);
    } catch (cause) {
      controller.notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  const continueTaskSession = async (taskId: string, sessionPath: string) => {
    await composerDraft.flush();
    await controller.openTaskSession({ taskId, sessionPath });
    setWorkspaceView("chat");
    setSidebarOpen(false);
    controller.notify("已切换到所选任务执行会话", "success");
  };

  const chooseProject = async () => {
    const selection = await controller.chooseProject();
    if (!selection) return;
    await composerDraft.flush();
    const opened = await controller.openProject(selection.path, selection.requiresTrust);
    if (!opened) return;
    setWorkspaceView("chat");
    setSidebarOpen(false);
    focusComposer();
  };

  const openRecentProject = async (project: RecentProject) => {
    await composerDraft.flush();
    const opened = await controller.openProject(project.path, project.trusted);
    if (!opened) return;
    setWorkspaceView("chat");
    setSidebarOpen(false);
    focusComposer();
  };

  const switchSession = async (session: SessionSummary) => {
    if (session.path === state.bootstrap?.state.sessionFile) return;
    await composerDraft.flush();
    const response = await controller.command({ type: "switch_session", sessionPath: session.path }, true);
    if (wasCancelled(responseData(response), "switch_session")) {
      controller.notify("切换会话已由 Pi 扩展取消", "warning");
      return;
    }
    setWorkspaceView("chat");
    setSidebarOpen(false);
    focusComposer();
  };

  const setModel = async (model: ModelSummary) => {
    setModelChanging(true);
    try {
      await controller.command({ type: "set_model", provider: model.provider, modelId: model.id }, true);
      controller.notify(`全局模型已切换到 ${model.name}`, "success");
    } catch (cause) {
      reportActionError("切换模型", cause);
    } finally {
      setModelChanging(false);
    }
  };

  const setThinking = async (level: string) => {
    if (!bootstrap?.thinkingLevels.includes(level as PiThinkingLevel)) throw new Error(`当前模型不支持思考级别: ${level}`);
    await controller.command({ type: "set_thinking_level", level: level as PiThinkingLevel }, true);
  };

  const chooseSkinArtwork = async (skin: SkinId) => {
    try {
      const changed = await skinArtwork.choose(skin);
      if (changed) controller.notify(`${skinDefinition(skin).label} 已使用自定义背景`, "success");
    } catch (cause) {
      controller.notify(`更换背景失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
    }
  };

  const resetSkinArtwork = async (skin: SkinId) => {
    try {
      await skinArtwork.reset(skin);
      controller.notify(`${skinDefinition(skin).label} 已恢复内置背景`, "success");
    } catch (cause) {
      controller.notify(`恢复背景失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
    }
  };

  const sendPrompt = async (message: string, images: readonly ComposerImage[]) => {
    const payloadImages = images.map(({ type, data, mimeType }) => ({ type, data, mimeType }));
    await controller.command(
      state.streaming
        ? { type: "prompt", message, images: payloadImages, streamingBehavior: queueMode }
        : { type: "prompt", message, images: payloadImages },
      true,
    );
  };

  const fork = async (entryId: string) => {
    const response = await controller.command({ type: "fork", entryId }, true);
    if (wasCancelled(responseData(response), "fork")) {
      controller.notify("创建分支已由 Pi 扩展取消", "warning");
      return;
    }
    controller.notify("已从所选消息创建新分支", "success");
  };

  const cloneSession = async () => {
    const response = await controller.command({ type: "clone" }, true);
    if (wasCancelled(responseData(response), "clone")) {
      controller.notify("克隆会话已由 Pi 扩展取消", "warning");
      return;
    }
    controller.notify("当前分支已克隆为独立会话", "success");
  };

  const compact = async () => {
    await controller.command({ type: "compact" }, true);
    controller.notify("上下文压缩完成", "success");
  };

  const exportSession = async () => {
    const response = await controller.command({ type: "export_html" });
    const path = exportedPath(responseData(response));
    try {
      await api.revealPath(path);
      controller.notify(`会话已导出到 ${path}`, "success");
    } catch (cause) {
      controller.notify(`会话已导出到 ${path}，但无法在文件管理器中显示：${errorMessage(cause)}`, "error");
    }
  };

  const paletteActions = useMemo<readonly PaletteAction[]>(
    () => {
      const actions: PaletteAction[] = [
        { id: "models", label: "打开模型配置", detail: "连接 Provider、维护自定义模型并选择全局路由", icon: SlidersHorizontal, run: () => setWorkspaceView("models") },
        { id: "project", label: "打开项目", detail: "选择新的本地工作目录", icon: FolderOpen, run: () => runAction("打开项目", chooseProject) },
      ];
      if (teamFeaturesEnabled) {
        actions.push(
          { id: "team", label: "打开团队协作", detail: "在 Task Room 中 @lead 或直接委派 Worker", icon: UsersRound, run: () => setWorkspaceView("team") },
          { id: "kanban", label: "打开任务看板", detail: "监督固定 Agent 团队与流程", icon: LayoutDashboard, run: () => setWorkspaceView("kanban") },
        );
      }
      if (!bootstrap) return actions;
      return [
        ...actions,
        ...(teamFeaturesEnabled ? [
          { id: "team-task", label: "通过 @LEAD 启动任务", detail: "进入任务启动台并填写可验证验收标准", icon: MessageSquarePlus, run: newTeamTask },
          { id: "task", label: "新建看板任务", detail: "选择固定流程并分发", icon: Plus, run: newTask },
          { id: "capture-task", label: "固化当前会话为任务", detail: "打开带来源 identity 的可编辑草稿", icon: ListPlus, run: solidifyCurrentSession },
        ] : []),
        { id: "chat", label: "返回当前会话", detail: "与 Pi 直接对话", icon: MessagesSquare, run: () => setWorkspaceView("chat") },
        { id: "new", label: "新建会话", detail: "开始一个干净的 Pi 会话", icon: Plus, run: () => runAction("新建会话", newSession) },
        { id: "terminal", label: "运行命令", detail: "打开本地命令抽屉", icon: TerminalSquare, run: () => setTerminalOpen(true) },
        { id: "tree", label: "查看会话图谱", detail: "检查工具活动与分支结构", icon: GitFork, run: () => { setWorkspaceView("chat"); openInspector("tree"); } },
        { id: "compact", label: "压缩上下文", detail: "生成摘要并释放模型窗口", icon: Archive, run: () => runAction("压缩上下文", compact) },
        { id: "export", label: "导出 HTML", detail: "保存当前会话记录", icon: FileOutput, run: () => runAction("导出会话", exportSession) },
        { id: "settings", label: "偏好设置", detail: "外观、队列和 Pi 行为", icon: Settings2, run: openSettings },
      ];
    },
    // 动作闭包读取 bootstrap（messages / sessionFile）与 taskHealth，必须随它们重建，否则固化会话用到旧数据。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 动作函数每次渲染重建；只需在 bootstrap/taskHealth 变化时重算，其余依赖会导致 memo 失效
    [bootstrap, taskHealth, teamFeaturesEnabled],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (ctrl && event.key.toLocaleLowerCase() === "n") {
        event.preventDefault();
        if (workspaceView === "team") newTeamTask();
        else if (workspaceView === "kanban") newTask();
        else runAction("新建会话", newSession);
      }
      if (ctrl && event.key.toLocaleLowerCase() === "l") {
        event.preventDefault();
        if (workspaceView === "kanban") document.querySelector<HTMLInputElement>(".kanban-search input")?.focus();
        else if (workspaceView === "team") document.querySelector<HTMLInputElement>(".team-channel-search input")?.focus();
        else focusComposer();
      }
      if (ctrl && event.key === "`") {
        event.preventDefault();
        setTerminalOpen((value) => !value);
      }
      if (ctrl && event.key.toLocaleLowerCase() === "i") {
        event.preventDefault();
        if (workspaceView !== "chat") {
          setWorkspaceView("chat");
          openInspector();
        } else {
          setInspectorOpen((value) => !value);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // newTask / newSession 闭包读取 bootstrap，必须随 bootstrap 重建，否则快捷键看到过期状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- newTask/newSession 每次渲染重建；跟踪 workspaceView/bootstrap 已覆盖闭包读取的全部状态
  }, [workspaceView, bootstrap]);

  return (
    <div
      className={`app-shell app-shell--${activeView} ${activeView === "chat" && inspectorOpen ? "has-inspector" : ""} ${terminalOpen ? "has-terminal" : ""} ${sidebarVisible ? "" : "sidebar-collapsed"}`}
      style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}
    >
      <SkinBackdrop skin={preferences.skin} customArtwork={skinArtwork.bySkin[preferences.skin]} />
      <div className="titlebar-drag" />
      <WindowControls api={api} />
      <Sidebar
        bootstrap={bootstrap}
        capabilities={capabilitySnapshot}
        skin={preferences.skin}
        open={sidebarVisible}
        activeView={activeView}
        teamFeaturesEnabled={teamFeaturesEnabled}
        modelChanging={modelChanging}
        onClose={closeSidebar}
        onNewSession={() => runAction("新建会话", newSession)}
        onNewTask={activeView === "kanban" ? newTask : newTeamTask}
        onSwitchView={(view) => {
          if (!teamFeaturesEnabled && (view === "team" || view === "kanban")) {
            controller.notify("请先在偏好设置中开启“显示团队功能”", "warning");
            openSettings();
            return;
          }
          setWorkspaceView(view);
          if (view !== "chat") setFilePreview(undefined);
          setSidebarOpen(false);
          if (view === "chat") focusComposer();
        }}
        onChooseProject={() => runAction("打开项目", chooseProject)}
        onOpenRecentProject={(project) => runAction("打开最近项目", () => openRecentProject(project))}
        onSwitchSession={(session) => runAction("切换会话", () => switchSession(session))}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenTerminal={() => setTerminalOpen(true)}
        onOpenInspector={() => { setWorkspaceView("chat"); openInspector("context"); setSidebarOpen(false); focusComposer(); }}
        onOpenSettings={openSettings}
        onModelChange={(model) => void setModel(model)}
      />

      {bootstrap?.project.requiresSelection && activeView !== "models" ? (
        <main className="first-run-setup" aria-labelledby="first-run-title">
          <span className="first-run-setup__orbit" aria-hidden="true"><i /><b /><Sparkles size={24} /></span>
          <small>STELLA · FIRST LIGHT</small>
          <h1 id="first-run-title">先选择要工作的项目</h1>
          <p>当前目录只是首次启动占位，不会被当作你的项目保存。选择代码或研究资料所在目录后，Pi 会在该工作区恢复会话、命令与项目资源。</p>
          <div className="first-run-setup__model"><span>当前模型</span><strong>{bootstrap.state.model ? `${bootstrap.state.model.provider} / ${bootstrap.state.model.id}` : "尚未选择"}</strong></div>
          <div className="first-run-setup__actions">
            <button type="button" className="button-primary" onClick={() => runAction("打开项目", chooseProject)}><FolderOpen size={16} />选择项目目录</button>
            <button type="button" className="button-secondary" onClick={() => setWorkspaceView("models")}><SlidersHorizontal size={16} />配置模型</button>
          </div>
        </main>
      ) : activeView === "chat" && bootstrap ? <main className="workspace">
        <Topbar
          bootstrap={bootstrap}
          streaming={state.streaming}
          compacting={state.compacting}
          retrying={state.retrying}
          online={piReady}
          onOpenSidebar={openSidebar}
          onFocusSession={focusComposer}
          onNewSession={() => runAction("新建会话", newSession)}
          onToggleInspector={() => setInspectorOpen((value) => !value)}
          onOpenModels={() => setWorkspaceView("models")}
          onOpenSettings={openSettings}
          onThinkingChange={(level) => runAction("切换思考级别", () => setThinking(level))}
          onAbortRetry={() => runAction("停止自动重试", () => controller.command({ type: "abort_retry" }))}
          onSolidifyTask={teamFeaturesEnabled && piReady ? solidifyCurrentSession : undefined}
        />
        <div className="conversation-stage">
          {!piReady && (
            <section className="chat-runtime-banner" role="status" aria-live="polite">
              <span className={`capability-dot capability-dot--${piHealth?.state ?? "loading"}`} />
              <div>
                <strong>{piHealth?.state === "loading" || state.phase === "loading" ? "Pi 正在恢复连接" : "Pi 暂不可用，当前草稿已保留"}</strong>
                <small>{piHealth?.error ?? state.error ?? capabilities.state.error ?? "恢复后即可发送；你仍可编辑消息、添加附件和切换页面。"}</small>
              </div>
              <button type="button" className="button-secondary" disabled={capabilities.state.retrying.includes("pi")} onClick={() => runAction("重试 Pi", retryPi)}>
                <RefreshCw size={14} />{capabilities.state.retrying.includes("pi") ? "正在重试" : "重试连接"}
              </button>
            </section>
          )}
          <Conversation
            api={api}
            bootstrap={bootstrap}
            messages={state.messages}
            tools={state.tools}
            streaming={piReady && state.streaming}
            onPrefill={(text) => { composerDraft.setText(text); focusComposer(); }}
            onFork={(entryId) => runAction("创建会话分支", () => fork(entryId))}
            onPreviewFile={openFilePreview}
          />
        </div>
        <Composer
          draft={composerDraft.text}
          onDraftChange={composerDraft.setText}
          images={composerDraft.images}
          onImagesChange={composerDraft.setImages}
          editorInjection={state.editorInjection}
          commands={bootstrap.commands}
          widgets={state.extensionWidgets}
          streaming={piReady && state.streaming}
          queueMode={queueMode}
          onQueueModeChange={(mode) => {
            setQueueMode(mode);
            setPreferences(Object.freeze({ ...preferences, defaultQueueMode: mode }));
          }}
          onSend={sendPrompt}
          onStop={() => runAction("停止生成", () => controller.command({ type: "abort" }))}
          onOpenTerminal={() => setTerminalOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          onError={(message) => controller.notify(message, "error")}
          sendDisabled={!piReady}
          sendDisabledReason={!piReady ? (piHealth?.state === "loading" || state.phase === "loading" ? "Pi 正在连接，草稿不会丢失" : "Pi 恢复后即可发送") : undefined}
          draftPersistence={composerDraft.persistence}
        />
      </main> : activeView === "chat" ? (
        <main className="workspace capability-workspace">
          <header className="capability-workspace__bar">
            <button type="button" className="icon-button" aria-label="打开侧栏" onClick={openSidebar}><Menu size={18} /></button>
            <div><small>PI WORKSPACE</small><strong>{piHealth?.state === "loading" || state.phase === "loading" ? "正在连接" : "连接已中断"}</strong></div>
            <span className={`capability-state capability-state--${piHealth?.state ?? "loading"}`}>{piHealth?.state ?? "loading"}</span>
          </header>
          <section className="capability-workspace__body">
            {piHealth?.state === "loading" || state.phase === "loading" ? <>
              <div className="startup-screen__loader"><span /><span /><span /></div>
              <h1>正在恢复 Pi 工作区</h1>
              <p>{teamFeaturesEnabled ? "团队任务历史仍可独立查看。" : "正在恢复会话、模型、命令与项目资源。"}</p>
            </> : <>
              <span className="startup-screen__error-mark">!</span>
              <h1>Pi 工作区暂不可用</h1>
              <p>{piHealth?.error ?? state.error ?? capabilities.state.error ?? "初始化没有返回工作区状态。"}</p>
              {state.stderr && <details><summary>查看 Pi 诊断输出</summary><pre>{state.stderr}</pre></details>}
              <div className="capability-workspace__actions">
                <button type="button" className="button-primary" disabled={capabilities.state.retrying.includes("pi")} onClick={() => runAction("重试 Pi", retryPi)}><RefreshCw size={15} />{capabilities.state.retrying.includes("pi") ? "正在重试" : "重试 Pi"}</button>
                <button type="button" className="button-secondary" onClick={() => runAction("打开项目", chooseProject)}><FolderOpen size={15} />选择其他项目</button>
                {teamFeaturesEnabled && <button type="button" className="button-secondary" onClick={() => setWorkspaceView("kanban")}><LayoutDashboard size={15} />查看任务看板</button>}
              </div>
            </>}
          </section>
        </main>
      ) : activeView === "models" ? (
        <ModelConfigurationWorkspace
          api={api}
          bootstrap={bootstrap}
          online={piReady}
          modelChanging={modelChanging}
          onOpenSidebar={openSidebar}
          onModelChange={setModel}
          onRuntimeRefresh={controller.refresh}
          onNotify={controller.notify}
        />
      ) : activeView === "team" && teamFeaturesEnabled ? (
        <TeamWorkspace
          api={api}
          controller={kanban}
          project={bootstrap?.project}
          executionEnabled={piReady}
          onOpenSidebar={openSidebar}
          onNewTask={newTeamTask}
          focusLaunchRequest={teamLaunchRequest}
          availableSkillNames={bootstrap?.commands.flatMap((command) => command.source === "skill" && command.name.startsWith("skill:") ? [command.name.slice(6)] : [])}
          modelLabel={bootstrap?.state.model ? `${bootstrap.state.model.provider} / ${bootstrap.state.model.id}` : undefined}
          taskCapabilityError={taskHealth?.error}
          taskCapabilityRetrying={capabilities.state.retrying.includes("task")}
          onRetryTaskCapability={() => void capabilities.retry("task").catch((cause: unknown) => controller.notify(`重试 Task Control 失败：${cause instanceof Error ? cause.message : String(cause)}`, "error"))}
          onContinueTaskSession={(taskId, sessionPath) => continueTaskSession(taskId, sessionPath)}
          onError={(message) => controller.notify(message, "error")}
        />
      ) : activeView === "kanban" && teamFeaturesEnabled ? (
        <KanbanWorkspace
          api={api}
          controller={kanban}
          project={bootstrap?.project}
          executionEnabled={piReady}
          taskCapabilityError={taskHealth?.error}
          taskCapabilityRetrying={capabilities.state.retrying.includes("task")}
          onRetryTaskCapability={() => void capabilities.retry("task").catch((cause: unknown) => controller.notify(`重试 Task Control 失败：${cause instanceof Error ? cause.message : String(cause)}`, "error"))}
          createRequest={createTaskRequest}
          createDraft={createTaskDraft}
          onCreateRequestConsumed={() => setCreateTaskRequest(0)}
          onContinueTaskSession={(taskId, sessionPath) => continueTaskSession(taskId, sessionPath)}
          onOpenSidebar={openSidebar}
          onOpenTerminal={() => setTerminalOpen(true)}
          onError={(message) => controller.notify(message, "error")}
          modelLabel={bootstrap?.state.model ? `${bootstrap.state.model.provider} / ${bootstrap.state.model.id}` : undefined}
        />
      ) : null}

      {activeView === "chat" && bootstrap && piReady && <Inspector
        api={api}
        bootstrap={bootstrap}
        open={inspectorOpen}
        tab={inspectorTab}
        width={inspectorWidth}
        tools={state.tools}
        queue={state.queue}
        extensionStatuses={state.extensionStatuses}
        extensionWidgets={state.extensionWidgets}
        filePreview={filePreview}
        fileReferences={sessionFiles}
        onTabChange={setInspectorTab}
        onWidthChange={setInspectorWidth}
        onSelectFile={setFilePreview}
        onClose={() => setInspectorOpen(false)}
        onCompact={() => runAction("压缩上下文", compact)}
        onExport={() => runAction("导出会话", exportSession)}
        onClone={() => runAction("克隆会话", cloneSession)}
        onRename={() => setRenameOpen(true)}
        onFork={(entryId) => runAction("创建会话分支", () => fork(entryId))}
      />}

      {bootstrap && piReady && <TerminalDrawer
        open={terminalOpen}
        cwd={bootstrap.project.cwd}
        onClose={() => setTerminalOpen(false)}
        onRun={async (command) => parseBashResult(responseData(await controller.command({ type: "bash", command })))}
        onAbort={async () => {
          try { await controller.command({ type: "abort_bash" }); }
          catch (cause) { reportActionError("停止命令", cause); }
        }}
        onRevealPath={(path) => runAction("显示命令输出", () => api.revealPath(path))}
      />}

      {paletteOpen && (
        <CommandPalette
          commands={bootstrap?.commands ?? []}
          actions={paletteActions}
          onClose={() => setPaletteOpen(false)}
          onInsertCommand={(command: SlashCommandSummary) => { composerDraft.setText(`/${command.name} `); setWorkspaceView("chat"); focusComposer(); }}
        />
      )}
      {state.extensionRequest && <ExtensionDialog request={state.extensionRequest} onRespond={(response) => void controller.respondToExtension(response).catch((cause: unknown) => controller.notify(`回复扩展请求失败：${cause instanceof Error ? cause.message : String(cause)}`, "error"))} onExpire={controller.expireExtensionRequest} />}
      {renameOpen && bootstrap && <TextPromptDialog title="重命名会话" eyebrow="SESSION NAME" label="会话名称" initialValue={bootstrap.state.sessionName ?? ""} confirmLabel="保存名称" onCancel={() => setRenameOpen(false)} onConfirm={(name) => {
        setRenameOpen(false);
        runAction("重命名会话", () => controller.command({ type: "set_session_name", name }, true));
      }} />}
      {settingsOpen && bootstrap && (
        <SettingsDialog
          bootstrap={bootstrap}
          preferences={preferences}
          customArtwork={skinArtwork.bySkin}
          artworkBusySkin={skinArtwork.busySkin}
          onPreferencesChange={setPreferences}
          onChooseSkinArtwork={(skin) => void chooseSkinArtwork(skin)}
          onResetSkinArtwork={(skin) => void resetSkinArtwork(skin)}
          onAutoCompactionChange={(enabled) => runAction("更新自动压缩设置", () => controller.command({ type: "set_auto_compaction", enabled }, true))}
          onSteeringModeChange={(mode) => runAction("更新 Steering 模式", () => controller.command({ type: "set_steering_mode", mode }, true))}
          onFollowUpModeChange={(mode) => runAction("更新 Follow-up 模式", () => controller.command({ type: "set_follow_up_mode", mode }, true))}
          onRestartTrust={(trusted) => runAction("切换项目信任模式", () => controller.openProject(bootstrap.project.cwd, trusted))}
          onOpenLink={(url) => runAction("打开外部链接", () => api.openExternal(url))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <ToastStack notices={state.notices} onDismiss={controller.dismissNotice} />
    </div>
  );
}
