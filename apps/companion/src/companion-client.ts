import {
  COMPANION_MINIMUM_PROTOCOL_VERSION,
  COMPANION_PROTOCOL_VERSION,
  companionProtocolCompatibility,
  parseCompanionPairingUri,
  parseCompanionServerFrame,
  type CompanionClientFrame,
  type CompanionDeviceSummary,
  type CompanionHostSummary,
  type CompanionPairingUri,
  type CompanionServerFrame,
  type CompanionSnapshot,
} from "../../../src/shared/companion-protocol";

export type CompanionConnectionState = "unpaired" | "pairing" | "connecting" | "reconnecting" | "online" | "offline" | "incompatible";

export interface CompanionClientState {
  readonly connection: CompanionConnectionState;
  readonly host?: CompanionHostSummary;
  readonly snapshot?: CompanionSnapshot;
  readonly error?: string;
}

export interface CompanionClientStorage {
  get(): Promise<string | undefined>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

interface PersistedCompanionHost {
  readonly revision: 1;
  readonly endpoint: string;
  readonly host: CompanionHostSummary;
  readonly device: CompanionDeviceSummary;
  readonly credential: string;
  readonly lastSnapshot?: CompanionSnapshot;
}

interface CompanionSocket {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface CompanionClientDependencies {
  readonly storage: CompanionClientStorage;
  readonly socket?: (endpoint: string) => CompanionSocket;
  readonly schedule?: (callback: () => void, delayMs: number) => unknown;
  readonly cancelScheduled?: (timer: unknown) => void;
}

interface PendingPairing {
  readonly uri: CompanionPairingUri;
  readonly deviceName: string;
}

const STORAGE_REVISION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePersistedHost(raw: string): PersistedCompanionHost {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value) || value.revision !== STORAGE_REVISION || typeof value.endpoint !== "string"
    || !isRecord(value.host) || typeof value.host.id !== "string" || typeof value.host.name !== "string" || typeof value.host.version !== "string"
    || !isRecord(value.device) || typeof value.device.id !== "string" || typeof value.device.name !== "string"
    || typeof value.credential !== "string") {
    throw new Error("保存的 Companion 主机无效");
  }
  let lastSnapshot: CompanionSnapshot | undefined;
  if (value.lastSnapshot !== undefined) {
    const frame = parseCompanionServerFrame({
      type: "ready",
      requestId: "storage-check",
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
      host: value.host,
      device: value.device,
      snapshot: value.lastSnapshot,
    });
    if (frame.type !== "ready") throw new Error("保存的 Companion snapshot 无效");
    lastSnapshot = frame.snapshot;
  }
  return Object.freeze({
    revision: 1,
    endpoint: value.endpoint,
    host: value.host as unknown as CompanionHostSummary,
    device: value.device as unknown as CompanionDeviceSummary,
    credential: value.credential,
    ...(lastSnapshot ? { lastSnapshot } : {}),
  });
}

