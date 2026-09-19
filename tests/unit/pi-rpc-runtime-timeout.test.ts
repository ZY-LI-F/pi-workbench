// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PiRpcRuntime, piRpcCompactionTimeoutFromEnvironment, piRpcMaxRecordBytesFromEnvironment, piRpcRequestTimeoutFromEnvironment, type PiRuntimeStartOptions } from "../../src/main/pi-rpc-runtime";
import type { PiProcessSupervisor } from "../../src/main/pi-process-supervisor";

class FakeRpcProcess extends EventEmitter {
  readonly pid = 12345;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: Record<string, unknown>[] = [];
  readonly stdin: Writable;
  exitCode: number | null = null;

  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const request = JSON.parse(chunk.toString("utf8")) as Record<string, unknown>;
        this.requests.push(request);
        if (request.type === "get_state") {
          setImmediate(() => this.stdout.write(`${JSON.stringify({
            id: request.id,
            type: "response",
            command: "get_state",
            success: true,
            data: {},
          })}\n`));
        }
        callback();
      },
    });
  }

  kill(): boolean {
    if (this.exitCode !== null) return false;
    this.exitCode = 0;
    setImmediate(() => this.emit("exit", 0, null));
    return true;
  }
}

const runtimes: PiRpcRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});

async function startedRuntime(
  timeout: number,
  maxProtocolRecordBytes?: number,
  startOptions: PiRuntimeStartOptions = { cwd: process.cwd(), trusted: false },
  compactionTimeoutMs?: number,
  supervisor?: PiProcessSupervisor,
) {
  const child = new FakeRpcProcess();
  const signals: unknown[] = [];
  const events: unknown[] = [];
  const spawnArgs: string[][] = [];
  const runtime = new PiRpcRuntime({
    executablePath: "node",
    rpcEntryPath: "rpc-entry.js",
    spawnProcess: (_command, args) => {
      spawnArgs.push([...args]);
      setImmediate(() => child.emit("spawn"));
      return child as unknown as ChildProcessWithoutNullStreams;
    },
    emitPiEvent: (event) => events.push(event),
    emitRuntimeSignal: (signal) => signals.push(signal),
    requestTimeoutMs: timeout,
    compactionTimeoutMs,
    maxProtocolRecordBytes,
    ...(supervisor ? { superviseProcess: async () => supervisor } : {}),
  });
  runtimes.push(runtime);
  await runtime.start(startOptions);
  return { child, runtime, signals, spawnArgs, events };
}

