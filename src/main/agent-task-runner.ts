import type { AgentTask, BoardBootstrap, BoardBridgeEvent } from "../shared/kanban";
import { backgroundSessionName } from "../shared/session-policy";
import { AgentTaskRuntimeExpiredError, AgentTaskService, type ClaimedAgentTask } from "./agent-task-service";
import { ExecutionAbortedError, ExecutionProtocolError, type ExecutionBackend, type ExecutionEvent, type ExecutionOutcome } from "./execution-backend";
import type { ExecutionBackendRegistryContract, ExecutionUseCase } from "./execution-backend-registry";
import {
  WorkspaceAdmission,
  WorkspaceAdmissionAbortError,
  agentRequiresWorkspaceLease,
  assertAgentWorkspacePolicy,
  type WorkspaceLease,
} from "./workspace-admission";

interface AgentTaskRunnerDependencies {
  readonly service: AgentTaskService;
  readonly backendRegistry: ExecutionBackendRegistryContract;
  readonly emitBoardEvent: (event: BoardBridgeEvent) => void;
  readonly admission: WorkspaceAdmission;
  readonly resolveProjectTrust: (projectPath: string) => Promise<boolean>;
  readonly resolveProjectPath: (projectPath: string, trusted: boolean) => Promise<string>;
}

interface ActiveExecution {
  readonly taskId: string;
  readonly agentTaskId: string;
  readonly runtimeToken: string;
  readonly controller: AbortController;
  readonly lease?: WorkspaceLease;
  abortRequested: boolean;
  released: boolean;
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
  readonly #admission: WorkspaceAdmission;
  readonly #resolveProjectTrust: (projectPath: string) => Promise<boolean>;
  readonly #resolveProjectPath: (projectPath: string, trusted: boolean) => Promise<string>;
  #active?: ActiveExecution;
  #waiting?: WaitingExecution;
  #drainPromise?: Promise<void>;
  #draining = false;
  #ready = false;
  #stopping = false;