function staleSnapshot(snapshot: CompanionSnapshot | undefined): CompanionSnapshot | undefined {
  if (!snapshot) return undefined;
  return Object.freeze({
    ...snapshot,
    freshness: Object.freeze({ ...snapshot.freshness, state: "stale", stale: true }),
  });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class CompanionWebSocketClient {
  readonly #storage: CompanionClientStorage;
  readonly #socketFactory: (endpoint: string) => CompanionSocket;
  readonly #schedule: (callback: () => void, delayMs: number) => unknown;
  readonly #cancelScheduled: (timer: unknown) => void;
  readonly #listeners = new Set<(state: CompanionClientState) => void>();
  #state: CompanionClientState = Object.freeze({ connection: "unpaired" });
  #saved: PersistedCompanionHost | undefined;
  #pendingPairing: PendingPairing | undefined;
  #socket: CompanionSocket | undefined;
  #generation = 0;
  #request = 0;
  #reconnectAttempt = 0;
  #reconnectTimer: unknown;
  #blocked = false;
  #stopped = false;
  #recoveringRequestId: string | undefined;

  constructor(dependencies: CompanionClientDependencies) {
    this.#storage = dependencies.storage;
    this.#socketFactory = dependencies.socket ?? ((endpoint) => new WebSocket(endpoint));
    this.#schedule = dependencies.schedule ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.#cancelScheduled = dependencies.cancelScheduled ?? ((timer) => window.clearTimeout(timer as number));
  }

  state(): CompanionClientState { return this.#state; }

  subscribe(listener: (state: CompanionClientState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => { this.#listeners.delete(listener); };
  }

  async start(): Promise<void> {
    this.#stopped = false;
    let raw: string | undefined;
    try {
      raw = await this.#storage.get();
      if (!raw) {
        this.#setState({ connection: "unpaired" });
        return;
      }
      this.#saved = parsePersistedHost(raw);
      this.#setState({ connection: "connecting", host: this.#saved.host, snapshot: staleSnapshot(this.#saved.lastSnapshot) });
      this.#connect(this.#saved.endpoint);
    } catch (cause) {
      this.#setState({ connection: "offline", error: errorMessage(cause) });
    }
  }

  async pair(rawUri: string, deviceName: string): Promise<void> {
    const uri = parseCompanionPairingUri(rawUri);
    const compatibility = companionProtocolCompatibility(uri.protocolVersion, uri.minimumProtocolVersion);
    if (!compatibility.compatible) {
      this.#blocked = true;
      this.#setState({ connection: "incompatible", error: "桌面与 Companion 协议版本不兼容" });
      return;
    }
    this.#disconnectSocket();
    this.#blocked = false;
    this.#stopped = false;
    this.#pendingPairing = Object.freeze({ uri, deviceName: deviceName.trim() || "Android Companion" });
    this.#setState({ connection: "pairing" });
    this.#connect(uri.endpoint);
  }

  async forget(): Promise<void> {
    this.#blocked = true;
    this.#disconnectSocket();
    this.#saved = undefined;
    this.#pendingPairing = undefined;
    await this.#storage.remove();
    this.#setState({ connection: "unpaired" });
  }

  stop(): void {
    this.#stopped = true;
    this.#disconnectSocket();
    this.#setState({
      connection: this.#saved ? "offline" : "unpaired",
      ...(this.#saved ? { host: this.#saved.host, snapshot: staleSnapshot(this.#saved.lastSnapshot) } : {}),
    });
  }

  #connect(endpoint: string): void {
    const generation = ++this.#generation;
    const socket = this.#socketFactory(endpoint);
    this.#socket = socket;
    let messageQueue: Promise<void> = Promise.resolve();
    socket.onopen = () => {
      if (generation !== this.#generation) return;
      const requestId = this.#requestId();
      const frame: CompanionClientFrame = this.#pendingPairing
        ? {
            type: "pair",
            requestId,
            protocolVersion: COMPANION_PROTOCOL_VERSION,
            minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
            offerId: this.#pendingPairing.uri.offerId,
            offerSecret: this.#pendingPairing.uri.offerSecret,
            deviceName: this.#pendingPairing.deviceName,
          }
        : {
            type: "authenticate",
            requestId,
            protocolVersion: COMPANION_PROTOCOL_VERSION,
            minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
            deviceId: this.#saved?.device.id ?? "missing",
            credential: this.#saved?.credential ?? "missing",
          };
      socket.send(JSON.stringify(frame));
    };
    socket.onmessage = (event) => {
      messageQueue = messageQueue
        .then(() => this.#handleMessage(generation, String(event.data)))
        .catch((cause) => this.#malformed(generation, errorMessage(cause)));
    };
    socket.onerror = () => {
      // close owns reconnect and stale-state transitions.
    };
    socket.onclose = () => {
      if (generation !== this.#generation) return;
      this.#socket = undefined;
      if (this.#stopped || this.#blocked) return;
      if (!this.#saved) {
        this.#setState({ connection: "unpaired", error: this.#state.error ?? "配对连接已关闭" });
        return;
      }
      this.#setState({
        connection: "reconnecting",
        host: this.#saved.host,
        snapshot: staleSnapshot(this.#saved.lastSnapshot),
        ...(this.#state.error ? { error: this.#state.error } : {}),
      });
      this.#scheduleReconnect();
    };
  }

  async #handleMessage(generation: number, raw: string): Promise<void> {
    if (generation !== this.#generation) return;
    const frame = parseCompanionServerFrame(JSON.parse(raw));
    if (frame.type === "error") {
      this.#handleServerError(frame);
      return;
    }
    if (frame.type === "paired") {
      const pending = this.#pendingPairing;
      if (!pending || frame.host.id !== pending.uri.hostId) throw new Error("桌面身份与配对 offer 不一致");
      if (!companionProtocolCompatibility(frame.protocolVersion, frame.minimumProtocolVersion).compatible) {
        this.#blocked = true;
        this.#setState({ connection: "incompatible", error: "桌面与 Companion 协议版本不兼容" });
        this.#socket?.close(4002, "protocol incompatible");
        return;
      }
      this.#saved = Object.freeze({
        revision: 1,
        endpoint: pending.uri.endpoint,
        host: frame.host,
        device: frame.device,
        credential: frame.credential,
      });
      await this.#persist();
      return;
    }
    if (frame.type === "ready") {
      if (!this.#saved || frame.host.id !== this.#saved.host.id || frame.device.id !== this.#saved.device.id) {
        throw new Error("Companion ready frame 身份不一致");
      }
      this.#pendingPairing = undefined;
      this.#reconnectAttempt = 0;
      this.#recoveringRequestId = undefined;
      this.#saved = Object.freeze({ ...this.#saved, host: frame.host, device: frame.device, lastSnapshot: frame.snapshot });
      await this.#persist();
      this.#setState({ connection: "online", host: frame.host, snapshot: frame.snapshot });
      return;
    }
    if (frame.type === "snapshot") {
      if (!this.#saved || this.#state.connection !== "online") return;
      const currentSequence = this.#state.snapshot?.sequence ?? 0;
      if (frame.requestId && frame.requestId === this.#recoveringRequestId) {
        this.#recoveringRequestId = undefined;
        await this.#acceptSnapshot(frame.event.snapshot);
        return;
      }
      if (frame.event.sequence <= currentSequence) return;
      if (frame.event.sequence !== currentSequence + 1) {
        if (!this.#recoveringRequestId) {
          this.#recoveringRequestId = this.#requestId();
          this.#send({ type: "get-snapshot", requestId: this.#recoveringRequestId });
        }
        return;
      }
      await this.#acceptSnapshot(frame.event.snapshot);
    }
  }

  async #acceptSnapshot(snapshot: CompanionSnapshot): Promise<void> {
    if (!this.#saved) return;
    this.#saved = Object.freeze({ ...this.#saved, lastSnapshot: snapshot });
    await this.#persist();
    this.#setState({ connection: "online", host: this.#saved.host, snapshot });
  }

  #handleServerError(frame: Extract<CompanionServerFrame, { readonly type: "error" }>): void {
    if (frame.code === "protocol-incompatible") {
      this.#blocked = true;
      this.#setState({ connection: "incompatible", host: this.#saved?.host, snapshot: staleSnapshot(this.#saved?.lastSnapshot), error: frame.message });
    } else if (frame.code === "authentication-failed") {
      this.#blocked = true;
      this.#setState({ connection: "offline", host: this.#saved?.host, snapshot: staleSnapshot(this.#saved?.lastSnapshot), error: "此设备已被撤销或身份无效，请重新配对。" });
    } else if (frame.code === "pairing-invalid") {
      this.#blocked = true;
      this.#pendingPairing = undefined;
      this.#setState({ connection: "unpaired", error: frame.message });
    } else {
      this.#setState({ ...this.#state, error: frame.message });
    }
  }

  #malformed(generation: number, message: string): void {
    if (generation !== this.#generation) return;
    this.#setState({ ...this.#state, error: `桌面返回了无效数据：${message}` });
    this.#socket?.close(1008, "malformed server frame");
  }

  #send(frame: CompanionClientFrame): void {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify(frame));
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer !== undefined || !this.#saved) return;
    const delay = Math.min(30_000, 1_000 * (2 ** this.#reconnectAttempt));
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = this.#schedule(() => {
      this.#reconnectTimer = undefined;
      if (!this.#saved || this.#stopped || this.#blocked) return;
      this.#connect(this.#saved.endpoint);
    }, delay);
  }

  #disconnectSocket(): void {
    this.#generation += 1;
    if (this.#reconnectTimer !== undefined) {
      this.#cancelScheduled(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close(1000, "Companion client reset");
  }

  #requestId(): string {
    this.#request += 1;
    return `android-${this.#request}`;
  }

  async #persist(): Promise<void> {
    if (this.#saved) await this.#storage.set(JSON.stringify(this.#saved));
  }

  #setState(value: Omit<CompanionClientState, "host" | "snapshot" | "error"> & Partial<Pick<CompanionClientState, "host" | "snapshot" | "error">>): void {
    this.#state = Object.freeze({ ...value });
    for (const listener of this.#listeners) listener(this.#state);
  }
}
