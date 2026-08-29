import {
  parseCompanionPairingUri,
  type CompanionCommand,
  type CompanionCommandPreview,
  type CompanionCommandResult,
  type CompanionExternalExecutionDetail,
  type CompanionExternalExecutionReference,
  type CompanionTaskDetail,
} from "../../../src/shared/companion-protocol";
import {
  CompanionWebSocketClient,
  parsePersistedCompanionHost,
  type CompanionClientState,
  type CompanionClientStorage,
  type PersistedCompanionHost,
} from "./companion-client";

export interface CompanionFleetStorage {
  get(): Promise<string | undefined>;
  set(value: string): Promise<void>;
}

export interface CompanionFleetHostState {
  readonly hostId: string;
  readonly state: CompanionClientState;
}

export interface CompanionFleetState {
  readonly hosts: readonly CompanionFleetHostState[];
  readonly selectedHostId?: string;
  readonly error?: string;
}

export interface CompanionHostClient {
  state(): CompanionClientState;
  subscribe(listener: (state: CompanionClientState) => void): () => void;
  start(): Promise<void>;
  pair(rawUri: string, deviceName: string): Promise<void>;
  forget(): Promise<void>;
  stop(): void;
  getTaskDetail(taskId: string): Promise<CompanionTaskDetail>;
  getExternalExecutionDetail(
    sourceId: CompanionExternalExecutionReference["sourceId"],
    externalId: string,
  ): Promise<CompanionExternalExecutionDetail>;
  previewCommand(command: CompanionCommand): Promise<CompanionCommandPreview>;
  executeCommand(command: CompanionCommand): Promise<CompanionCommandResult>;
}

interface CompanionHostFleetDependencies {
  readonly storage: CompanionFleetStorage;
  readonly client?: (storage: CompanionClientStorage, expectedHostId: string) => CompanionHostClient;
}

interface PersistedCompanionFleet {
  readonly revision: 2;
  readonly selectedHostId?: string;
  readonly hosts: readonly PersistedCompanionHost[];
}

interface HostSlot {
  readonly expectedHostId: string;
  readonly client: CompanionHostClient;
  unsubscribe: () => void;
  raw?: string;
  persisted?: PersistedCompanionHost;
  state: CompanionClientState;
}

const FLEET_STORAGE_REVISION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePersistedCompanionFleet(raw: string): PersistedCompanionFleet {
  const value = JSON.parse(raw) as unknown;
  if (isRecord(value) && value.revision === FLEET_STORAGE_REVISION) {
    if (!Array.isArray(value.hosts) || (value.selectedHostId !== undefined && typeof value.selectedHostId !== "string")) {
      throw new Error("保存的 Companion Host 列表无效");
    }
    const hosts = value.hosts.map((host) => parsePersistedCompanionHost(JSON.stringify(host)));
    const identities = new Set<string>();
    for (const host of hosts) {
      if (identities.has(host.host.id)) throw new Error(`保存的 Companion Host 重复: ${host.host.id}`);
      identities.add(host.host.id);
    }
    const selectedHostId = typeof value.selectedHostId === "string" && identities.has(value.selectedHostId)
      ? value.selectedHostId
      : hosts[0]?.host.id;
    return Object.freeze({
      revision: FLEET_STORAGE_REVISION,
      ...(selectedHostId ? { selectedHostId } : {}),
      hosts: Object.freeze(hosts),
    });
  }

  const legacy = parsePersistedCompanionHost(raw);
  return Object.freeze({
    revision: FLEET_STORAGE_REVISION,
    selectedHostId: legacy.host.id,
    hosts: Object.freeze([legacy]),
  });
}

/** Owns multi-host persistence, lifecycle, selection and exact command routing. */
export class CompanionHostFleet {
  readonly #storage: CompanionFleetStorage;
  readonly #clientFactory: (storage: CompanionClientStorage, expectedHostId: string) => CompanionHostClient;
  readonly #slots = new Map<string, HostSlot>();
  readonly #listeners = new Set<(state: CompanionFleetState) => void>();
  #selectedHostId: string | undefined;
  #error: string | undefined;
  #started = false;
  #loaded = false;
  #loadPromise: Promise<void> | undefined;
  #lifecycleGeneration = 0;
  #persistQueue: Promise<void> = Promise.resolve();

