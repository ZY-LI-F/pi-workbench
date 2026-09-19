import type {
  BridgeEvent,
  PiExtensionResponse,
  RuntimeBootstrap,
  SerializableMessage,
} from "@shared/contracts";
import { appendDiagnosticText } from "@shared/diagnostics";
import { historicalTools } from "./historical-tools";
import { projectMessage, reconcileSnapshotMessages, resumeMessageProjection } from "./message-projection";
import { sameRuntimeScope, type RuntimeScope } from "@shared/runtime-scope";

export interface ToolExecutionState {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: "running" | "complete" | "error";
  readonly partialResult?: unknown;
  readonly result?: unknown;
  readonly startedAt: number;
}

export interface Notice {
  readonly id: string;
  readonly type: "info" | "warning" | "error" | "success";
  readonly message: string;
}

export interface ExtensionRequest {
  readonly type: "extension_ui_request";
  readonly id: string;
  readonly method: "select" | "confirm" | "input" | "editor";
  readonly title: string;
  readonly options?: readonly string[];
  readonly message?: string;
  readonly placeholder?: string;
  readonly prefill?: string;
  readonly timeout?: number;
}

export interface RuntimeUiState {
  readonly phase: "loading" | "ready" | "error";
  readonly bootstrap?: RuntimeBootstrap;
  readonly messages: readonly SerializableMessage[];
  readonly activeMessages: Readonly<Record<string, number>>;
  readonly nextMessageOrdinal: number;
  readonly scope?: RuntimeScope;
  readonly retiredGenerations: readonly string[];
  readonly executionObserved: boolean;
  readonly compactionObserved: boolean;
  readonly streaming: boolean;
  readonly compacting: boolean;
  readonly retrying: boolean;
  readonly queue: {
    readonly steering: readonly string[];
    readonly followUp: readonly string[];
  };
  readonly tools: Readonly<Record<string, ToolExecutionState>>;
  readonly extensionRequest?: ExtensionRequest;
  readonly extensionStatuses: Readonly<Record<string, string>>;
  readonly extensionWidgets: Readonly<
    Record<string, { readonly lines: readonly string[]; readonly placement: "aboveEditor" | "belowEditor" }>
  >;
  readonly editorInjection?: { readonly id: string; readonly text: string };
  readonly windowTitle?: string;
  readonly notices: readonly Notice[];
  readonly stderr: string;
  readonly error?: string;
}

export type RuntimeAction =
  | { readonly type: "SESSION_METRICS"; readonly stats: RuntimeBootstrap["stats"]; readonly scope?: RuntimeScope }
  | { readonly type: "SESSION_METRICS_FAILED"; readonly error: string; readonly scope?: RuntimeScope }
  | { readonly type: "BOOTSTRAP"; readonly payload: RuntimeBootstrap; readonly preserveLiveState?: boolean }
  | { readonly type: "INITIALIZE_FAILED"; readonly error: string }
  | { readonly type: "SYNC_FAILED"; readonly error: string }
  | { readonly type: "SYNC_WARNING"; readonly error: string }
  | { readonly type: "BRIDGE_EVENT"; readonly event: BridgeEvent }
  | { readonly type: "BRIDGE_EVENTS"; readonly events: readonly BridgeEvent[] }
  | { readonly type: "EXTENSION_RESOLVED"; readonly response: PiExtensionResponse }
  | { readonly type: "EXTENSION_EXPIRED"; readonly id: string }
  | { readonly type: "EDITOR_INJECTION_APPLIED"; readonly id: string }
  | { readonly type: "NOTICE"; readonly notice: Notice }
  | { readonly type: "DISMISS_NOTICE"; readonly id: string };

