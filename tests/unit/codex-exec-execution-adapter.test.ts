// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { snapshotExecutionProfile } from "../../src/shared/execution-profile";
import type { AgentDefinition } from "../../src/shared/kanban";
import { CliProcess } from "../../src/main/cli-process";
import { CodexExecExecutionAdapter, codexExecutionArgv } from "../../src/main/execution-adapters/codex-exec-execution-adapter";
import { ExecutionAbortedError, ExecutionProtocolError, type ExecutionRequest } from "../../src/main/execution-backend";

const SHIM = fileURLToPath(new URL("../fixtures/cli-process-shim.mjs", import.meta.url));
const AGENT: AgentDefinition = Object.freeze({
  id: "builder", version: 1, name: "Builder", callsign: "BUILD", responsibility: "build", instructions: "build",
  workspaceAccess: "write", allowedTools: Object.freeze(["read", "bash", "edit"]), thinking: "high",
  disableExtensions: true, disableSkills: true, disablePromptTemplates: true, disableContextFiles: true,
});

function request(profileId: "codex.exec" | "codex.review", agent: AgentDefinition = AGENT): ExecutionRequest {
  return Object.freeze({
    executionId: "execution-1",
    runtimeToken: "token-1",
    profile: snapshotExecutionProfile(profileId),
    cwd: process.cwd(),
    trusted: true,
    sessionName: "Codex shim",
    prompt: "完成任务",
    agent,
    expectedResult: "report",
  });
}

async function adapter(behavior: "success" | "failure" | "no-terminal" | "invalid-jsonl" | "wait" = "success") {
  const instance = new CodexExecExecutionAdapter({ process: new CliProcess({ abortGraceMs: 20 }), isGitRepository: async () => true });
  const configuration = {
    backendId: "codex" as const,
    executable: process.execPath,
    prefixArgv: [SHIM, "codex-exec", behavior],
    displayPath: "/fake/codex",
    executableSource: "path" as const,
  };
  instance.activate(configuration);
  await instance.probe(configuration);
  return instance;
}

describe("CodexExecExecutionAdapter", () => {
  it("maps fixed argv without putting the prompt in argv", () => {
    expect(codexExecutionArgv(request("codex.exec"))).toEqual([
      "exec", "--json", "--cd", process.cwd(), "--sandbox", "workspace-write", "--approve-for-me", "-",
    ]);
    const reviewAgent = Object.freeze({ ...AGENT, workspaceAccess: "read" as const, provider: "openai", model: "gpt-review" });
    expect(codexExecutionArgv(request("codex.review", reviewAgent))).toEqual([
      "exec", "review", "--json", "--uncommitted", "--model", "gpt-review", "-",
    ]);
    expect(codexExecutionArgv(request("codex.exec", Object.freeze({ ...AGENT, provider: "anthropic", model: "claude" })))).not.toContain("claude");
    expect(codexExecutionArgv(request("codex.exec", Object.freeze({ ...AGENT, model: "ambiguous-model" })))).not.toContain("ambiguous-model");
  });

  it("runs the JSONL shim and returns report, Thread identity, usage, version, and tool events", async () => {
    const events: unknown[] = [];
    const outcome = await (await adapter()).run(request("codex.exec"), (event) => events.push(event), new AbortController().signal);
    expect(outcome).toEqual({
      result: { kind: "report", output: "Codex 完成：完成任务" },
      session: { backendId: "codex", sessionId: "thread-shim" },
      usage: { inputTokens: 21, outputTokens: 34 },
      backendVersion: "7.6.5",
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool-start", name: "git" }),
      expect.objectContaining({ type: "tool-end", name: "git", failed: false }),
      expect.objectContaining({ type: "assistant-output", text: "Codex 完成：完成任务" }),
    ]));
  });

  it("surfaces turn failure and missing terminal state as protocol failures with partial identity", async () => {
    await expect((await adapter("failure")).run(request("codex.exec"), () => undefined, new AbortController().signal))
      .rejects.toMatchObject({ name: "ExecutionProtocolError", message: "模型执行失败", session: { sessionId: "thread-shim" } });
    await expect((await adapter("no-terminal")).run(request("codex.exec"), () => undefined, new AbortController().signal))
      .rejects.toBeInstanceOf(ExecutionProtocolError);
    await expect((await adapter("invalid-jsonl")).run(request("codex.exec"), () => undefined, new AbortController().signal))
      .rejects.toMatchObject({
        name: "ExecutionProtocolError",
        message: expect.stringContaining("无效 JSON"),
        session: { backendId: "codex", sessionId: "thread-shim" },
        backendVersion: "7.6.5",
      });
  });

  it("rejects review policy violations before execution", async () => {
    const notGit = new CodexExecExecutionAdapter({ isGitRepository: async () => false });
    notGit.activate({ backendId: "codex", executable: process.execPath });
    const readAgent = Object.freeze({ ...AGENT, workspaceAccess: "read" as const });
    await expect(notGit.run(request("codex.review", readAgent), () => undefined, new AbortController().signal)).rejects.toThrow("Git 项目");
    await expect((await adapter()).run(request("codex.review"), () => undefined, new AbortController().signal)).rejects.toThrow("只支持只读");
  });

  it("aborts the owned process group", async () => {
    const instance = await adapter("wait");
    const controller = new AbortController();
    const running = instance.run(request("codex.exec"), vi.fn(), controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(running).rejects.toBeInstanceOf(ExecutionAbortedError);
  });
});
