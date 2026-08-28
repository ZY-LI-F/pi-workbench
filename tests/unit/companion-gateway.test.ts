import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { MainCompanionControlPlane } from "../../src/main/companion-control-plane";
import { CompanionGateway } from "../../src/main/companion-gateway";
import { CompanionPairingStore } from "../../src/main/companion-pairing-store";
import type { BoardRepository } from "../../src/main/board-repository";
import {
  COMPANION_MINIMUM_PROTOCOL_VERSION,
  COMPANION_PROTOCOL_VERSION,
  parseCompanionPairingUri,
  type CompanionServerFrame,
} from "../../src/shared/companion-protocol";
import { BOARD_SCHEMA_VERSION, type BoardState } from "../../src/shared/kanban";
import { CompanionWebSocketClient, type CompanionClientStorage } from "../../apps/companion/src/companion-client";

const NOW = "2026-08-28T10:00:00.000Z";
const HOST = Object.freeze({ id: "host-1", name: "Test Desktop", version: "0.5.0" });

class MemoryBoardRepository implements BoardRepository {
  #board: BoardState;

  constructor(board: BoardState) {
    this.#board = board;
  }

  async read(): Promise<BoardState> { return this.#board; }

  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.#board = transform(this.#board);
    return this.#board;
  }
}

function board(title = "Initial Task"): BoardState {
  return Object.freeze({
    version: BOARD_SCHEMA_VERSION,
    tasks: Object.freeze([Object.freeze({
      id: "task-1",
      title,
      description: "",
      acceptanceCriteria: "",
      priority: "medium" as const,
      projectPath: "/repo",
      projectName: "repo",
      trusted: true,
      executionTarget: Object.freeze({ kind: "manual" as const }),
      executionWorkspace: Object.freeze({ strategy: "current-folder" as const }),
      stage: "planned" as const,
      specRevision: 1,
      createdAt: NOW,
      updatedAt: NOW,
    })]),
    runs: Object.freeze([]),
    activities: Object.freeze([]),
    comments: Object.freeze([]),
    agentTasks: Object.freeze([]),
    customAgents: Object.freeze([]),
    squads: Object.freeze([]),
    autopilots: Object.freeze([]),
    autopilotRuns: Object.freeze([]),
  });
}

class SocketInbox {
  readonly socket: WebSocket;
  readonly #messages: CompanionServerFrame[] = [];
  readonly #waiters: Array<(frame: CompanionServerFrame) => void> = [];

  constructor(endpoint: string) {
    this.socket = new WebSocket(endpoint);
    this.socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString()) as CompanionServerFrame;
      const waiter = this.#waiters.shift();
      if (waiter) waiter(frame);
      else this.#messages.push(frame);
    });
  }

  async open(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
  }

  next(): Promise<CompanionServerFrame> {
    const queued = this.#messages.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for Companion frame")), 3_000);
      this.#waiters.push((frame) => { clearTimeout(timeout); resolve(frame); });
    });
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.terminate();
  }
}

const temporaryDirectories: string[] = [];
const gateways: CompanionGateway[] = [];
const sockets: SocketInbox[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const gateway of gateways.splice(0)) await gateway.stop();
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "stella-companion-gateway-"));
  temporaryDirectories.push(directory);
  let identifier = 0;
  const pairingStore = new CompanionPairingStore(join(directory, "pairing.json"), {
    now: () => NOW,
    id: () => identifier++ === 0 ? HOST.id : `device-${identifier}`,
    credential: () => "device-credential",
  });
  await pairingStore.initialize(HOST.name);
  const repository = new MemoryBoardRepository(board());
  const controlPlane = new MainCompanionControlPlane({ repository, host: HOST, now: () => NOW });
  const gateway = new CompanionGateway({
    controlPlane,
    pairingStore,
    host: HOST,
    port: 0,
    bindHost: "127.0.0.1",
    publicAddresses: () => ["127.0.0.1"],
    now: () => NOW,
    id: () => "offer-1",
    secret: () => "offer-secret",
  });
  gateways.push(gateway);
  const status = await gateway.start();
  const endpoint = status.connectionUrls[0];
  if (!endpoint) throw new Error("Gateway test endpoint missing");
  return { gateway, pairingStore, repository, controlPlane, endpoint, directory };
}

