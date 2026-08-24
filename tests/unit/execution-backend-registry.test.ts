// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ExecutionBackend, ExecutionEvent, ExecutionOutcome, ExecutionRequest } from "../../src/main/execution-backend";
import { ExecutionBackendRegistry } from "../../src/main/execution-backend-registry";
import type { ExecutionBackendHealth } from "../../src/shared/execution-profile";

const NOW = "2026-08-24T00:00:00.000Z";

class FakeExecutionBackend implements ExecutionBackend {
  readonly backendId = "pi" as const;
  readonly requests: ExecutionRequest[] = [];
  readonly probe = vi.fn(async (): Promise<ExecutionBackendHealth> => Object.freeze({
    backendId: "pi", state: "ready", version: "fake-1", authState: "ready", executableSource: "bundled", updatedAt: NOW,
  }));

  async run(request: ExecutionRequest, emit: (event: ExecutionEvent) => void, signal: AbortSignal): Promise<ExecutionOutcome> {
    if (signal.aborted) throw new Error("aborted");
    this.requests.push(request);
    emit({ type: "assistant-output", text: "fake report" });
    return Object.freeze({ result: Object.freeze({ kind: "report", output: "fake report" }), backendVersion: "fake-1" });
  }

  async openSession(): Promise<never> {
    throw new Error("not implemented in fake");
  }
}

describe("ExecutionBackendRegistry contract", () => {
  it("probes, resolves immutable profile snapshots, and exposes availability", async () => {
    const backend = new FakeExecutionBackend();
    const registry = new ExecutionBackendRegistry({ backends: [backend], now: () => NOW });
    const catalog = await registry.initialize();

    expect(backend.probe).toHaveBeenCalledOnce();
    expect(catalog.health).toContainEqual(expect.objectContaining({ backendId: "pi", state: "ready", version: "fake-1" }));
    expect(catalog.profiles.find((item) => item.profile.id === "pi.rpc")).toMatchObject({ available: true });
    expect(catalog.profiles.find((item) => item.profile.id === "codex.exec")).toMatchObject({ available: false });

    const resolved = registry.resolve("pi.rpc");
    expect(resolved.backend).toBe(backend);
    expect(resolved.profile).toMatchObject({ id: "pi.rpc", revision: 1, backendId: "pi" });
    expect(Object.isFrozen(resolved.profile)).toBe(true);
  });

  it("enforces profile capabilities without falling back to another backend", async () => {
    const registry = new ExecutionBackendRegistry({ backends: [new FakeExecutionBackend()], now: () => NOW });
    await registry.initialize();

    expect(() => registry.assertCompatible("pi.rpc", "coordinator")).not.toThrow();
    expect(() => registry.assertCompatible("codex.review", "workflow-step")).toThrow("不支持 workflow-step");
    expect(() => registry.resolve("codex.exec")).toThrow("未注册 Backend");
  });
});
