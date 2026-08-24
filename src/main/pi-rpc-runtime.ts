import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { PiCommand, PiExtensionResponse, PiResponse, RuntimeSignal } from "../shared/contracts";
import type { AgentThinkingLevel } from "../shared/kanban";
import { appendDiagnosticText } from "../shared/diagnostics";

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

interface RuntimeDependencies {
  readonly executablePath: string;
  readonly rpcEntryPath: string;
  readonly spawnProcess: SpawnProcess;
  readonly emitPiEvent: (event: unknown) => void;
  readonly emitRuntimeSignal: (event: RuntimeSignal) => void;
  /** Set to 0 to disable. Defaults to 120 seconds. */
  readonly requestTimeoutMs?: number;
  /** Manual compaction may legitimately take several minutes. Set to 0 to disable. Defaults to 10 minutes. */
  readonly compactionTimeoutMs?: number;
  /** Maximum size of one newline-delimited Pi RPC record. Set to 0 to disable. Defaults to 64 MiB. */
  readonly maxProtocolRecordBytes?: number;
}

export interface PiRuntimeStartOptions {
  readonly cwd: string;
  readonly trusted: boolean;
  readonly sessionPath?: string;
  readonly sessionId?: string;
  readonly sessionName?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: AgentThinkingLevel;
  readonly allowedTools?: readonly string[];
  readonly appendSystemPrompt?: string;
  readonly disableExtensions?: boolean;
  readonly disableSkills?: boolean;
  readonly disablePromptTemplates?: boolean;
  readonly disableContextFiles?: boolean;
  /** Explicit trusted extensions; these still load when ambient extension discovery is disabled. */
  readonly extensions?: readonly string[];
}

