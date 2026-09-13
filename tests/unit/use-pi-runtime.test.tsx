// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, PiResponse, RuntimeBootstrap, StellaDesktopApi } from "../../src/shared/contracts";
import {
  isReportedRuntimeError,
  usePiRuntime,
} from "../../src/renderer/src/hooks/use-pi-runtime";

function pendingBootstrap(): Promise<RuntimeBootstrap> {
  return new Promise(() => undefined);
}

function bootstrap(sessionId: string, cwd = "C:/project"): RuntimeBootstrap {
  return {
    project: { cwd, name: cwd.split("/").at(-1) ?? cwd, trusted: true, requiresTrust: false, requiresSelection: false },
    recentProjects: [],
    state: { sessionId, thinkingLevel: "off", isStreaming: false, isCompacting: false, steeringMode: "all", followUpMode: "all", autoCompactionEnabled: true, messageCount: 0, pendingMessageCount: 0 },
    messages: [], models: [], thinkingLevels: ["off"], commands: [], sessions: [], entries: [], tree: [], leafId: null, piVersion: "test",
    stats: { sessionId, userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0, contextUsage: null },
  } as unknown as RuntimeBootstrap;
}

function runtimeApi(overrides: Partial<StellaDesktopApi>): StellaDesktopApi {
  return {
    initialize: vi.fn(pendingBootstrap),
    onEvent: vi.fn(() => () => undefined),
    ...overrides,
  } as unknown as StellaDesktopApi;
}

afterEach(() => cleanup());

