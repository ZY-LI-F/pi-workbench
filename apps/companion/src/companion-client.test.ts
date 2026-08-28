import { describe, expect, it } from "vitest";
import {
  COMPANION_MINIMUM_PROTOCOL_VERSION,
  COMPANION_PROTOCOL_VERSION,
  formatCompanionPairingUri,
  type CompanionDeviceSummary,
  type CompanionHostSummary,
  type CompanionCommand,
  type CompanionServerFrame,
  type CompanionSnapshot,
} from "../../../src/shared/companion-protocol";
import { CompanionCommandIndeterminateError, CompanionWebSocketClient, type CompanionClientStorage } from "./companion-client";

const NOW = "2026-08-28T10:00:00.000Z";
const HOST: CompanionHostSummary = Object.freeze({ id: "host-1", name: "Studio Mac", version: "0.5.0" });
const DEVICE: CompanionDeviceSummary = Object.freeze({
  id: "device-1",
  name: "Pixel",
  createdAt: "2026-08-28T10:00:00.000Z",
  connected: true,
});

function snapshot(sequence: number, title = `Task ${sequence}`): CompanionSnapshot {
  const capturedAt = `2026-08-28T10:00:0${sequence}.000Z`;
  return Object.freeze({
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    sequence,
    capturedAt,
    host: HOST,
    freshness: Object.freeze({ state: "live", stale: false, capturedAt }),
    projects: Object.freeze([Object.freeze({ path: "/repo", name: "repo", taskCount: 1, attentionCount: 1, workingAgentCount: 0, updatedAt: capturedAt })]),
    tasks: Object.freeze([Object.freeze({ id: "task-1", title, priority: "high", stage: "running", projectPath: "/repo", projectName: "repo", attentionCount: 1, agentCount: 1, updatedAt: capturedAt })]),
    agents: Object.freeze([Object.freeze({
      id: "managed:agent-task:1",
      kind: "agent-task" as const,
      bucket: "attention" as const,
      state: Object.freeze({ domain: "agent-task" as const, value: "waiting_human" as const }),
      title: "Coordinator",
      taskTitle: title,
      projectPath: "/repo",
      taskId: "task-1",
      needsInput: true,
      attentionReason: "waiting-human" as const,
      updatedAt: capturedAt,
    })]),
    attention: Object.freeze([]),
    recentTimeline: Object.freeze([]),
  });
}

class MemoryStorage implements CompanionClientStorage {
  value: string | undefined;
  async get() { return this.value; }
  async set(value: string) { this.value = value; }
  async remove() { this.value = undefined; }
}

class FakeSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: string[] = [];

  open() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(frame: CompanionServerFrame | Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }

  send(data: string) { this.sent.push(data); }

  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }
}

function pairedFrame(): CompanionServerFrame {
  return Object.freeze({
    type: "paired",
    requestId: "android-1",
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
    host: HOST,
    device: DEVICE,
    credential: "credential-1",
  });
}

function readyFrame(value: CompanionSnapshot, requestId = "android-1"): CompanionServerFrame {
  return Object.freeze({
    type: "ready",
    requestId,
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
    host: HOST,
    device: DEVICE,
    snapshot: value,
  });
}

