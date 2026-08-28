import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseCompanionServerFrame, type CompanionCommandResult } from "../shared/companion-protocol";

const STORE_REVISION = 1;

export interface CompanionStoredCommandReceipt {
  readonly deviceId: string;
  readonly idempotencyKey: string;
  readonly commandDigest: string;
  readonly result: CompanionCommandResult;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

interface ReceiptFile {
  readonly revision: typeof STORE_REVISION;
  readonly receipts: readonly CompanionStoredCommandReceipt[];
}

interface CompanionCommandReceiptStoreOptions {
  readonly now?: () => string;
  readonly ttlMs?: number;
  readonly limit?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReceipt(value: unknown): CompanionStoredCommandReceipt {
  if (!isRecord(value)
    || typeof value.deviceId !== "string"
    || typeof value.idempotencyKey !== "string"
    || typeof value.commandDigest !== "string"
    || typeof value.updatedAt !== "string"
    || typeof value.expiresAt !== "string") {
    throw new Error("Companion command receipt 无效");
  }
  const frame = parseCompanionServerFrame({
    type: "command-result",
    requestId: "receipt-validation",
    result: value.result,
  });
  if (frame.type !== "command-result") throw new Error("Companion command receipt result 无效");
  return Object.freeze({
    deviceId: value.deviceId,
    idempotencyKey: value.idempotencyKey,
    commandDigest: value.commandDigest,
    result: frame.result,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
  });
}

function parseFile(value: unknown): ReceiptFile {
  if (!isRecord(value) || value.revision !== STORE_REVISION || !Array.isArray(value.receipts)) {
    throw new Error("Companion command receipt 文件无效");
  }
  return Object.freeze({ revision: STORE_REVISION, receipts: Object.freeze(value.receipts.map(parseReceipt)) });
}

function key(deviceId: string, idempotencyKey: string): string {
  return `${deviceId}\u0000${idempotencyKey}`;
}

export class CompanionCommandReceiptStore {
  readonly #path: string;
  readonly #now: () => string;
  readonly #ttlMs: number;
  readonly #limit: number;
  #receipts = new Map<string, CompanionStoredCommandReceipt>();
  #initialized = false;

  constructor(path: string, options: CompanionCommandReceiptStoreOptions = {}) {
    this.#path = path;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60_000;
    this.#limit = options.limit ?? 1_000;
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    try {
      const parsed = parseFile(JSON.parse(await readFile(this.#path, "utf8")) as unknown);
      this.#receipts = new Map(parsed.receipts.map((receipt) => [key(receipt.deviceId, receipt.idempotencyKey), receipt]));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    this.#initialized = true;
    this.#prune();
  }

  get(deviceId: string, idempotencyKey: string): CompanionStoredCommandReceipt | undefined {
    this.#assertInitialized();
    this.#prune();
    return this.#receipts.get(key(deviceId, idempotencyKey));
  }

  async remember(
    deviceId: string,
    idempotencyKey: string,
    commandDigest: string,
    result: CompanionCommandResult,
  ): Promise<CompanionStoredCommandReceipt> {
    this.#assertInitialized();
    const updatedAt = this.#now();
    const receipt = Object.freeze({
      deviceId,
      idempotencyKey,
      commandDigest,
      result,
      updatedAt,
      expiresAt: new Date(Date.parse(updatedAt) + this.#ttlMs).toISOString(),
    });
    this.#receipts.set(key(deviceId, idempotencyKey), receipt);
    this.#prune();
    await this.#write();
    return receipt;
  }

  #prune(): void {
    const now = Date.parse(this.#now());
    for (const [receiptKey, receipt] of this.#receipts) {
      if (Date.parse(receipt.expiresAt) <= now) this.#receipts.delete(receiptKey);
    }
    const ordered = [...this.#receipts.entries()].sort((left, right) => {
      const byTime = Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt);
      return byTime !== 0 ? byTime : left[0].localeCompare(right[0]);
    });
    for (const [receiptKey] of ordered.slice(this.#limit)) this.#receipts.delete(receiptKey);
  }

  async #write(): Promise<void> {
    const file: ReceiptFile = Object.freeze({
      revision: STORE_REVISION,
      receipts: Object.freeze([...this.#receipts.values()].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))),
    });
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.#path);
  }

  #assertInitialized(): void {
    if (!this.#initialized) throw new Error("Companion command receipt store 尚未初始化");
  }
}
