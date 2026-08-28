// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXECUTION_CONCURRENCY,
  ExecutionCapacity,
  ExecutionCapacityAbortError,
  executionConcurrencyFromEnvironment,
} from "../../src/main/execution-capacity";

describe("ExecutionCapacity", () => {
  it("enforces a FIFO active-set limit and releases idempotently", async () => {
    const capacity = new ExecutionCapacity(2);
    const first = await capacity.acquire("first");
    const second = await capacity.acquire("second");
    let thirdReady = false;
    const thirdPromise = capacity.acquire("third").then((lease) => { thirdReady = true; return lease; });
    await Promise.resolve();
    expect(capacity.activeCount).toBe(2);
    expect(capacity.waitingCount).toBe(1);
    expect(thirdReady).toBe(false);

    first.release();
    first.release();
    const third = await thirdPromise;
    expect(thirdReady).toBe(true);
    expect(capacity.activeCount).toBe(2);
    second.release();
    third.release();
    expect(capacity.activeCount).toBe(0);
  });

  it("removes an aborted waiter without disturbing other owners", async () => {
    const capacity = new ExecutionCapacity(1);
    const active = await capacity.acquire("active");
    const controller = new AbortController();
    const waiting = capacity.acquire("waiting", controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(ExecutionCapacityAbortError);
    expect(capacity.waitingCount).toBe(0);
    expect(capacity.activeCount).toBe(1);
    active.release();
  });
});

describe("executionConcurrencyFromEnvironment", () => {
  it("uses a stable default and accepts an explicit bounded value", () => {
    expect(executionConcurrencyFromEnvironment({})).toBe(DEFAULT_EXECUTION_CONCURRENCY);
    expect(executionConcurrencyFromEnvironment({ STELLA_EXECUTION_CONCURRENCY: "5" })).toBe(5);
  });

  it("rejects invalid limits", () => {
    expect(() => executionConcurrencyFromEnvironment({ STELLA_EXECUTION_CONCURRENCY: "0" })).toThrow("1-16");
    expect(() => executionConcurrencyFromEnvironment({ STELLA_EXECUTION_CONCURRENCY: "2.5" })).toThrow("1-16");
  });
});
