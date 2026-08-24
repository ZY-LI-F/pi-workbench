import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { ExecutionAbortedError } from "./execution-backend";

const DEFAULT_MAX_LINE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TAIL_BYTES = 256 * 1024;
const DEFAULT_ABORT_GRACE_MS = 1_500;
const TRUNCATION_MARKER = "\n… <Stella 已截断输出> …\n";

export interface CliProcessRequest {
  readonly executable: string;
  readonly prefixArgv?: readonly string[];
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly stdin?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly stdout: "json" | "jsonl" | "text";
  readonly maxLineBytes?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly timeoutMs?: number;
}

export interface CliProcessCallbacks {
  readonly onJson?: (value: unknown) => void;
  readonly onTextLine?: (line: string) => void;
  readonly onStderr?: (line: string) => void;
}

export interface CliProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdoutTail: string;
  readonly stderrTail: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export class CliProcessProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliProcessProtocolError";
  }
}

export class CliProcessTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`CLI 进程在 ${timeoutMs}ms 内没有完成`);
    this.name = "CliProcessTimeoutError";
  }
}

export type CliSpawnProcess = (
  executable: string,
  argv: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly shell: false;
    readonly detached: boolean;
    readonly stdio: readonly ["pipe", "pipe", "pipe"];
    readonly windowsHide: true;
  },
) => ChildProcessWithoutNullStreams;

interface CliProcessOptions {
  readonly spawnProcess?: CliSpawnProcess;
  readonly abortGraceMs?: number;
}

class BoundedCapture {
  readonly #maxBytes: number;
  #buffer = Buffer.alloc(0);
  #head = Buffer.alloc(0);
  #tail = Buffer.alloc(0);
  #truncated = false;

