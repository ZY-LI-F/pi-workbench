import { describe, expect, it, vi } from "vitest";
import { createMockCompanionHost, mockSnapshot } from "./mock-host";

describe("mock Companion host", () => {
  it.each(["working", "needs-input", "completed", "failed"] as const)("projects the %s state", (state) => {
    const snapshot = mockSnapshot(state, 7, "2026-08-28T00:00:00.000Z");
    expect(snapshot).toMatchObject({
      sequence: 7,
      connection: "online",
      stale: false,
    });
    expect(snapshot.tasks[0]).toMatchObject({ state });
  });

  it("keeps the last task view visible and marks it stale while offline", () => {
    expect(mockSnapshot("offline")).toMatchObject({ connection: "offline", stale: true, tasks: expect.any(Array) });
  });

  it("publishes selected scenarios with monotonic sequence numbers", () => {
    const host = createMockCompanionHost();
    const listener = vi.fn();
    const unsubscribe = host.subscribe(listener);
    host.select("needs-input");
    unsubscribe();
    host.select("completed");

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map(([snapshot]) => snapshot.sequence)).toEqual([1, 2]);
  });
});
