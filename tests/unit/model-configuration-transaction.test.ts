// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { executeModelConfigurationTransaction } from "../../src/main/model-configuration-transaction";
import type { ModelConfigurationCheckpoint } from "../../src/main/model-configuration-service";

const BEFORE: ModelConfigurationCheckpoint = Object.freeze({ authContents: "before-auth", modelsContents: "before-models" });
const APPLIED: ModelConfigurationCheckpoint = Object.freeze({ authContents: "after-auth", modelsContents: "before-models" });

describe("executeModelConfigurationTransaction", () => {
  it("returns the refreshed snapshot after one successful activation", async () => {
    const restartRuntime = vi.fn(async () => undefined);
    const restoreCheckpoint = vi.fn(async () => undefined);
    const mutation = vi.fn(async () => undefined);
    const result = await executeModelConfigurationTransaction({
      createCheckpoint: vi.fn()
        .mockResolvedValueOnce(BEFORE)
        .mockResolvedValueOnce(APPLIED),
      restoreCheckpoint,
      captureSessionPath: vi.fn(async () => "session.jsonl"),
      restartRuntime,
      snapshot: vi.fn(async () => ({ providers: 2 })),
    }, mutation);

    expect(result).toEqual({ providers: 2 });
    expect(mutation).toHaveBeenCalledOnce();
    expect(restartRuntime).toHaveBeenCalledWith("session.jsonl");
    expect(restoreCheckpoint).not.toHaveBeenCalled();
  });

  it("restores the exact prior files and restarts the old session when activation fails", async () => {
    const activationError = new Error("invalid models.json");
    const restartRuntime = vi.fn()
      .mockRejectedValueOnce(activationError)
      .mockResolvedValueOnce(undefined);
    const restoreCheckpoint = vi.fn(async () => undefined);

    await expect(executeModelConfigurationTransaction({
      createCheckpoint: vi.fn()
        .mockResolvedValueOnce(BEFORE)
        .mockResolvedValueOnce(APPLIED),
      restoreCheckpoint,
      captureSessionPath: vi.fn(async () => "session.jsonl"),
      restartRuntime,
      snapshot: vi.fn(async () => ({ providers: 2 })),
    }, vi.fn(async () => undefined))).rejects.toThrow("已回滚");

    expect(restoreCheckpoint).toHaveBeenCalledWith(BEFORE, APPLIED);
    expect(restartRuntime).toHaveBeenNthCalledWith(1, "session.jsonl");
    expect(restartRuntime).toHaveBeenNthCalledWith(2, "session.jsonl");
  });

  it("surfaces a rollback conflict without overwriting an external edit", async () => {
    const restartRuntime = vi.fn(async () => { throw new Error("activation failed"); });
    const restoreCheckpoint = vi.fn(async () => { throw new Error("configuration changed externally"); });

    await expect(executeModelConfigurationTransaction({
      createCheckpoint: vi.fn()
        .mockResolvedValueOnce(BEFORE)
        .mockResolvedValueOnce(APPLIED),
      restoreCheckpoint,
      captureSessionPath: vi.fn(async () => undefined),
      restartRuntime,
      snapshot: vi.fn(async () => ({ providers: 2 })),
    }, vi.fn(async () => undefined))).rejects.toThrow("安全回滚失败");

    expect(restartRuntime).toHaveBeenCalledOnce();
  });
});
