import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useProjectRegistry } from "../../src/renderer/src/hooks/use-project-registry";
import type { BridgeEvent, StellaDesktopApi } from "../../src/shared/contracts";
import type { ProjectRegistrySnapshot } from "../../src/shared/project-registry";

afterEach(cleanup);
const snapshot = (revision: number): ProjectRegistrySnapshot => ({ version: 1, revision, projects: [], directories: {}, checkedAt: "2026-09-13T00:00:00Z" });

it("does not let a delayed initial read replace a newer saved snapshot", async () => {
  let resolveInitial!: (value: ProjectRegistrySnapshot) => void;
  const initial = new Promise<ProjectRegistrySnapshot>((resolve) => { resolveInitial = resolve; });
  const api = { projectsInitialize: vi.fn(() => initial), projectsUpdate: vi.fn(async () => snapshot(2)), onEvent: () => () => undefined } as unknown as StellaDesktopApi;
  const hook = renderHook(() => useProjectRegistry(api));
  await act(async () => { await hook.result.current.update({ projectId: "a", name: "new" }); });
  expect(hook.result.current.snapshot?.revision).toBe(2);
  await act(async () => { resolveInitial(snapshot(1)); await initial; });
  expect(hook.result.current.snapshot?.revision).toBe(2);
  expect(hook.result.current.loading).toBe(false);
});

it("refreshes from commit events and exposes failed reads while preserving the last committed snapshot", async () => {
  let listener!: (event: BridgeEvent) => void;
  const initialize = vi.fn().mockResolvedValueOnce(snapshot(1)).mockRejectedValueOnce(new Error("无权限读取"));
  const api = { projectsInitialize: initialize, onEvent: (next: typeof listener) => { listener = next; return () => undefined; } } as unknown as StellaDesktopApi;
  const hook = renderHook(() => useProjectRegistry(api));
  await waitFor(() => expect(hook.result.current.snapshot?.revision).toBe(1));
  act(() => listener({ source: "project", payload: { type: "changed" } }));
  await waitFor(() => expect(hook.result.current.error).toBe("无权限读取"));
  expect(hook.result.current.snapshot?.revision).toBe(1);
});
