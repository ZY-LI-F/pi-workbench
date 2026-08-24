import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExternalExecutions } from "../../src/renderer/src/hooks/use-external-executions";
import type { StellaDesktopApi } from "../../src/shared/contracts";
import type { ExternalExecutionCatalogSnapshot, ExternalExecutionScope } from "../../src/shared/external-execution";

function snapshot(scope: ExternalExecutionScope, title: string): ExternalExecutionCatalogSnapshot {
  return Object.freeze({
    epoch: 1,
    scope,
    capturedAt: "2026-08-24T08:00:00.000Z",
    sources: Object.freeze([Object.freeze({
      source: Object.freeze({ id: "claude", label: "Claude", description: "", supportsDetails: false, supportsImport: true, supportsContinue: true }),
      state: "ready",
      stale: false,
      items: Object.freeze([Object.freeze({
        sourceId: "claude",
        externalId: title,
        nativeId: title,
        kind: "background",
        title,
        projectPath: scope.kind === "project" ? scope.projectPath : "/repo",
        session: Object.freeze({ backendId: "claude", sessionId: title }),
        state: "working",
        needsInput: false,
        terminal: false,
        updatedAt: "2026-08-24T08:00:00.000Z",
      })]),
    })]),
  });
}

function Harness({ api, scope, enabled = true }: { readonly api: StellaDesktopApi; readonly scope: ExternalExecutionScope; readonly enabled?: boolean }) {
  const controller = useExternalExecutions(api, scope, enabled);
  return <span>{controller.snapshot?.sources[0]?.items[0]?.title ?? (controller.loading ? "loading" : "empty")}</span>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useExternalExecutions", () => {
  it("polls only while enabled", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async (scope: ExternalExecutionScope) => snapshot(scope, `refresh-${refresh.mock.calls.length}`));
    const api = { externalExecutionsRefresh: refresh } as unknown as StellaDesktopApi;
    const view = render(<Harness api={api} scope={{ kind: "all" }} />);
    await act(async () => { await Promise.resolve(); });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(refresh).toHaveBeenCalledTimes(2);

    view.rerender(<Harness api={api} scope={{ kind: "all" }} enabled={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not let a late result from the previous scope replace the current scope", async () => {
    const resolvers: Array<(value: ExternalExecutionCatalogSnapshot) => void> = [];
    const refresh = vi.fn((scope: ExternalExecutionScope) => new Promise<ExternalExecutionCatalogSnapshot>((resolve) => {
      resolvers.push((value) => resolve(value));
    }));
    const api = { externalExecutionsRefresh: refresh } as unknown as StellaDesktopApi;
    const view = render(<Harness api={api} scope={{ kind: "all" }} />);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    view.rerender(<Harness api={api} scope={{ kind: "project", projectPath: "/repo" }} />);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    await act(async () => { resolvers[1]?.(snapshot({ kind: "project", projectPath: "/repo" }, "project-result")); });
    expect(await screen.findByText("project-result")).toBeTruthy();

    await act(async () => { resolvers[0]?.(snapshot({ kind: "all" }, "late-all-result")); });
    expect(screen.getByText("project-result")).toBeTruthy();
    expect(screen.queryByText("late-all-result")).toBeNull();
  });
});
