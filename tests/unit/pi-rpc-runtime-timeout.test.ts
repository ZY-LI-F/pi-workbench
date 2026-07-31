// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PiRpcRuntime, piRpcRequestTimeoutFromEnvironment } from "../../src/main/pi-rpc-runtime";

class FakeRpcProcess extends EventEmitter {
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

async function startedRuntime(timeout: number) {
  const child = new FakeRpcProcess();
  const signals: unknown[] = [];
  const runtime = new PiRpcRuntime({
    executablePath: "node",
    rpcEntryPath: "rpc-entry.js",
    spawnProcess: () => {
      setImmediate(() => child.emit("spawn"));
      return child as unknown as ChildProcessWithoutNullStreams;
    },
    emitPiEvent: () => undefined,
    emitRuntimeSignal: (signal) => signals.push(signal),
    requestTimeoutMs: timeout,
  });
  runtimes.push(runtime);
  await runtime.start({ cwd: process.cwd(), trusted: false });
  return { child, runtime, signals };
}

describe("PiRpcRuntime request boundaries", () => {
  it("rejects an RPC request that never receives a response", async () => {
    const { child, runtime, signals } = await startedRuntime(15);

    await expect(runtime.send({ type: "abort" })).rejects.toThrow("执行结果未知，Runtime 已停止");
    expect(runtime.running).toBe(false);
    expect(child.exitCode).toBe(0);
    expect(signals).toContainEqual(expect.objectContaining({ type: "protocol_error", message: expect.stringContaining("abort 在 15ms 内没有返回响应") }));
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
});
