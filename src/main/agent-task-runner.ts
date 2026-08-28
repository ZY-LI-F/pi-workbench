import type { AgentTask, BoardBootstrap, BoardBridgeEvent } from "../shared/kanban";
import { backgroundSessionName } from "../shared/session-policy";
import { AgentTaskRuntimeExpiredError, AgentTaskService, type ClaimedAgentTask } from "./agent-task-service";
import { ExecutionAbortedError, ExecutionProtocolError, type ExecutionBackend, type ExecutionEvent, type ExecutionOutcome } from "./execution-backend";
import type { ExecutionBackendRegistryContract, ExecutionUseCase } from "./execution-backend-registry";
import {
  ExecutionCapacity,
  ExecutionCapacityAbortError,
  type ExecutionCapacityLease,
} from "./execution-capacity";
import {
  ExecutionWorkspaceAbortError,
  type ExecutionWorkspaceHandle,
  type ExecutionWorkspaceProvider,
} from "./execution-workspace";

interface AgentTaskRunnerDependencies {
  readonly service: AgentTaskService;
  readonly backendRegistry: ExecutionBackendRegistryContract;
  readonly emitBoardEvent: (event: BoardBridgeEvent) => void;
  readonly workspace: ExecutionWorkspaceProvider;
  readonly capacity?: ExecutionCapacity;
  readonly reservationLimit?: number;
}

interface ActiveExecution {
  readonly taskId: string;
  readonly agentTaskId: string;
  readonly runtimeToken: string;
  readonly controller: AbortController;
  readonly workspace: ExecutionWorkspaceHandle;
  readonly capacity: ExecutionCapacityLease;
  abortRequested: boolean;
  done?: Promise<void>;
}

interface WaitingExecution {
  readonly taskId: string;
  readonly agentTaskId: string;
  readonly controller: AbortController;
}

function useCaseForAgentTask(agentTask: AgentTask): ExecutionUseCase {
  if (agentTask.kind === "coordinator" || agentTask.kind === "coordinator-review") return "coordinator";
  if (agentTask.kind === "squad-leader") return "squad";
  if (agentTask.kind === "mention-root" || agentTask.kind === "delegated") return "worker-mention";
  return "direct-agent";
}

function outcomeOutput(outcome: ExecutionOutcome): string {
  return outcome.result.kind === "report" ? outcome.result.output : JSON.stringify(outcome.result.action);
}

export class AgentTaskRunner {
  readonly #service: AgentTaskService;
  readonly #backendRegistry: ExecutionBackendRegistryContract;
  readonly #emitBoardEvent: (event: BoardBridgeEvent) => void;
  readonly #workspace: ExecutionWorkspaceProvider;
  readonly #capacity: ExecutionCapacity;
  readonly #reservationLimit: number;
  readonly #active = new Map<string, ActiveExecution>();
  readonly #waiting = new Map<string, WaitingExecution>();
  readonly #preparations = new Set<Promise<void>>();
  #schedulePromise?: Promise<void>;
  #scheduling = false;
  #ready = false;
  #stopping = false;

