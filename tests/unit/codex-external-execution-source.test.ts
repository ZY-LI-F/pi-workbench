// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { CodexAppServerNotification } from "../../src/main/codex-app-server-client";
import {
  CodexExternalExecutionSource,
  normalizeCodexExternalExecution,
} from "../../src/main/codex-external-execution-source";

const NOW = "2026-08-25T00:00:00.000Z";

function thread(id: string, source: unknown, status: unknown = { type: "idle" }) {
  return {
    id,
    sessionId: "tree-1",
    name: id === "cli-thread" ? "实现多 CLI 看板" : null,
    preview: `Preview ${id}`,
    cwd: "/repo",
    path: `/tmp/${id}.jsonl`,
    source,
    status,
    parentThreadId: null,
    forkedFromId: null,
    createdAt: 1_787_616_000,
    updatedAt: 1_787_619_600,
  };
}

class FakeClient {
  readonly listThreads = vi.fn(async () => [
    thread("cli-thread", "cli"),
    thread("exec-thread", "exec", { type: "active", activeFlags: [] }),
    thread("app-thread", "appServer", { type: "systemError" }),
    { ...thread("sub-thread", { subAgent: { thread_spawn: { depth: 1, parent_thread_id: "cli-thread" } } }), parentThreadId: "cli-thread" },
  ]);
  readonly readThread = vi.fn(async (threadId: string) => thread(threadId, "cli"));
  readonly listTurns = vi.fn(async () => [{
    id: "turn-1",
    status: "completed",
    startedAt: 1_787_616_000,
    completedAt: 1_787_616_060,
    items: [
      { id: "user-1", type: "userMessage", content: [{ type: "text", text: "实现功能" }] },
      { id: "cmd-1", type: "commandExecution", command: "npm test", aggregatedOutput: "411 passed", status: "completed" },
      { id: "agent-1", type: "agentMessage", text: "已完成" },
      { id: "compact-1", type: "contextCompaction" },
    ],
  }]);
  readonly shutdown = vi.fn(async () => undefined);
  listener?: (notification: CodexAppServerNotification) => void;
  onNotification(listener: (notification: CodexAppServerNotification) => void) {
    this.listener = listener;
    return () => { this.listener = undefined; };
  }
  emit(notification: CodexAppServerNotification) { this.listener?.(notification); }
}

function configuration() {
  return Object.freeze({ backendId: "codex" as const, executable: "/fake/codex", displayPath: "/fake/codex", executableSource: "path" as const });
}

describe("CodexExternalExecutionSource", () => {
  it("normalizes CLI, Exec, App Server and Sub-agent thread identities and states", () => {
    const cli = normalizeCodexExternalExecution(thread("cli-thread", "cli", { type: "active", activeFlags: ["waitingOnApproval"] }), NOW);
    const sub = normalizeCodexExternalExecution({
      ...thread("sub-thread", { subAgent: { thread_spawn: { depth: 1, parent_thread_id: "cli-thread" } } }),
      parentThreadId: "cli-thread",
    }, NOW);
    const failed = normalizeCodexExternalExecution(thread("app-thread", "appServer", { type: "systemError" }), NOW);

    expect(cli).toMatchObject({
      sourceId: "codex",
      externalId: "cli-thread",
      kind: "cli",
      title: "实现多 CLI 看板",
      state: "needs-input",
      needsInput: true,
      waitingFor: "等待执行审批",
      session: { backendId: "codex", sessionId: "cli-thread", sessionPath: "/tmp/cli-thread.jsonl" },
    });
    expect(sub).toMatchObject({ kind: "subAgentThreadSpawn", parentExternalId: "cli-thread", state: "idle" });
    expect(failed).toMatchObject({ kind: "appServer", state: "failed", terminal: true });
  });

  it("lists project-scoped threads and applies waiting notifications over stored status", async () => {
    const client = new FakeClient();
    const source = new CodexExternalExecutionSource({ configuration, client, now: () => NOW });
    client.emit({ method: "thread/status/changed", params: { threadId: "cli-thread", status: { type: "active", activeFlags: ["waitingOnUserInput"] } } });

    const items = await source.refresh({ kind: "project", projectPath: "/repo" });

    expect(client.listThreads).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", sortKey: "updated_at", sourceKinds: expect.arrayContaining(["cli", "exec", "appServer", "subAgent"]) }));
    expect(items.map((item) => [item.kind, item.state])).toEqual([
      ["cli", "needs-input"],
      ["exec", "working"],
      ["appServer", "failed"],
      ["subAgentThreadSpawn", "idle"],
    ]);
  });

  it("loads full Turn details only on demand, caches briefly, and invalidates on notifications", async () => {
    const client = new FakeClient();
    let clock = 1_000;
    const copyText = vi.fn();
    const source = new CodexExternalExecutionSource({ configuration, client, copyText, now: () => NOW, clock: () => clock });
    const item = normalizeCodexExternalExecution(thread("cli-thread", "cli"), NOW);

    const first = await source.details(item);
    const cached = await source.details(item);
    expect(first).toBe(cached);
    expect(client.readThread).toHaveBeenCalledTimes(1);
    expect(client.listTurns).toHaveBeenCalledTimes(1);
    expect(first.turns[0]).toMatchObject({ status: "completed", items: [
      { label: "用户", text: "实现功能" },
      { label: "npm test", text: "411 passed", status: "completed" },
      { label: "Codex", text: "已完成" },
      { label: "上下文已压缩" },
    ] });

    clock += 30_001;
    await source.details(item);
    expect(client.readThread).toHaveBeenCalledTimes(2);
    client.emit({ method: "turn/completed", params: { threadId: "cli-thread", turn: { id: "turn-new" } } });
    await source.details(item);
    expect(client.readThread).toHaveBeenCalledTimes(3);

    await expect(source.continue(item)).resolves.toEqual({ kind: "command-copied", message: "codex resume cli-thread" });
    expect(copyText).toHaveBeenCalledWith("codex resume cli-thread");
    await source.shutdown();
    expect(client.shutdown).toHaveBeenCalledTimes(1);
  });
});
