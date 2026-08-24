// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiResponse, RuntimeBootstrap, StellaDesktopApi } from "../../src/shared/contracts";
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