  constructor(dependencies: AgentTaskRunnerDependencies) {
    this.#service = dependencies.service;
    this.#backendRegistry = dependencies.backendRegistry;
    this.#emitBoardEvent = dependencies.emitBoardEvent;
    this.#admission = dependencies.admission;
    this.#resolveProjectTrust = dependencies.resolveProjectTrust;
    this.#resolveProjectPath = dependencies.resolveProjectPath;
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
    if (!this.#ready || this.#stopping || this.#active || this.#draining) return;
    const pending = this.#drain();
    this.#drainPromise = pending;
    void pending
      .catch((error) => this.#reportError(error))
      .finally(() => { if (this.#drainPromise === pending) this.#drainPromise = undefined; });
  }

  async abortTask(taskId: string): Promise<BoardBootstrap> {
    if (this.#waiting?.taskId === taskId) this.#waiting.controller.abort();
    const result = await this.#service.abortTask(taskId);
    const active = this.#active;
    if (active && active.agentTaskId === (result.runningAgentTaskId ?? result.agentTaskId)) {
      active.abortRequested = true;
      active.controller.abort();
      await active.done;
    }
    this.notify();
    return result.bootstrap;
  }

  async shutdown(): Promise<void> {
    this.#stopping = true;
    this.#ready = false;
    this.#waiting?.controller.abort();
    await this.#drainPromise;
    const active = this.#active;
    if (!active) return;
    try {
      await this.#service.interruptRunning(active.agentTaskId, active.runtimeToken, "Stella 关闭，Agent 执行已中断");
    } catch (cause) {
      if (!(cause instanceof AgentTaskRuntimeExpiredError)) throw cause;
    }
    active.abortRequested = true;
    active.controller.abort();
    await active.done;
  }

  async #drain(): Promise<void> {
    if (this.#draining || this.#stopping || this.#active) return;
    this.#draining = true;
    let foundWork = false;
    try {
      const queued = await this.#service.nextQueued();
      if (!queued || this.#stopping) return;
      foundWork = true;
      const agent = queued.agentTask.agentSnapshot;
      let backend: ExecutionBackend;
      let projectPath: string;
      let trusted: boolean;
      let profileLabel: string;
      try {
        assertAgentWorkspacePolicy(agent);
        this.#backendRegistry.assertCompatible(queued.agentTask.executionProfile.id, useCaseForAgentTask(queued.agentTask));
        const resolved = this.#backendRegistry.resolve(queued.agentTask.executionProfile.id);
        backend = resolved.backend;
        profileLabel = resolved.profile.label;
        trusted = await this.#resolveProjectTrust(queued.task.projectPath);
        projectPath = await this.#resolveProjectPath(queued.task.projectPath, trusted);
      } catch (cause) {
        await this.#service.rejectQueued(queued.agentTask.id, cause);
        return;
      }

      let lease: WorkspaceLease | undefined;
      if (agentRequiresWorkspaceLease(agent)) {
        const controller = new AbortController();
        const waiting = Object.freeze({ taskId: queued.task.id, agentTaskId: queued.agentTask.id, controller });
        this.#waiting = waiting;
        try {
          lease = await this.#admission.acquireBackground(queued.task.projectPath, {
            id: `agent-task:${queued.agentTask.id}`,
            kind: "agent-task",
            label: `AgentTask · ${agent.name} · ${profileLabel}`,
            taskId: queued.task.id,
            executionId: queued.agentTask.id,
          }, {
            signal: controller.signal,
            onQueued: (owner) => this.#service.recordWorkspaceWait(queued.agentTask.id, owner.label).then(() => undefined),
          });
        } catch (cause) {
          if (cause instanceof WorkspaceAdmissionAbortError) return;
          throw cause;
        } finally {
          if (this.#waiting === waiting) this.#waiting = undefined;
        }
      }
      if (this.#stopping) {
        lease?.release();
        return;
      }
      const claimed = await this.#service.claim(queued.agentTask.id);
      if (!claimed) {
        lease?.release();
        return;
      }
      this.#launch(claimed, backend, projectPath, trusted, lease);
    } finally {
      this.#draining = false;
      if (foundWork && !this.#active && !this.#stopping) this.notify();
    }
  }

  #launch(claimed: ClaimedAgentTask, backend: ExecutionBackend, projectPath: string, trusted: boolean, lease?: WorkspaceLease): void {
    const runtimeToken = claimed.agentTask.runtimeToken;
    if (!runtimeToken) {
      lease?.release();
      throw new Error(`已认领 AgentTask ${claimed.agentTask.id} 缺少 runtimeToken`);
    }
    const active: ActiveExecution = {
      taskId: claimed.task.id,
      agentTaskId: claimed.agentTask.id,
      runtimeToken,
      controller: new AbortController(),
      lease,
      abortRequested: false,
      released: false,
    };
    this.#active = active;
    const expectedResult = claimed.agentTask.kind === "coordinator"
      || claimed.agentTask.kind === "coordinator-review"
      || claimed.agentTask.kind === "squad-leader"
      ? "coordinator-action"
      : "report";
    const done = this.#execute(active, backend, claimed, projectPath, trusted, expectedResult);
    active.done = done;
    void done.catch((error) => this.#reportError(error));
  }

  async #execute(
    active: ActiveExecution,
    backend: ExecutionBackend,
    claimed: ClaimedAgentTask,
    projectPath: string,
    trusted: boolean,
    expectedResult: "report" | "coordinator-action",
  ): Promise<void> {
    try {
      const outcome = await backend.run({
        executionId: claimed.agentTask.id,
        runtimeToken: active.runtimeToken,
        profile: claimed.agentTask.executionProfile,
        cwd: projectPath,
        trusted,
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
      if (this.#active !== active || active.abortRequested) return;
      await this.#service.complete(active.agentTaskId, active.runtimeToken, {
        output: outcomeOutput(outcome),
        session: outcome.session,
        backendVersion: outcome.backendVersion,
        inputTokens: outcome.usage?.inputTokens,
        outputTokens: outcome.usage?.outputTokens,
        cost: outcome.usage?.cost,
      });
    } catch (cause) {
      if (this.#active !== active || active.abortRequested || cause instanceof ExecutionAbortedError) return;
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
          await this.#service.complete(active.agentTaskId, active.runtimeToken, { ...result, protocolError: cause.message });
        } else {
          await this.#service.fail(active.agentTaskId, active.runtimeToken, cause, result);
        }
      } else {
        try {
          await this.#service.fail(active.agentTaskId, active.runtimeToken, cause);
        } catch (stale) {
          if (!(stale instanceof AgentTaskRuntimeExpiredError)) throw stale;
        }
      }
    } finally {
      this.#finalize(active);
    }
  }

  async #handleExecutionEvent(active: ActiveExecution, event: ExecutionEvent): Promise<void> {
    if (this.#active !== active || active.abortRequested) return;
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
      await this.#service.recordToolEvent(active.agentTaskId, active.runtimeToken, event.name, event.type === "tool-start");
    }
  }

  #finalize(active: ActiveExecution): void {
    if (!active.released) {
      active.released = true;
      active.lease?.release();
    }
    if (this.#active === active) this.#active = undefined;
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
