import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  COMPANION_MAX_FRAME_BYTES,
  COMPANION_MINIMUM_PROTOCOL_VERSION,
  COMPANION_PROTOCOL_VERSION,
  companionProtocolCompatibility,
  formatCompanionPairingUri,
  parseCompanionClientFrame,
  type CompanionClientFrame,
  type CompanionDeviceSummary,
  type CompanionGatewayStatus,
  type CompanionHostSummary,
  type CompanionPairingOffer,
  type CompanionProjectedEvent,
  type CompanionServerErrorCode,
  type CompanionServerFrame,
} from "../shared/companion-protocol";
import type { MainCompanionControlPlane } from "./companion-control-plane";
import type { CompanionPairingStore } from "./companion-pairing-store";

interface CompanionGatewayDependencies {
  readonly controlPlane: MainCompanionControlPlane;
  readonly pairingStore: CompanionPairingStore;
  readonly host: CompanionHostSummary;
  readonly port?: number;
  readonly bindHost?: string;
  readonly publicAddresses?: () => readonly string[];
  readonly now?: () => string;
  readonly id?: () => string;
  readonly secret?: () => string;
  readonly offerTtlMs?: number;
  readonly emitChanged?: (status: CompanionGatewayStatus) => void;
}

interface PairingOfferRecord {
  readonly id: string;
  readonly secret: string;
  readonly expiresAt: string;
}

interface ConnectionContext {
  readonly socket: WebSocket;
  device?: CompanionDeviceSummary;
  unsubscribe?: () => void;
  queue: Promise<void>;
  ready: boolean;
  pendingEvents: CompanionProjectedEvent[];
}

function defaultPublicAddresses(): readonly string[] {
  const addresses = new Set<string>();
  for (const values of Object.values(networkInterfaces())) {
    for (const value of values ?? []) {
      if (value.family === "IPv4" && !value.internal) addresses.add(value.address);
    }
  }
  addresses.add("127.0.0.1");
  return Object.freeze([...addresses]);
}

function hostForUrl(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function companionPortFromEnvironment(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 43_821;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`STELLA_COMPANION_PORT 必须是 1-65535 的整数，实际为 ${value}`);
  }
  return parsed;
}

export class CompanionGateway {
  readonly #controlPlane: MainCompanionControlPlane;
  readonly #pairingStore: CompanionPairingStore;
  readonly #host: CompanionHostSummary;
  readonly #configuredPort: number;
  readonly #bindHost: string;
  readonly #publicAddresses: () => readonly string[];
  readonly #now: () => string;
  readonly #id: () => string;
  readonly #secret: () => string;
  readonly #offerTtlMs: number;
  readonly #emitChanged: (status: CompanionGatewayStatus) => void;
  readonly #offers = new Map<string, PairingOfferRecord>();
  readonly #connections = new Set<ConnectionContext>();
  readonly #deviceConnections = new Map<string, Set<ConnectionContext>>();
  #server: WebSocketServer | undefined;
  #state: CompanionGatewayStatus["state"] = "stopped";
  #port: number | undefined;
  #error: string | undefined;

  constructor(dependencies: CompanionGatewayDependencies) {
    this.#controlPlane = dependencies.controlPlane;
    this.#pairingStore = dependencies.pairingStore;
    this.#host = Object.freeze({ ...dependencies.host });
    this.#configuredPort = dependencies.port ?? 43_821;
    this.#bindHost = dependencies.bindHost ?? "0.0.0.0";
    this.#publicAddresses = dependencies.publicAddresses ?? defaultPublicAddresses;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#id = dependencies.id ?? randomUUID;
    this.#secret = dependencies.secret ?? (() => randomBytes(32).toString("base64url"));
    this.#offerTtlMs = dependencies.offerTtlMs ?? 5 * 60_000;
    this.#emitChanged = dependencies.emitChanged ?? (() => undefined);
  }