  constructor(maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) throw new Error("CLI 输出上限必须是不小于 256 的整数");
    this.#maxBytes = maxBytes;
  }

  append(chunk: Buffer): void {
    if (chunk.length === 0) return;
    if (!this.#truncated) {
      const combined = Buffer.concat([this.#buffer, chunk]);
      if (combined.length <= this.#maxBytes) {
        this.#buffer = combined;
        return;
      }
      this.#truncated = true;
      const headBytes = Math.floor(this.#maxBytes / 2);
      this.#head = combined.subarray(0, headBytes);
      this.#tail = combined.subarray(combined.length - (this.#maxBytes - headBytes));
      this.#buffer = Buffer.alloc(0);
      return;
    }
    const tailBytes = this.#maxBytes - this.#head.length;
    const combinedTail = Buffer.concat([this.#tail, chunk]);
    this.#tail = combinedTail.subarray(Math.max(0, combinedTail.length - tailBytes));
  }

  get truncated(): boolean { return this.#truncated; }

  value(): string {
    if (!this.#truncated) return this.#buffer.toString("utf8");
    return `${this.#head.toString("utf8")}${TRUNCATION_MARKER}${this.#tail.toString("utf8")}`;
  }
}

class Utf8LineReader {
  readonly #decoder = new StringDecoder("utf8");
  readonly #maxLineBytes: number;
  readonly #onLine: (line: string) => void;
  #pending = "";
  #ended = false;

  constructor(maxLineBytes: number, onLine: (line: string) => void) {
    this.#maxLineBytes = maxLineBytes;
    this.#onLine = onLine;
  }

  write(chunk: Buffer): void {
    if (this.#ended) return;
    this.#pending += this.#decoder.write(chunk);
    this.#drain(false);
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#pending += this.#decoder.end();
    this.#drain(true);
  }

  #drain(flush: boolean): void {
    let newline = this.#pending.indexOf("\n");
    while (newline >= 0) {
      const line = this.#pending.slice(0, newline).replace(/\r$/, "");
      this.#pending = this.#pending.slice(newline + 1);
      this.#deliver(line);
      newline = this.#pending.indexOf("\n");
    }
    if (Buffer.byteLength(this.#pending, "utf8") > this.#maxLineBytes) {
      throw new CliProcessProtocolError(`CLI 输出单行超过 ${this.#maxLineBytes} bytes`);
    }
    if (flush && this.#pending.length > 0) {
      const line = this.#pending.replace(/\r$/, "");
      this.#pending = "";
      this.#deliver(line);
    }
  }

  #deliver(line: string): void {
    if (Buffer.byteLength(line, "utf8") > this.#maxLineBytes) {
      throw new CliProcessProtocolError(`CLI 输出单行超过 ${this.#maxLineBytes} bytes`);
    }
    this.#onLine(line);
  }
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 256) throw new Error(`${label} 必须是不小于 256 的整数`);
  return resolved;
}

function parseJsonRecord(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch (cause) {
    throw new CliProcessProtocolError(`CLI 返回无效 JSON：${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export class CliProcess {
  readonly #spawnProcess: CliSpawnProcess;
  readonly #abortGraceMs: number;

  constructor(options: CliProcessOptions = {}) {
    this.#spawnProcess = options.spawnProcess ?? ((executable, argv, spawnOptions) => spawn(executable, [...argv], {
      ...spawnOptions,
      stdio: ["pipe", "pipe", "pipe"],
    }));
    this.#abortGraceMs = options.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS;
  }

  run(request: CliProcessRequest, callbacks: CliProcessCallbacks = {}, signal?: AbortSignal): Promise<CliProcessResult> {
    if (signal?.aborted) return Promise.reject(new ExecutionAbortedError());
    const maxLineBytes = positiveLimit(request.maxLineBytes, DEFAULT_MAX_LINE_BYTES, "CLI 单行上限");
    const stdoutCapture = new BoundedCapture(positiveLimit(request.maxStdoutBytes, DEFAULT_MAX_TAIL_BYTES, "CLI stdout 上限"));
    const stderrCapture = new BoundedCapture(positiveLimit(request.maxStderrBytes, DEFAULT_MAX_TAIL_BYTES, "CLI stderr 上限"));
    const argv = Object.freeze([...(request.prefixArgv ?? []), ...request.argv]);
    const child = this.#spawnProcess(request.executable, argv, {
      cwd: request.cwd,
      env: { ...process.env, ...request.environment },
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    return new Promise<CliProcessResult>((resolve, reject) => {
      let settled = false;
      let aborted = false;
      let timedOut = false;
      let stdoutEnded = false;
      let stderrEnded = false;
      let terminateTimer: ReturnType<typeof setTimeout> | undefined;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const jsonChunks: Buffer[] = [];
      let jsonBytes = 0;

      const settle = (cause: unknown, result?: CliProcessResult): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        if (terminateTimer) clearTimeout(terminateTimer);
        if (forceTimer) clearTimeout(forceTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        cause === undefined && result ? resolve(result) : reject(cause);
      };

      const signalTree = (treeSignal: NodeJS.Signals): void => {
        if (child.pid === undefined) return;
        try {
          if (process.platform === "win32") child.kill(treeSignal);
          else process.kill(-child.pid, treeSignal);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
        }
      };

      const terminate = (immediate = false): void => {
        try { signalTree(immediate ? "SIGKILL" : "SIGINT"); } catch { /* close/error owns the final result */ }
        if (immediate) return;
        terminateTimer = setTimeout(() => {
          try { signalTree("SIGTERM"); } catch { /* best effort */ }
        }, this.#abortGraceMs);
        terminateTimer.unref?.();
        forceTimer = setTimeout(() => {
          if (process.platform === "win32" && child.pid !== undefined) {
            try {
              const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { shell: false, windowsHide: true, stdio: "ignore" });
              killer.unref();
            } catch { /* best effort */ }
          } else {
            try { signalTree("SIGKILL"); } catch { /* best effort */ }
          }
        }, this.#abortGraceMs * 2);
        forceTimer.unref?.();
      };

      const failProtocol = (cause: unknown): void => {
        terminate(true);
        settle(cause);
      };

      const stdoutLines = request.stdout === "json"
        ? undefined
        : new Utf8LineReader(maxLineBytes, (line) => {
            if (line.length === 0) return;
            if (request.stdout === "jsonl") {
              const value = parseJsonRecord(line);
              callbacks.onJson?.(value);
            }
            else callbacks.onTextLine?.(line);
          });
      const stderrLines = new Utf8LineReader(maxLineBytes, (line) => {
        if (line.length > 0) callbacks.onStderr?.(line);
      });

      const abort = (): void => {
        if (aborted || settled) return;
        aborted = true;
        terminate();
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (request.timeoutMs !== undefined) {
        if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
          settle(new Error("CLI timeoutMs 必须是正整数"));
          terminate(true);
          return;
        }
        timeoutTimer = setTimeout(() => {
          if (settled) return;
          timedOut = true;
          terminate();
        }, request.timeoutMs);
        timeoutTimer.unref?.();
      }

      child.stdout.on("data", (value: Buffer | string) => {
        if (settled) return;
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        stdoutCapture.append(chunk);
        try {
          if (request.stdout === "json") {
            jsonBytes += chunk.length;
            if (jsonBytes > maxLineBytes) throw new CliProcessProtocolError(`CLI JSON 输出超过 ${maxLineBytes} bytes`);
            jsonChunks.push(chunk);
          } else {
            stdoutLines?.write(chunk);
          }
        } catch (cause) {
          failProtocol(cause);
        }
      });
      child.stdout.once("end", () => {
        stdoutEnded = true;
        try { stdoutLines?.end(); } catch (cause) { failProtocol(cause); }
      });
      child.stderr.on("data", (value: Buffer | string) => {
        if (settled) return;
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        stderrCapture.append(chunk);
        try { stderrLines.write(chunk); } catch (cause) { failProtocol(cause); }
      });
      child.stderr.once("end", () => {
        stderrEnded = true;
        try { stderrLines.end(); } catch (cause) { failProtocol(cause); }
      });
      child.once("error", (cause) => settle(cause));
      child.once("close", (exitCode, processSignal) => {
        if (settled) return;
        try {
          if (!stdoutEnded) stdoutLines?.end();
          if (!stderrEnded) stderrLines.end();
          if (aborted) {
            settle(new ExecutionAbortedError());
            return;
          }
          if (timedOut) {
            settle(new CliProcessTimeoutError(request.timeoutMs as number));
            return;
          }
          if (request.stdout === "json") {
            const jsonText = Buffer.concat(jsonChunks).toString("utf8").trim();
            if (jsonText.length > 0) {
              const value = parseJsonRecord(jsonText);
              callbacks.onJson?.(value);
            }
          }
          settle(undefined, Object.freeze({
            exitCode,
            signal: processSignal as NodeJS.Signals | null,
            stdoutTail: stdoutCapture.value(),
            stderrTail: stderrCapture.value(),
            stdoutTruncated: stdoutCapture.truncated,
            stderrTruncated: stderrCapture.truncated,
          }));
        } catch (cause) {
          settle(cause);
        }
      });
      child.stdin.on("error", (cause: NodeJS.ErrnoException) => {
        if (!settled && cause.code !== "EPIPE") settle(cause);
      });
      child.stdin.end(request.stdin ?? "", "utf8");
    });
  }
}