  constructor(dependencies: CompanionHostFleetDependencies) {
    this.#storage = dependencies.storage;
    this.#clientFactory = dependencies.client ?? ((storage) => new CompanionWebSocketClient({ storage }));
  }

  state(): CompanionFleetState {
    const hosts = Object.freeze([...this.#slots.entries()].map(([hostId, slot]) => Object.freeze({
      hostId,
      state: slot.state,
    })));
    return Object.freeze({
      hosts,
      ...(this.#selectedHostId ? { selectedHostId: this.#selectedHostId } : {}),
      ...(this.#error ? { error: this.#error } : {}),
    });
  }

  subscribe(listener: (state: CompanionFleetState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.state());
    return () => { this.#listeners.delete(listener); };
  }

  async start(): Promise<void> {
    if (this.#started) {
      await this.#load();
      return;
    }
    this.#started = true;
    const generation = ++this.#lifecycleGeneration;
    try {
      await this.#load();
    } catch (cause) {
      if (generation === this.#lifecycleGeneration) this.#started = false;
      throw cause;
    }
    if (!this.#started || generation !== this.#lifecycleGeneration) return;
    await Promise.all([...this.#slots.values()].map((slot) => slot.client.start()));
  }

  async pair(rawUri: string, deviceName: string): Promise<string> {
    const uri = parseCompanionPairingUri(rawUri);
    if (this.#slots.has(uri.hostId)) {
      throw new Error("该桌面已经配对；如需更换凭据，请先忘记该 Host");
    }
    this.#error = undefined;
    const slot = this.#createSlot(uri.hostId);
    this.#selectedHostId = uri.hostId;
    this.#emit();
    try {
      await slot.client.pair(rawUri, deviceName);
      if (this.#slots.get(uri.hostId) !== slot) throw new Error(this.#error ?? "配对未能启动");
      return uri.hostId;
    } catch (cause) {
      this.#discardPendingSlot(slot);
      throw cause;
    }
  }

  async select(hostId: string): Promise<void> {
    if (!this.#slots.has(hostId)) throw new Error(`未知 Companion Host: ${hostId}`);
    this.#selectedHostId = hostId;
    await this.#persist();
    this.#emit();
  }

  async forget(hostId: string): Promise<void> {
    const slot = this.#requiredSlot(hostId);
    await slot.client.forget();
  }

  getTaskDetail(hostId: string, taskId: string): Promise<CompanionTaskDetail> {
    return this.#requiredSlot(hostId).client.getTaskDetail(taskId);
  }

  getExternalExecutionDetail(
    hostId: string,
    sourceId: CompanionExternalExecutionReference["sourceId"],
    externalId: string,
  ): Promise<CompanionExternalExecutionDetail> {
    return this.#requiredSlot(hostId).client.getExternalExecutionDetail(sourceId, externalId);
  }

  previewCommand(hostId: string, command: CompanionCommand): Promise<CompanionCommandPreview> {
    return this.#requiredSlot(hostId).client.previewCommand(command);
  }

  executeCommand(hostId: string, command: CompanionCommand): Promise<CompanionCommandResult> {
    return this.#requiredSlot(hostId).client.executeCommand(command);
  }

  stop(): void {
    this.#started = false;
    this.#lifecycleGeneration += 1;
    for (const slot of this.#slots.values()) slot.client.stop();
  }

  #load(): Promise<void> {
    if (this.#loaded) return Promise.resolve();
    if (this.#loadPromise) return this.#loadPromise;
    const operation = (async () => {
      const raw = await this.#storage.get();
      if (raw) {
        const persisted = parsePersistedCompanionFleet(raw);
        this.#selectedHostId = persisted.selectedHostId;
        for (const host of persisted.hosts) {
          if (!this.#slots.has(host.host.id)) this.#createSlot(host.host.id, JSON.stringify(host));
        }
        await this.#persist();
      }
      this.#loaded = true;
      this.#emit();
    })();
    this.#loadPromise = operation;
    return operation.finally(() => {
      if (this.#loadPromise === operation) this.#loadPromise = undefined;
    });
  }

  #createSlot(expectedHostId: string, raw?: string): HostSlot {
    let slot: HostSlot;
    const clientStorage: CompanionClientStorage = Object.freeze({
      get: async () => slot.raw,
      set: async (value: string) => this.#saveSlot(slot, value),
      remove: async () => this.#removeSlot(slot),
    });
    const client = this.#clientFactory(clientStorage, expectedHostId);
    slot = {
      expectedHostId,
      client,
      unsubscribe: () => undefined,
      ...(raw ? { raw, persisted: parsePersistedCompanionHost(raw) } : {}),
      state: client.state(),
    };
    slot.unsubscribe = client.subscribe((state) => this.#acceptSlotState(slot, state));
    this.#slots.set(expectedHostId, slot);
    return slot;
  }

  #acceptSlotState(slot: HostSlot, state: CompanionClientState): void {
    slot.state = state;
    if (!slot.persisted && state.error && (state.connection === "unpaired" || state.connection === "incompatible" || state.connection === "offline")) {
      this.#error = state.error;
      this.#discardPendingSlot(slot);
      return;
    }
    this.#emit();
  }

  async #saveSlot(slot: HostSlot, raw: string): Promise<void> {
    const persisted = parsePersistedCompanionHost(raw);
    if (persisted.host.id !== slot.expectedHostId) throw new Error("配对桌面身份与 offer 不一致");
    slot.raw = raw;
    slot.persisted = persisted;
    this.#selectedHostId = persisted.host.id;
    this.#error = undefined;
    await this.#persist();
    this.#emit();
  }

  async #removeSlot(slot: HostSlot): Promise<void> {
    if (this.#slots.get(slot.expectedHostId) !== slot) return;
    slot.unsubscribe();
    this.#slots.delete(slot.expectedHostId);
    if (this.#selectedHostId === slot.expectedHostId) this.#selectedHostId = this.#firstPersistedHostId();
    await this.#persist();
    this.#emit();
  }

  #discardPendingSlot(slot: HostSlot): void {
    if (slot.persisted || this.#slots.get(slot.expectedHostId) !== slot) return;
    slot.unsubscribe();
    slot.client.stop();
    this.#slots.delete(slot.expectedHostId);
    if (this.#selectedHostId === slot.expectedHostId) this.#selectedHostId = this.#firstPersistedHostId();
    this.#emit();
  }

  #firstPersistedHostId(): string | undefined {
    return [...this.#slots.values()].find((candidate) => candidate.persisted)?.expectedHostId;
  }

  #requiredSlot(hostId: string): HostSlot {
    const slot = this.#slots.get(hostId);
    if (!slot?.persisted) throw new Error(`Companion Host 尚未完成配对: ${hostId}`);
    return slot;
  }

  #persist(): Promise<void> {
    const hosts = [...this.#slots.values()].flatMap((slot) => slot.persisted ? [slot.persisted] : []);
    const selectedHostId = this.#selectedHostId && hosts.some((host) => host.host.id === this.#selectedHostId)
      ? this.#selectedHostId
      : hosts[0]?.host.id;
    const value: PersistedCompanionFleet = Object.freeze({
      revision: FLEET_STORAGE_REVISION,
      ...(selectedHostId ? { selectedHostId } : {}),
      hosts: Object.freeze(hosts),
    });
    const raw = JSON.stringify(value);
    const persist = () => this.#storage.set(raw);
    const operation = this.#persistQueue.then(persist, persist);
    this.#persistQueue = operation.catch(() => undefined);
    return operation;
  }

  #emit(): void {
    const state = this.state();
    for (const listener of this.#listeners) listener(state);
  }
}
