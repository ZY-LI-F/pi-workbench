import { describe, expect, it } from "vitest";
import {
  COMPANION_MINIMUM_PROTOCOL_VERSION,
  COMPANION_PROTOCOL_VERSION,
  formatCompanionPairingUri,
  type CompanionCommand,
  type CompanionCommandPreview,
  type CompanionCommandResult,
  type CompanionDeviceSummary,
  type CompanionExternalExecutionDetail,
  type CompanionExternalExecutionReference,
  type CompanionHostSummary,
  type CompanionSnapshot,
  type CompanionTaskDetail,
} from "../../../src/shared/companion-protocol";
import { parsePersistedCompanionHost, type CompanionClientState, type CompanionClientStorage } from "./companion-client";
import {
  CompanionHostFleet,
  parsePersistedCompanionFleet,
  type CompanionFleetStorage,
  type CompanionHostClient,
} from "./companion-host-fleet";

const NOW = "2026-08-29T10:00:00.000Z";
const MAC = Object.freeze({ id: "host-mac", name: "Studio Mac", version: "0.5.0" });
const WINDOWS = Object.freeze({ id: "host-windows", name: "Windows Workstation", version: "0.5.0" });
const DEVICE: CompanionDeviceSummary = Object.freeze({ id: "android-device", name: "Android", createdAt: NOW, connected: true });

function snapshot(host: CompanionHostSummary, sequence = 1): CompanionSnapshot {
  return Object.freeze({
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    sequence,
    capturedAt: NOW,
    host,
    freshness: Object.freeze({ state: "live", stale: false, capturedAt: NOW }),
    projects: Object.freeze([]),
    tasks: Object.freeze([]),
    agents: Object.freeze([]),
    attention: Object.freeze([]),
    recentTimeline: Object.freeze([]),
  });
}

function persisted(host: CompanionHostSummary, endpoint: string) {
  return Object.freeze({
    revision: 1 as const,
    endpoint,
    host,
    device: DEVICE,
    credential: `credential-${host.id}`,
    lastSnapshot: snapshot(host),
  });
}

function pairingUri(host: CompanionHostSummary, endpoint: string): string {
  return formatCompanionPairingUri({
    endpoint,
    offerId: `offer-${host.id}`,
    offerSecret: `secret-${host.id}`,
    hostId: host.id,
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
  });
}

class MemoryFleetStorage implements CompanionFleetStorage {
  value: string | undefined;
  writes = 0;
  async get() { return this.value; }
  async set(value: string) { this.value = value; this.writes += 1; }
}

class FakeHostClient implements CompanionHostClient {
  readonly #storage: CompanionClientStorage;
  readonly #expectedHostId: string;
  readonly #hostById: Readonly<Record<string, CompanionHostSummary>>;
  readonly #listeners = new Set<(state: CompanionClientState) => void>();
  #state: CompanionClientState = Object.freeze({ connection: "unpaired" });
  starts = 0;
  stops = 0;
  readonly commands: CompanionCommand[] = [];

  constructor(storage: CompanionClientStorage, expectedHostId: string, hostById: Readonly<Record<string, CompanionHostSummary>>) {
    this.#storage = storage;
    this.#expectedHostId = expectedHostId;
    this.#hostById = hostById;
  }

