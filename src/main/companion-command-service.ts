import { createHash } from "node:crypto";
import { availableMentionAgentsForTask, parseAgentMentions } from "../shared/agent-mentions";
import { isCoordinatorRootAgentTask } from "../shared/coordinator-protocol";
import {
  type CompanionCommand,
  type CompanionCommandPreview,
  type CompanionCommandResult,
} from "../shared/companion-protocol";
import type {
  BoardState,
  CreateTaskCommentInput,
  OrchestrationCatalog,
  ResolveGateInput,
  ReviewExecutionInput,
} from "../shared/kanban";
import { catalogForBoard } from "../shared/orchestration-catalog";
import type { BoardRepository } from "./board-repository";
import type { CompanionCommandReceiptStore } from "./companion-command-receipt-store";

export interface CompanionAbortExecutionInput {
  readonly taskId: string;
  readonly executionKind: "workflow" | "agent-task";
  readonly executionId: string;
}

interface CompanionCommandHandlers {
  readonly addComment: (input: CreateTaskCommentInput) => Promise<unknown>;
  readonly resolveGate: (input: ResolveGateInput) => Promise<unknown>;
  readonly reviewExecution: (input: ReviewExecutionInput) => Promise<unknown>;
  readonly abortExecution: (input: CompanionAbortExecutionInput) => Promise<unknown>;
}

interface CompanionCommandServiceDependencies {
  readonly repository: BoardRepository;
  readonly catalog: OrchestrationCatalog;
  readonly receipts: CompanionCommandReceiptStore;
  readonly handlers: CompanionCommandHandlers;
  readonly now?: () => string;
}

export class StaleCompanionExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleCompanionExecutionError";
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function digest(command: CompanionCommand): string {
  return createHash("sha256").update(JSON.stringify(command), "utf8").digest("hex");
}

export class CompanionCommandService {
  readonly #repository: BoardRepository;
  readonly #catalog: OrchestrationCatalog;
  readonly #receipts: CompanionCommandReceiptStore;
  readonly #handlers: CompanionCommandHandlers;
  readonly #now: () => string;
  #queue: Promise<void> = Promise.resolve();

  constructor(dependencies: CompanionCommandServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#receipts = dependencies.receipts;
    this.#handlers = dependencies.handlers;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async preview(command: CompanionCommand): Promise<CompanionCommandPreview> {
    return this.#preview(await this.#repository.read(), command);
  }

  execute(deviceId: string, command: CompanionCommand): Promise<CompanionCommandResult> {
    const operation = this.#queue.then(() => this.#execute(deviceId, command));
    this.#queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #execute(deviceId: string, command: CompanionCommand): Promise<CompanionCommandResult> {
    const commandDigest = digest(command);
    const existing = this.#receipts.get(deviceId, command.idempotencyKey);
    if (existing) {
      if (existing.commandDigest === commandDigest) return existing.result;
      return Object.freeze({
        idempotencyKey: command.idempotencyKey,
        status: "rejected",
        code: "idempotency-conflict",
        message: "该 idempotency key 已用于另一条命令",
        completedAt: this.#now(),
      });
    }

    const inProgress: CompanionCommandResult = Object.freeze({
      idempotencyKey: command.idempotencyKey,
      status: "indeterminate",
      code: "command-in-progress",
      message: "命令已被桌面接收，但尚未记录最终结果",
      completedAt: this.#now(),
    });
    await this.#receipts.remember(deviceId, command.idempotencyKey, commandDigest, inProgress);

    let result: CompanionCommandResult;
    try {
      const preview = await this.preview(command);
      await this.#apply(command);
      result = Object.freeze({
        idempotencyKey: command.idempotencyKey,
        status: "accepted",
        code: "accepted",
        message: preview.summary,
        completedAt: this.#now(),
        preview,
      });
    } catch (cause) {
      result = Object.freeze({
        idempotencyKey: command.idempotencyKey,
        status: "rejected",
        code: cause instanceof StaleCompanionExecutionError ? "stale-execution" : "domain-rejected",
        message: errorMessage(cause),
        completedAt: this.#now(),
      });
    }
    await this.#receipts.remember(deviceId, command.idempotencyKey, commandDigest, result);
    return result;
  }

