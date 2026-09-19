import { expect, it } from "vitest";
import type { RuntimeBootstrap } from "../../src/shared/contracts";
import { INITIAL_RUNTIME_STATE, runtimeReducer } from "../../src/renderer/src/lib/runtime-state";

const scope = { generation: "first", scope: 1, sequence: 10, cwd: "/test", sessionId: "session" };
const bootstrap = { scope, state: { sessionId: "session" }, statsSequence: 10,
  stats: { sessionId: "session", cost: 1, totalMessages: 3 }, sessions: [{ id: "session", messageCount: 3 }] } as unknown as RuntimeBootstrap;
const state = { ...INITIAL_RUNTIME_STATE, bootstrap, scope, streaming: true };

it("rejects late statistics and failures from an older scope or read sequence", () => {
  const stats = { ...bootstrap.stats, cost: 2 };
  expect(runtimeReducer(state, { type: "SESSION_METRICS", stats, scope: { ...scope, generation: "retired" } })).toBe(state);
  expect(runtimeReducer(state, { type: "SESSION_METRICS", stats, scope: { ...scope, sequence: 9 } })).toBe(state);
  expect(runtimeReducer(state, { type: "SESSION_METRICS_FAILED", error: "old failure", scope: { ...scope, sequence: 9 } })).toBe(state);
  expect(runtimeReducer(state, { type: "SESSION_METRICS", stats: { ...stats, sessionId: "other" }, scope })).toBe(state);
});
it("updates the authoritative statistics and count without changing execution or messages", () => {
  const next = runtimeReducer(state, { type: "SESSION_METRICS", stats: { ...bootstrap.stats, cost: 2, totalMessages: 5 }, scope: { ...scope, sequence: 11 } });
  expect(next.bootstrap?.stats.cost).toBe(2);
  expect(next.bootstrap?.sessions[0]?.messageCount).toBe(5);
  expect(next.streaming).toBe(true); expect(next.messages).toBe(state.messages);
  const failed = runtimeReducer(next, { type: "SESSION_METRICS_FAILED", error: "offline", scope: { ...scope, sequence: 12 } });
  expect(failed.bootstrap?.stats.cost).toBe(2); expect(failed.bootstrap?.statsError).toBe("offline");
});