describe("PiRpcRuntime request boundaries", () => {
  it("does not report Pi stopped when Pi rejects abort even if its children were stopped", async () => {
    const { child, runtime, signals } = await startedRuntime(5_000, undefined, undefined, undefined, {
      stopChildren: async () => 2, close: async () => undefined,
    });
    const stopping = runtime.send({ type: "abort" });
    const request = child.requests.at(-1)!;
    child.stdout.write(`${JSON.stringify({ type: "response", id: request.id, command: "abort", success: false, error: "Abort rejected" })}\n`);
    await expect(stopping).rejects.toThrow("Abort rejected");
    expect(signals).not.toContainEqual(expect.objectContaining({ type: "background_stopped" }));
  });

  it("exposes background termination failure even when Pi acknowledges abort", async () => {
    const { child, runtime, signals } = await startedRuntime(5_000, undefined, undefined, undefined, {
      stopChildren: async () => { throw new Error("Termination denied"); }, close: async () => undefined,
    });
    const stopping = runtime.send({ type: "abort" });
    const request = child.requests.at(-1)!;
    child.stdout.write(`${JSON.stringify({ type: "response", id: request.id, command: "abort", success: true })}\n`);
    await expect(stopping).rejects.toThrow("无法确认本机后台计算已停止");
    expect(signals).not.toContainEqual(expect.objectContaining({ type: "background_stopped" }));
  });

  it("waits for protocol-failure termination before a stop or replacement start completes", async () => {
    const children: FakeRpcProcess[] = [];
    const runtime = new PiRpcRuntime({
      executablePath: "node", rpcEntryPath: "rpc-entry.js", requestTimeoutMs: 5_000,
      spawnProcess: () => {
        const child = new FakeRpcProcess(); children.push(child);
        setImmediate(() => child.emit("spawn"));
        return child as unknown as ChildProcessWithoutNullStreams;
      }, emitPiEvent: () => undefined, emitRuntimeSignal: () => undefined,
    });
    runtimes.push(runtime);
    await runtime.start({ cwd: process.cwd(), trusted: false });
    const old = children[0]!;
    const finishExit = old.kill.bind(old);
    old.kill = () => true; // Simulate a process whose SIGTERM has not completed yet.
    old.stdout.write("{invalid-json}\n");
    let stopCompleted = false;
    const stopping = runtime.stop().then(() => { stopCompleted = true; });
    const restarting = runtime.start({ cwd: process.cwd(), trusted: false });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stopCompleted).toBe(false);
      expect(children).toHaveLength(1);
    } finally { finishExit(); await stopping; await restarting; }
    expect(children).toHaveLength(2);
    expect(runtime.running).toBe(true);
  });

  it("decodes every possible UTF-8 byte boundary without changing Chinese, emoji or paths", async () => {
    const { child, events, signals } = await startedRuntime(5_000);
    const event = { type: "message_update", text: "中文😀路径 C:\\报告\\分子.md" };
    const bytes = Buffer.from(`${JSON.stringify(event)}\r\n`);
    for (let split = 1; split < bytes.length; split += 1) {
      child.stdout.write(bytes.subarray(0, split));
      child.stdout.write(bytes.subarray(split));
    }
    for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
    expect(events).toEqual(Array.from({ length: bytes.length }, () => event));
    expect(signals).not.toContainEqual(expect.objectContaining({ type: "protocol_error" }));
  });

  it("flushes the final record at EOF and drains it before process close", async () => {
    const { child, runtime } = await startedRuntime(5_000);
    const pending = runtime.send({ type: "abort" });
    const request = child.requests.at(-1);
    child.emit("exit", 0, null);
    child.stdout.end(JSON.stringify({ id: request?.id, type: "response", command: "abort", success: true }));
    await expect(pending).resolves.toMatchObject({ success: true });
    child.emit("close", 0, null);
    expect(runtime.running).toBe(false);
  });

  it("reports truncated JSON and incomplete UTF-8 instead of silently dropping the last line", async () => {
    const first = await startedRuntime(5_000);
    const pending = first.runtime.send({ type: "abort" });
    first.child.stdout.end('{"type":');
    await expect(pending).rejects.toThrow("无法解析");
    const second = await startedRuntime(5_000);
    const other = second.runtime.send({ type: "abort" });
    second.child.stdout.end(Buffer.from([0xe4, 0xb8]));
    await expect(other).rejects.toThrow("UTF-8");
  });

  it("decodes stderr independently from stdout across byte boundaries", async () => {
    const { child, signals } = await startedRuntime(5_000);
    const bytes = Buffer.from("中文😀错误");
    for (const byte of bytes) child.stderr.write(Buffer.from([byte]));
    child.stderr.end();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(signals.filter((signal) => (signal as { type: string }).type === "runtime_stderr")
      .map((signal) => (signal as { message: string }).message).join("")).toBe("中文😀错误");
  });

  it("isolates delayed stdout, stderr, exit and errors from retired processes", async () => {
    const children: FakeRpcProcess[] = [];
    const events: unknown[] = [];
    const signals: unknown[] = [];
    const runtime = new PiRpcRuntime({
      executablePath: "node", rpcEntryPath: "rpc.js", requestTimeoutMs: 5_000,
      spawnProcess: () => {
        const child = new FakeRpcProcess();
        children.push(child);
        setImmediate(() => child.emit("spawn"));
        return child as unknown as ChildProcessWithoutNullStreams;
      },
      emitPiEvent: (event) => events.push(event), emitRuntimeSignal: (event) => signals.push(event),
    });
    runtimes.push(runtime);
    await runtime.start({ cwd: process.cwd(), trusted: false });
    const before = runtime.scope;
    children[0].stdout.write('{"type":"old');
    await runtime.start({ cwd: process.cwd(), trusted: false });
    expect(runtime.scope?.generation).not.toBe(before?.generation);
    const pending = runtime.send({ type: "abort" });
    const request = children[1].requests.at(-1);
    children[0].stdout.write('-event"}\n');
    children[0].stderr.write("old error");
    children[0].emit("error", new Error("old process error"));
    children[0].emit("close", 1, null);
    children[1].stdout.write(`${JSON.stringify({ id: request?.id, type: "response", command: "abort", success: true })}\n`);
    await expect(pending).resolves.toMatchObject({ success: true });
    expect(events).toEqual([]);
    expect(signals).not.toContainEqual(expect.objectContaining({ type: "runtime_exit" }));
    expect(signals).not.toContainEqual(expect.objectContaining({ type: "runtime_stderr" }));
  });

  it("rejects a response whose command does not match the request ID", async () => {
    const { child, runtime } = await startedRuntime(5_000);
    const pending = runtime.send({ type: "abort" });
    child.stdout.write(`${JSON.stringify({ id: child.requests.at(-1)?.id, type: "response", command: "prompt", success: true })}\n`);
    await expect(pending).rejects.toThrow("响应与请求不匹配");
  });

  it("resumes an unsaved session by its exact ID", async () => {
    const sessionId = "01a01595-7f5c-7a0d-a4d3-118f199cbd8b";
    const { spawnArgs } = await startedRuntime(5_000, undefined, {
      cwd: process.cwd(),
      trusted: false,
      sessionId,
    });

    expect(spawnArgs[0]).toContain("--session-id");
    expect(spawnArgs[0]).toContain(sessionId);
    expect(spawnArgs[0]).not.toContain("--session");
  });

  it("rejects conflicting session selectors before stopping the active runtime", async () => {
    const { runtime } = await startedRuntime(5_000);

    await expect(runtime.start({
      cwd: process.cwd(),
      trusted: false,
      sessionPath: "C:/sessions/current.jsonl",
      sessionId: "01a01595-7f5c-7a0d-a4d3-118f199cbd8b",
    })).rejects.toThrow("不能同时使用 sessionPath 与 sessionId");
    expect(runtime.running).toBe(true);
  });

  it("rejects an RPC request that never receives a response", async () => {
    const { child, runtime, signals } = await startedRuntime(15);

    await expect(runtime.send({ type: "abort" })).rejects.toThrow("执行结果未知，Runtime 已停止");
    expect(runtime.running).toBe(false);
    expect(child.exitCode).toBe(0);
    expect(signals).toContainEqual(expect.objectContaining({ type: "protocol_error", message: expect.stringContaining("abort 在 15ms 内没有返回响应") }));
  });

  it("uses a separate long-running timeout for manual compaction", async () => {
    const { child, runtime } = await startedRuntime(15, undefined, { cwd: process.cwd(), trusted: false }, 100);
    const pending = runtime.send({ type: "compact" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const request = child.requests.find((candidate) => candidate.type === "compact");
    child.stdout.write(`${JSON.stringify({ id: request?.id, type: "response", command: "compact", success: true, data: { summary: "ok" } })}\n`);

    await expect(pending).resolves.toMatchObject({ command: "compact", success: true });
    expect(runtime.running).toBe(true);
  });

  it("rejects all pending work when Pi writes malformed protocol JSON", async () => {
    const { child, runtime, signals } = await startedRuntime(5_000);
    const pending = runtime.send({ type: "abort" });
    child.stdout.write("{not-json}\n");

    await expect(pending).rejects.toThrow("无法解析的协议记录");
    expect(signals).toContainEqual(expect.objectContaining({ type: "protocol_error" }));
  });

  it("validates the environment timeout and keeps zero as an explicit opt-out", () => {
    expect(piRpcRequestTimeoutFromEnvironment(undefined)).toBe(120_000);
    expect(piRpcRequestTimeoutFromEnvironment("2500")).toBe(2_500);
    expect(piRpcRequestTimeoutFromEnvironment("0")).toBe(0);
    expect(() => piRpcRequestTimeoutFromEnvironment("-1")).toThrow("非负数字");
    expect(() => piRpcRequestTimeoutFromEnvironment("NaN")).toThrow("非负数字");
  });

  it("validates the dedicated compaction timeout", () => {
    expect(piRpcCompactionTimeoutFromEnvironment(undefined)).toBe(600_000);
    expect(piRpcCompactionTimeoutFromEnvironment("900000")).toBe(900_000);
    expect(piRpcCompactionTimeoutFromEnvironment("0")).toBe(0);
    expect(() => piRpcCompactionTimeoutFromEnvironment("-1")).toThrow("非负数字");
  });

  it("stops on an explicitly oversized newline-delimited protocol record", async () => {
    const { child, runtime, signals } = await startedRuntime(5_000, 256);
    const pending = runtime.send({ type: "abort" });
    child.stdout.write(`${JSON.stringify({ type: "event", payload: "x".repeat(1_000) })}\n`);

    await expect(pending).rejects.toThrow("协议记录超过 256 bytes");
    await expect.poll(() => runtime.running).toBe(false);
    expect(signals).toContainEqual(expect.objectContaining({
      type: "protocol_error",
      message: expect.stringContaining("STELLA_PI_RPC_MAX_RECORD_BYTES"),
    }));
  });

  it("validates the protocol record environment boundary", () => {
    expect(piRpcMaxRecordBytesFromEnvironment(undefined)).toBe(64 * 1024 * 1024);
    expect(piRpcMaxRecordBytesFromEnvironment("1048576")).toBe(1_048_576);
    expect(piRpcMaxRecordBytesFromEnvironment("0")).toBe(0);
    expect(() => piRpcMaxRecordBytesFromEnvironment("1.5")).toThrow("安全整数");
    expect(() => piRpcMaxRecordBytesFromEnvironment("-1")).toThrow("非负安全整数");
  });
});