function eventFrame(value: CompanionSnapshot, requestId?: string): CompanionServerFrame {
  return Object.freeze({
    type: "snapshot",
    ...(requestId ? { requestId } : {}),
    event: Object.freeze({
      type: "snapshot",
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      sequence: value.sequence,
      capturedAt: value.capturedAt,
      snapshot: value,
    }),
  });
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CompanionWebSocketClient", () => {
  it("pairs, persists identity, replaces a sequence gap, and reconnects from last-good state", async () => {
    const storage = new MemoryStorage();
    const sockets: FakeSocket[] = [];
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const client = new CompanionWebSocketClient({
      storage,
      socket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (callback, delay) => { scheduled.push({ callback, delay }); return callback; },
      cancelScheduled: () => undefined,
    });
    const uri = formatCompanionPairingUri({
      endpoint: "ws://desktop.test:43821/companion",
      offerId: "offer-1",
      offerSecret: "offer-secret",
      hostId: HOST.id,
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
    });

    await client.pair(uri, "Pixel");
    const first = sockets[0];
    expect(first).toBeDefined();
    first?.open();
    expect(JSON.parse(first?.sent[0] ?? "{}")).toMatchObject({ type: "pair", offerId: "offer-1", deviceName: "Pixel" });
    first?.receive(pairedFrame());
    first?.receive(readyFrame(snapshot(1)));
    await flush();
    expect(client.state()).toMatchObject({ connection: "online", host: HOST, snapshot: { sequence: 1 } });
    expect(storage.value).toContain("credential-1");

    first?.receive(eventFrame(snapshot(2, "Second")));
    await flush();
    expect(client.state().snapshot?.tasks[0]?.title).toBe("Second");
    first?.receive(eventFrame(snapshot(4, "Gap event")));
    await flush();
    const gapRequest = JSON.parse(first?.sent.at(-1) ?? "{}") as { type?: string; requestId?: string };
    expect(gapRequest.type).toBe("get-snapshot");
    first?.receive(eventFrame(snapshot(4, "Replacement"), gapRequest.requestId));
    await flush();
    expect(client.state()).toMatchObject({ connection: "online", snapshot: { sequence: 4, tasks: [{ title: "Replacement" }] } });

    first?.close();
    expect(client.state()).toMatchObject({ connection: "reconnecting", snapshot: { freshness: { stale: true } } });
    expect(scheduled[0]?.delay).toBe(1_000);
    scheduled[0]?.callback();
    const second = sockets[1];
    second?.open();
    expect(JSON.parse(second?.sent[0] ?? "{}")).toMatchObject({ type: "authenticate", deviceId: DEVICE.id, credential: "credential-1" });
    second?.receive(readyFrame(snapshot(5, "Reconnected"), "android-3"));
    await flush();
    expect(client.state()).toMatchObject({ connection: "online", snapshot: { sequence: 5, freshness: { stale: false } } });
  });

  it("keeps last-good data stale and stops reconnecting after desktop revocation", async () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({ revision: 1, endpoint: "ws://desktop.test:43821/companion", host: HOST, device: DEVICE, credential: "credential-1", lastSnapshot: snapshot(7) });
    const sockets: FakeSocket[] = [];
    const scheduled: Array<() => void> = [];
    const client = new CompanionWebSocketClient({
      storage,
      socket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      schedule: (callback) => { scheduled.push(callback); return callback; },
      cancelScheduled: () => undefined,
    });
    await client.start();
    expect(client.state()).toMatchObject({ connection: "connecting", snapshot: { freshness: { stale: true } } });
    sockets[0]?.open();
    sockets[0]?.receive({ type: "error", requestId: "android-1", code: "authentication-failed", message: "revoked", recoverable: false });
    await flush();
    expect(client.state()).toMatchObject({ connection: "offline", snapshot: { sequence: 7, freshness: { stale: true } }, error: expect.stringContaining("撤销") });
    sockets[0]?.close();
    expect(scheduled).toHaveLength(0);
  });

  it("round-trips typed command previews/results and marks a lost reply indeterminate", async () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({ revision: 1, endpoint: "ws://desktop.test:43821/companion", host: HOST, device: DEVICE, credential: "credential-1", lastSnapshot: snapshot(1) });
    const socket = new FakeSocket();
    const client = new CompanionWebSocketClient({
      storage,
      socket: () => socket,
      schedule: () => 1,
      cancelScheduled: () => undefined,
    });
    await client.start();
    socket.open();
    socket.receive(readyFrame(snapshot(2)));
    await flush();
    const command: CompanionCommand = Object.freeze({
      type: "add-task-message",
      idempotencyKey: "command-1",
      taskId: "task-1",
      body: "继续",
      dispatchMentions: true,
    });

    const previewPromise = client.previewCommand(command);
    const previewRequest = JSON.parse(socket.sent.at(-1) ?? "{}") as { requestId: string };
    socket.receive({
      type: "command-preview",
      requestId: previewRequest.requestId,
      preview: { commandType: "add-task-message", effect: "resume-coordinator", summary: "恢复 Coordinator", destructive: false, requiresConfirmation: false },
    });
    await expect(previewPromise).resolves.toMatchObject({ effect: "resume-coordinator" });

    const resultPromise = client.executeCommand(command);
    const resultRequest = JSON.parse(socket.sent.at(-1) ?? "{}") as { requestId: string };
    socket.receive({
      type: "command-result",
      requestId: resultRequest.requestId,
      result: { idempotencyKey: command.idempotencyKey, status: "accepted", code: "accepted", message: "已恢复", completedAt: NOW },
    });
    await expect(resultPromise).resolves.toMatchObject({ status: "accepted" });

    const unknown = client.executeCommand({ ...command, idempotencyKey: "command-unknown" });
    socket.close();
    await expect(unknown).rejects.toMatchObject({
      name: CompanionCommandIndeterminateError.name,
      idempotencyKey: "command-unknown",
    });
  });
});
