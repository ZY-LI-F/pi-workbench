// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, StellaDesktopApi } from "../../src/shared/contracts";
import { BOARD_SCHEMA_VERSION, type BoardBootstrap, type KanbanTask } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { useKanban } from "../../src/renderer/src/hooks/use-kanban";

const NOW = "2026-08-24T00:00:00.000Z";

function task(title: string): KanbanTask {
  return Object.freeze({
    id: "task-1",
    title,
    description: "说明",
    acceptanceCriteria: "验收",
    priority: "medium",
    projectPath: "C:/project",
    projectName: "project",
    trusted: true,
    executionTarget: Object.freeze({ kind: "manual" }),
    stage: "planned",
    specRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function bootstrap(title: string): BoardBootstrap {
  return Object.freeze({
    board: Object.freeze({
      version: BOARD_SCHEMA_VERSION,
      tasks: Object.freeze([task(title)]),
      runs: Object.freeze([]),
      activities: Object.freeze([]),
      comments: Object.freeze([]),
      agentTasks: Object.freeze([]),
      customAgents: Object.freeze([]),
      squads: Object.freeze([]),
      autopilots: Object.freeze([]),
      autopilotRuns: Object.freeze([]),
    }),
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
  });
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

afterEach(() => cleanup());

describe("useKanban synchronization", () => {
  it("keeps a newer Board snapshot when an operation returns an older bootstrap", async () => {
    const response = deferred<BoardBootstrap>();
    let emit: ((event: BridgeEvent) => void) | undefined;
    const api = {
      boardInitialize: vi.fn(async () => bootstrap("初始")),
      boardUpdateTask: vi.fn(() => response.promise),
      onEvent: vi.fn((listener: (event: BridgeEvent) => void) => { emit = listener; return () => undefined; }),
    } as unknown as StellaDesktopApi;
    const { result } = renderHook(() => useKanban(api));
    await waitFor(() => expect(result.current.state.bootstrap?.board.tasks[0]?.title).toBe("初始"));

    let operation!: Promise<BoardBootstrap>;
    act(() => {
      operation = result.current.updateTask({ taskId: "task-1", title: "旧响应" });
    });
    act(() => {
      emit?.({ source: "board", payload: { type: "snapshot", bootstrap: bootstrap("新快照") } });
      response.resolve(bootstrap("旧响应"));
    });
    await act(async () => { await operation; });

    expect(result.current.state.bootstrap?.board.tasks[0]?.title).toBe("新快照");
  });

  it("keeps a shared pending key active until every concurrent operation settles", async () => {
    const first = deferred<BoardBootstrap>();
    const second = deferred<BoardBootstrap>();
    const boardUpdateTask = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const api = {
      boardInitialize: vi.fn(async () => bootstrap("初始")),
      boardUpdateTask,
      onEvent: vi.fn(() => () => undefined),
    } as unknown as StellaDesktopApi;
    const { result } = renderHook(() => useKanban(api));
    await waitFor(() => expect(result.current.state.phase).toBe("ready"));

    let firstOperation!: Promise<BoardBootstrap>;
    let secondOperation!: Promise<BoardBootstrap>;
    act(() => {
      firstOperation = result.current.updateTask({ taskId: "task-1", title: "第一份" });
      secondOperation = result.current.updateTask({ taskId: "task-1", title: "第二份" });
    });
    expect(result.current.state.pending).toContain("task-1");

    second.resolve(bootstrap("第二份"));
    await act(async () => { await secondOperation; });
    expect(result.current.state.pending).toContain("task-1");
    expect(result.current.state.bootstrap?.board.tasks[0]?.title).toBe("第二份");

    first.resolve(bootstrap("第一份"));
    await act(async () => { await firstOperation; });
    expect(result.current.state.pending).not.toContain("task-1");
    expect(result.current.state.bootstrap?.board.tasks[0]?.title).toBe("第二份");
  });
});