describe("usePiRuntime error reporting", () => {
  it("does not overwrite newer streamed content with an older refresh snapshot", async () => {
    let emit!: (event: BridgeEvent) => void;
    let complete!: (snapshot: RuntimeBootstrap) => void;
    const initial = bootstrap("same-session");
    const api = runtimeApi({
      initialize: async () => initial,
      onEvent: (listener) => { emit = listener; return () => undefined; },
      refresh: () => new Promise((resolve) => { complete = resolve; }),
    });
    const { result } = renderHook(() => usePiRuntime(api));
    await waitFor(() => expect(result.current.state.phase).toBe("ready"));
    let refreshing!: Promise<RuntimeBootstrap>;
    act(() => { refreshing = result.current.refresh(); });
    const message = { role: "user", content: "arrived after snapshot", timestamp: 42 } as const;
    act(() => {
      emit({ source: "pi", payload: { type: "agent_start" } } as BridgeEvent);
      emit({ source: "pi", payload: { type: "message_start", message } } as BridgeEvent);
    });
    await act(async () => { complete(initial); await refreshing; });
    expect(result.current.state.messages).toMatchObject([message]);
    expect(result.current.state.streaming).toBe(true);
  });

  it("drains a second settled event that arrives while the first refresh is pending", async () => {
    let emit!: (event: BridgeEvent) => void;
    const accepts: ((snapshot: RuntimeBootstrap) => void)[] = [];
    const initial = bootstrap("same-session");
    const api = runtimeApi({
      initialize: async () => initial,
      onEvent: (listener) => { emit = listener; return () => undefined; },
      refresh: vi.fn(() => new Promise((resolve) => { accepts.push(resolve); })),
    });
    const { result } = renderHook(() => usePiRuntime(api));
    await waitFor(() => expect(result.current.state.phase).toBe("ready"));
    const settled = { source: "pi", payload: { type: "agent_settled" } } as BridgeEvent;
    act(() => { emit(settled); emit(settled); });
    expect(api.refresh).toHaveBeenCalledTimes(1);
    await act(async () => { accepts[0]!(initial); });
    expect(api.refresh).toHaveBeenCalledTimes(2);
    const latest = { ...initial, state: { ...initial.state, sessionName: "latest turn" } };
    await act(async () => { accepts[1]!(latest); });
    expect(result.current.state.bootstrap?.state.sessionName).toBe("latest turn");
  });

  it("defers settled refreshes during navigation and ignores a stale initialization failure", async () => {
    let emit!: (event: BridgeEvent) => void;
    let failInitialize!: (cause: Error) => void;
    let finishOpen!: (snapshot: RuntimeBootstrap) => void;
    const next = bootstrap("new-session");
    const api = runtimeApi({
      initialize: () => new Promise((_, reject) => { failInitialize = reject; }),
      onEvent: (listener) => { emit = listener; return () => undefined; },
      openProject: () => new Promise((resolve) => { finishOpen = resolve; }),
      refresh: vi.fn(async () => next),
    });
    const { result } = renderHook(() => usePiRuntime(api));
    let opening!: Promise<RuntimeBootstrap | null>;
    act(() => { opening = result.current.openProject("C:/project", true); });
    act(() => { emit({ source: "pi", payload: { type: "agent_settled" } } as BridgeEvent); });
    expect(api.refresh).not.toHaveBeenCalled();
    await act(async () => { finishOpen(next); await opening; failInitialize(new Error("old initialization")); });
    expect(result.current.state.bootstrap?.state.sessionId).toBe("new-session");
    expect(result.current.state.phase).toBe("ready");
    expect(result.current.state.error).toBeUndefined();
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it("marks command failures that were already emitted as visible runtime notices", async () => {
    const api = runtimeApi({ command: vi.fn(async () => { throw new Error("RPC transport failed"); }) });
    const { result } = renderHook(() => usePiRuntime(api));
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.command({ type: "abort" });
      } catch (cause) {
        caught = cause;
      }
    });

    expect(isReportedRuntimeError(caught)).toBe(true);
    await waitFor(() => expect(result.current.state.notices.at(-1)?.message).toBe("RPC transport failed"));
  });

  it("treats a cancelled main-process trust prompt as no state change, not an error", async () => {
    const api = runtimeApi({ openProject: vi.fn(async () => null) });
    const { result } = renderHook(() => usePiRuntime(api));
    let opened: RuntimeBootstrap | null | undefined;

    await act(async () => {
      opened = await result.current.openProject("C:/project", true);
    });

    expect(opened).toBeNull();
    expect(result.current.state.notices).toEqual([]);
    expect(result.current.state.bootstrap).toBeUndefined();
  });

  it("does not turn a successful prompt into a send failure when only the refresh fails", async () => {
    const response: PiResponse = { id: "prompt-1", type: "response", command: "prompt", success: true };
    const api = runtimeApi({
      command: vi.fn(async () => response),
      refresh: vi.fn(async () => { throw new Error("refresh transport failed"); }),
    });
    const { result } = renderHook(() => usePiRuntime(api));
    let received: PiResponse | undefined;

    await act(async () => {
      received = await result.current.command({ type: "prompt", message: "只发送一次" }, true);
    });

    expect(received).toBe(response);
    expect(api.command).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.state.notices.at(-1)?.message)
      .toBe("消息已发送，但状态刷新失败：refresh transport failed"));
  });

  it("does not let a late initialize response overwrite a newer project session", async () => {
    let resolveInitialize: ((value: RuntimeBootstrap) => void) | undefined;
    const initialize = new Promise<RuntimeBootstrap>((resolve) => { resolveInitialize = resolve; });
    const newer = bootstrap("session-new", "C:/new-project");
    const api = runtimeApi({
      initialize: vi.fn(() => initialize),
      openProject: vi.fn(async () => newer),
    });
    const { result } = renderHook(() => usePiRuntime(api));

    await act(async () => {
      await result.current.openProject("C:/new-project", true);
    });
    resolveInitialize?.(bootstrap("session-old", "C:/old-project"));
    await act(async () => { await initialize; });

    expect(result.current.state.bootstrap?.state.sessionId).toBe("session-new");
    expect(result.current.state.bootstrap?.project.cwd).toBe("C:/new-project");
  });
});