  state() { return this.#state; }

  subscribe(listener: (state: CompanionClientState) => void) {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => { this.#listeners.delete(listener); };
  }

  async start() {
    this.starts += 1;
    const raw = await this.#storage.get();
    if (!raw) return;
    const saved = parsePersistedCompanionHost(raw);
    this.#setState({ connection: "connecting", host: saved.host, snapshot: saved.lastSnapshot });
  }

  async pair(rawUri: string) {
    const host = this.#hostById[this.#expectedHostId];
    if (!host || !rawUri.includes("stella://pair")) throw new Error("Fake pairing host missing");
    this.#setState({ connection: "pairing" });
    const saved = persisted(host, `ws://${host.id}.tailnet.ts.net:43821/companion`);
    await this.#storage.set(JSON.stringify(saved));
    this.#setState({ connection: "online", host, snapshot: saved.lastSnapshot });
  }

  async forget() {
    await this.#storage.remove();
    this.#setState({ connection: "unpaired" });
  }

  stop() { this.stops += 1; }

  online() {
    const host = this.#hostById[this.#expectedHostId];
    if (!host) throw new Error("Fake host missing");
    this.#setState({ connection: "online", host, snapshot: snapshot(host, 2) });
  }

  getTaskDetail(_taskId: string): Promise<CompanionTaskDetail> { return Promise.reject(new Error("unused")); }
  getExternalExecutionDetail(
    _sourceId: CompanionExternalExecutionReference["sourceId"],
    _externalId: string,
  ): Promise<CompanionExternalExecutionDetail> { return Promise.reject(new Error("unused")); }
  previewCommand(_command: CompanionCommand): Promise<CompanionCommandPreview> { return Promise.reject(new Error("unused")); }
  async executeCommand(command: CompanionCommand): Promise<CompanionCommandResult> {
    this.commands.push(command);
    return Object.freeze({ idempotencyKey: command.idempotencyKey, status: "accepted", code: "accepted", message: "routed", completedAt: NOW });
  }

  #setState(state: CompanionClientState) {
    this.#state = Object.freeze(state);
    for (const listener of this.#listeners) listener(this.#state);
  }
}

describe("CompanionHostFleet", () => {
  it("migrates one v1 host and keeps Mac plus Windows connections active together", async () => {
    const storage = new MemoryFleetStorage();
    storage.value = JSON.stringify(persisted(MAC, "ws://mac.tailnet.ts.net:43821/companion"));
    const clients = new Map<string, FakeHostClient>();
    const fleet = new CompanionHostFleet({
      storage,
      client: (clientStorage, hostId) => {
        const client = new FakeHostClient(clientStorage, hostId, { [MAC.id]: MAC, [WINDOWS.id]: WINDOWS });
        clients.set(hostId, client);
        return client;
      },
    });

    await fleet.start();
    expect(clients.get(MAC.id)?.starts).toBe(1);
    expect(parsePersistedCompanionFleet(storage.value ?? "")).toMatchObject({ revision: 2, selectedHostId: MAC.id, hosts: [{ host: MAC }] });

    await fleet.pair(pairingUri(WINDOWS, "ws://windows.tailnet.ts.net:43821/companion"), "Android");
    clients.get(MAC.id)?.online();
    expect(fleet.state()).toMatchObject({
      selectedHostId: WINDOWS.id,
      hosts: [
        { hostId: MAC.id, state: { connection: "online", host: MAC } },
        { hostId: WINDOWS.id, state: { connection: "online", host: WINDOWS } },
      ],
    });
    expect(parsePersistedCompanionFleet(storage.value ?? "").hosts.map((host) => host.host.id)).toEqual([MAC.id, WINDOWS.id]);
  });

  it("routes a command to the exact Host and forgets only that Host", async () => {
    const storage = new MemoryFleetStorage();
    storage.value = JSON.stringify({
      revision: 2,
      selectedHostId: MAC.id,
      hosts: [
        persisted(MAC, "ws://mac.tailnet.ts.net:43821/companion"),
        persisted(WINDOWS, "ws://windows.tailnet.ts.net:43821/companion"),
      ],
    });
    const clients = new Map<string, FakeHostClient>();
    const fleet = new CompanionHostFleet({
      storage,
      client: (clientStorage, hostId) => {
        const client = new FakeHostClient(clientStorage, hostId, { [MAC.id]: MAC, [WINDOWS.id]: WINDOWS });
        clients.set(hostId, client);
        return client;
      },
    });
    await fleet.start();
    expect(clients.get(MAC.id)?.starts).toBe(1);
    expect(clients.get(WINDOWS.id)?.starts).toBe(1);
    const command = Object.freeze({ type: "add-task-message" as const, idempotencyKey: "windows-command", taskId: "task-1", body: "继续", dispatchMentions: true });

    await fleet.executeCommand(WINDOWS.id, command);
    expect(clients.get(MAC.id)?.commands).toEqual([]);
    expect(clients.get(WINDOWS.id)?.commands).toEqual([command]);

    await fleet.forget(MAC.id);
    expect(fleet.state()).toMatchObject({ selectedHostId: WINDOWS.id, hosts: [{ hostId: WINDOWS.id }] });
    expect(parsePersistedCompanionFleet(storage.value ?? "").hosts.map((host) => host.host.id)).toEqual([WINDOWS.id]);
  });

  it("rejects pairing the same desktop twice without disturbing its live connection", async () => {
    const storage = new MemoryFleetStorage();
    storage.value = JSON.stringify(persisted(MAC, "ws://mac.tailnet.ts.net:43821/companion"));
    const fleet = new CompanionHostFleet({
      storage,
      client: (clientStorage, hostId) => new FakeHostClient(clientStorage, hostId, { [MAC.id]: MAC }),
    });
    await fleet.start();

    await expect(fleet.pair(pairingUri(MAC, "ws://mac.tailnet.ts.net:43821/companion"), "Android"))
      .rejects.toThrow("已经配对");
    expect(fleet.state().hosts).toHaveLength(1);
    expect(fleet.state().selectedHostId).toBe(MAC.id);
  });

  it("survives a StrictMode-style stop and restart while Host storage is loading", async () => {
    let releaseLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => { releaseLoad = resolve; });
    let value = JSON.stringify(persisted(MAC, "ws://mac.tailnet.ts.net:43821/companion"));
    const clients = new Map<string, FakeHostClient>();
    const fleet = new CompanionHostFleet({
      storage: {
        async get() { await loadGate; return value; },
        async set(next) { value = next; },
      },
      client: (clientStorage, hostId) => {
        const client = new FakeHostClient(clientStorage, hostId, { [MAC.id]: MAC });
        clients.set(hostId, client);
        return client;
      },
    });

    const firstStart = fleet.start();
    fleet.stop();
    const secondStart = fleet.start();
    releaseLoad?.();
    await Promise.all([firstStart, secondStart]);

    expect(clients.get(MAC.id)?.starts).toBe(1);
    expect(fleet.state().hosts).toHaveLength(1);
  });
});
