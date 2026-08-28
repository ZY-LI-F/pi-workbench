import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MainCompanionControlPlane } from "../src/main/companion-control-plane";
import { CompanionGateway } from "../src/main/companion-gateway";
import { CompanionPairingStore } from "../src/main/companion-pairing-store";
import type { BoardRepository } from "../src/main/board-repository";
import { snapshotExecutionProfile } from "../src/shared/execution-profile";
import { BOARD_SCHEMA_VERSION, type AgentDefinition, type BoardState } from "../src/shared/kanban";

const hostAddress = process.env.STELLA_COMPANION_ACCEPTANCE_ADDRESS?.trim() || "10.0.2.2";
const port = Number(process.env.STELLA_COMPANION_ACCEPTANCE_PORT ?? "43822");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("STELLA_COMPANION_ACCEPTANCE_PORT 无效");

const AGENT: AgentDefinition = Object.freeze({
  id: "acceptance-coordinator",
  version: 1,
  name: "Acceptance Coordinator",
  callsign: "acceptance",
  responsibility: "Prove Android live updates",
  instructions: "Alternate attention and working states",
  workspaceAccess: "write",
  allowedTools: Object.freeze([]),
  thinking: "medium",
  disableExtensions: false,
  disableSkills: false,
  disablePromptTemplates: false,
  disableContextFiles: true,
});

function acceptanceBoard(status: "waiting_human" | "running", updatedAt: string): BoardState {
  const task = Object.freeze({
    id: "android-acceptance-task",
    title: "Android 实时状态验收",
    description: "由真实 Companion Gateway 推送状态",
    acceptanceCriteria: "Android 在 Attention 与 Working 之间实时切换",
    priority: "high" as const,
    projectPath: "/acceptance/stella",
    projectName: "pi-workbench",
    trusted: true,
    executionTarget: Object.freeze({ kind: "agent" as const, agentId: AGENT.id }),
    executionProfileId: "pi.rpc" as const,
    executionWorkspace: Object.freeze({ strategy: "current-folder" as const }),
    stage: "running" as const,
    specRevision: 1,
    activeAgentTaskId: "android-acceptance-agent",
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt,
  });
  return Object.freeze({
    version: BOARD_SCHEMA_VERSION,
    tasks: Object.freeze([task]),
    runs: Object.freeze([]),
    activities: Object.freeze([Object.freeze({
      id: `activity-${updatedAt}`,
      taskId: task.id,
      agentTaskId: "android-acceptance-agent",
      kind: "agent" as const,
      summary: status === "waiting_human" ? "等待 Android 回复" : "正在处理 Android 验收",
      createdAt: updatedAt,
    })]),
    comments: Object.freeze([]),
    agentTasks: Object.freeze([Object.freeze({
      id: "android-acceptance-agent",
      taskId: task.id,
      executionAttempt: 1,
      taskSpec: Object.freeze({ revision: 1, title: task.title, description: task.description, acceptanceCriteria: task.acceptanceCriteria, priority: task.priority, executionTarget: task.executionTarget, executionProfileId: "pi.rpc" as const }),
      executionProfile: snapshotExecutionProfile("pi.rpc"),
      agentSnapshot: AGENT,
      kind: "coordinator" as const,
      status,
      acceptance: "not-ready" as const,
      prompt: "Android acceptance",
      ...(status === "waiting_human" ? { output: "请选择下一步，确认手机已收到实时状态。" } : {}),
      createdAt: "2026-08-28T10:00:00.000Z",
      updatedAt,
    })]),
    customAgents: Object.freeze([]),
    squads: Object.freeze([]),
    autopilots: Object.freeze([]),
    autopilotRuns: Object.freeze([]),
  });
}

class MemoryRepository implements BoardRepository {
  #board = acceptanceBoard("waiting_human", new Date().toISOString());
  async read() { return this.#board; }
  async update(transform: (current: BoardState) => BoardState) {
    this.#board = transform(this.#board);
    return this.#board;
  }
  set(board: BoardState) { this.#board = board; }
}

const directory = await mkdtemp(join(tmpdir(), "stella-companion-acceptance-"));
const pairingStore = new CompanionPairingStore(join(directory, "devices.json"));
await pairingStore.initialize("Stella Acceptance Host");
const host = await pairingStore.host("0.5.0");
const repository = new MemoryRepository();
const controlPlane = new MainCompanionControlPlane({ repository, host });
const gateway = new CompanionGateway({
  controlPlane,
  pairingStore,
  host,
  port,
  bindHost: "0.0.0.0",
  publicAddresses: () => [hostAddress],
});
await gateway.start();
const offer = await gateway.createPairingOffer();
process.stdout.write(`PAIRING_URI=${offer.pairingUri}\n`);
process.stdout.write(`PAIRING_EXPIRES_AT=${offer.expiresAt}\n`);

let waiting = true;
const timer = setInterval(() => {
  waiting = !waiting;
  const board = acceptanceBoard(waiting ? "waiting_human" : "running", new Date().toISOString());
  repository.set(board);
  void controlPlane.publishCommitted(board);
}, 4_000);

const shutdown = async () => {
  clearInterval(timer);
  await gateway.stop();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
};
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
