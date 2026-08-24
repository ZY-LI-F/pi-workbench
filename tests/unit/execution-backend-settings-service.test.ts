// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { ConfigurableExecutionBackendId } from "../../src/shared/execution-profile";
import type { ExecutionBackend, ExecutionBackendConfiguration } from "../../src/main/execution-backend";
import { ExecutionBackendRegistry } from "../../src/main/execution-backend-registry";
import { ExecutionBackendSettingsService } from "../../src/main/execution-backend-settings-service";
import { StateStore } from "../../src/main/state-store";

const directories: string[] = [];

class ProbeBackend implements ExecutionBackend {
  constructor(readonly backendId: ConfigurableExecutionBackendId) {}
  async probe(configuration: ExecutionBackendConfiguration) {
    const unavailable = configuration.displayPath?.includes("bad");
    return {
      backendId: this.backendId,
      state: unavailable ? "unavailable" as const : "ready" as const,
      authState: "ready" as const,
      version: unavailable ? undefined : "1.0.0",
      executablePath: configuration.displayPath,
      executableSource: configuration.executableSource,
      error: unavailable ? "候选 CLI 无效" : undefined,
      updatedAt: "2026-08-24T00:00:00.000Z",
    };
  }
  async run(): Promise<never> { throw new Error("not used"); }
  async openSession(): Promise<never> { throw new Error("not used"); }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "stella-backend-settings-"));
  directories.push(directory);
  const stateStore = new StateStore(join(directory, "state.json"));
  const registry = new ExecutionBackendRegistry({
    backends: [new ProbeBackend("codex"), new ProbeBackend("claude")],
    now: () => "2026-08-24T00:00:00.000Z",
  });
  const resolver = {
    resolve: async (backendId: ConfigurableExecutionBackendId, configuredPath?: string) => ({
      backendId,
      executable: configuredPath ?? `/auto/${backendId}`,
      displayPath: configuredPath ?? `/auto/${backendId}`,
      executableSource: configuredPath ? "path" as const : "auto" as const,
    }),
  };
  const service = new ExecutionBackendSettingsService({ stateStore, registry, resolver });
  return { stateStore, registry, service };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ExecutionBackendSettingsService", () => {
  it("loads persisted paths and probes both configurable backends", async () => {
    const { stateStore, service } = await fixture();
    await stateStore.configureExecutionBackend("codex", "/saved/codex");
    const snapshot = await service.initialize();
    expect(snapshot.health).toEqual(expect.arrayContaining([
      expect.objectContaining({ backendId: "codex", executablePath: "/saved/codex", state: "ready" }),
      expect.objectContaining({ backendId: "claude", executablePath: "/auto/claude", state: "ready" }),
    ]));
  });

  it("probes a candidate before saving and retains the old path after failure", async () => {
    const { stateStore, service } = await fixture();
    await stateStore.configureExecutionBackend("codex", "/saved/codex");
    await service.initialize();
    await expect(service.configure({ backendId: "codex", executablePath: "/bad/codex" })).rejects.toThrow("候选 CLI 无效");
    expect((await stateStore.read()).executionBackends?.codex?.executablePath).toBe("/saved/codex");
    expect(service.snapshot().health.find((item) => item.backendId === "codex")?.executablePath).toBe("/saved/codex");
  });

  it("atomically saves and activates a valid path without losing recent projects", async () => {
    const { stateStore, service } = await fixture();
    await service.initialize();
    await stateStore.recordProject("/repo", true);
    const snapshot = await service.configure({ backendId: "claude", executablePath: "/new/claude" });
    expect(snapshot.health.find((item) => item.backendId === "claude")).toMatchObject({ state: "ready", executablePath: "/new/claude" });
    expect(await stateStore.read()).toMatchObject({
      lastProject: "/repo",
      executionBackends: { claude: { executablePath: "/new/claude" } },
    });
  });

  it("exposes only the active resolved configuration to external execution sources", async () => {
    const { service } = await fixture();
    expect(() => service.configuration("claude")).toThrow("尚未初始化");
    await service.initialize();

    const automatic = service.configuration("claude");
    expect(automatic).toMatchObject({ executable: "/auto/claude", executableSource: "auto" });
    await service.configure({ backendId: "claude", executablePath: "/new/claude" });
    expect(service.configuration("claude")).toMatchObject({ executable: "/new/claude", executableSource: "path" });
  });
});
