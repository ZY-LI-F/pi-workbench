import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CompanionDeviceSummary, CompanionHostSummary } from "../shared/companion-protocol";

interface PersistedCompanionDevice {
  readonly id: string;
  readonly name: string;
  readonly credentialHash: string;
  readonly createdAt: string;
  readonly lastSeenAt?: string;
  readonly revokedAt?: string;
}

interface PersistedCompanionPairingState {
  readonly version: 1;
  readonly hostId: string;
  readonly hostName: string;
  readonly devices: readonly PersistedCompanionDevice[];
}

export interface PairedCompanionDevice {
  readonly device: CompanionDeviceSummary;
  readonly credential: string;
}

interface CompanionPairingStoreDependencies {
  readonly now?: () => string;
  readonly id?: () => string;
  readonly credential?: () => string;
}

function requiredText(value: unknown, label: string, limit = 240): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > limit) {
    throw new Error(`Companion pairing store ${label} 无效`);
  }
  return value;
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const timestamp = requiredText(value, label, 64);
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`Companion pairing store ${label} 无效`);
  return timestamp;
}

function parseDevice(value: unknown): PersistedCompanionDevice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Companion device 必须是对象");
  const record = value as Record<string, unknown>;
  const createdAt = optionalTimestamp(record.createdAt, "device.createdAt");
  if (!createdAt) throw new Error("Companion pairing store device.createdAt 无效");
  return Object.freeze({
    id: requiredText(record.id, "device.id"),
    name: requiredText(record.name, "device.name"),
    credentialHash: requiredText(record.credentialHash, "device.credentialHash"),
    createdAt,
    ...(optionalTimestamp(record.lastSeenAt, "device.lastSeenAt") ? { lastSeenAt: optionalTimestamp(record.lastSeenAt, "device.lastSeenAt") } : {}),
    ...(optionalTimestamp(record.revokedAt, "device.revokedAt") ? { revokedAt: optionalTimestamp(record.revokedAt, "device.revokedAt") } : {}),
  });
}

function parseState(contents: string, path: string): PersistedCompanionPairingState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (cause) {
    throw new Error(`无法解析 Companion 配对文件 ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`Companion 配对文件 ${path} 必须是对象`);
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.devices)) throw new Error(`Companion 配对文件 ${path} 版本无效`);
  const devices = Object.freeze(record.devices.map(parseDevice));
  if (new Set(devices.map((device) => device.id)).size !== devices.length) throw new Error(`Companion 配对文件 ${path} 包含重复设备`);
  return Object.freeze({
    version: 1,
    hostId: requiredText(record.hostId, "hostId"),
    hostName: requiredText(record.hostName, "hostName"),
    devices,
  });
}

function credentialHash(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}

function credentialMatches(credential: string, expectedHex: string): boolean {
  const actual = Buffer.from(credentialHash(credential), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function summary(device: PersistedCompanionDevice): CompanionDeviceSummary {
  return Object.freeze({
    id: device.id,
    name: device.name,
    createdAt: device.createdAt,
    ...(device.lastSeenAt ? { lastSeenAt: device.lastSeenAt } : {}),
    ...(device.revokedAt ? { revokedAt: device.revokedAt } : {}),
    connected: false,
  });
}

export class CompanionPairingStore {
  readonly #path: string;
  readonly #now: () => string;
  readonly #id: () => string;
  readonly #credential: () => string;
  #state: PersistedCompanionPairingState | undefined;
  #queue: Promise<void> = Promise.resolve();

  constructor(path: string, dependencies: CompanionPairingStoreDependencies = {}) {
    this.#path = path;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#id = dependencies.id ?? randomUUID;
    this.#credential = dependencies.credential ?? (() => randomBytes(32).toString("base64url"));
  }

  initialize(hostName: string): Promise<PersistedCompanionPairingState> {
    return this.#enqueue(async () => {
      if (this.#state) return this.#state;
      try {
        const loaded = parseState(await readFile(this.#path, "utf8"), this.#path);
        if (loaded.hostName === hostName) {
          this.#state = loaded;
          return loaded;
        }
        this.#state = Object.freeze({ ...loaded, hostName });
        await this.#write(this.#state);
        return this.#state;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        this.#state = Object.freeze({
          version: 1,
          hostId: this.#id(),
          hostName: requiredText(hostName, "hostName"),
          devices: Object.freeze([]),
        });
        await this.#write(this.#state);
        return this.#state;
      }
    });
  }

  async host(version: string): Promise<CompanionHostSummary> {
    const state = await this.#requiredState();
    return Object.freeze({ id: state.hostId, name: state.hostName, version });
  }

  async devices(): Promise<readonly CompanionDeviceSummary[]> {
    return Object.freeze((await this.#requiredState()).devices.map(summary));
  }

  pairDevice(name: string): Promise<PairedCompanionDevice> {
    return this.#enqueue(async () => {
      const state = await this.#requiredState();
      const credential = this.#credential();
      const device: PersistedCompanionDevice = Object.freeze({
        id: this.#id(),
        name: requiredText(name.trim(), "device.name", 80),
        credentialHash: credentialHash(credential),
        createdAt: this.#now(),
      });
      this.#state = Object.freeze({ ...state, devices: Object.freeze([...state.devices, device]) });
      await this.#write(this.#state);
      return Object.freeze({ device: summary(device), credential });
    });
  }

  authenticate(deviceId: string, credential: string): Promise<CompanionDeviceSummary | undefined> {
    return this.#enqueue(async () => {
      const state = await this.#requiredState();
      const device = state.devices.find((candidate) => candidate.id === deviceId);
      if (!device || device.revokedAt || !credentialMatches(credential, device.credentialHash)) return undefined;
      const lastSeenAt = this.#now();
      const updated = Object.freeze({ ...device, lastSeenAt });
      this.#state = Object.freeze({
        ...state,
        devices: Object.freeze(state.devices.map((candidate) => candidate.id === deviceId ? updated : candidate)),
      });
      await this.#write(this.#state);
      return summary(updated);
    });
  }

  revoke(deviceId: string): Promise<CompanionDeviceSummary> {
    return this.#enqueue(async () => {
      const state = await this.#requiredState();
      const device = state.devices.find((candidate) => candidate.id === deviceId);
      if (!device) throw new Error(`Companion 设备不存在: ${deviceId}`);
      if (device.revokedAt) return summary(device);
      const updated = Object.freeze({ ...device, revokedAt: this.#now() });
      this.#state = Object.freeze({
        ...state,
        devices: Object.freeze(state.devices.map((candidate) => candidate.id === deviceId ? updated : candidate)),
      });
      await this.#write(this.#state);
      return summary(updated);
    });
  }

  async #requiredState(): Promise<PersistedCompanionPairingState> {
    if (!this.#state) throw new Error("Companion pairing store 尚未初始化");
    return this.#state;
  }

  async #write(state: PersistedCompanionPairingState): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.#path);
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