  async start(): Promise<CompanionGatewayStatus> {
    if (this.#server) return this.status();
    const server = new WebSocketServer({
      host: this.#bindHost,
      port: this.#configuredPort,
      maxPayload: COMPANION_MAX_FRAME_BYTES,
      perMessageDeflate: false,
    });
    this.#server = server;
    server.on("connection", (socket, request) => {
      if (request.url !== "/companion") {
        socket.close(1008, "Unknown Companion endpoint");
        return;
      }
      this.#accept(socket);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const onListening = () => { cleanup(); resolve(); };
        const onError = (cause: Error) => { cleanup(); reject(cause); };
        const cleanup = () => {
          server.off("listening", onListening);
          server.off("error", onError);
        };
        server.once("listening", onListening);
        server.once("error", onError);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Companion Gateway 未返回监听端口");
      this.#port = address.port;
      this.#state = "listening";
      this.#error = undefined;
      const status = await this.status();
      this.#emitChanged(status);
      return status;
    } catch (cause) {
      this.#state = "error";
      this.#error = errorMessage(cause);
      this.#server = undefined;
      try { server.close(); } catch { /* listener never became active */ }
      const status = await this.status();
      this.#emitChanged(status);
      throw cause;
    }
  }

  async stop(): Promise<CompanionGatewayStatus> {
    const server = this.#server;
    this.#server = undefined;
    this.#offers.clear();
    for (const connection of [...this.#connections]) connection.socket.close(1001, "Stella is shutting down");
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    this.#connections.clear();
    this.#deviceConnections.clear();
    this.#port = undefined;
    this.#state = "stopped";
    this.#error = undefined;
    const status = await this.status();
    this.#emitChanged(status);
    return status;
  }

  async status(): Promise<CompanionGatewayStatus> {
    const connected = new Set([...this.#deviceConnections.entries()].filter(([, values]) => values.size > 0).map(([id]) => id));
    const devices = Object.freeze((await this.#pairingStore.devices()).map((device) => Object.freeze({
      ...device,
      connected: connected.has(device.id),
    })));
    return Object.freeze({
      state: this.#state,
      host: this.#host,
      ...(this.#port !== undefined ? { port: this.#port } : {}),
      connectionUrls: this.#connectionUrls(),
      devices,
      ...(this.#error ? { error: this.#error } : {}),
    });
  }

  async createPairingOffer(): Promise<CompanionPairingOffer> {
    if (this.#state !== "listening" || this.#port === undefined) throw new Error("Companion Gateway 尚未监听");
    this.#pruneOffers();
    const record = Object.freeze({
      id: this.#id(),
      secret: this.#secret(),
      expiresAt: new Date(Date.parse(this.#now()) + this.#offerTtlMs).toISOString(),
    });
    this.#offers.set(record.id, record);
    const connectionUrls = this.#connectionUrls();
    const endpoint = connectionUrls[0];
    if (!endpoint) throw new Error("Companion Gateway 没有可用连接地址");
    return Object.freeze({
      id: record.id,
      host: this.#host,
      pairingUri: formatCompanionPairingUri({
        endpoint,
        offerId: record.id,
        offerSecret: record.secret,
        hostId: this.#host.id,
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
      }),
      connectionUrls,
      expiresAt: record.expiresAt,
    });
  }

  async revokeDevice(deviceId: string): Promise<CompanionGatewayStatus> {
    await this.#pairingStore.revoke(deviceId);
    for (const connection of [...(this.#deviceConnections.get(deviceId) ?? [])]) {
      connection.socket.close(4003, "Companion device revoked");
    }
    this.#deviceConnections.delete(deviceId);
    const status = await this.status();
    this.#emitChanged(status);
    return status;
  }

  #connectionUrls(): readonly string[] {
    if (this.#port === undefined) return Object.freeze([]);
    return Object.freeze(this.#publicAddresses().map((address) => `ws://${hostForUrl(address)}:${this.#port}/companion`));
  }

  #pruneOffers(): void {
    const now = Date.parse(this.#now());
    for (const [id, offer] of this.#offers) {
      if (Date.parse(offer.expiresAt) <= now) this.#offers.delete(id);
    }
  }

  #accept(socket: WebSocket): void {
    const context: ConnectionContext = {
      socket,
      queue: Promise.resolve(),
      ready: false,
      pendingEvents: [],
    };
    this.#connections.add(context);
    socket.on("message", (data, isBinary) => {
      context.queue = context.queue
        .then(() => this.#message(context, data, isBinary))
        .catch((cause) => this.#closeWithError(context, "request-failed", errorMessage(cause)));
    });
    socket.on("error", () => {
      // ws also emits close; the failure remains local to this connection.
    });
    socket.on("close", () => this.#removeConnection(context));
  }

  async #message(context: ConnectionContext, raw: RawData, isBinary: boolean): Promise<void> {
    if (isBinary) {
      this.#closeWithError(context, "malformed-frame", "Companion 只接受 JSON 文本 frame");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      this.#closeWithError(context, "malformed-frame", "Companion frame 不是有效 JSON");
      return;
    }
    let frame: CompanionClientFrame;
    try {
      frame = parseCompanionClientFrame(parsed);
    } catch (cause) {
      this.#closeWithError(context, "malformed-frame", errorMessage(cause));
      return;
    }
    if (frame.type === "pair") {
      await this.#pair(context, frame);
      return;
    }
    if (frame.type === "authenticate") {
      await this.#authenticate(context, frame);
      return;
    }
    if (!context.device || !context.ready) {
      this.#send(context, { type: "error", requestId: frame.requestId, code: "not-authenticated", message: "Companion 尚未认证", recoverable: false });
      return;
    }
    if (frame.type === "get-snapshot") {
      const snapshot = await this.#controlPlane.getSnapshot();
      this.#send(context, {
        type: "snapshot",
        requestId: frame.requestId,
        event: Object.freeze({
          type: "snapshot",
          protocolVersion: snapshot.protocolVersion,
          sequence: snapshot.sequence,
          capturedAt: snapshot.capturedAt,
          snapshot,
        }),
      });
      return;
    }
    if (frame.type === "get-task-detail") {
      try {
        this.#send(context, { type: "task-detail", requestId: frame.requestId, detail: await this.#controlPlane.getTaskDetail(frame.taskId) });
      } catch (cause) {
        this.#send(context, { type: "error", requestId: frame.requestId, code: "task-not-found", message: errorMessage(cause), recoverable: true });
      }
      return;
    }
    if (frame.type === "preview-command") {
      try {
        this.#send(context, {
          type: "command-preview",
          requestId: frame.requestId,
          preview: await this.#controlPlane.previewCommand(context.device.id, frame.command),
        });
      } catch (cause) {
        this.#send(context, {
          type: "error",
          requestId: frame.requestId,
          code: "command-preview-failed",
          message: errorMessage(cause),
          recoverable: true,
        });
      }
      return;
    }
    if (frame.type === "execute-command") {
      try {
        this.#send(context, {
          type: "command-result",
          requestId: frame.requestId,
          result: await this.#controlPlane.executeCommand(context.device.id, frame.command),
        });
      } catch (cause) {
        this.#send(context, {
          type: "error",
          requestId: frame.requestId,
          code: "request-failed",
          message: errorMessage(cause),
          recoverable: true,
        });
      }
      return;
    }
    this.#send(context, { type: "pong", requestId: frame.requestId, capturedAt: this.#now() });
  }

  async #pair(context: ConnectionContext, frame: Extract<CompanionClientFrame, { readonly type: "pair" }>): Promise<void> {
    if (!this.#compatible(context, frame)) return;
    this.#pruneOffers();
    const offer = this.#offers.get(frame.offerId);
    this.#offers.delete(frame.offerId);
    if (!offer || Date.parse(offer.expiresAt) <= Date.parse(this.#now()) || !safeEqual(offer.secret, frame.offerSecret)) {
      this.#closeWithError(context, "pairing-invalid", "配对 offer 无效、已过期或已使用");
      return;
    }
    const paired = await this.#pairingStore.pairDevice(frame.deviceName);
    const device = Object.freeze({ ...paired.device, connected: true });
    this.#send(context, {
      type: "paired",
      requestId: frame.requestId,
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
      host: this.#host,
      device,
      credential: paired.credential,
    });
    await this.#activate(context, frame.requestId, device);
  }

  async #authenticate(
    context: ConnectionContext,
    frame: Extract<CompanionClientFrame, { readonly type: "authenticate" }>,
  ): Promise<void> {
    if (!this.#compatible(context, frame)) return;
    const authenticated = await this.#pairingStore.authenticate(frame.deviceId, frame.credential);
    if (!authenticated) {
      this.#closeWithError(context, "authentication-failed", "Companion 设备身份无效或已撤销");
      return;
    }
    await this.#activate(context, frame.requestId, Object.freeze({ ...authenticated, connected: true }));
  }

  #compatible(
    context: ConnectionContext,
    frame: { readonly requestId: string; readonly protocolVersion: number; readonly minimumProtocolVersion: number },
  ): boolean {
    const compatibility = companionProtocolCompatibility(frame.protocolVersion, frame.minimumProtocolVersion);
    if (compatibility.compatible) return true;
    this.#send(context, {
      type: "error",
      requestId: frame.requestId,
      code: "protocol-incompatible",
      message: `协议不兼容：Desktop ${COMPANION_PROTOCOL_VERSION}（最低 ${COMPANION_MINIMUM_PROTOCOL_VERSION}），Companion ${frame.protocolVersion}（最低 ${frame.minimumProtocolVersion}）`,
      recoverable: false,
    });
    context.socket.close(4002, "Companion protocol incompatible");
    return false;
  }

  async #activate(context: ConnectionContext, requestId: string, device: CompanionDeviceSummary): Promise<void> {
    if (context.device) {
      this.#closeWithError(context, "authentication-failed", "Companion 连接已经认证");
      return;
    }
    context.device = device;
    const connections = this.#deviceConnections.get(device.id) ?? new Set<ConnectionContext>();
    connections.add(context);
    this.#deviceConnections.set(device.id, connections);
    context.unsubscribe = this.#controlPlane.subscribe((event) => {
      if (!context.ready) {
        context.pendingEvents.push(event);
        return;
      }
      this.#send(context, { type: "snapshot", event });
    });
    const snapshot = await this.#controlPlane.getSnapshot();
    this.#send(context, {
      type: "ready",
      requestId,
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
      host: this.#host,
      device,
      snapshot,
    });
    context.ready = true;
    for (const event of context.pendingEvents) {
      if (event.sequence > snapshot.sequence) this.#send(context, { type: "snapshot", event });
    }
    context.pendingEvents.length = 0;
    void this.#publishStatus();
  }

  #send(context: ConnectionContext, frame: CompanionServerFrame): void {
    if (context.socket.readyState !== WebSocket.OPEN) return;
    const serialized = JSON.stringify(frame);
    if (Buffer.byteLength(serialized, "utf8") > COMPANION_MAX_FRAME_BYTES) {
      throw new Error("Companion projected frame 超过上限");
    }
    context.socket.send(serialized);
  }

  #closeWithError(context: ConnectionContext, code: CompanionServerErrorCode, message: string): void {
    try {
      this.#send(context, { type: "error", code, message, recoverable: false });
    } finally {
      context.socket.close(1008, code);
    }
  }

  #removeConnection(context: ConnectionContext): void {
    context.unsubscribe?.();
    this.#connections.delete(context);
    if (context.device) {
      const values = this.#deviceConnections.get(context.device.id);
      values?.delete(context);
      if (values?.size === 0) this.#deviceConnections.delete(context.device.id);
    }
    void this.#publishStatus();
  }

  async #publishStatus(): Promise<void> {
    try {
      this.#emitChanged(await this.status());
    } catch {
      // Status reporting must not affect active connections.
    }
  }
}
