// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "../../src/main/state-store";

const directories: string[] = [];

async function storeFixture(): Promise<{ readonly store: StateStore; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "stella-state-store-"));
  directories.push(directory);
  const path = join(directory, "state.json");
  return { store: new StateStore(path), path };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("StateStore", () => {
  it("reads legacy project-only state without inventing backend configuration", async () => {
    const { store, path } = await storeFixture();
    await writeFile(path, JSON.stringify({
      lastProject: "/repo",
      recentProjects: [{ path: "/repo", trusted: true, lastOpened: "2026-08-24T00:00:00.000Z" }],
    }), "utf8");
    await expect(store.read()).resolves.toMatchObject({ lastProject: "/repo", executionBackends: undefined });
  });

  it("serializes project and backend mutations through one queue without lost updates", async () => {
    const { store, path } = await storeFixture();
    await Promise.all([
      store.recordProject("/repo-a", true),
      store.configureExecutionBackend("codex", "/opt/bin/codex"),
      store.configureExecutionBackend("claude", "/opt/bin/claude"),
      store.recordProject("/repo-b", false),
    ]);
    const state = await store.read();
    expect(state.lastProject).toBe("/repo-b");
    expect(state.recentProjects.map((project) => project.path)).toEqual(["/repo-b", "/repo-a"]);
    expect(state.executionBackends).toEqual({
      codex: { executablePath: "/opt/bin/codex" },
      claude: { executablePath: "/opt/bin/claude" },
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ lastProject: "/repo-b" });
  });

  it("can return one backend to automatic discovery without deleting the other", async () => {
    const { store } = await storeFixture();
    await store.configureExecutionBackend("codex", "/codex");
    await store.configureExecutionBackend("claude", "/claude");
    await store.configureExecutionBackend("codex");
    expect((await store.read()).executionBackends).toEqual({ claude: { executablePath: "/claude" } });
  });

  it("recovers its mutation queue after a failed transform", async () => {
    const { store } = await storeFixture();
    await expect(store.mutate(() => { throw new Error("拒绝写入"); })).rejects.toThrow("拒绝写入");
    await expect(store.recordProject("/repo", true)).resolves.toMatchObject({ lastProject: "/repo" });
  });
});