function handshake(requestId: string) {
  return {
    requestId,
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
  } as const;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Companion client state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("CompanionGateway", () => {
  it("pairs once, persists a revocable device, authenticates, and streams real projections", async () => {
    const { gateway, repository, controlPlane, endpoint, directory } = await fixture();
    const offer = await gateway.createPairingOffer();
    expect(parseCompanionPairingUri(offer.pairingUri)).toMatchObject({ endpoint, offerId: "offer-1", hostId: HOST.id });

    const pairedSocket = new SocketInbox(endpoint);
    sockets.push(pairedSocket);
    await pairedSocket.open();
    pairedSocket.socket.send(JSON.stringify({
      type: "pair",
      ...handshake("pair-request"),
      offerId: "offer-1",
      offerSecret: "offer-secret",
      deviceName: "Pixel 9",
    }));
    const paired = await pairedSocket.next();
    const ready = await pairedSocket.next();
    expect(paired).toMatchObject({ type: "paired", credential: "device-credential", device: { name: "Pixel 9" } });
    expect(ready).toMatchObject({ type: "ready", snapshot: { tasks: [{ title: "Initial Task" }] } });
    if (paired.type !== "paired") throw new Error("Expected paired frame");

    const authenticatedSocket = new SocketInbox(endpoint);
    sockets.push(authenticatedSocket);
    await authenticatedSocket.open();
    authenticatedSocket.socket.send(JSON.stringify({
      type: "authenticate",
      ...handshake("auth-request"),
      deviceId: paired.device.id,
      credential: paired.credential,
    }));
    expect(await authenticatedSocket.next()).toMatchObject({ type: "ready", device: { id: paired.device.id } });

    const committed = await repository.update((current) => Object.freeze({
      ...current,
      tasks: Object.freeze(current.tasks.map((task) => Object.freeze({ ...task, title: "Committed Task" }))),
    }));
    await controlPlane.publishCommitted(committed);
    expect(await pairedSocket.next()).toMatchObject({ type: "snapshot", event: { snapshot: { tasks: [{ title: "Committed Task" }] } } });
    expect(await authenticatedSocket.next()).toMatchObject({ type: "snapshot", event: { snapshot: { tasks: [{ title: "Committed Task" }] } } });

    pairedSocket.socket.send("not json");
    expect(await pairedSocket.next()).toMatchObject({ type: "error", code: "malformed-frame" });
    authenticatedSocket.socket.send(JSON.stringify({ type: "ping", requestId: "ping-1" }));
    expect(await authenticatedSocket.next()).toMatchObject({ type: "pong", requestId: "ping-1" });

    await gateway.revokeDevice(paired.device.id);
    await new Promise<void>((resolve) => authenticatedSocket.socket.once("close", () => resolve()));
    const stored = JSON.parse(await readFile(join(directory, "pairing.json"), "utf8")) as { devices: Array<Record<string, unknown>> };
    expect(stored.devices[0]).not.toHaveProperty("credential");
    expect(stored.devices[0]?.credentialHash).not.toBe("device-credential");
    expect((await gateway.status()).devices[0]).toMatchObject({ id: paired.device.id, revokedAt: NOW, connected: false });

    const rejectedSocket = new SocketInbox(endpoint);
    sockets.push(rejectedSocket);
    await rejectedSocket.open();
    rejectedSocket.socket.send(JSON.stringify({
      type: "authenticate",
      ...handshake("revoked-auth"),
      deviceId: paired.device.id,
      credential: paired.credential,
    }));
    expect(await rejectedSocket.next()).toMatchObject({ type: "error", code: "authentication-failed" });
  });

  it("rejects incompatible peers without consuming a valid offer", async () => {
    const { gateway, endpoint } = await fixture();
    await gateway.createPairingOffer();
    const incompatible = new SocketInbox(endpoint);
    sockets.push(incompatible);
    await incompatible.open();
    incompatible.socket.send(JSON.stringify({
      type: "pair",
      requestId: "old-client",
      protocolVersion: 1,
      minimumProtocolVersion: 99,
      offerId: "offer-1",
      offerSecret: "offer-secret",
      deviceName: "Old Phone",
    }));

    expect(await incompatible.next()).toMatchObject({ type: "error", code: "protocol-incompatible" });

    const compatible = new SocketInbox(endpoint);
    sockets.push(compatible);
    await compatible.open();
    compatible.socket.send(JSON.stringify({
      type: "pair",
      ...handshake("current-client"),
      offerId: "offer-1",
      offerSecret: "offer-secret",
      deviceName: "Current Phone",
    }));
    expect(await compatible.next()).toMatchObject({ type: "paired", device: { name: "Current Phone" } });
    expect(await compatible.next()).toMatchObject({ type: "ready" });
  });

  it("drives the Android client against a real local WebSocket host", async () => {
    const { gateway, repository, controlPlane } = await fixture();
    const offer = await gateway.createPairingOffer();
    const storage: CompanionClientStorage & { value?: string } = {
      async get() { return this.value; },
      async set(value) { this.value = value; },
      async remove() { this.value = undefined; },
    };
    const client = new CompanionWebSocketClient({
      storage,
      socket: (endpoint) => new WebSocket(endpoint),
      schedule: () => 1,
      cancelScheduled: () => undefined,
    });
    await client.pair(offer.pairingUri, "Android integration client");
    await waitFor(() => client.state().connection === "online");
    expect(client.state()).toMatchObject({ snapshot: { tasks: [{ title: "Initial Task" }] } });

    const committed = await repository.update((current) => Object.freeze({
      ...current,
      tasks: Object.freeze(current.tasks.map((task) => Object.freeze({ ...task, title: "Live Android update" }))),
    }));
    await controlPlane.publishCommitted(committed);
    await waitFor(() => client.state().snapshot?.tasks[0]?.title === "Live Android update");
    expect(storage.value).toContain("Android integration client");
    client.stop();
  });
});
