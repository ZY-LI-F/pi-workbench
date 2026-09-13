import { describe, expect, it, vi } from "vitest";
import { OrderedEventBatch } from "../../src/renderer/src/lib/ordered-event-batch";
import { INITIAL_RUNTIME_STATE, runtimeReducer } from "../../src/renderer/src/lib/runtime-state";
import type { BridgeEvent } from "../../src/shared/contracts";

describe("ordered native event batching", () => {
  it("publishes a full event sequence once and preserves all intermediate data", () => {
    const events: BridgeEvent[] = [
      { source: "pi", payload: { type: "agent_start" } },
      ...Array.from({ length: 1000 }, (_, index) => [
        { source: "pi", payload: { type: "message_start", message: { role: "user", timestamp: 1, content: `message ${index}` } } },
        { source: "pi", payload: { type: "message_end", message: { role: "user", timestamp: 1, content: `message ${index}` } } },
      ]).flat(),
      { source: "pi", payload: { type: "agent_settled" } },
    ] as BridgeEvent[];
    let tick!: () => void;
    const publish = vi.fn(); const schedule = vi.fn((flush: () => void) => { tick = flush; return () => undefined; });
    const batch = new OrderedEventBatch<BridgeEvent>(publish, schedule);
    for (const event of events) batch.push(event);
    expect(schedule).toHaveBeenCalledTimes(1); tick();
    expect(publish).toHaveBeenCalledTimes(1); expect(publish.mock.calls[0]![0]).toEqual(events);
    const individual = events.reduce((state, event) => runtimeReducer(state, { type: "BRIDGE_EVENT", event }), INITIAL_RUNTIME_STATE);
    const batched = runtimeReducer(INITIAL_RUNTIME_STATE, { type: "BRIDGE_EVENTS", events });
    expect(batched).toEqual(individual); expect(batched.messages).toHaveLength(1000); expect(batched.streaming).toBe(false);
  });
  it("does not redeliver a flushed batch and drops only a disposed subscriber's pending delivery", () => {
    let tick!: () => void; const publish = vi.fn();
    const batch = new OrderedEventBatch<number>(publish, (flush) => { tick = flush; return () => undefined; });
    batch.push(1); batch.flush(); tick(); expect(publish).toHaveBeenCalledTimes(1);
    batch.push(2); batch.dispose(); tick(); expect(publish).toHaveBeenCalledTimes(1);
  });
});