interface PendingRequest {
  readonly resolve: (response: PiResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeout?: ReturnType<typeof setTimeout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPiResponse(value: unknown): value is PiResponse {
  return isRecord(value) && value.type === "response" && typeof value.command === "string";
}

export function piRpcRequestTimeoutFromEnvironment(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 120_000;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("STELLA_PI_RPC_TIMEOUT_MS 必须是非负数字，0 表示禁用超时");
  return parsed;
}

export class PiRpcRuntime {
  readonly #dependencies: RuntimeDependencies;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #intentionalStops = new WeakSet<ChildProcessWithoutNullStreams>();
  readonly #requestTimeoutMs: number;
  readonly #compactionTimeoutMs: number;
  readonly #maxProtocolRecordBytes: number;
  #process: ChildProcessWithoutNullStreams | null = null;
  #stdoutBuffer = "";
  #stderrBuffer = "";

  constructor(dependencies: RuntimeDependencies) {
    const timeout = dependencies.requestTimeoutMs ?? 120_000;
    if (!Number.isFinite(timeout) || timeout < 0) throw new Error("Pi RPC requestTimeoutMs 必须是非负有限数字");
    const compactionTimeout = dependencies.compactionTimeoutMs ?? 600_000;
    if (!Number.isFinite(compactionTimeout) || compactionTimeout < 0) throw new Error("Pi RPC compactionTimeoutMs 必须是非负有限数字");
    const maxProtocolRecordBytes = dependencies.maxProtocolRecordBytes ?? 64 * 1024 * 1024;
    if (!Number.isSafeInteger(maxProtocolRecordBytes) || maxProtocolRecordBytes < 0) {
      throw new Error("Pi RPC maxProtocolRecordBytes 必须是非负安全整数");
    }
    this.#dependencies = dependencies;
    this.#requestTimeoutMs = timeout;
    this.#compactionTimeoutMs = compactionTimeout;
    this.#maxProtocolRecordBytes = maxProtocolRecordBytes;
  }

  get running(): boolean {
    return this.#process !== null && this.#process.exitCode === null;
  }

  async start(options: PiRuntimeStartOptions): Promise<void> {
    if (options.sessionPath && options.sessionId) {
      throw new Error("Pi Runtime 不能同时使用 sessionPath 与 sessionId");
    }
    const directory = await stat(options.cwd);
    if (!directory.isDirectory()) throw new Error(`项目路径不是目录: ${options.cwd}`);
    await this.stop();

    this.#dependencies.emitRuntimeSignal({ type: "runtime_starting", cwd: options.cwd });
    const args: string[] = [this.#dependencies.rpcEntryPath, options.trusted ? "--approve" : "--no-approve"];
    if (options.sessionPath) args.push("--session", options.sessionPath);
    else if (options.sessionId) args.push("--session-id", options.sessionId);
    if (options.sessionName) args.push("--name", options.sessionName);
    if (options.provider) args.push("--provider", options.provider);
    if (options.model) args.push("--model", options.model);
    if (options.thinking) args.push("--thinking", options.thinking);
    if (options.allowedTools) {
      if (options.allowedTools.length === 0) args.push("--no-tools");
      else args.push("--tools", options.allowedTools.join(","));
    }
    if (options.appendSystemPrompt) args.push("--append-system-prompt", options.appendSystemPrompt);
    if (options.disableExtensions) args.push("--no-extensions");
    if (options.disableSkills) args.push("--no-skills");
    if (options.disablePromptTemplates) args.push("--no-prompt-templates");
    if (options.disableContextFiles) args.push("--no-context-files");
    for (const extension of options.extensions ?? []) args.push("--extension", extension);
    const child = this.#dependencies.spawnProcess(this.#dependencies.executablePath, args, {
      cwd: options.cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    });
    this.#process = child;
    this.#stdoutBuffer = "";
    this.#stderrBuffer = "";

    child.stdout.on("data", (chunk: Buffer) => this.#consumeStdout(chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8");
      this.#stderrBuffer = appendDiagnosticText(this.#stderrBuffer, message);
      this.#dependencies.emitRuntimeSignal({ type: "runtime_stderr", message: appendDiagnosticText("", message) });
    });
    child.once("error", (error) => this.#handleProcessFailure(error));
    child.once("exit", (code, signal) => {
      const intentional = this.#intentionalStops.has(child);
      this.#intentionalStops.delete(child);
      if (this.#process === child) this.#process = null;
      const failure = new Error(
        `${intentional ? "Pi RPC 已停止" : `Pi RPC 已退出 (code=${String(code)}, signal=${String(signal)})`}${
          this.#stderrBuffer ? `\n${this.#stderrBuffer}` : ""
        }`,
      );
      this.#rejectPending(failure);
      if (!intentional) this.#dependencies.emitRuntimeSignal({ type: "runtime_exit", code, signal });
    });

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    try {
      await this.send({ type: "get_state" });
    } catch (cause) {
      await this.stop();
      throw cause;
    }
    this.#dependencies.emitRuntimeSignal({ type: "runtime_ready", cwd: options.cwd });
  }

  async stop(): Promise<void> {
    const child = this.#process;
    if (!child) return;
    this.#process = null;
    this.#intentionalStops.add(child);
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2500).unref();
    });
  }

  async abortAndStop(): Promise<void> {
    let abortError: unknown;
    if (this.running) {
      try {
        await this.send({ type: "abort" });
      } catch (error) {
        abortError = error;
      }
    }
    await this.stop();
    if (abortError) throw abortError;
  }

  send(command: PiCommand): Promise<PiResponse> {
    const child = this.#process;
    if (!child || child.exitCode !== null || !child.stdin.writable) {
      throw new Error(`Pi RPC 未运行${this.#stderrBuffer ? `: ${this.#stderrBuffer}` : ""}`);
    }

    const id = randomUUID();
    const record = { ...command, id };
    return new Promise<PiResponse>((resolve, reject) => {
      const requestTimeoutMs = command.type === "compact" ? this.#compactionTimeoutMs : this.#requestTimeoutMs;
      const timeout = requestTimeoutMs > 0
        ? setTimeout(() => {
            if (!this.#pending.delete(id)) return;
            const error = new Error(
              `Pi RPC 命令 ${command.type} 在 ${requestTimeoutMs}ms 内没有返回响应；执行结果未知，Runtime 已停止`,
            );
            this.#dependencies.emitRuntimeSignal({ type: "protocol_error", message: error.message, record: JSON.stringify(record) });
            void this.stop().then(
              () => reject(error),
              (stopCause: unknown) => reject(new AggregateError([error, stopCause], "Pi RPC 超时且 Runtime 停止失败")),
            );
          }, requestTimeoutMs)
        : undefined;
      timeout?.unref();
      this.#pending.set(id, { resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify(record)}\n`, "utf8", (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        this.#pending.delete(id);
        if (pending?.timeout) clearTimeout(pending.timeout);
        reject(error);
      });
    });
  }

  async respondToExtension(response: PiExtensionResponse): Promise<void> {
    const child = this.#process;
    if (!child || child.exitCode !== null || !child.stdin.writable) {
      throw new Error("Pi RPC 未运行，无法回复扩展请求");
    }
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(response)}\n`, "utf8", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  #consumeStdout(chunk: string): void {
    this.#stdoutBuffer += chunk;
    let newline = this.#stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const record = this.#stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (record.length > 0) {
        if (this.#recordTooLarge(record)) return;
        this.#handleRecord(record);
      }
      newline = this.#stdoutBuffer.indexOf("\n");
    }
    if (this.#recordTooLarge(this.#stdoutBuffer)) this.#stdoutBuffer = "";
  }

  #recordTooLarge(record: string): boolean {
    if (this.#maxProtocolRecordBytes === 0 || Buffer.byteLength(record, "utf8") <= this.#maxProtocolRecordBytes) return false;
    const message = `Pi RPC 协议记录超过 ${this.#maxProtocolRecordBytes} bytes；Runtime 已停止。可通过 STELLA_PI_RPC_MAX_RECORD_BYTES 调整显式边界`;
    this.#dependencies.emitRuntimeSignal({
      type: "protocol_error",
      message,
      record: appendDiagnosticText("", record, 4096),
    });
    this.#rejectPending(new Error(message));
    void this.stop();
    return true;
  }

  #handleRecord(record: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#dependencies.emitRuntimeSignal({ type: "protocol_error", message, record });
      this.#rejectPending(new Error(`Pi RPC 返回了无法解析的协议记录：${message}`));
      return;
    }

    if (isPiResponse(parsed) && typeof parsed.id === "string") {
      const pending = this.#pending.get(parsed.id);
      if (!pending) return;
      this.#pending.delete(parsed.id);
      if (pending.timeout) clearTimeout(pending.timeout);
      if (parsed.success) pending.resolve(parsed);
      else pending.reject(new Error(parsed.error));
      return;
    }
    this.#dependencies.emitPiEvent(parsed);
  }

  #handleProcessFailure(error: Error): void {
    this.#rejectPending(error);
    this.#dependencies.emitRuntimeSignal({
      type: "runtime_stderr",
      message: `Pi RPC 进程错误: ${error.message}`,
    });
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export function piRpcMaxRecordBytesFromEnvironment(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 64 * 1024 * 1024;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("STELLA_PI_RPC_MAX_RECORD_BYTES 必须是非负安全整数，0 表示禁用边界");
  }
  return parsed;
}

export function piRpcCompactionTimeoutFromEnvironment(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 600_000;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("STELLA_PI_COMPACTION_TIMEOUT_MS 必须是非负数字，0 表示禁用超时");
  return parsed;
}
