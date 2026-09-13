import { describe, expect, it } from "vitest";
import type { BridgeEvent, RuntimeBootstrap, SerializableMessage } from "@shared/contracts";
import {
  INITIAL_RUNTIME_STATE,
  runtimeReducer,
  type RuntimeUiState,
} from "@renderer/lib/runtime-state";

const BOOTSTRAP = {
  project: { cwd: "C:/workspace", name: "workspace", trusted: false, requiresTrust: false, requiresSelection: false },
  recentProjects: [],
  state: {
    thinkingLevel: "off",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    sessionId: "session-1",
    autoCompactionEnabled: true,
    messageCount: 0,
    pendingMessageCount: 0,
  },
  messages: [],
  models: [],
  thinkingLevels: ["off", "medium", "high"],
  commands: [],
  sessions: [],
  stats: {
    sessionId: "session-1",
    sessionFile: undefined,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    contextUsage: null,
  },
  entries: [],
  tree: [],
  leafId: null,
  piVersion: "0.80.10",
} as unknown as RuntimeBootstrap;

function readyState(): RuntimeUiState {
  return runtimeReducer(INITIAL_RUNTIME_STATE, { type: "BOOTSTRAP", payload: BOOTSTRAP });
}

function piEvent(state: RuntimeUiState, payload: Record<string, unknown>): RuntimeUiState {
  return runtimeReducer(state, {
    type: "BRIDGE_EVENT",
    event: { source: "pi", payload } as unknown as BridgeEvent,
  });
}