  constructor(dependencies: AgentTaskRunnerDependencies) {
    this.#service = dependencies.service;
    this.#backendRegistry = dependencies.backendRegistry;
    this.#emitBoardEvent = dependencies.emitBoardEvent;
    this.#workspace = dependencies.workspace;
    this.#capacity = dependencies.capacity ?? new ExecutionCapacity();
    this.#reservationLimit = dependencies.reservationLimit ?? Math.max(4, this.#capacity.limit * 2);
    if (!Number.isInteger(this.#reservationLimit) || this.#reservationLimit < this.#capacity.limit) {
      throw new Error("AgentTask reservationLimit 不能小于 execution concurrency");
    }
  }

  start(): void {
    this.#stopping = false;
    this.#ready = false;
    void this.#backendRegistry.initialize()
      .then(() => this.#service.reconcileWaitingParents())
      .then(() => {
        if (this.#stopping) return;
        this.#ready = true;
        this.notify();
      })
      .catch((error) => this.#reportError(error));
  }

  notify(): void {
    if (!this.#ready || this.#stopping || this.#scheduling) return;
    const schedule = this.#schedule();
    this.#schedulePromise = schedule;
    void schedule
      .catch((error) => this.#reportError(error))
      .finally(() => { if (this.#schedulePromise === schedule) this.#schedulePromise = undefined; });
  }

  async abortTask(taskId: string, expectedAgentTaskId?: string): Promise<BoardBootstrap> {
    for (const waiting of this.#waiting.values()) {
      if (waiting.taskId === taskId) waiting.controller.abort();
    }
    const result = await this.#service.abortTask(taskId, expectedAgentTaskId);
    const active = [...this.#active.values()].filter((entry) => entry.taskId === taskId);
    for (const entry of active) {
      entry.abortRequested = true;
      entry.controller.abort();
    }
    await Promise.all(active.flatMap((entry) => entry.done ? [entry.done] : []));
    this.notify();
    return result.bootstrap;
  }

  async shutdown(): Promise<void> {
    this.#stopping = true;
    this.#ready = false;
    for (const waiting of this.#waiting.values()) waiting.controller.abort();
    await Promise.allSettled([...this.#preparations]);
    await this.#schedulePromise;
    const active = [...this.#active.values()];
    await Promise.all(active.map(async (entry) => {
      try {
        await this.#service.interruptRunning(
          entry.agentTaskId,
          entry.runtimeToken,
          "Stella 关闭，Agent 执行已中断",
          entry.workspace.placement.resourceId,
        );
      } catch (cause) {
        if (!(cause instanceof AgentTaskRuntimeExpiredError)) throw cause;
      }
    }));
    for (const entry of active) {
      if (entry.abortRequested) continue;
      entry.abortRequested = true;
      entry.controller.abort();
    }
    await Promise.all(active.flatMap((entry) => entry.done ? [entry.done] : []));
  }

  async #schedule(): Promise<void> {
    if (this.#scheduling || this.#stopping) return;
    this.#scheduling = true;
    try {
      while (!this.#stopping && this.#waiting.size + this.#active.size < this.#reservationLimit) {
        const excluded = new Set([...this.#waiting.keys(), ...this.#active.keys()]);
        const queued = await this.#service.nextQueued(excluded);
        if (!queued || this.#stopping) return;
        const controller = new AbortController();
        const waiting: WaitingExecution = Object.freeze({
          taskId: queued.task.id,
          agentTaskId: queued.agentTask.id,
          controller,
        });
        this.#waiting.set(waiting.agentTaskId, waiting);
        let preparation!: Promise<void>;
        preparation = this.#prepare(queued, waiting)
          .catch((cause) => this.#reportError(cause))
          .finally(() => {
            if (this.#waiting.get(waiting.agentTaskId) === waiting) this.#waiting.delete(waiting.agentTaskId);
            this.#preparations.delete(preparation);
            if (!this.#stopping) this.notify();
          });
        this.#preparations.add(preparation);
      }
    } finally {
      this.#scheduling = false;
    }
  }

  async #prepare(queued: ClaimedAgentTask, waiting: WaitingExecution): Promise<void> {
    const agent = queued.agentTask.agentSnapshot;
    let backend: ExecutionBackend;
    let profileLabel: string;
    try {
      this.#backendRegistry.assertCompatible(queued.agentTask.executionProfile.id, useCaseForAgentTask(queued.agentTask));
      const resolved = this.#backendRegistry.resolve(queued.agentTask.executionProfile.id);
      backend = resolved.backend;
      profileLabel = resolved.profile.label;
    } catch (cause) {
      await this.#rejectQueuedIfCurrent(queued.agentTask.id, cause, waiting.controller.signal);
      return;
    }

    let capacity: ExecutionCapacityLease | undefined;
    let workspace: ExecutionWorkspaceHandle | undefined;
    let claimed: ClaimedAgentTask | undefined;
    try {
      capacity = await this.#capacity.acquire(`agent-task:${queued.agentTask.id}`, waiting.controller.signal);
      workspace = await this.#workspace.acquire({
        projectPath: queued.task.projectPath,
        preference: queued.agentTask.taskSpec.executionWorkspace ?? queued.task.executionWorkspace,
        existingPlacement: queued.agentTask.workspacePlacement,
        executionAttempt: queued.agentTask.executionAttempt,
        agent,
        owner: {
          id: `agent-task:${queued.agentTask.id}`,
          kind: "agent-task",
          label: `AgentTask · ${agent.name} · ${profileLabel}`,
          taskId: queued.task.id,
          executionId: queued.agentTask.id,
        },
        signal: waiting.controller.signal,
        onQueued: (owner) => this.#service.recordWorkspaceWait(queued.agentTask.id, owner.label).then(() => undefined),
      });
      if (this.#stopping || waiting.controller.signal.aborted) return;
      try {
        await this.#service.recordWorkspacePlacement(queued.agentTask.id, workspace.placement);
      } catch (cause) {
        await this.#rejectQueuedIfCurrent(queued.agentTask.id, cause, waiting.controller.signal);
        return;
      }
      claimed = await this.#service.claim(queued.agentTask.id);
      if (!claimed) return;
      if (this.#stopping || waiting.controller.signal.aborted) {
        const runtimeToken = claimed.agentTask.runtimeToken;
        if (runtimeToken) {
          try {
            await this.#service.interruptRunning(
              claimed.agentTask.id,
              runtimeToken,
              this.#stopping ? "Stella 关闭，Agent 启动已取消" : "Agent 启动已取消",
              workspace.placement.resourceId,
            );
          } catch (cause) {
            if (!(cause instanceof AgentTaskRuntimeExpiredError)) throw cause;
          }
        }
        return;
      }
      this.#launch(claimed, backend, workspace, capacity, waiting.controller);
      workspace = undefined;
      capacity = undefined;
    } catch (cause) {
      if (cause instanceof ExecutionWorkspaceAbortError || cause instanceof ExecutionCapacityAbortError) return;
      const runtimeToken = claimed?.agentTask.runtimeToken;
      if (claimed && runtimeToken && workspace) {
        try {
          await this.#service.fail(claimed.agentTask.id, runtimeToken, cause, undefined, workspace.placement.resourceId);
        } catch (stale) {
          if (!(stale instanceof AgentTaskRuntimeExpiredError)) throw stale;
        }
      } else {
        await this.#rejectQueuedIfCurrent(queued.agentTask.id, cause, waiting.controller.signal);
      }
    } finally {
      workspace?.release();
      capacity?.release();
    }
  }

  async #rejectQueuedIfCurrent(agentTaskId: string, cause: unknown, signal: AbortSignal): Promise<void> {
    try {
      await this.#service.rejectQueued(agentTaskId, cause);
    } catch (stale) {
      if (!signal.aborted && !this.#stopping) throw stale;
    }
  }

  #launch(
    claimed: ClaimedAgentTask,
    backend: ExecutionBackend,
    workspace: ExecutionWorkspaceHandle,
    capacity: ExecutionCapacityLease,
    controller: AbortController,
  ): void {
    const runtimeToken = claimed.agentTask.runtimeToken;
    if (!runtimeToken) throw new Error(`已认领 AgentTask ${claimed.agentTask.id} 缺少 runtimeToken`);
    const active: ActiveExecution = {
      taskId: claimed.task.id,
      agentTaskId: claimed.agentTask.id,
      runtimeToken,
      controller,
      workspace,
      capacity,
      abortRequested: false,
    };
    this.#active.set(active.agentTaskId, active);
    const expectedResult = claimed.agentTask.kind === "coordinator"
      || claimed.agentTask.kind === "coordinator-review"
      || claimed.agentTask.kind === "squad-leader"
      ? "coordinator-action"
      : "report";
    const done = this.#execute(active, backend, claimed, expectedResult);
    active.done = done;
    void done.catch((error) => this.#reportError(error));
  }

  async #execute(
    active: ActiveExecution,
    backend: ExecutionBackend,
    claimed: ClaimedAgentTask,
    expectedResult: "report" | "coordinator-action",
  ): Promise<void> {
    try {
      const outcome = await backend.run({
        executionId: claimed.agentTask.id,
        runtimeToken: active.runtimeToken,
        profile: claimed.agentTask.executionProfile,
        cwd: active.workspace.cwd,
        trusted: active.workspace.trusted,
        sessionName: backgroundSessionName({
          taskId: claimed.task.id,
          executionKind: "agent-task",
          executionId: claimed.agentTask.id,
          label: `${claimed.task.title} · ${claimed.agentTask.agentSnapshot.name}`,
        }),
        prompt: claimed.agentTask.prompt,
        agent: claimed.agentTask.agentSnapshot,
        coordinatorDelegates: claimed.agentTask.executionPlan?.delegates,
        expectedResult,
      }, (event) => void this.#handleExecutionEvent(active, event).catch((error) => this.#reportError(error)), active.controller.signal);
      if (this.#active.get(active.agentTaskId) !== active || active.abortRequested) return;
      await this.#service.complete(active.agentTaskId, active.runtimeToken, {
        output: outcomeOutput(outcome),
        session: outcome.session,
        backendVersion: outcome.backendVersion,
        inputTokens: outcome.usage?.inputTokens,
        outputTokens: outcome.usage?.outputTokens,
        cost: outcome.usage?.cost,
      }, active.workspace.placement.resourceId);
      await this.#abortExpiredPeers(active.agentTaskId);
    } catch (cause) {
      if (this.#active.get(active.agentTaskId) !== active || active.abortRequested || cause instanceof ExecutionAbortedError) return;
      if (cause instanceof ExecutionProtocolError) {
        const result = {
          output: cause.output,
          session: cause.session,
          backendVersion: cause.backendVersion,
          inputTokens: cause.usage?.inputTokens,
          outputTokens: cause.usage?.outputTokens,
          cost: cause.usage?.cost,
        };
        if (expectedResult === "coordinator-action") {
          await this.#service.complete(active.agentTaskId, active.runtimeToken, { ...result, protocolError: cause.message }, active.workspace.placement.resourceId);
        } else {
          await this.#service.fail(active.agentTaskId, active.runtimeToken, cause, result, active.workspace.placement.resourceId);
        }
        await this.#abortExpiredPeers(active.agentTaskId);
      } else {
        try {
          await this.#service.fail(active.agentTaskId, active.runtimeToken, cause, undefined, active.workspace.placement.resourceId);
          await this.#abortExpiredPeers(active.agentTaskId);
        } catch (stale) {
          if (!(stale instanceof AgentTaskRuntimeExpiredError)) throw stale;
        }
      }
    } finally {
      this.#finalize(active);
    }
  }

  async #handleExecutionEvent(active: ActiveExecution, event: ExecutionEvent): Promise<void> {
    if (this.#active.get(active.agentTaskId) !== active || active.abortRequested) return;
    const eventType = event.type === "tool-start"
      ? "tool_execution_start"
      : event.type === "tool-end"
        ? "tool_execution_end"
        : event.type;
    const toolName = event.type === "tool-start" || event.type === "tool-end" ? event.name : undefined;
    const message = event.type === "stderr" ? event.message : event.type === "assistant-output" ? event.text : undefined;
    this.#emitBoardEvent({
      type: "agent-task-event",
      taskId: active.taskId,
      agentTaskId: active.agentTaskId,
      eventType,
      toolName,
      message,
    });
    if (event.type === "tool-start" || event.type === "tool-end") {
      await this.#service.recordToolEvent(
        active.agentTaskId,
        active.runtimeToken,
        event.name,
        event.type === "tool-start",
        active.workspace.placement.resourceId,
      );
    }
  }

  async #abortExpiredPeers(completedAgentTaskId: string): Promise<void> {
    const state = await this.#service.read();
    for (const entry of this.#active.values()) {
      if (entry.agentTaskId === completedAgentTaskId || entry.abortRequested) continue;
      const durable = state.agentTasks.find((candidate) => candidate.id === entry.agentTaskId);
      if (durable?.status === "running" && durable.runtimeToken === entry.runtimeToken
        && durable.workspacePlacement?.resourceId === entry.workspace.placement.resourceId) continue;
      entry.abortRequested = true;
      entry.controller.abort();
    }
  }

  #finalize(active: ActiveExecution): void {
    active.workspace.release();
    active.capacity.release();
    if (this.#active.get(active.agentTaskId) === active) this.#active.delete(active.agentTaskId);
    if (!this.#stopping) this.notify();
  }

  #reportError(cause: unknown): void {
    this.#emitBoardEvent({
      type: "automation-error",
      source: "agent-task-runner",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
