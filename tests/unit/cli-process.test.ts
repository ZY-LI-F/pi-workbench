// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CliProcess, CliProcessProtocolError, CliProcessTimeoutError } from "../../src/main/cli-process";
import { ExecutionAbortedError } from "../../src/main/execution-backend";

const SHIM = fileURLToPath(new URL("../fixtures/cli-process-shim.mjs", import.meta.url));
const cwd = process.cwd();

function request(mode: string, stdout: "json" | "jsonl" | "text") {
  return {
    executable: process.execPath,
    prefixArgv: [SHIM],
    argv: [mode],
    cwd,
    stdout,
  } as const;
}

describe("CliProcess", () => {
  it("decodes split UTF-8 JSONL records and flushes the last line without a newline", async () => {
    const values: unknown[] = [];
    const result = await new CliProcess().run(request("jsonl", "jsonl"), { onJson: (value) => values.push(value) });
    expect(result.exitCode).toBe(0);
    expect(values).toEqual([
      { type: "hello", text: "你好" },
      { type: "done", ok: true },
    ]);
  });

  it("writes prompts through stdin and parses one JSON result", async () => {
    let payload: unknown;
    const result = await new CliProcess().run({ ...request("stdin", "json"), stdin: "秘密不进入 argv" }, {
      onJson: (value) => { payload = value; },
    });
    expect(result.exitCode).toBe(0);
    expect(payload).toEqual({ input: "秘密不进入 argv" });
  });

  it("keeps bounded stdout/stderr heads and tails with an explicit truncation marker", async () => {
    const result = await new CliProcess().run({
      ...request("tails", "text"),
      maxStdoutBytes: 256,
      maxStderrBytes: 256,
    });
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(result.stdoutTail).toContain("Stella 已截断输出");
    expect(result.stdoutTail).toMatch(/^head-/);
    expect(result.stdoutTail).toMatch(/-tail$/);
    expect(result.stderrTail).toMatch(/^problem-/);
    expect(result.stderrTail).toContain("-end");
  });

  it("fails bad JSONL and oversized protocol lines explicitly", async () => {
    await expect(new CliProcess().run(request("invalid-jsonl", "jsonl"))).rejects.toBeInstanceOf(CliProcessProtocolError);
    await expect(new CliProcess().run({ ...request("long-line", "jsonl"), maxLineBytes: 256 })).rejects.toThrow("超过 256 bytes");
  });

  it("aborts its detached process group and settles once", async () => {
    const controller = new AbortController();
    const processRunner = new CliProcess({ abortGraceMs: 20 });
    const settled = vi.fn();
    const running = processRunner.run(request("wait", "text"), {}, controller.signal).finally(settled);
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(ExecutionAbortedError);
    expect(settled).toHaveBeenCalledOnce();
  });

  it("bounds probe-style commands with an explicit timeout", async () => {
    await expect(new CliProcess({ abortGraceMs: 10 }).run({ ...request("wait", "text"), timeoutMs: 20 }))
      .rejects.toBeInstanceOf(CliProcessTimeoutError);
  });
});
