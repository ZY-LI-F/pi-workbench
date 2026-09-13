// @vitest-environment node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CodexAppServerClient, type CodexAppServerSpawn } from "../../src/main/codex-app-server-client";

const SHIM = fileURLToPath(new URL("../fixtures/cli-process-shim.mjs", import.meta.url));

function fixture(timeout = 1_000) {
  const spawnProcess = vi.fn<CodexAppServerSpawn>((executable, argv, options) => spawn(executable, [...argv], {
    ...options,
    stdio: ["pipe", "pipe", "pipe"],
  }));
  const client = new CodexAppServerClient({
    configuration: () => Object.freeze({
      backendId: "codex" as const,
      executable: process.execPath,
      prefixArgv: Object.freeze([SHIM, "codex-app-server"]),
      displayPath: "/fake/codex",
      executableSource: "path" as const,
    }),
    cwd: process.cwd(),
    spawnProcess,
    requestTimeoutMs: timeout,
  });
  return { client, spawnProcess };
}

describe("CodexAppServerClient", () => {
  it("initializes once, receives notifications, and paginates threads and turns", async () => {
    const { client, spawnProcess } = fixture();
    const notifications: string[] = [];
    client.onNotification((notification) => notifications.push(notification.method));

    const [threads, turns, thread] = await Promise.all([
      client.listThreads({ cwd: "/repo", sourceKinds: ["cli", "exec", "appServer", "subAgent"] }),
      client.listTurns("thread-cli"),
      client.readThread("thread-cli"),
    ]);

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(spawnProcess).toHaveBeenCalledWith(process.execPath, [SHIM, "codex-app-server", "app-server", "--stdio"], expect.objectContaining({ cwd: process.cwd(), shell: false }));
    expect(threads.map((item) => item.id)).toEqual(["thread-cli", "thread-exec", "thread-app", "thread-sub"]);
    expect(turns.map((item) => item.id)).toEqual(["turn-current", "turn-older"]);
    expect(thread.id).toBe("thread-cli");
    expect(notifications).toContain("thread/status/changed");

    await client.shutdown();
  });

  it("surfaces protocol errors and restarts after malformed output or process exit", async () => {
    const { client, spawnProcess } = fixture();
    await expect(client.request("test/error")).rejects.toThrow("fixture failure");
    await expect(client.request("test/malformed")).rejects.toThrow("无效 JSON");
    expect((await client.listThreads()).length).toBe(4);
    await expect(client.request("test/exit")).rejects.toThrow("已退出");
    expect((await client.listThreads()).length).toBe(4);
    expect(spawnProcess).toHaveBeenCalledTimes(3);
    await client.shutdown();
  });

  it("times out a stalled request, terminates that connection, and restarts on demand", async () => {
    // Leave enough startup headroom under a parallel full-suite run so this
    // assertion measures the deliberately stalled request, not process spawn.
    const { client, spawnProcess } = fixture(500);
    await expect(client.request("test/timeout")).rejects.toThrow("500ms 内未响应");
    expect((await client.listThreads()).length).toBe(4);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    await client.shutdown();
  });
});
