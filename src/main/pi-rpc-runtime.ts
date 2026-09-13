import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { PiCommand, PiExtensionResponse, PiResponse, RuntimeSignal } from "../shared/contracts";
import type { AgentThinkingLevel } from "../shared/kanban";
import { appendDiagnosticText } from "../shared/diagnostics";
import type { RuntimeScope } from "../shared/runtime-scope";
import type { NativeRequestTrace } from "../shared/native-diagnostics";

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

interface RuntimeDependencies {
  readonly executablePath: string;
  readonly rpcEntryPath: string;
  readonly spawnProcess: SpawnProcess;
  readonly emitPiEvent: (event: unknown, scope: RuntimeScope) => void;
  readonly emitRuntimeSignal: (event: RuntimeSignal, scope: RuntimeScope) => void;
  readonly emitRequestTrace?: (trace: NativeRequestTrace, scope: RuntimeScope) => void;
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
  readonly id: string;
  readonly command: PiCommand["type"];
  readonly resolve: (response: PiResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeout?: ReturnType<typeof setTimeout>;
}

interface ProcessContext {
  readonly child: ChildProcessWithoutNullStreams;
  readonly generation: string;
  readonly cwd: string;
  readonly pending: Map<string, PendingRequest>;
  readonly stdoutDecoder: TextDecoder;
  readonly stderrDecoder: TextDecoder;
  stdoutBuffer: string;
  stderrBuffer: string;
  retired: boolean;
  spawned: boolean;
  sequence: number;
  scope: number;
  sessionId?: string;
  sessionFile?: string;
  stopPromise?: Promise<void>;
}

/** A negative Pi response is authoritative rejection, unlike a lost transport response. */
export class PiCommandRejectedError extends Error {}

const SESSION_COMMANDS = new Set<PiCommand["type"]>(["new_session", "switch_session", "fork", "clone"]);

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
  readonly #requestTimeoutMs: number;
  readonly #compactionTimeoutMs: number;
  readonly #maxProtocolRecordBytes: number;
  #context: ProcessContext | null = null;
  #lifecycle: Promise<void> = Promise.resolve();
  #termination: Promise<void> = Promise.resolve();
  readonly #responseScopes = new WeakMap<PiResponse, RuntimeScope>();

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
    return this.#context !== null && !this.#context.retired && this.#context.child.exitCode === null;
  }

  get scope(): RuntimeScope | undefined {
    return this.#context ? this.#scope(this.#context) : undefined;
  }

  responseScope(response: PiResponse): RuntimeScope | undefined { return this.#responseScopes.get(response); }

  #scope(context: ProcessContext): RuntimeScope {
    return Object.freeze({ generation: context.generation, scope: context.scope, sequence: context.sequence,
      cwd: context.cwd, sessionId: context.sessionId, sessionFile: context.sessionFile });
  }

  #signal(context: ProcessContext, event: RuntimeSignal): void {
    if (context.retired || this.#context !== context) return;
    context.sequence += 1;
    this.#dependencies.emitRuntimeSignal(event, this.#scope(context));
  }

  #enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const result = this.#lifecycle.then(operation);
    // Keep the queue usable; the operation's caller still receives the original rejection.
    this.#lifecycle = result.then(() => undefined, () => undefined);
    return result;
  }

  start(options: PiRuntimeStartOptions): Promise<void> {
    return this.#enqueueLifecycle(() => this.#start(options));
  }

  async #start(options: PiRuntimeStartOptions): Promise<void> {
    if (options.sessionPath && options.sessionId) {
      throw new Error("Pi Runtime 不能同时使用 sessionPath 与 sessionId");
    }
    const directory = await stat(options.cwd);
    if (!directory.isDirectory()) throw new Error(`项目路径不是目录: ${options.cwd}`);
    // A protocol failure retires routing immediately, but the old process may
    // still be terminating. Do not overlap it with the replacement process.
    await this.#termination;
    if (this.#context) await this.#stopContext(this.#context);

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
    const context: ProcessContext = {
      child, generation: randomUUID(), cwd: options.cwd, pending: new Map(),
      stdoutDecoder: new TextDecoder("utf-8", { fatal: true }), stderrDecoder: new TextDecoder("utf-8", { fatal: true }),
      stdoutBuffer: "", stderrBuffer: "", retired: false, spawned: false, sequence: 0, scope: 0,
      sessionId: options.sessionId, sessionFile: options.sessionPath,
    };
    this.#context = context;
    this.#signal(context, { type: "runtime_starting", cwd: options.cwd });
    child.stdout.on("data", (chunk: Buffer) => this.#decode(context, "stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => this.#decode(context, "stderr", chunk));
    child.stdout.once("end", () => this.#decode(context, "stdout"));
    child.stderr.once("end", () => this.#decode(context, "stderr"));
    child.once("error", (error) => {
      if (context.retired) return;
      this.#protocolFailure(context, `Pi RPC 进程错误: ${error.message}`, "");
    });
    // close follows stream EOF; exit can precede the final stdout response.
    child.once("close", (code, signal) => {
      if (context.retired) return;
      this.#signal(context, { type: "runtime_exit", code, signal });
      this.#rejectPending(context, new Error(`Pi RPC 已退出 (code=${String(code)}, signal=${String(signal)})${context.stderrBuffer ? `\n${context.stderrBuffer}` : ""}`));
      context.retired = true;
      if (this.#context === context) this.#context = null;
    });

    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", () => { context.spawned = true; resolve(); });
        child.once("error", reject);
      });
      await this.#send(context, { type: "get_state" });
    } catch (cause) {
      await this.#stopContext(context);
      throw cause;
    }
    this.#signal(context, { type: "runtime_ready", cwd: options.cwd });
  }

  stop(): Promise<void> {
    return this.#enqueueLifecycle(async () => {
      if (this.#context) await this.#stopContext(this.#context);
      else await this.#termination;
    });
  }

  #stopContext(context: ProcessContext): Promise<void> {
    if (context.stopPromise) return context.stopPromise;
    context.stopPromise = this.#terminate(context);
    this.#termination = context.stopPromise;
    return context.stopPromise;
  }

  async #terminate(context: ProcessContext): Promise<void> {
    const { child } = context;
    context.retired = true;
    if (this.#context === context) this.#context = null;
    this.#rejectPending(context, new Error("Pi RPC 已停止；未返回响应的命令执行结果未知"));
    if (!context.spawned) return;
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2500);
      timeout.unref();
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      child.once("error", () => { clearTimeout(timeout); resolve(); });
      child.kill("SIGTERM");
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

  send(command: PiCommand, requestId?: string): Promise<PiResponse> {
    const context = this.#context;
    if (!context) throw new Error("Pi RPC 未运行");
    return this.#send(context, command, requestId);
  }

  #send(context: ProcessContext, command: PiCommand, requestId?: string): Promise<PiResponse> {
    const { child } = context;
    if (context.retired || child.exitCode !== null || !child.stdin.writable) throw new Error("Pi RPC 未运行");
    const id = requestId ?? randomUUID();
    if (context.pending.has(id)) throw new PiCommandRejectedError(`Pi RPC 已存在请求 ID：${id}`);
    const record = { ...command, id };
    this.#dependencies.emitRequestTrace?.({ id, command: command.type, stage: "sent" }, this.#scope(context));
    return new Promise<PiResponse>((resolve, reject) => {
      const requestTimeoutMs = command.type === "compact" ? this.#compactionTimeoutMs : this.#requestTimeoutMs;
      const timeout = requestTimeoutMs > 0
        ? setTimeout(() => {
            if (!context.pending.delete(id)) return;
            this.#dependencies.emitRequestTrace?.({ id, command: command.type, stage: "transport-error" }, this.#scope(context));
            const error = new Error(
              `Pi RPC 命令 ${command.type} 在 ${requestTimeoutMs}ms 内没有返回响应；执行结果未知，Runtime 已停止`,
            );
            this.#signal(context, { type: "protocol_error", message: error.message, record: JSON.stringify({ id, type: command.type }) });
            void this.#stopContext(context).then(
              () => reject(error),
              (stopCause: unknown) => reject(new AggregateError([error, stopCause], "Pi RPC 超时且 Runtime 停止失败")),
            );
          }, requestTimeoutMs)
        : undefined;
      timeout?.unref();
      context.pending.set(id, { id, command: command.type, resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify(record)}\n`, "utf8", (error) => {
        if (!error) return;
        const pending = context.pending.get(id);
        context.pending.delete(id);
        if (pending?.timeout) clearTimeout(pending.timeout);
        if (pending) this.#dependencies.emitRequestTrace?.({ id, command: command.type, stage: "transport-error" }, this.#scope(context));
        reject(error);
      });
    });
  }

  async respondToExtension(response: PiExtensionResponse): Promise<void> {
    const child = this.#context?.child;
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

  #decode(context: ProcessContext, stream: "stdout" | "stderr", chunk?: Buffer): void {
    if (context.retired || this.#context !== context) return;
    try {
      const text = context[`${stream}Decoder`].decode(chunk, { stream: chunk !== undefined });
      if (stream === "stderr") {
        context.stderrBuffer = appendDiagnosticText(context.stderrBuffer, text);
        if (text) this.#signal(context, { type: "runtime_stderr", message: appendDiagnosticText("", text) });
      } else {
        this.#consumeStdout(context, text);
        if (!chunk && context.stdoutBuffer) {
          const record = context.stdoutBuffer.replace(/\r$/, "");
          context.stdoutBuffer = "";
          if (!this.#recordTooLarge(context, record)) this.#handleRecord(context, record);
        }
      }
    } catch (cause) {
      this.#protocolFailure(context, `Pi RPC ${stream} 解码失败或 UTF-8 字节不完整：${String(cause)}`, "");
    }
  }

  #consumeStdout(context: ProcessContext, chunk: string): void {
    context.stdoutBuffer += chunk;
    let newline = context.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const record = context.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      context.stdoutBuffer = context.stdoutBuffer.slice(newline + 1);
      if (record.length > 0) {
        if (this.#recordTooLarge(context, record)) return;
        this.#handleRecord(context, record);
        if (context.retired) return;
      }
      newline = context.stdoutBuffer.indexOf("\n");
    }
    if (this.#recordTooLarge(context, context.stdoutBuffer)) context.stdoutBuffer = "";
  }

  #recordTooLarge(context: ProcessContext, record: string): boolean {
    if (this.#maxProtocolRecordBytes === 0 || Buffer.byteLength(record, "utf8") <= this.#maxProtocolRecordBytes) return false;
    const message = `Pi RPC 协议记录超过 ${this.#maxProtocolRecordBytes} bytes；Runtime 已停止。可通过 STELLA_PI_RPC_MAX_RECORD_BYTES 调整显式边界`;
    this.#protocolFailure(context, message, appendDiagnosticText("", record, 4096));
    return true;
  }

  #handleRecord(context: ProcessContext, record: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#protocolFailure(context, `Pi RPC 返回了无法解析的协议记录：${message}`, record);
      return;
    }

    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      this.#protocolFailure(context, "Pi RPC 协议记录必须包含 type 字符串", record);
      return;
    }

    if (isPiResponse(parsed) && typeof parsed.id === "string") {
      const pending = context.pending.get(parsed.id);
      if (!pending) return;
      if (parsed.command !== pending.command || typeof parsed.success !== "boolean") {
        this.#protocolFailure(context, "Pi RPC 响应与请求不匹配", record);
        return;
      }
      context.pending.delete(parsed.id);
      this.#dependencies.emitRequestTrace?.({ id: parsed.id, command: pending.command, stage: parsed.success ? "accepted" : "rejected" }, this.#scope(context));
      if (pending.timeout) clearTimeout(pending.timeout);
      this.#responseScopes.set(parsed, this.#scope(context));
      if (parsed.success) {
        if (parsed.command === "get_state" && isRecord(parsed.data)) {
          const sessionId = typeof parsed.data.sessionId === "string" ? parsed.data.sessionId : undefined;
          if (context.sessionId && sessionId && context.sessionId !== sessionId) context.scope += 1;
          context.sessionId = sessionId;
          context.sessionFile = typeof parsed.data.sessionFile === "string" ? parsed.data.sessionFile : undefined;
        }
        if (SESSION_COMMANDS.has(pending.command) && !("data" in parsed && isRecord(parsed.data) && "cancelled" in parsed.data && parsed.data.cancelled)) {
          context.scope += 1;
          context.sessionId = undefined;
          context.sessionFile = undefined;
        }
        pending.resolve(parsed);
      } else pending.reject(new PiCommandRejectedError(parsed.error));
      return;
    }
    context.sequence += 1;
    this.#dependencies.emitPiEvent(parsed, this.#scope(context));
  }

  #protocolFailure(context: ProcessContext, message: string, record: string): void {
    this.#signal(context, { type: "protocol_error", message, record });
    this.#rejectPending(context, new Error(message));
    void this.#stopContext(context);
  }

  #rejectPending(context: ProcessContext, error: Error): void {
    for (const pending of context.pending.values()) {
      this.#dependencies.emitRequestTrace?.({ id: pending.id, command: pending.command, stage: "transport-error" }, this.#scope(context));
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    context.pending.clear();
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
