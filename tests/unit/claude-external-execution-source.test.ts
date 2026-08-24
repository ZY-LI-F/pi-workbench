// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { CliProcess, CliProcessCallbacks, CliProcessRequest, CliProcessResult } from "../../src/main/cli-process";
import {
  ClaudeExternalExecutionSource,
  normalizeClaudeExternalExecution,
} from "../../src/main/claude-external-execution-source";

const NOW = "2026-08-24T08:00:00.000Z";
const SUCCESS: CliProcessResult = Object.freeze({
  exitCode: 0,
  signal: null,
  stdoutTail: "",
  stderrTail: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

function fakeProcess(payload: unknown, result: CliProcessResult = SUCCESS) {
  const run = vi.fn(async (request: CliProcessRequest, callbacks: CliProcessCallbacks) => {
    callbacks.onJson?.(payload);
    return result;
  });
  return { process: { run } as unknown as Pick<CliProcess, "run">, run };
}

function configuration() {
  return Object.freeze({
    backendId: "claude" as const,
    executable: process.execPath,
    prefixArgv: Object.freeze(["/fake/claude.mjs"]),
    displayPath: "/fake/claude",
    executableSource: "path" as const,
  });
}

describe("ClaudeExternalExecutionSource", () => {
  it.each([
    ["working", "busy", "working", false],
    ["needs_input", "idle", "needs-input", true],
    ["blocked", "waiting", "needs-input", true],
    ["idle", "idle", "idle", false],
    ["done", "idle", "completed", false],
    ["failed", "idle", "failed", false],
    ["stopped", "idle", "stopped", false],
  ] as const)("normalizes Claude state %s/%s", (state, status, expected, needsInput) => {
    const item = normalizeClaudeExternalExecution({
      id: "agent-short",
      sessionId: `session-${state}`,
      kind: "background",
      cwd: "/repo",
      state,
      status,
      pid: 4321,
      waitingFor: needsInput ? "请选择方案" : undefined,
      parent: { sessionId: "parent-session" },
      startedAt: 1_777_000_000,
      updatedAt: "2026-08-24T07:59:00Z",
      transcriptPath: "/tmp/transcript.jsonl",
    }, NOW);

    expect(item).toMatchObject({
      sourceId: "claude",
      externalId: `session-${state}`,
      nativeId: "agent-short",
      projectPath: "/repo",
      parentExternalId: "parent-session",
      state: expected,
      needsInput,
      process: { pid: 4321, status, alive: !["completed", "failed", "stopped"].includes(expected) },
      session: { backendId: "claude", sessionId: `session-${state}`, sessionPath: "/tmp/transcript.jsonl" },
    });
  });

  it("reads a project-scoped catalog and preserves native process/session shape", async () => {
    const fixture = fakeProcess([{
      id: "agent-1",
      session_id: "session-1",
      name: "修复看板",
      cwd: "/repo",
      state: "working",
      process: { pid: 987, status: "busy" },
      lastActivityAt: NOW,
    }]);
    const source = new ClaudeExternalExecutionSource({
      configuration,
      process: fixture.process,
      cwd: "/home/test",
      now: () => NOW,
    });

    const items = await source.refresh({ kind: "project", projectPath: "/repo" });

    expect(fixture.run).toHaveBeenCalledWith(expect.objectContaining({
      executable: process.execPath,
      prefixArgv: ["/fake/claude.mjs"],
      argv: ["agents", "--json", "--all", "--cwd", "/repo"],
      cwd: "/repo",
      stdout: "json",
      timeoutMs: 10_000,
    }), expect.any(Object));
    expect(items).toEqual([expect.objectContaining({ title: "修复看板", process: { pid: 987, status: "busy", alive: true } })]);
  });

  it("keeps live status authoritative, rejects malformed output, and reports CLI failures", async () => {
    expect(normalizeClaudeExternalExecution({ id: "agent", cwd: "/repo", state: "done", status: "busy" }, NOW).state).toBe("working");
    expect(() => normalizeClaudeExternalExecution({ id: "agent", state: "idle" }, NOW)).toThrow("cwd 缺失");

    const malformed = new ClaudeExternalExecutionSource({ configuration, process: fakeProcess({ agents: [] }).process });
    await expect(malformed.refresh({ kind: "all" })).rejects.toThrow("未返回数组");

    const failed = new ClaudeExternalExecutionSource({
      configuration,
      process: fakeProcess([], { ...SUCCESS, exitCode: 2, stderrTail: "Claude 尚未登录" }).process,
    });
    await expect(failed.refresh({ kind: "all" })).rejects.toThrow("Claude 尚未登录");
  });

  it("copies attach for a live agent and resume for a completed session", async () => {
    const copyText = vi.fn();
    const source = new ClaudeExternalExecutionSource({ configuration, copyText });
    const live = normalizeClaudeExternalExecution({ id: "agent-live", sessionId: "session-live", cwd: "/repo", state: "working", pid: 88 }, NOW);
    const done = normalizeClaudeExternalExecution({ id: "agent-done", sessionId: "session-done", cwd: "/repo", state: "done", pid: 89 }, NOW);

    await expect(source.continue(live)).resolves.toEqual({ kind: "command-copied", message: "claude attach \"agent-live\"" });
    await expect(source.continue(done)).resolves.toEqual({ kind: "command-copied", message: "claude --resume \"session-done\"" });
    expect(copyText).toHaveBeenNthCalledWith(1, "claude attach \"agent-live\"");
    expect(copyText).toHaveBeenNthCalledWith(2, "claude --resume \"session-done\"");
  });
});
