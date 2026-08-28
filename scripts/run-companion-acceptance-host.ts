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
import { snapshotTaskSpec } from "../src/shared/execution-state";
import type {
  ExternalExecutionCatalogSnapshot,
  ExternalExecutionDetails,
  ExternalExecutionScope,
  ReadExternalExecutionDetailsInput,
} from "../src/shared/external-execution";
import { BOARD_SCHEMA_VERSION, type AgentDefinition, type BoardState, type KanbanTask } from "../src/shared/kanban";
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

const ACCEPTANCE_WORKFLOW = BUILTIN_ORCHESTRATION_CATALOG.workflows.find((workflow) => workflow.steps.some((step) => step.kind === "human-gate"));
const ACCEPTANCE_GATE = ACCEPTANCE_WORKFLOW?.steps.find((step) => step.kind === "human-gate");
const BUILDER = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
if (!ACCEPTANCE_WORKFLOW || !ACCEPTANCE_GATE || ACCEPTANCE_GATE.kind !== "human-gate" || !BUILDER) {
  throw new Error("Companion 验收主机缺少内置 Workflow、人工关卡或 Builder");
}

function acceptanceTask(input: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly target: KanbanTask["executionTarget"];
  readonly stage: KanbanTask["stage"];
  readonly updatedAt: string;
  readonly activeAgentTaskId?: string;
  readonly activeRunId?: string;
  readonly awaitingReviewExecution?: KanbanTask["awaitingReviewExecution"];
}): KanbanTask {
  return Object.freeze({
    id: input.id,
    title: input.title,
    description: input.description,
    acceptanceCriteria: "Android 命令由桌面既有领域规则接收且只作用于精确 execution",
    priority: "high",
    projectPath: "/acceptance/stella",
    projectName: "pi-workbench",
    trusted: true,
    executionTarget: input.target,
    executionProfileId: "pi.rpc",
    executionWorkspace: Object.freeze({ strategy: "current-folder" }),
    stage: input.stage,
    specRevision: 1,
    executionAttempt: 1,
    ...(input.activeAgentTaskId ? { activeAgentTaskId: input.activeAgentTaskId } : {}),
    ...(input.activeRunId ? { activeRunId: input.activeRunId } : {}),
    ...(input.awaitingReviewExecution ? { awaitingReviewExecution: input.awaitingReviewExecution } : {}),
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: input.updatedAt,
  });
}

