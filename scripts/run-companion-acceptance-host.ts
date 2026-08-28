import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MainCompanionControlPlane } from "../src/main/companion-control-plane";
import { CompanionGateway } from "../src/main/companion-gateway";
import { CompanionPairingStore } from "../src/main/companion-pairing-store";
import { CompanionCommandReceiptStore } from "../src/main/companion-command-receipt-store";
import { CompanionCommandService } from "../src/main/companion-command-service";
import type { BoardRepository } from "../src/main/board-repository";
import { snapshotExecutionProfile } from "../src/shared/execution-profile";
import type {
  ExternalExecutionCatalogSnapshot,
  ExternalExecutionDetails,
  ExternalExecutionScope,
  ReadExternalExecutionDetailsInput,
} from "../src/shared/external-execution";
import { BOARD_SCHEMA_VERSION, type AgentDefinition, type BoardState } from "../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../src/shared/orchestration-catalog";

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
}

const directory = await mkdtemp(join(tmpdir(), "stella-companion-acceptance-"));
const pairingStore = new CompanionPairingStore(join(directory, "devices.json"));
await pairingStore.initialize("Stella Acceptance Host");
const host = await pairingStore.host("0.5.0");
const repository = new MemoryRepository();
const receiptStore = new CompanionCommandReceiptStore(join(directory, "command-receipts.json"));
await receiptStore.initialize();
let controlPlane: MainCompanionControlPlane;
const commit = async (transform: (current: BoardState) => BoardState) => {
  const board = await repository.update(transform);
  await controlPlane.publishCommitted(board);
  return board;
};
const commandService = new CompanionCommandService({
  repository,
  catalog: BUILTIN_ORCHESTRATION_CATALOG,
  receipts: receiptStore,
  handlers: {
    addComment: (input) => commit((current) => Object.freeze({
      ...current,
      comments: Object.freeze([...current.comments, Object.freeze({
        id: `android-comment-${current.comments.length + 1}`,
        taskId: input.taskId,
        author: "user" as const,
        messageKind: "comment" as const,
        body: input.body,
        createdAt: new Date().toISOString(),
      })]),
    })),
    resolveGate: async () => { throw new Error("验收主机当前没有人工关卡"); },
    reviewExecution: async () => { throw new Error("验收主机当前没有待验收报告"); },
    abortExecution: (input) => commit((current) => Object.freeze({
      ...current,
      tasks: Object.freeze(current.tasks.map((task) => task.id === input.taskId
        ? Object.freeze({ ...task, activeAgentTaskId: undefined, stage: "blocked" as const, blockedReason: "Android 验收中止", updatedAt: new Date().toISOString() })
        : task)),
      agentTasks: Object.freeze(current.agentTasks.map((agentTask) => agentTask.id === input.executionId
        ? Object.freeze({ ...agentTask, status: "interrupted" as const, error: "Android 验收中止", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        : agentTask)),
    })),
  },
});
controlPlane = new MainCompanionControlPlane({ repository, host, commands: commandService });
let externalEpoch = 0;
const externalListeners = new Set<(snapshot: ExternalExecutionCatalogSnapshot) => void>();
const projectExternalExecutions = (): ExternalExecutionCatalogSnapshot => {
  const capturedAt = new Date().toISOString();
  return Object.freeze({
    epoch: externalEpoch,
    scope: Object.freeze({ kind: "all" }),
    capturedAt,
    sources: Object.freeze([
      Object.freeze({
        source: Object.freeze({
          id: "claude" as const,
          label: "Claude Agents",
          description: "Acceptance Claude source",
          capabilities: Object.freeze({
            discovery: "cli-json" as const,
            updates: Object.freeze(["poll" as const]),
            details: false,
            import: true,
            continue: true,
            hierarchy: true,
            evidence: "official-structured" as const,
          }),
        }),
        state: "error" as const,
        stale: true,
        error: "验收样例：Claude Source 暂时不可用",
        lastSuccessfulAt: "2026-08-28T10:00:00.000Z",
        items: Object.freeze([
          Object.freeze({
            sourceId: "claude" as const,
            externalId: "claude-external-acceptance",
            nativeId: "claude-a1",
            kind: "background",
            title: "Claude 外部 Agent 等待输入",
            summary: "保留自上次成功刷新的状态",
            projectPath: "/acceptance/claude-project",
            session: Object.freeze({ backendId: "claude", sessionId: "claude-external-acceptance" }),
            state: "needs-input" as const,
            needsInput: true,
            waitingFor: "请在 Claude CLI 中回复",
            terminal: false,
            updatedAt: "2026-08-28T10:00:00.000Z",
          }),
          Object.freeze({
            sourceId: "claude" as const,
            externalId: "managed-duplicate",
            nativeId: "managed-a1",
            kind: "background",
            title: "不应重复显示的 managed session",
            projectPath: "/acceptance/stella",
            session: Object.freeze({ backendId: "claude", sessionId: "managed-duplicate" }),
            state: "working" as const,
            needsInput: false,
            terminal: false,
            updatedAt: capturedAt,
            association: Object.freeze({ taskId: "android-acceptance-task", relation: "managed" as const }),
          }),
        ]),
      }),
      Object.freeze({
        source: Object.freeze({
          id: "codex" as const,
          label: "Codex Threads",
          description: "Acceptance Codex source",
          capabilities: Object.freeze({
            discovery: "app-server" as const,
            updates: Object.freeze(["notification" as const, "poll" as const]),
            details: true,
            import: true,
            continue: true,
            hierarchy: true,
            evidence: "official-structured" as const,
          }),
        }),
        state: "ready" as const,
        stale: false,
        lastSuccessfulAt: capturedAt,
        items: Object.freeze([Object.freeze({
          sourceId: "codex" as const,
          externalId: "codex-external-acceptance",
          nativeId: "codex-a1",
          kind: "subAgent",
          title: "Codex 外部 Thread 正在实现",
          summary: "由桌面 App Server 投影到 Android",
          projectPath: "/acceptance/codex-project",
          parentExternalId: "codex-parent",
          session: Object.freeze({ backendId: "codex", sessionId: "codex-external-acceptance" }),
          state: "working" as const,
          needsInput: false,
          terminal: false,
          updatedAt: capturedAt,
        })]),
      }),
    ]),
  });
};
let externalSnapshot = projectExternalExecutions();
controlPlane.attachExternalExecutions({
  async refresh(_scope: ExternalExecutionScope) {
    externalEpoch += 1;
    externalSnapshot = projectExternalExecutions();
    for (const listener of [...externalListeners]) listener(externalSnapshot);
    return externalSnapshot;
  },
  async snapshot(_scope: ExternalExecutionScope) { return externalSnapshot; },
  async details(input: ReadExternalExecutionDetailsInput): Promise<ExternalExecutionDetails> {
    if (input.sourceId !== "codex" || input.externalId !== "codex-external-acceptance") {
      throw new Error(`验收 Source 没有详情: ${input.sourceId}/${input.externalId}`);
    }
    const fetchedAt = new Date().toISOString();
    return Object.freeze({
      sourceId: input.sourceId,
      externalId: input.externalId,
      title: "Codex 外部 Thread 正在实现",
      projectPath: "/acceptance/codex-project",
      fetchedAt,
      turns: Object.freeze([Object.freeze({
        id: "codex-turn-1",
        status: "completed",
        startedAt: "2026-08-28T10:00:00.000Z",
        completedAt: fetchedAt,
        items: Object.freeze([
          Object.freeze({ id: "codex-item-1", type: "userMessage", label: "User", text: "实现 Android 外部任务状态视图" }),
          Object.freeze({ id: "codex-item-2", type: "agentMessage", label: "Codex", text: "已完成统一投影、筛选和只读详情。", status: "completed" }),
        ]),
      })]),
    });
  },
  subscribe(listener) {
    externalListeners.add(listener);
    return () => { externalListeners.delete(listener); };
  },
});
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
  const updatedAt = new Date().toISOString();
  void commit((current) => {
    const active = current.tasks[0]?.activeAgentTaskId === "android-acceptance-agent";
    if (!active) return current;
    return Object.freeze({
      ...current,
      tasks: Object.freeze(current.tasks.map((task) => Object.freeze({ ...task, updatedAt }))),
      agentTasks: Object.freeze(current.agentTasks.map((agentTask) => agentTask.id === "android-acceptance-agent"
        ? Object.freeze({ ...agentTask, status: waiting ? "waiting_human" as const : "running" as const, updatedAt })
        : agentTask)),
      activities: Object.freeze([...current.activities, Object.freeze({
        id: `activity-${updatedAt}`,
        taskId: "android-acceptance-task",
        agentTaskId: "android-acceptance-agent",
        kind: "agent" as const,
        summary: waiting ? "等待 Android 回复" : "正在处理 Android 验收",
        createdAt: updatedAt,
      })]),
    });
  });
}, 4_000);

const shutdown = async () => {
  clearInterval(timer);
  await gateway.stop();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
};
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