export const INITIAL_RUNTIME_STATE: RuntimeUiState = Object.freeze({
  phase: "loading",
  messages: Object.freeze([]),
  activeMessages: Object.freeze({}),
  nextMessageOrdinal: 0,
  retiredGenerations: Object.freeze([]),
  executionObserved: false,
  compactionObserved: false,
  streaming: false,
  compacting: false,
  retrying: false,
  queue: Object.freeze({ steering: Object.freeze([]), followUp: Object.freeze([]) }),
  tools: Object.freeze({}),
  extensionStatuses: Object.freeze({}),
  extensionWidgets: Object.freeze({}),
  notices: Object.freeze([]),
  stderr: "",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : Object.freeze({});
}

function noticeFromExtension(payload: Record<string, unknown>): Notice {
  const rawType = payload.notifyType;
  const type = rawType === "warning" || rawType === "error" ? rawType : "info";
  return Object.freeze({
    id: typeof payload.id === "string" ? payload.id : crypto.randomUUID(),
    type,
    message: typeof payload.message === "string" ? payload.message : "扩展发来了一条空通知",
  });
}

function extensionErrorValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function handleExtensionError(state: RuntimeUiState, payload: Record<string, unknown>): RuntimeUiState {
  const extensionPath = extensionErrorValue(payload.extensionPath, "未知扩展");
  const event = extensionErrorValue(payload.event, "未知事件");
  const error = extensionErrorValue(payload.error, "扩展没有提供错误原因");
  const stack = typeof payload.stack === "string" && payload.stack.trim().length > 0
    ? payload.stack
    : undefined;
  const noticeMessage = `Pi 扩展 ${extensionPath} 处理 ${event} 时失败：${error.replace(/\s+/gu, " ").trim()}`;
  const diagnostic = [
    "[Pi extension_error]",
    `extension=${extensionPath}`,
    `event=${event}`,
    `error=${error}`,
    ...(stack ? [`stack=${stack}`] : []),
    "",
  ].join("\n");
  return {
    ...state,
    notices: Object.freeze([
      ...state.notices,
      Object.freeze({ id: crypto.randomUUID(), type: "error" as const, message: noticeMessage }),
    ]),
    stderr: appendDiagnosticText(state.stderr, diagnostic),
  };
}

function extensionDialog(payload: Record<string, unknown>): ExtensionRequest {
  const method = payload.method;
  if (method !== "select" && method !== "confirm" && method !== "input" && method !== "editor") {
    throw new Error(`不支持的扩展对话框方法: ${String(method)}`);
  }
  return Object.freeze({
    type: "extension_ui_request",
    id: String(payload.id),
    method,
    title: typeof payload.title === "string" ? payload.title : "Pi 扩展请求",
    options: Array.isArray(payload.options)
      ? Object.freeze(payload.options.filter((option): option is string => typeof option === "string"))
      : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
    placeholder: typeof payload.placeholder === "string" ? payload.placeholder : undefined,
    prefill: typeof payload.prefill === "string" ? payload.prefill : undefined,
    timeout:
      typeof payload.timeout === "number" && Number.isFinite(payload.timeout) && payload.timeout > 0
        ? payload.timeout
        : undefined,
  });
}

function handleExtensionRequest(state: RuntimeUiState, payload: Record<string, unknown>): RuntimeUiState {
  const method = payload.method;
  if (method === "notify") {
    return { ...state, notices: Object.freeze([...state.notices, noticeFromExtension(payload)]) };
  }
  if (method === "setStatus") {
    const key = String(payload.statusKey);
    const statuses = { ...state.extensionStatuses };
    if (typeof payload.statusText === "string") statuses[key] = payload.statusText;
    else delete statuses[key];
    return { ...state, extensionStatuses: Object.freeze(statuses) };
  }
  if (method === "setWidget") {
    const key = String(payload.widgetKey);
    const widgets = { ...state.extensionWidgets };
    if (Array.isArray(payload.widgetLines)) {
      widgets[key] = Object.freeze({
        lines: Object.freeze(payload.widgetLines.filter((line): line is string => typeof line === "string")),
        placement: payload.widgetPlacement === "aboveEditor" ? "aboveEditor" : "belowEditor",
      });
    } else {
      delete widgets[key];
    }
    return { ...state, extensionWidgets: Object.freeze(widgets) };
  }
  if (method === "setTitle" && typeof payload.title === "string") {
    return { ...state, windowTitle: payload.title };
  }
  if (method === "set_editor_text" && typeof payload.text === "string") {
    return {
      ...state,
      editorInjection: Object.freeze({ id: String(payload.id), text: payload.text }),
    };
  }
  return { ...state, extensionRequest: extensionDialog(payload) };
}

function handlePiEvent(state: RuntimeUiState, payload: Record<string, unknown>): RuntimeUiState {
  if (payload.type === "extension_ui_request") return handleExtensionRequest(state, payload);
  if (payload.type === "extension_error") return handleExtensionError(state, payload);
  if (payload.type === "agent_start") return { ...state, streaming: true, retrying: false, executionObserved: true };
  if (payload.type === "agent_settled") return { ...state, streaming: false, retrying: false, executionObserved: true };
  if (payload.type === "compaction_start") return { ...state, compacting: true, compactionObserved: true };
  if (payload.type === "compaction_end") {
    state = { ...state, compactionObserved: true };
    const errorMessage = typeof payload.errorMessage === "string" && payload.errorMessage.trim().length > 0
      ? payload.errorMessage.trim()
      : undefined;
    if (!errorMessage || payload.reason === "manual") return { ...state, compacting: false };
    return {
      ...state,
      compacting: false,
      error: errorMessage,
      notices: Object.freeze([
        ...state.notices,
        Object.freeze({ id: crypto.randomUUID(), type: "error" as const, message: `自动上下文压缩失败：${errorMessage}` }),
      ]),
    };
  }
  if (payload.type === "auto_retry_start") return { ...state, retrying: true };
  if (payload.type === "auto_retry_end") return { ...state, retrying: false };
  if (payload.type === "queue_update") {
    return {
      ...state,
      queue: Object.freeze({
        steering: Object.freeze(Array.isArray(payload.steering) ? payload.steering.map(String) : []),
        followUp: Object.freeze(Array.isArray(payload.followUp) ? payload.followUp.map(String) : []),
      }),
    };
  }
  if (
    (payload.type === "message_start" || payload.type === "message_update" || payload.type === "message_end") &&
    isRecord(payload.message)
  ) {
    return {
      ...state,
      ...projectMessage(state, payload.type, payload.message as SerializableMessage,
        state.scope ? `${state.scope.generation}:${state.scope.scope}` : state.bootstrap?.state.sessionId ?? "initial", state.scope?.sequence),
    };
  }
  if (payload.type === "tool_execution_start") {
    const id = String(payload.toolCallId);
    return {
      ...state,
      tools: Object.freeze({
        ...state.tools,
        [id]: Object.freeze({
          id,
          name: String(payload.toolName),
          args: recordValue(payload.args),
          status: "running",
          startedAt: Date.now(),
        }),
      }),
    };
  }
  if (payload.type === "tool_execution_update") {
    const id = String(payload.toolCallId);
    const previous = state.tools[id];
    if (!previous) return state;
    return {
      ...state,
      tools: Object.freeze({
        ...state.tools,
        [id]: Object.freeze({ ...previous, partialResult: payload.partialResult }),
      }),
    };
  }
  if (payload.type === "tool_execution_end") {
    const id = String(payload.toolCallId);
    const previous = state.tools[id];
    const completed: ToolExecutionState = Object.freeze({
      id,
      name: previous?.name ?? String(payload.toolName),
      args: previous?.args ?? Object.freeze({}),
      status: payload.isError ? "error" : "complete",
      result: payload.result,
      startedAt: previous?.startedAt ?? Date.now(),
    });
    return { ...state, tools: Object.freeze({ ...state.tools, [id]: completed }) };
  }
  if (payload.type === "session_info_changed" && state.bootstrap) {
    const sessionName = typeof payload.name === "string" ? payload.name : undefined;
    return {
      ...state,
      bootstrap: Object.freeze({
        ...state.bootstrap,
        state: Object.freeze({ ...state.bootstrap.state, sessionName }),
      }),
    };
  }
  if (payload.type === "thinking_level_changed" && state.bootstrap && typeof payload.level === "string") {
    return {
      ...state,
      bootstrap: Object.freeze({
        ...state.bootstrap,
        state: Object.freeze({
          ...state.bootstrap.state,
          thinkingLevel: payload.level as RuntimeBootstrap["state"]["thinkingLevel"],
        }),
      }),
    };
  }
  return state;
}

function handleBridgeEvent(state: RuntimeUiState, event: BridgeEvent): RuntimeUiState {
  if ((event.source === "pi" || event.source === "runtime") && event.scope) {
    if (event.source === "runtime" && event.payload.type === "runtime_starting") {
      if (state.retiredGenerations.includes(event.scope.generation)) return state;
      return { ...state, scope: event.scope, activeMessages: Object.freeze({}), streaming: false, compacting: false, retrying: false,
        executionObserved: false, compactionObserved: false, queue: INITIAL_RUNTIME_STATE.queue, tools: Object.freeze({}), extensionRequest: undefined,
        extensionStatuses: Object.freeze({}), extensionWidgets: Object.freeze({}), editorInjection: undefined, windowTitle: undefined,
        retiredGenerations: state.scope && state.scope.generation !== event.scope.generation
        ? [...state.retiredGenerations, state.scope.generation] : state.retiredGenerations };
    }
    if (state.scope && (!sameRuntimeScope(state.scope, event.scope) || event.scope.sequence <= state.scope.sequence)) return state;
    state = { ...state, scope: event.scope };
  }
  if (event.source === "pi") return handlePiEvent(state, event.payload as unknown as Record<string, unknown>);
  if (event.source !== "runtime") return state;
  const payload = event.payload;
  if (payload.type === "background_stopped") return { ...state, notices: [...state.notices, { id: crypto.randomUUID(), type: "info",
    message: `Pi 已停止，并核查本机后台进程（终止 ${payload.count} 个）。远程、容器或主动脱离监管的任务须在对应环境核查。` }] };
  if (payload.type === "runtime_stderr") return { ...state, stderr: appendDiagnosticText(state.stderr, payload.message) };
  // 运行时重启成功后清除上一次 runtime_exit / protocol_error 留下的错误横幅。
  if (payload.type === "runtime_ready") return { ...state, error: undefined };
  if (payload.type === "runtime_exit") {
    return {
      ...state,
      streaming: false,
      error: `Pi RPC 已退出（code=${String(payload.code)}，signal=${String(payload.signal)}）`,
    };
  }
  if (payload.type === "protocol_error") {
    return { ...state, streaming: false, compacting: false, retrying: false, executionObserved: true, compactionObserved: true, error: `Pi RPC 协议错误：${payload.message}` };
  }
  return state;
}

export function runtimeReducer(state: RuntimeUiState, action: RuntimeAction): RuntimeUiState {
  if (action.type === "SESSION_METRICS" || action.type === "SESSION_METRICS_FAILED") {
    const bootstrap = state.bootstrap;
    if (!bootstrap || (action.scope && state.scope && !sameRuntimeScope(action.scope, state.scope))
      || (action.scope && action.scope.sequence < (bootstrap.statsSequence ?? -1))) return state;
    if (action.type === "SESSION_METRICS_FAILED") return { ...state, bootstrap: { ...bootstrap, statsError: action.error } };
    if (action.stats.sessionId !== bootstrap.state.sessionId
      || (action.scope && action.scope.sequence < (bootstrap.statsSequence ?? -1))) return state;
    return { ...state, bootstrap: { ...bootstrap, stats: action.stats, statsError: undefined, statsSequence: action.scope?.sequence,
      sessions: bootstrap.sessions.map((session) => session.id === action.stats.sessionId
        ? { ...session, messageCount: action.stats.totalMessages } : session) } };
  }
  if (action.type === "EDITOR_INJECTION_APPLIED") {
    return state.editorInjection?.id === action.id ? { ...state, editorInjection: undefined } : state;
  }
  if (action.type === "BOOTSTRAP") {
    if (action.payload.scope && (state.retiredGenerations.includes(action.payload.scope.generation)
      || (state.scope?.generation === action.payload.scope.generation && state.scope.scope > action.payload.scope.scope))) return state;
    const identityChanged = Boolean(
      state.bootstrap
      && (
        state.bootstrap.project.cwd !== action.payload.project.cwd
        || state.bootstrap.state.sessionId !== action.payload.state.sessionId
      )
    );
    const base = identityChanged
      ? { ...INITIAL_RUNTIME_STATE, notices: state.notices }
      : state;
    const preserveLive = !identityChanged && Boolean(state.bootstrap) && action.preserveLiveState;
    const scoped = Boolean(action.payload.scope && state.scope && sameRuntimeScope(action.payload.scope, state.scope) && action.payload.messageSequence !== undefined);
    const liveStateNewer = scoped && state.scope!.sequence > (action.payload.stateSequence ?? action.payload.scope!.sequence);
    return {
      ...base,
      phase: "ready",
      bootstrap: !identityChanged && scoped && (state.bootstrap?.statsSequence ?? -1) > (action.payload.statsSequence ?? -1)
        ? { ...action.payload, stats: state.bootstrap!.stats, statsSequence: state.bootstrap!.statsSequence, statsError: state.bootstrap!.statsError }
        : action.payload,
      ...(scoped ? reconcileSnapshotMessages(state, action.payload) : preserveLive ? {} : resumeMessageProjection(action.payload.messages, action.payload.state.isStreaming)),
      scope: (liveStateNewer || preserveLive) && state.scope ? state.scope : action.payload.scope,
      retiredGenerations: state.retiredGenerations,
      streaming: (liveStateNewer && state.executionObserved) || preserveLive ? state.streaming : action.payload.state.isStreaming,
      compacting: (liveStateNewer && state.compactionObserved) || preserveLive ? state.compacting : action.payload.state.isCompacting,
      executionObserved: true,
      compactionObserved: true,
      queue: liveStateNewer ? state.queue : base.queue,
      tools: liveStateNewer || preserveLive ? Object.freeze({ ...historicalTools(action.payload.messages), ...state.tools }) : Object.freeze({
        ...Object.fromEntries(Object.entries(base.tools).filter(([, tool]) => tool.status !== "running" || action.payload.state.isStreaming)),
        ...historicalTools(action.payload.messages),
      }),
      error: undefined,
    };
  }
  if (action.type === "INITIALIZE_FAILED") return { ...state, phase: "error", error: action.error };
  if (action.type === "SYNC_FAILED") {
    return {
      ...state,
      error: action.error,
      notices: Object.freeze([
        ...state.notices,
        Object.freeze({ id: crypto.randomUUID(), type: "error", message: action.error }),
      ]),
    };
  }
  if (action.type === "SYNC_WARNING") {
    return {
      ...state,
      error: action.error,
      notices: Object.freeze([
        ...state.notices,
        Object.freeze({ id: crypto.randomUUID(), type: "warning", message: action.error }),
      ]),
    };
  }
  if (action.type === "BRIDGE_EVENT") return handleBridgeEvent(state, action.event);
  if (action.type === "BRIDGE_EVENTS") return action.events.reduce(handleBridgeEvent, state);
  if (action.type === "EXTENSION_RESOLVED") {
    if (state.extensionRequest?.id !== action.response.id) return state;
    return { ...state, extensionRequest: undefined };
  }
  if (action.type === "EXTENSION_EXPIRED") {
    if (state.extensionRequest?.id !== action.id) return state;
    return { ...state, extensionRequest: undefined };
  }
  if (action.type === "NOTICE") return { ...state, notices: Object.freeze([...state.notices, action.notice]) };
  if (action.type === "DISMISS_NOTICE") {
    return { ...state, notices: Object.freeze(state.notices.filter((notice) => notice.id !== action.id)) };
  }
  return state;
}