function acceptanceBoard(status: "waiting_human" | "running", updatedAt: string): BoardState {
  const coordinatorTask = acceptanceTask({
    id: "android-acceptance-task",
    title: "Android Coordinator 回复验收",
    description: "由真实 Companion Gateway 推送状态并接收一次回复",
    target: Object.freeze({ kind: "agent", agentId: AGENT.id }),
    stage: "running",
    activeAgentTaskId: "android-acceptance-agent",
    updatedAt,
  });
  const gateTask = acceptanceTask({
    id: "android-gate-task",
    title: "Android 人工关卡验收",
    description: "批准当前 Workflow human gate",
    target: Object.freeze({ kind: "workflow", workflowId: ACCEPTANCE_WORKFLOW.id }),
    stage: "review",
    activeRunId: "android-gate-run",
    updatedAt,
  });
  const reviewTask = acceptanceTask({
    id: "android-review-task",
    title: "Android 执行报告验收",
    description: "接受或请求修订当前 AgentTask 报告",
    target: Object.freeze({ kind: "agent", agentId: BUILDER.id }),
    stage: "review",
    awaitingReviewExecution: Object.freeze({ kind: "agent-task", id: "android-review-agent", attempt: 1 }),
    updatedAt,
  });
  const abortTask = acceptanceTask({
    id: "android-abort-task",
    title: "Android 精确中止验收",
    description: "确认后只中止当前 AgentTask execution",
    target: Object.freeze({ kind: "agent", agentId: BUILDER.id }),
    stage: "running",
    activeAgentTaskId: "android-abort-agent",
    updatedAt,
  });
  return Object.freeze({
    version: BOARD_SCHEMA_VERSION,
    tasks: Object.freeze([coordinatorTask, gateTask, reviewTask, abortTask]),
    runs: Object.freeze([Object.freeze({
      id: "android-gate-run",
      taskId: gateTask.id,
      executionAttempt: 1,
      taskSpec: snapshotTaskSpec(gateTask),
      executionProfile: snapshotExecutionProfile("pi.rpc"),
      workflow: ACCEPTANCE_WORKFLOW,
      agents: Object.freeze([BUILDER]),
      status: "review" as const,
      acceptance: "not-ready" as const,
      currentStepId: ACCEPTANCE_GATE.id,
      steps: Object.freeze(ACCEPTANCE_WORKFLOW.steps.map((step, index) => Object.freeze({
        id: step.id === ACCEPTANCE_GATE.id ? "android-gate-step" : `android-workflow-step-${index}`,
        stepId: step.id,
        stepKind: step.kind,
        name: step.name,
        status: step.id === ACCEPTANCE_GATE.id ? "waiting" as const : "pending" as const,
        ...(step.kind === "agent" ? { agentId: step.agentId } : {}),
      }))),
      startedAt: "2026-08-28T10:00:00.000Z",
      updatedAt,
    })]),
    activities: Object.freeze([Object.freeze({
      id: `activity-${updatedAt}`,
      taskId: coordinatorTask.id,
      agentTaskId: "android-acceptance-agent",
      kind: "agent" as const,
      summary: status === "waiting_human" ? "等待 Android 回复" : "正在处理 Android 验收",
      createdAt: updatedAt,
    })]),
    comments: Object.freeze([]),
    agentTasks: Object.freeze([
      Object.freeze({
        id: "android-acceptance-agent",
        taskId: coordinatorTask.id,
        executionAttempt: 1,
        taskSpec: snapshotTaskSpec(coordinatorTask),
        executionProfile: snapshotExecutionProfile("pi.rpc"),
        agentSnapshot: AGENT,
        kind: "coordinator" as const,
        status,
        acceptance: "not-ready" as const,
        prompt: "Android acceptance",
        ...(status === "waiting_human" ? { output: "请选择下一步，确认手机已收到实时状态。" } : {}),
        createdAt: "2026-08-28T10:00:00.000Z",
        updatedAt,
      }),
      Object.freeze({
        id: "android-review-agent",
        taskId: reviewTask.id,
        executionAttempt: 1,
        taskSpec: snapshotTaskSpec(reviewTask),
        executionProfile: snapshotExecutionProfile("pi.rpc"),
        agentSnapshot: BUILDER,
        kind: "direct" as const,
        status: "reported" as const,
        acceptance: "pending" as const,
        prompt: "Build release",
        output: "发布候选已完成，等待 Android 验收。",
        createdAt: "2026-08-28T10:00:00.000Z",
        updatedAt,
        completedAt: updatedAt,
      }),
      Object.freeze({
        id: "android-abort-agent",
        taskId: abortTask.id,
        executionAttempt: 1,
        taskSpec: snapshotTaskSpec(abortTask),
        executionProfile: snapshotExecutionProfile("pi.rpc"),
        agentSnapshot: BUILDER,
        kind: "direct" as const,
        status: "running" as const,
        acceptance: "not-ready" as const,
        prompt: "Wait for abort acceptance",
        runtimeToken: "android-abort-runtime",
        createdAt: "2026-08-28T10:00:00.000Z",
        updatedAt,
      }),
    ]),
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
let coordinatorReplySequence = 0;
const commandService = new CompanionCommandService({
  repository,
  catalog: BUILTIN_ORCHESTRATION_CATALOG,
  receipts: receiptStore,
  handlers: {
    addComment: (input) => commit((current) => {
      const createdAt = new Date().toISOString();
      const coordinator = current.agentTasks.find((agentTask) => agentTask.id === "android-acceptance-agent");
      const resumesCoordinator = input.taskId === "android-acceptance-task" && coordinator?.status === "waiting_human";
      const reviewId = resumesCoordinator ? `android-coordinator-review-${++coordinatorReplySequence}` : undefined;
      return Object.freeze({
        ...current,
        tasks: Object.freeze(current.tasks.map((task) => task.id === input.taskId ? Object.freeze({ ...task, updatedAt: createdAt }) : task)),
        comments: Object.freeze([...current.comments, Object.freeze({
          id: `android-comment-${current.comments.length + 1}`,
          taskId: input.taskId,
          author: "user" as const,
          messageKind: "comment" as const,
          body: input.body,
          createdAt,
        })]),
        agentTasks: Object.freeze([
          ...current.agentTasks.map((agentTask) => resumesCoordinator && agentTask.id === coordinator?.id
            ? Object.freeze({ ...agentTask, status: "waiting_children" as const, updatedAt: createdAt })
            : agentTask),
          ...(resumesCoordinator && coordinator && reviewId ? [Object.freeze({
            id: reviewId,
            taskId: coordinator.taskId,
            executionAttempt: coordinator.executionAttempt,
            taskSpec: coordinator.taskSpec,
            executionProfile: coordinator.executionProfile,
            agentSnapshot: coordinator.agentSnapshot,
            kind: "coordinator-review" as const,
            status: "queued" as const,
            acceptance: "not-ready" as const,
            prompt: `Android 回复后的 Coordinator review：${input.body}`,
            parentAgentTaskId: coordinator.id,
            delegationRound: coordinatorReplySequence,
            createdAt,
            updatedAt: createdAt,
          })] : []),
        ]),
        activities: Object.freeze([...current.activities, ...(reviewId ? [Object.freeze({
          id: `activity-${reviewId}`,
          taskId: input.taskId,
          agentTaskId: reviewId,
          kind: "agent" as const,
          summary: "Android 回复已创建且仅创建一个 Coordinator review",
          createdAt,
        })] : [])]),
      });
    }),
    resolveGate: (input) => commit((current) => {
      const completedAt = new Date().toISOString();
      const gateIndex = ACCEPTANCE_WORKFLOW.steps.findIndex((step) => step.id === ACCEPTANCE_GATE.id);
      const nextStep = ACCEPTANCE_WORKFLOW.steps[gateIndex + 1];
      return Object.freeze({
        ...current,
        tasks: Object.freeze(current.tasks.map((task) => task.id === input.taskId
          ? Object.freeze({
              ...task,
              ...(input.decision === "approve"
                ? { stage: "running" as const }
                : { activeRunId: undefined, stage: "blocked" as const, blockedReason: "Android 驳回人工关卡" }),
              updatedAt: completedAt,
            })
          : task)),
        runs: Object.freeze(current.runs.map((run) => run.id === input.runId
          ? Object.freeze({
              ...run,
              status: input.decision === "approve" ? "running" as const : "failed" as const,
              currentStepId: input.decision === "approve" ? nextStep?.id : undefined,
              steps: Object.freeze(run.steps.map((step) => step.id === input.stepId
                ? Object.freeze({
                    ...step,
                    status: input.decision === "approve" ? "succeeded" as const : "failed" as const,
                    completedAt,
                  })
                : step)),
              updatedAt: completedAt,
              ...(input.decision === "reject" ? { completedAt, error: "Android 驳回人工关卡" } : {}),
            })
          : run)),
      });
    }),
    reviewExecution: (input) => commit((current) => {
      const reviewedAt = new Date().toISOString();
      const acceptance = input.decision === "accept" ? "accepted" as const
        : input.decision === "revision-requested" ? "revision-requested" as const
          : "rejected" as const;
      return Object.freeze({
        ...current,
        tasks: Object.freeze(current.tasks.map((task) => task.id === input.taskId
          ? Object.freeze({
              ...task,
              awaitingReviewExecution: undefined,
              stage: input.decision === "accept" ? "completed" as const : input.decision === "revision-requested" ? "planned" as const : "blocked" as const,
              ...(input.decision === "reject" ? { blockedReason: input.comment || "Android 拒绝执行报告" } : {}),
              updatedAt: reviewedAt,
            })
          : task)),
        agentTasks: Object.freeze(current.agentTasks.map((agentTask) => agentTask.id === input.executionId
          ? Object.freeze({ ...agentTask, acceptance, acceptanceComment: input.comment || undefined, reviewedAt, updatedAt: reviewedAt })
          : agentTask)),
      });
    }),
    abortExecution: (input) => commit((current) => {
      const completedAt = new Date().toISOString();
      return Object.freeze({
        ...current,
        tasks: Object.freeze(current.tasks.map((task) => task.id === input.taskId
          ? Object.freeze({
              ...task,
              ...(input.executionKind === "workflow" ? { activeRunId: undefined } : { activeAgentTaskId: undefined }),
              stage: "blocked" as const,
              blockedReason: "Android 验收中止",
              updatedAt: completedAt,
            })
          : task)),
        runs: Object.freeze(current.runs.map((run) => input.executionKind === "workflow" && run.id === input.executionId
          ? Object.freeze({ ...run, status: "interrupted" as const, error: "Android 验收中止", completedAt, updatedAt: completedAt })
          : run)),
        agentTasks: Object.freeze(current.agentTasks.map((agentTask) => input.executionKind === "agent-task" && agentTask.id === input.executionId
          ? Object.freeze({ ...agentTask, status: "interrupted" as const, runtimeToken: undefined, error: "Android 验收中止", completedAt, updatedAt: completedAt })
          : agentTask)),
      });
    }),
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
    const coordinatorTask = current.tasks.find((task) => task.id === "android-acceptance-task");
    const coordinator = current.agentTasks.find((agentTask) => agentTask.id === "android-acceptance-agent");
    const alternating = coordinator?.status === "waiting_human" || coordinator?.status === "running";
    if (coordinatorTask?.activeAgentTaskId !== coordinator?.id || !alternating) return current;
    return Object.freeze({
      ...current,
      tasks: Object.freeze(current.tasks.map((task) => task.id === coordinatorTask.id ? Object.freeze({ ...task, updatedAt }) : task)),
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