  async #apply(command: CompanionCommand): Promise<void> {
    if (command.type === "add-task-message") {
      await this.#handlers.addComment({
        taskId: command.taskId,
        body: command.body,
        dispatchMentions: command.dispatchMentions,
      });
      return;
    }
    if (command.type === "resolve-human-gate") {
      await this.#handlers.resolveGate({
        taskId: command.taskId,
        runId: command.runId,
        stepId: command.stepId,
        decision: command.decision,
        comment: command.comment,
      });
      return;
    }
    if (command.type === "review-execution") {
      await this.#handlers.reviewExecution({
        taskId: command.taskId,
        executionKind: command.executionKind,
        executionId: command.executionId,
        decision: command.decision,
        comment: command.comment,
      });
      return;
    }
    await this.#handlers.abortExecution({
      taskId: command.taskId,
      executionKind: command.executionKind,
      executionId: command.executionId,
    });
  }

  #preview(board: BoardState, command: CompanionCommand): CompanionCommandPreview {
    const task = board.tasks.find((candidate) => candidate.id === command.taskId);
    if (!task) throw new Error(`找不到任务: ${command.taskId}`);
    if (command.type === "add-task-message") {
      const availableAgents = command.dispatchMentions
        ? availableMentionAgentsForTask(task, catalogForBoard(this.#catalog, board), board.squads)
        : Object.freeze([]);
      const mentions = command.dispatchMentions ? parseAgentMentions(command.body, availableAgents).agents : Object.freeze([]);
      const activeRoot = task.activeAgentTaskId
        ? board.agentTasks.find((candidate) => candidate.id === task.activeAgentTaskId)
        : undefined;
      const resumesCoordinator = mentions.length === 0
        && activeRoot !== undefined
        && isCoordinatorRootAgentTask(activeRoot)
        && activeRoot.status === "waiting_human";
      if (mentions.length > 0) {
        if (task.activeRunId || task.activeAgentTaskId) throw new Error("任务正在执行；当前消息不能分发 Agent mention");
        if (task.stage === "completed") throw new Error("已完成任务不能直接分发 Agent mention");
        return Object.freeze({
          commandType: command.type,
          effect: "dispatch-agent-tasks",
          summary: `追加消息并分发给 ${mentions.map((agent) => agent.name).join("、")}`,
          destructive: false,
          requiresConfirmation: false,
        });
      }
      if (resumesCoordinator) {
        return Object.freeze({
          commandType: command.type,
          effect: "resume-coordinator",
          summary: "追加回复并为等待中的 Coordinator 创建一个下一轮 review",
          destructive: false,
          requiresConfirmation: false,
        });
      }
      return Object.freeze({
        commandType: command.type,
        effect: "comment-only",
        summary: "只在 Task Room 追加一条用户评论",
        destructive: false,
        requiresConfirmation: false,
      });
    }
    if (command.type === "resolve-human-gate") {
      const run = board.runs.find((candidate) => candidate.id === command.runId && candidate.taskId === task.id);
      const step = run?.steps.find((candidate) => candidate.id === command.stepId);
      if (task.activeRunId !== command.runId || run?.status !== "review" || !step
        || step.stepKind !== "human-gate" || step.status !== "waiting" || run.currentStepId !== step.stepId) {
        throw new StaleCompanionExecutionError("人工关卡已经变化，请刷新 Task Room 后重试");
      }
      return Object.freeze({
        commandType: command.type,
        effect: "resolve-human-gate",
        summary: command.decision === "approve" ? `批准人工关卡“${step.name}”并继续流程` : `驳回人工关卡“${step.name}”并终止本次流程`,
        destructive: command.decision === "reject",
        requiresConfirmation: command.decision === "reject",
      });
    }
    if (command.type === "review-execution") {
      const awaiting = task.awaitingReviewExecution;
      if (!awaiting || awaiting.kind !== command.executionKind || awaiting.id !== command.executionId) {
        throw new StaleCompanionExecutionError("待验收 execution 已经变化，请刷新 Task Room 后重试");
      }
      const decision = command.decision === "accept" ? "接受" : command.decision === "revision-requested" ? "请求修订" : "拒绝";
      return Object.freeze({
        commandType: command.type,
        effect: "review-execution",
        summary: `${decision}当前 ${command.executionKind === "workflow" ? "Workflow" : "AgentTask"} 执行报告`,
        destructive: command.decision === "reject",
        requiresConfirmation: command.decision === "reject",
      });
    }
    const activeId = command.executionKind === "workflow" ? task.activeRunId : task.activeAgentTaskId;
    if (activeId !== command.executionId) {
      throw new StaleCompanionExecutionError("active execution 已经变化，请刷新 Task Room 后重试");
    }
    return Object.freeze({
      commandType: command.type,
      effect: "abort-execution",
      summary: `中止当前 ${command.executionKind === "workflow" ? "Workflow" : "AgentTask"} execution ${command.executionId}`,
      destructive: true,
      requiresConfirmation: true,
    });
  }
}
