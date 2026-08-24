import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { ExecutionBackendConfiguration } from "./execution-backend";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_RECORDS = 5_000;
const STDERR_TAIL_BYTES = 64 * 1024;

export type CodexAppServerSpawn = (
  executable: string,
  argv: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly shell: false;
    readonly stdio: readonly ["pipe", "pipe", "pipe"];
    readonly windowsHide: true;
  },
) => ChildProcessWithoutNullStreams;

export interface CodexAppServerNotification {
  readonly method: string;
  readonly params?: unknown;
}

interface CodexAppServerClientOptions {
  readonly configuration: () => ExecutionBackendConfiguration;
  readonly cwd: string;
  readonly spawnProcess?: CodexAppServerSpawn;
  readonly requestTimeoutMs?: number;
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (cause: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function configurationKey(configuration: ExecutionBackendConfiguration): string {
  return JSON.stringify([configuration.executable, configuration.prefixArgv ?? [], configuration.displayPath]);
}

function boundedTail(current: string, chunk: Buffer): string {
  const combined = Buffer.concat([Buffer.from(current), chunk]);
  return combined.subarray(Math.max(0, combined.length - STDERR_TAIL_BYTES)).toString("utf8");
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const input = value as Record<string, unknown>;
    if (typeof input.message === "string") return input.message;
  }
  return "Codex App Server 返回未知错误";
}

export class CodexAppServerClient {
  readonly #configuration: () => ExecutionBackendConfiguration;
  readonly #cwd: string;
  readonly #spawnProcess: CodexAppServerSpawn;
  readonly #requestTimeoutMs: number;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #notificationListeners = new Set<(notification: CodexAppServerNotification) => void>();
  #child?: ChildProcessWithoutNullStreams;
  #starting?: Promise<void>;
  #activeConfigurationKey?: string;
  #requestId = 0;
  #shutdown = false;
  #stderrTail = "";

