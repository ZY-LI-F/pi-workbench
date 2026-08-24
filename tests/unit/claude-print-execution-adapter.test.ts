// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../../src/shared/kanban";
import { snapshotExecutionProfile } from "../../src/shared/execution-profile";
import { CliProcess } from "../../src/main/cli-process";
import {
  ClaudePrintExecutionAdapter,
  claudeAllowedTools,
  claudePrintArgv,
} from "../../src/main/execution-adapters/claude-print-execution-adapter";
import { ExecutionAbortedError, ExecutionProtocolError, type ExecutionRequest } from "../../src/main/execution-backend";

const SHIM = fileURLToPath(new URL("../fixtures/cli-process-shim.mjs", import.meta.url));
const AGENT: AgentDefinition = Object.freeze({
  id: "builder", version: 1, name: "Builder", callsign: "BUILD", responsibility: "build", instructions: "build",
  workspaceAccess: "write", allowedTools: Object.freeze(["read", "grep", "find", "ls", "bash", "edit", "write"]), thinking: "high",
  disableExtensions: true, disableSkills: true, disablePromptTemplates: true, disableContextFiles: true,
});

function request(agent: AgentDefinition = AGENT): ExecutionRequest {
  return Object.freeze({
    executionId: "execution-1",
    runtimeToken: "token-1",
    profile: snapshotExecutionProfile("claude.print"),
    cwd: process.cwd(),
    trusted: true,
    sessionName: "Claude shim",
    prompt: "完成任务",
    agent,
    expectedResult: "report",
  });
}

type Behavior = "success" | "failure" | "permission" | "no-terminal" | "invalid-jsonl" | "wait";

async function adapter(behavior: Behavior = "success", copyText?: (value: string) => void) {
  const instance = new ClaudePrintExecutionAdapter({ process: new CliProcess({ abortGraceMs: 20 }), copyText });
  const configuration = {
    backendId: "claude" as const,
    executable: process.execPath,
    prefixArgv: [SHIM, "claude-print", behavior],
    displayPath: "/fake/claude",
    executableSource: "path" as const,
  };
  instance.activate(configuration);
  await instance.probe(configuration);
  return instance;
}

describe("ClaudePrintExecutionAdapter", () => {
  it("maps workspace access, effort, model, safe mode, and Stella tools to fixed argv", () => {
    const anthropicAgent = Object.freeze({ ...AGENT, provider: "anthropic", model: "claude-sonnet", thinking: "xhigh" as const });
    expect(claudeAllowedTools(request(anthropicAgent))).toEqual(["Read", "Grep", "Glob", "Bash", "Edit", "Write"]);
    expect(claudePrintArgv(request(anthropicAgent))).toEqual([
      "-p", "--output-format", "stream-json", "--verbose",
      "--permission-mode", "acceptEdits", "--effort", "xhigh",
      "--tools", "Read,Grep,Glob,Bash,Edit,Write",
      "--allowedTools", "Read,Grep,Glob,Bash,Edit,Write",
      "--name", "Claude shim", "--safe-mode", "--model", "claude-sonnet",
    ]);
    const reader = Object.freeze({ ...AGENT, workspaceAccess: "read" as const, allowedTools: Object.freeze(["read", "grep", "find", "ls"]), thinking: "off" as const });
    expect(claudePrintArgv(request(reader))).toEqual(expect.arrayContaining(["--permission-mode", "plan", "--effort", "low"]));
    expect(claudePrintArgv(request(Object.freeze({ ...AGENT, model: "ambiguous-model" })))).not.toContain("ambiguous-model");
  });

  it("runs the stream-json shim and returns report, Session identity, usage, cost, version, and tool events", async () => {
    const events: unknown[] = [];
    const outcome = await (await adapter()).run(request(), (event) => events.push(event), new AbortController().signal);
    expect(outcome).toEqual({
      result: { kind: "report", output: "Claude 完成：完成任务" },
      session: { backendId: "claude", sessionId: "claude-session-shim" },
      usage: { inputTokens: 12, outputTokens: 12, cost: 0.04 },
      backendVersion: "8.7.6",
    });
    expect(events).toEqual(expect.arrayContaining([
      { type: "tool-start", name: "Bash" },
      { type: "tool-end", name: "Bash", failed: false },
      { type: "assistant-output", text: "Claude 完成：完成任务" },
    ]));
  });

  it("surfaces result, permission, missing-terminal, and malformed JSONL failures with partial evidence", async () => {
    await expect((await adapter("failure")).run(request(), () => undefined, new AbortController().signal))
      .rejects.toMatchObject({ name: "ExecutionProtocolError", message: "模型执行失败", session: { sessionId: "claude-session-shim" }, backendVersion: "8.7.6" });
    await expect((await adapter("permission")).run(request(), () => undefined, new AbortController().signal))
      .rejects.toMatchObject({ name: "ExecutionProtocolError", message: "Claude CLI 未获授权执行工具：Write" });
    await expect((await adapter("no-terminal")).run(request(), () => undefined, new AbortController().signal))
      .rejects.toBeInstanceOf(ExecutionProtocolError);
    await expect((await adapter("invalid-jsonl")).run(request(), () => undefined, new AbortController().signal))
      .rejects.toMatchObject({ name: "ExecutionProtocolError", message: expect.stringContaining("无效 JSON"), session: { sessionId: "claude-session-shim" } });
  });

  it("aborts the owned process group and exposes a resumable command", async () => {
    const copyText = vi.fn();
    const instance = await adapter("wait", copyText);
    const controller = new AbortController();
    const running = instance.run(request(), vi.fn(), controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(running).rejects.toBeInstanceOf(ExecutionAbortedError);
    await expect(instance.openSession({ backendId: "claude", sessionId: "session-resume" })).resolves.toEqual({
      kind: "command-copied",
      message: "claude --resume session-resume",
    });
    expect(copyText).toHaveBeenCalledWith("claude --resume session-resume");
  });
});