describe("runtimeReducer", () => {
  it("merges exact post-snapshot message occurrences without duplicating already persisted messages", () => {
    const scope = { generation: "generation", scope: 0, sequence: 0, cwd: "C:/workspace", sessionId: "session-1" };
    let state = runtimeReducer(INITIAL_RUNTIME_STATE, { type: "BOOTSTRAP", payload: { ...BOOTSTRAP, scope } });
    const user = { role: "user", content: "before read barrier", timestamp: 10 } as const;
    const assistant = { role: "assistant", content: [{ type: "text", text: "流式内容" }], timestamp: 10, provider: "test", model: "test", stopReason: "stop" } as const;
    const events = [{ type: "agent_start" }, { type: "message_start", message: user }, { type: "message_end", message: user },
      { type: "message_start", message: assistant }, { type: "message_update", message: assistant }];
    for (const [index, payload] of events.entries()) state = runtimeReducer(state, { type: "BRIDGE_EVENT", event: { source: "pi", scope: { ...scope, sequence: index + 1 }, payload } as BridgeEvent });
    const snapshot = { ...BOOTSTRAP, scope, stateSequence: 3, messageSequence: 3,
      messages: [{ ...user, stella: { key: "entry:session-1:user-id", entryId: "user-id" } }], state: { ...BOOTSTRAP.state, isStreaming: true } };
    state = runtimeReducer(state, { type: "BOOTSTRAP", payload: snapshot });
    expect(state.messages).toHaveLength(2); expect(state.messages[0]?.stella?.entryId).toBe("user-id");
    expect(state.activeMessages.assistant).toBe(1); expect(state.streaming).toBe(true);
    state = runtimeReducer(state, { type: "BRIDGE_EVENT", event: { source: "pi", scope: { ...scope, sequence: 6 }, payload: { type: "message_end", message: assistant } } as BridgeEvent });
    expect(state.messages).toHaveLength(2); expect(state.activeMessages).toEqual({});
  });

  it("restores an in-flight message on renderer reload even when agent_start happened before subscription", () => {
    const scope = { generation: "generation", scope: 0, sequence: 6, cwd: "C:/workspace", sessionId: "session-1" };
    let state = runtimeReducer(INITIAL_RUNTIME_STATE, { type: "BRIDGE_EVENT", event: { source: "pi", scope,
      payload: { type: "message_update", message: { role: "assistant", timestamp: 1, content: [{ type: "text", text: "live tail" }], model: "test", provider: "test", stopReason: "stop" } } } as BridgeEvent });
    state = runtimeReducer(state, { type: "BOOTSTRAP", payload: { ...BOOTSTRAP, scope: { ...scope, sequence: 3 }, stateSequence: 3, messageSequence: 4, state: { ...BOOTSTRAP.state, isStreaming: true } } });
    expect(state.streaming).toBe(true); expect(state.messages).toHaveLength(1);
  });

  it("does not accept a snapshot from a retired runtime generation", () => {
    const scope = { generation: "old", scope: 0, sequence: 3, cwd: "C:/workspace" };
    let state = runtimeReducer(INITIAL_RUNTIME_STATE, { type: "BOOTSTRAP", payload: { ...BOOTSTRAP, scope } });
    state = runtimeReducer(state, { type: "BRIDGE_EVENT", event: { source: "runtime", scope: { ...scope, generation: "new" }, payload: { type: "runtime_starting", cwd: scope.cwd } } });
    expect(runtimeReducer(state, { type: "BOOTSTRAP", payload: { ...BOOTSTRAP, scope } })).toBe(state);
  });

  it("preserves identical same-millisecond messages across independent start/end lifecycles", () => {
    const message = { role: "user", timestamp: 123, content: "repeat intentionally" };
    let state = readyState();
    for (let index = 0; index < 2; index += 1) {
      state = piEvent(state, { type: "message_start", message });
      state = piEvent(state, { type: "message_end", message });
    }
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]?.stella?.key).not.toBe(state.messages[1]?.stella?.key);
    expect(state.activeMessages).toEqual({});
  });

  it("ignores duplicate, out-of-order and foreign-generation events without mutating the current conversation", () => {
    const scope = { generation: "new", scope: 2, sequence: 10, cwd: "C:/workspace", sessionId: "session-1" };
    const state = runtimeReducer(INITIAL_RUNTIME_STATE, { type: "BOOTSTRAP", payload: { ...BOOTSTRAP, scope } });
    for (const stale of [{ ...scope, sequence: 10 }, { ...scope, sequence: 9 }, { ...scope, generation: "old", sequence: 100 }, { ...scope, scope: 1, sequence: 99 }]) {
      const next = runtimeReducer(state, { type: "BRIDGE_EVENT", event: { source: "pi", scope: stale, payload: { type: "agent_start" } } as BridgeEvent });
      expect(next).toBe(state);
    }
    const next = runtimeReducer(state, { type: "BRIDGE_EVENT", event: { source: "pi", scope: { ...scope, sequence: 11 }, payload: { type: "agent_start" } } as BridgeEvent });
    expect(next.streaming).toBe(true);
  });

  it("consumes editor injections once without allowing a stale acknowledgement to clear a newer injection", () => {
    const injected = piEvent(readyState(), { type: "extension_ui_request", method: "set_editor_text", id: "injection-1", text: "extension draft" });
    expect(injected.editorInjection?.text).toBe("extension draft");
    expect(runtimeReducer(injected, { type: "EDITOR_INJECTION_APPLIED", id: "old-id" }).editorInjection).toEqual(injected.editorInjection);
    expect(runtimeReducer(injected, { type: "EDITOR_INJECTION_APPLIED", id: "injection-1" }).editorInjection).toBeUndefined();
  });

  it("rehydrates tool completion and failure from durable results without live events", () => {
    const messages: readonly SerializableMessage[] = [
      { role: "assistant", timestamp: 1, model: "test", provider: "test", stopReason: "toolUse", content: [
        { type: "toolCall", id: "read-1", name: "read", arguments: { path: "file.txt" } },
        { type: "toolCall", id: "read-2", name: "read", arguments: { path: "missing.txt" } },
      ] },
      { role: "toolResult", timestamp: 2, toolCallId: "read-1", toolName: "read", isError: false, content: [{ type: "text", text: "file contents" }] },
      { role: "toolResult", timestamp: 3, toolCallId: "read-2", toolName: "read", isError: true, content: [{ type: "text", text: "not found" }] },
    ];
    const state = runtimeReducer(INITIAL_RUNTIME_STATE, { type: "BOOTSTRAP", payload: { ...BOOTSTRAP, messages } });
    expect(state.tools["read-1"]).toMatchObject({ status: "complete", args: { path: "file.txt" }, startedAt: 1 });
    expect(state.tools["read-2"]).toMatchObject({ status: "error", args: { path: "missing.txt" } });
  });

  it("hydrates a ready workspace without mutating the initial state", () => {
    const result = readyState();
    expect(result.phase).toBe("ready");
    expect(result.bootstrap).toBe(BOOTSTRAP);
    expect(INITIAL_RUNTIME_STATE.phase).toBe("loading");
  });

  it("upserts streaming messages and tracks tool execution", () => {
    const initialMessage: SerializableMessage = {
      role: "assistant",
      content: [{ type: "text", text: "第一段" }],
      provider: "test",
      model: "model",
      stopReason: "stop",
      timestamp: 10,
    };
    const updatedMessage: SerializableMessage = {
      ...initialMessage,
      content: [{ type: "text", text: "第一段与第二段" }],
    };
    let state = piEvent(readyState(), { type: "message_start", message: initialMessage });
    state = piEvent(state, { type: "message_update", message: updatedMessage });
    state = piEvent(state, {
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "read",
      args: { path: "README.md" },
    });
    state = piEvent(state, {
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "read",
      result: "ok",
      isError: false,
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject(updatedMessage);
    expect(state.tools["tool-1"]).toMatchObject({ status: "complete", result: "ok" });
  });

  it("tracks queue and every extension UI surface", () => {
    let state = piEvent(readyState(), {
      type: "queue_update",
      steering: ["立即补充"],
      followUp: ["完成后继续"],
    });
    state = piEvent(state, {
      type: "extension_ui_request",
      id: "status-1",
      method: "setStatus",
      statusKey: "lint",
      statusText: "通过",
    });
    state = piEvent(state, {
      type: "extension_ui_request",
      id: "widget-1",
      method: "setWidget",
      widgetKey: "progress",
      widgetLines: ["3 / 3"],
      widgetPlacement: "aboveEditor",
    });
    state = piEvent(state, {
      type: "extension_ui_request",
      id: "title-1",
      method: "setTitle",
      title: "正在审查",
    });
    state = piEvent(state, {
      type: "extension_ui_request",
      id: "editor-1",
      method: "set_editor_text",
      text: "扩展写入的草稿",
    });
    state = piEvent(state, {
      type: "extension_ui_request",
      id: "input-1",
      method: "input",
      title: "补充说明",
      placeholder: "输入内容",
      timeout: 2_000,
    });

    expect(state.queue).toEqual({ steering: ["立即补充"], followUp: ["完成后继续"] });
    expect(state.extensionStatuses.lint).toBe("通过");
    expect(state.extensionWidgets.progress).toEqual({ lines: ["3 / 3"], placement: "aboveEditor" });
    expect(state.windowTitle).toBe("正在审查");
    expect(state.editorInjection?.text).toBe("扩展写入的草稿");
    expect(state.extensionRequest?.timeout).toBe(2_000);

    const unchanged = runtimeReducer(state, { type: "EXTENSION_EXPIRED", id: "stale-request" });
    expect(unchanged.extensionRequest?.id).toBe("input-1");
    state = runtimeReducer(state, { type: "EXTENSION_EXPIRED", id: "input-1" });
    expect(state.extensionRequest).toBeUndefined();
  });

  it("clears session-scoped activity when bootstrap changes project or session", () => {
    let state = piEvent(readyState(), {
      type: "queue_update",
      steering: ["旧会话消息"],
      followUp: ["旧会话后续"],
    });
    state = piEvent(state, { type: "tool_execution_start", toolCallId: "old-tool", toolName: "read", args: {} });
    state = piEvent(state, { type: "extension_ui_request", id: "old-dialog", method: "input", title: "旧请求" });
    state = runtimeReducer(state, {
      type: "BRIDGE_EVENT",
      event: { source: "runtime", payload: { type: "runtime_stderr", message: "old diagnostic" } },
    });

    const nextBootstrap = Object.freeze({
      ...BOOTSTRAP,
      state: Object.freeze({ ...BOOTSTRAP.state, sessionId: "session-2" }),
    }) as RuntimeBootstrap;
    state = runtimeReducer(state, { type: "BOOTSTRAP", payload: nextBootstrap });

    expect(state.bootstrap).toBe(nextBootstrap);
    expect(state.tools).toEqual({});
    expect(state.queue).toEqual({ steering: [], followUp: [] });
    expect(state.extensionRequest).toBeUndefined();
    expect(state.stderr).toBe("");
  });

  it("surfaces automatic compaction failures and clears the busy state", () => {
    let state = piEvent(readyState(), { type: "compaction_start", reason: "threshold" });
    state = piEvent(state, {
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: "Compaction failed: quota exceeded",
    });

    expect(state.compacting).toBe(false);
    expect(state.error).toContain("quota exceeded");
    expect(state.notices.at(-1)?.message).toContain("自动上下文压缩失败");
  });

  it("surfaces Pi extension errors as persistent notices and diagnostics", () => {
    const result = piEvent(readyState(), {
      type: "extension_error",
      extensionPath: "C:/workspace/.pi/extensions/remote-bash.ts",
      event: "user_bash",
      error: "SSH connection failed\nremote host unavailable",
      stack: "Error: SSH connection failed\n    at remote-bash.ts:42",
    });

    expect(result.phase).toBe("ready");
    expect(result.error).toBeUndefined();
    expect(result.notices.at(-1)).toMatchObject({
      type: "error",
      message: expect.stringContaining("remote-bash.ts 处理 user_bash 时失败：SSH connection failed remote host unavailable"),
    });
    expect(result.stderr).toContain("[Pi extension_error]");
    expect(result.stderr).toContain("extension=C:/workspace/.pi/extensions/remote-bash.ts");
    expect(result.stderr).toContain("event=user_bash");
    expect(result.stderr).toContain("stack=Error: SSH connection failed");
  });

  it("clears the runtime error banner once the runtime reports ready again", () => {
    let state = runtimeReducer(readyState(), {
      type: "BRIDGE_EVENT",
      event: { source: "runtime", payload: { type: "runtime_exit", code: 1, signal: null } },
    });
    expect(state.error).toContain("Pi RPC 已退出");
    state = runtimeReducer(state, {
      type: "BRIDGE_EVENT",
      event: { source: "runtime", payload: { type: "runtime_ready", cwd: "C:/workspace" } },
    });
    expect(state.error).toBeUndefined();
  });

  it("surfaces runtime protocol failures", () => {
    const result = runtimeReducer(readyState(), {
      type: "BRIDGE_EVENT",
      event: {
        source: "runtime",
        payload: { type: "protocol_error", message: "invalid json", record: "{" },
      },
    });
    expect(result.error).toContain("invalid json");
  });
});