  constructor(options: CodexAppServerClientOptions) {
    this.#configuration = options.configuration;
    this.#cwd = options.cwd;
    this.#spawnProcess = options.spawnProcess ?? ((executable, argv, spawnOptions) => spawn(executable, [...argv], {
      ...spawnOptions,
      stdio: ["pipe", "pipe", "pipe"],
    }));
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#requestTimeoutMs) || this.#requestTimeoutMs <= 0) {
      throw new Error("Codex App Server requestTimeoutMs 必须是正整数");
    }
  }

  onNotification(listener: (notification: CodexAppServerNotification) => void): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  async request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (!method.trim()) throw new Error("Codex App Server method 不能为空");
    await this.#ensureStarted();
    return this.#request<T>(method, params);
  }

  async listThreads(params: Readonly<Record<string, unknown>> = {}): Promise<readonly Record<string, unknown>[]> {
    const threads: Record<string, unknown>[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = record(await this.request("thread/list", { ...params, cursor }), "thread/list response");
      if (!Array.isArray(response.data)) throw new Error("thread/list response.data 必须是数组");
      for (const [index, value] of response.data.entries()) {
        threads.push(record(value, `thread/list data[${index}]`));
        if (threads.length > MAX_RECORDS) throw new Error(`Codex Thread 超过 ${MAX_RECORDS} 条上限`);
      }
      const nextCursor = typeof response.nextCursor === "string" && response.nextCursor.length > 0
        ? response.nextCursor
        : undefined;
      if (!nextCursor) return Object.freeze(threads);
      if (cursors.has(nextCursor)) throw new Error("thread/list 返回了重复 cursor");
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error(`thread/list 分页超过 ${MAX_PAGES} 页上限`);
  }

  async readThread(threadId: string): Promise<Record<string, unknown>> {
    const response = record(await this.request("thread/read", { threadId, includeTurns: false }), "thread/read response");
    return record(response.thread, "thread/read response.thread");
  }

  async listTurns(threadId: string): Promise<readonly Record<string, unknown>[]> {
    const turns: Record<string, unknown>[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = record(await this.request("thread/turns/list", {
        threadId,
        cursor,
        limit: 100,
        sortDirection: "desc",
        itemsView: "full",
      }), "thread/turns/list response");
      if (!Array.isArray(response.data)) throw new Error("thread/turns/list response.data 必须是数组");
      for (const [index, value] of response.data.entries()) {
        turns.push(record(value, `thread/turns/list data[${index}]`));
        if (turns.length > MAX_RECORDS) throw new Error(`Codex Turn 超过 ${MAX_RECORDS} 条上限`);
      }
      const nextCursor = typeof response.nextCursor === "string" && response.nextCursor.length > 0
        ? response.nextCursor
        : undefined;
      if (!nextCursor) return Object.freeze(turns);
      if (cursors.has(nextCursor)) throw new Error("thread/turns/list 返回了重复 cursor");
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error(`thread/turns/list 分页超过 ${MAX_PAGES} 页上限`);
  }

  async shutdown(): Promise<void> {
    this.#shutdown = true;
    this.#stop(new Error("Codex App Server 已关闭"));
    await this.#starting?.catch(() => undefined);
  }

  async #ensureStarted(): Promise<void> {
    if (this.#shutdown) throw new Error("Codex App Server Client 已关闭");
    const configuration = this.#configuration();
    if (!configuration.executable) throw new Error(configuration.resolutionError ?? "Codex CLI 当前不可用");
    const key = configurationKey(configuration);
    if (this.#starting) {
      await this.#starting;
      if (this.#child && this.#activeConfigurationKey === key) return;
    }
    if (this.#child && this.#activeConfigurationKey === key) return;
    if (this.#child) this.#stop(new Error("Codex CLI 配置已变更"));
    if (!this.#starting) {
      this.#starting = this.#start(configuration, key).finally(() => { this.#starting = undefined; });
    }
    await this.#starting;
  }

  async #start(configuration: ExecutionBackendConfiguration, key: string): Promise<void> {
    if (!configuration.executable) throw new Error(configuration.resolutionError ?? "Codex CLI 当前不可用");
    this.#stderrTail = "";
    const child = this.#spawnProcess(configuration.executable, [
      ...(configuration.prefixArgv ?? []),
      "app-server",
      "--stdio",
    ], {
      cwd: this.#cwd,
      env: { ...process.env },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child = child;
    this.#activeConfigurationKey = key;
    this.#listen(child);
    try {
      await this.#request("initialize", {
        clientInfo: { name: "stella-pi-workbench", title: "Stella Pi Workbench", version: "0.5.0" },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: [
            "agentMessage/delta",
            "commandExecution/outputDelta",
            "fileChange/outputDelta",
            "reasoning/summaryTextDelta",
            "reasoning/textDelta",
          ],
        },
      });
      this.#write({ method: "initialized" });
    } catch (cause) {
      this.#stop(cause instanceof Error ? cause : new Error(String(cause)));
      throw cause;
    }
  }

  #request<T>(method: string, params: unknown): Promise<T> {
    const id = ++this.#requestId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending.delete(id)) return;
        const cause = new Error(`Codex App Server ${method} 在 ${this.#requestTimeoutMs}ms 内未响应`);
        reject(cause);
        this.#stop(cause);
      }, this.#requestTimeoutMs);
      timer.unref?.();
      this.#pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        this.#write({ id, method, params });
      } catch (cause) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  #write(message: unknown): void {
    const child = this.#child;
    if (!child || child.stdin.destroyed) throw new Error("Codex App Server 连接不可写");
    child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
  }

  #listen(child: ChildProcessWithoutNullStreams): void {
    const decoder = new StringDecoder("utf8");
    let pending = "";
    const consume = (flush: boolean) => {
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/u, "");
        pending = pending.slice(newline + 1);
        if (line) this.#acceptLine(child, line);
        newline = pending.indexOf("\n");
      }
      if (Buffer.byteLength(pending, "utf8") > MAX_LINE_BYTES) {
        this.#protocolFailure(child, new Error(`Codex App Server 单行超过 ${MAX_LINE_BYTES} bytes`));
        return;
      }
      if (flush && pending) {
        const line = pending.replace(/\r$/u, "");
        pending = "";
        this.#acceptLine(child, line);
      }
    };
    child.stdout.on("data", (value: Buffer | string) => {
      if (child !== this.#child) return;
      pending += decoder.write(Buffer.isBuffer(value) ? value : Buffer.from(value));
      consume(false);
    });
    child.stdout.on("end", () => {
      if (child !== this.#child) return;
      pending += decoder.end();
      consume(true);
    });
    child.stderr.on("data", (value: Buffer | string) => {
      if (child !== this.#child) return;
      this.#stderrTail = boundedTail(this.#stderrTail, Buffer.isBuffer(value) ? value : Buffer.from(value));
    });
    child.once("error", (cause) => this.#handleExit(child, cause));
    child.once("close", (code, signal) => {
      const detail = this.#stderrTail.trim();
      this.#handleExit(child, new Error(detail || `Codex App Server 已退出（code=${String(code)}, signal=${String(signal)}）`));
    });
  }

  #acceptLine(child: ChildProcessWithoutNullStreams, line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (cause) {
      this.#protocolFailure(child, new Error(`Codex App Server 返回无效 JSON：${cause instanceof Error ? cause.message : String(cause)}`));
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = record(value, "Codex App Server message");
    } catch (cause) {
      this.#protocolFailure(child, cause instanceof Error ? cause : new Error(String(cause)));
      return;
    }
    if ((typeof message.id === "number" || typeof message.id === "string") && ("result" in message || "error" in message)) {
      const id = typeof message.id === "number" ? message.id : Number(message.id);
      const request = Number.isSafeInteger(id) ? this.#pending.get(id) : undefined;
      if (!request) return;
      this.#pending.delete(id);
      clearTimeout(request.timer);
      if (message.error !== undefined) request.reject(new Error(`Codex App Server ${request.method}: ${errorMessage(message.error)}`));
      else request.resolve(message.result);
      return;
    }
    if (typeof message.method === "string" && message.id === undefined) {
      const notification = Object.freeze({ method: message.method, params: message.params });
      for (const listener of this.#notificationListeners) listener(notification);
      return;
    }
    if (typeof message.method === "string" && message.id !== undefined) {
      this.#write({
        id: message.id,
        error: { code: -32601, message: `Stella 不处理 App Server 请求 ${message.method}` },
      });
    }
  }

  #protocolFailure(child: ChildProcessWithoutNullStreams, cause: Error): void {
    if (child !== this.#child) return;
    this.#stop(cause);
  }

  #handleExit(child: ChildProcessWithoutNullStreams, cause: Error): void {
    if (child !== this.#child) return;
    this.#child = undefined;
    this.#activeConfigurationKey = undefined;
    this.#rejectPending(cause);
  }

  #stop(cause: Error): void {
    const child = this.#child;
    this.#child = undefined;
    this.#activeConfigurationKey = undefined;
    this.#rejectPending(cause);
    if (!child) return;
    try { child.stdin.end(); } catch { /* best effort */ }
    try { child.kill("SIGTERM"); } catch { /* best effort */ }
  }

  #rejectPending(cause: Error): void {
    for (const request of this.#pending.values()) {
      clearTimeout(request.timer);
      request.reject(cause);
    }
    this.#pending.clear();
  }
}
