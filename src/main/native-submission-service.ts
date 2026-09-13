import { createHash } from "node:crypto";
import type { PiResponse } from "../shared/contracts";
import type { NativeSubmissionInput, NativeSubmissionReceipt, NativeSubmissionResult, NativeTurnCommand } from "../shared/native-submission";
import type { RuntimeScope } from "../shared/runtime-scope";
import type { JsonFileStorage } from "./atomic-json-file";
import { PiCommandRejectedError } from "./pi-rpc-runtime";

interface StoredReceipt extends NativeSubmissionReceipt { readonly digest: string }
interface Journal { readonly version: 1; readonly receipts: readonly StoredReceipt[] }
interface Dependencies {
  readonly storage: JsonFileStorage;
  readonly now: () => string;
  readonly scope: () => RuntimeScope | undefined;
  readonly send: (command: NativeTurnCommand, cwd: string, requestId: string) => Promise<PiResponse>;
}

function parseJournal(value: unknown): Journal {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) {
    throw new Error("原生提交回执版本不兼容；保留原文件，请使用匹配的 Stella 版本");
  }
  if (!("receipts" in value) || !Array.isArray(value.receipts)) throw new Error("原生提交回执文件格式无效");
  const ids = new Set<string>();
  for (const receipt of value.receipts) {
    if (!receipt || typeof receipt !== "object"
      || !["id", "sessionId", "cwd", "generation", "createdAt", "updatedAt", "digest"].every((key) => typeof receipt[key] === "string" && receipt[key].length > 0)
      || !["prompt", "steer", "follow_up"].includes(receipt.command)
      || !["pending", "accepted", "rejected", "unknown"].includes(receipt.status)
      || (receipt.sessionFile !== undefined && typeof receipt.sessionFile !== "string")
      || (receipt.error !== undefined && typeof receipt.error !== "string")
      || ids.has(receipt.id)) throw new Error("原生提交回执内容无效或包含重复 ID");
    ids.add(receipt.id);
  }
  return value as Journal;
}

function publicReceipt({ digest: _digest, ...receipt }: StoredReceipt): NativeSubmissionReceipt { return Object.freeze(receipt); }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
function digestInput(input: NativeSubmissionInput): string {
  const command = input.command;
  return createHash("sha256").update(JSON.stringify({ sessionId: input.sessionId, type: command.type,
    message: command.message, images: command.images ?? [],
    streamingBehavior: command.type === "prompt" ? command.streamingBehavior : undefined })).digest("hex");
}

/** Owns GUI submission intent, not the Pi transcript or execution outcome. No implicit retry. */
export class NativeSubmissionService {
  readonly #deps: Dependencies;
  #journal: Journal = { version: 1, receipts: [] };
  #initialization?: Promise<void>;
  readonly #persistenceErrors = new Map<string, string>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(deps: Dependencies) { this.#deps = deps; }

  initialize(): Promise<void> {
    return this.#initialization ??= this.#initialize().catch((cause: unknown) => { this.#initialization = undefined; throw cause; });
  }

  async #initialize(): Promise<void> {
    const saved = await this.#deps.storage.read();
    if (saved === undefined) return;
    const journal = parseJournal(saved);
    const receipts = journal.receipts.map((receipt): StoredReceipt => receipt.status === "pending"
      ? { ...receipt, status: "unknown", updatedAt: this.#deps.now(), error: "上次退出前未保存 Pi 响应，执行结果未知。请核对会话；不会自动重发。" }
      : receipt);
    if (receipts.some((receipt, index) => receipt !== journal.receipts[index])) {
      await this.#deps.storage.write({ version: 1, receipts });
    }
    this.#journal = { version: 1, receipts };
  }

  async list(sessionId: string): Promise<readonly NativeSubmissionReceipt[]> {
    await this.initialize();
    return Object.freeze(this.#journal.receipts.filter((receipt) => receipt.sessionId === sessionId).map(publicReceipt).reverse());
  }

  submit(input: NativeSubmissionInput): Promise<NativeSubmissionResult> {
    const operation = this.#queue.then(() => this.#submit(input));
    this.#queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #commit(receipt: StoredReceipt): Promise<void> {
    const exists = this.#journal.receipts.some((item) => item.id === receipt.id);
    const receipts = exists ? this.#journal.receipts.map((item) => item.id === receipt.id ? receipt : item)
      : [...this.#journal.receipts, receipt];
    const next: Journal = { version: 1, receipts };
    await this.#deps.storage.write(next);
    this.#journal = next;
  }

  async #submit(input: NativeSubmissionInput): Promise<NativeSubmissionResult> {
    await this.initialize();
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(input.id) || !input.sessionId) throw new Error("提交 ID / Session ID 无效");
    const digest = digestInput(input);
    const existing = this.#journal.receipts.find((item) => item.id === input.id);
    if (existing) {
      if (existing.digest !== digest) throw new Error("同一提交 ID 不能用于不同的消息或会话");
      return { receipt: publicReceipt(existing), persistenceError: this.#persistenceErrors.get(existing.id) };
    }
    const scope = this.#deps.scope();
    if (!scope || scope.sessionId !== input.sessionId) throw new Error("会话已切换，消息未发送。请确认当前会话后重试。");
    const now = this.#deps.now();
    const pending: StoredReceipt = { id: input.id, digest, sessionId: input.sessionId,
      sessionFile: scope.sessionFile, cwd: scope.cwd, generation: scope.generation, command: input.command.type,
      status: "pending", createdAt: now, updatedAt: now };
    await this.#commit(pending);
    let result: StoredReceipt;
    try {
      const current = this.#deps.scope();
      if (!current || current.generation !== scope.generation || current.scope !== scope.scope || current.sessionId !== input.sessionId) {
        throw new PiCommandRejectedError("会话在提交落盘期间已切换，消息未发送");
      }
      const response = await this.#deps.send(input.command, scope.cwd, input.id);
      if (!response.success) throw new PiCommandRejectedError(response.error);
      result = { ...pending, status: "accepted", updatedAt: this.#deps.now() };
    } catch (cause) {
      result = { ...pending, status: cause instanceof PiCommandRejectedError ? "rejected" : "unknown",
        updatedAt: this.#deps.now(), error: message(cause) };
    }
    try { await this.#commit(result); }
    catch (cause) {
      // Retain the known outcome in memory to prevent duplicate execution in this process.
      this.#journal = { version: 1, receipts: this.#journal.receipts.map((receipt) => receipt.id === result.id ? result : receipt) };
      const persistenceError = `Pi 回执未能落盘：${message(cause)}。重启后会标为结果未知。`;
      this.#persistenceErrors.set(result.id, persistenceError);
      return { receipt: publicReceipt(result), persistenceError };
    }
    return { receipt: publicReceipt(result) };
  }
}
