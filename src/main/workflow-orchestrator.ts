import { randomUUID } from "node:crypto";
import { backgroundSessionName } from "../shared/session-policy";
import {
  type AgentArtifact,
  type AgentDefinition,
  type BoardBootstrap,
  type BoardBridgeEvent,
  type BoardState,
  type KanbanTask,
  type OrchestrationCatalog,
  type ResolveGateInput,
  type StepRun,
  type TaskActivity,
  type WorkflowDefinition,
  type WorkflowRun,
} from "../shared/kanban";
import type { BoardRepository } from "./board-repository";
import { applyTaskLifecycle } from "../shared/task-lifecycle";
import {
  beginWorkflowExecution,
  finishExecutionLifecycle,
  nextExecutionAttempt,
  reportWorkflowExecution,
  snapshotTaskSpec,
  supersedePendingExecutions,
} from "../shared/execution-state";
import { catalogForBoard } from "../shared/orchestration-catalog";
import {
  ExecutionWorkspaceAbortError,
  type ExecutionWorkspaceHandle,
  type ExecutionWorkspaceProvider,
} from "./execution-workspace";
import { executionProfileAgentIncompatibility, snapshotExecutionProfile, type ExecutionProfileId } from "../shared/execution-profile";
import { ExecutionAbortedError, ExecutionProtocolError, type ExecutionBackend, type ExecutionEvent, type ExecutionOutcome } from "./execution-backend";
import type { ExecutionBackendRegistryContract } from "./execution-backend-registry";
import {
  ExecutionCapacity,
  ExecutionCapacityAbortError,
  type ExecutionCapacityLease,
} from "./execution-capacity";

interface OrchestratorDependencies {
  readonly repository: BoardRepository;
  readonly catalog: OrchestrationCatalog;
  readonly backendRegistry: ExecutionBackendRegistryContract;
  readonly emitBoardEvent: (event: BoardBridgeEvent) => void;
  readonly workspace: ExecutionWorkspaceProvider;
  readonly capacity?: ExecutionCapacity;
  readonly now?: () => string;
  readonly id?: () => string;
}

interface ActiveAgentRun {
  readonly taskId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly runtimeToken: string;
  readonly controller: AbortController;
  readonly workspace: ExecutionWorkspaceHandle;
  readonly capacity: ExecutionCapacityLease;
  abortRequested: boolean;
  done?: Promise<void>;
}

interface WaitingAdmission {
  readonly taskId: string;
  readonly controller: AbortController;
}

function cloneAgent(definition: AgentDefinition): AgentDefinition {
  return Object.freeze({
    ...definition,
    allowedTools: Object.freeze([...definition.allowedTools]),
    requiredSkills: definition.requiredSkills ? Object.freeze([...definition.requiredSkills]) : undefined,
  });
}

function cloneWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  return Object.freeze({
    ...definition,
    steps: Object.freeze(definition.steps.map((step) => Object.freeze({ ...step }))),
  });
}

export class WorkflowOrchestrator {
  readonly #repository: BoardRepository;
  readonly #catalog: OrchestrationCatalog;
  readonly #backendRegistry: ExecutionBackendRegistryContract;
  readonly #emitBoardEvent: (event: BoardBridgeEvent) => void;
  readonly #workspace: ExecutionWorkspaceProvider;
  readonly #capacity: ExecutionCapacity;
  readonly #now: () => string;
  readonly #id: () => string;
  readonly #activeAgents = new Map<string, ActiveAgentRun>();
  readonly #waitingAdmissions = new Map<string, WaitingAdmission>();
  #stopping = false;

  constructor(dependencies: OrchestratorDependencies) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#backendRegistry = dependencies.backendRegistry;
    this.#emitBoardEvent = dependencies.emitBoardEvent;
    this.#workspace = dependencies.workspace;
    this.#capacity = dependencies.capacity ?? new ExecutionCapacity();
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#id = dependencies.id ?? randomUUID;
  }

  async dispatch(taskId: string): Promise<BoardBootstrap> {
    if (this.#stopping) throw new Error("WorkflowOrchestrator 正在关闭");
    const preview = await this.#repository.read();
    const previewTask = this.#task(preview, taskId);
    if (previewTask.executionTarget.kind !== "workflow") throw new Error("任务的执行目标不是固定流程");
    if (this.#backendRegistry.snapshot().health.some((health) => health.state === "checking")) {
      await this.#backendRegistry.initialize();
    }
    if (!previewTask.executionProfileId) throw new Error(`任务 ${previewTask.id} 未选择执行 Profile`);
    const previewWorkflow = this.#workflow(previewTask.executionTarget.workflowId);
    const previewAgentIds = new Set(previewWorkflow.steps.flatMap((step) => step.kind === "agent" ? [step.agentId] : []));
    const previewAgents = Object.freeze([...previewAgentIds].map((agentId) => this.#agent(agentId)));
    this.#assertWorkflowProfile(previewTask.executionProfileId, previewAgents);
    this.#backendRegistry.resolve(previewTask.executionProfileId);
    await this.#workspace.resolve(previewTask.projectPath, previewTask.executionWorkspace);
    const now = this.#now();
    let runId = "";
    const bootstrap = await this.#commit((current) => {
      const task = this.#task(current, taskId);
      if (task.activeRunId || task.activeAgentTaskId) throw new Error("任务已有正在进行的执行");
      if (task.stage === "completed") throw new Error("已完成任务需先移回待规划列才能重新分发");
      if (task.executionTarget.kind !== "workflow") throw new Error("任务的执行目标不是固定流程");
      const workflowDefinition = this.#workflow(task.executionTarget.workflowId);
      const workflow = cloneWorkflow(workflowDefinition);
      const agentIds = new Set(workflow.steps.filter((step) => step.kind === "agent").map((step) => step.agentId));
      const agents = Object.freeze([...agentIds].map((id) => cloneAgent(this.#agent(id))));
      if (!task.executionProfileId) throw new Error(`任务 ${task.id} 未选择执行 Profile`);
      this.#assertWorkflowProfile(task.executionProfileId, agents);
      this.#backendRegistry.resolve(task.executionProfileId);
      const executionProfile = snapshotExecutionProfile(task.executionProfileId);
      runId = this.#id();
      const executionAttempt = nextExecutionAttempt(task);
      const run: WorkflowRun = Object.freeze({
        id: runId,
        taskId: task.id,
        executionAttempt,
        taskSpec: snapshotTaskSpec(task),
        executionProfile,
        workflow,
        agents,
        status: "queued",
        acceptance: "not-ready",
        steps: Object.freeze(workflow.steps.map((step) => Object.freeze({
          id: this.#id(),
          stepId: step.id,
          stepKind: step.kind,
          name: step.name,
          status: "pending" as const,
          agentId: step.kind === "agent" ? step.agentId : undefined,
        }))),
        startedAt: now,
        updatedAt: now,
      });
      const superseded = supersedePendingExecutions(current, task.id);
      const nextTask = beginWorkflowExecution(task, run.id, executionAttempt, now);
      return {
        ...superseded,
        tasks: superseded.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate),
        runs: [run, ...superseded.runs],
        activities: [...superseded.activities, this.#activity(task.id, "dispatch", `已分发「${workflow.shortName}」`, "等待第一个执行角色", now, run.id)],
      };
    });
    void this.#advance(runId).catch((error) => this.#failRun(runId, error)).catch((error) => this.#reportError(error));
    return bootstrap;
  }

  async resolveGate(input: ResolveGateInput): Promise<BoardBootstrap> {
    const now = this.#now();
    let runId = "";
    const bootstrap = await this.#commit((current) => {
      const task = this.#task(current, input.taskId);
      if (!task.activeRunId) throw new Error("任务当前没有等待处理的流程");
      const run = this.#run(current, task.activeRunId);
      runId = run.id;
      if (run.status !== "review" || !run.currentStepId) throw new Error("流程当前不在人工关卡");
      const step = run.steps.find((candidate) => candidate.stepId === run.currentStepId);
      if (!step || step.stepKind !== "human-gate" || step.status !== "waiting") {
        throw new Error("流程的人工关卡状态无效");
      }
      const comment = input.comment.trim();
      if (input.decision === "reject") {
        const rejectedStep: StepRun = Object.freeze({
          ...step,
          status: "failed",
          completedAt: now,
          error: comment || "用户驳回人工关卡",
        });
        const blockedRun: WorkflowRun = Object.freeze({
          ...run,
          status: "blocked",
          currentStepId: undefined,
          steps: Object.freeze(run.steps.map((candidate) => candidate.id === step.id ? rejectedStep : candidate)),
          updatedAt: now,
          completedAt: now,
        });
        const blockedTask = finishExecutionLifecycle(task, { type: "execution-failed", reason: comment || "人工关卡被驳回" }, now);
        return {
          ...current,
          tasks: current.tasks.map((candidate) => candidate.id === task.id ? blockedTask : candidate),
          runs: current.runs.map((candidate) => candidate.id === run.id ? blockedRun : candidate),
          activities: [...current.activities, this.#activity(task.id, "gate", `${step.name}已驳回`, comment || undefined, now, run.id, step.stepId)],
        };
      }

      const approvedStep: StepRun = Object.freeze({
        ...step,
        status: "succeeded",
        completedAt: now,
        artifact: Object.freeze({ title: `${step.name} · 人工决定`, content: comment || "已批准" }),
      });
      const runningRun: WorkflowRun = Object.freeze({
        ...run,
        status: "running",
        currentStepId: undefined,
        steps: Object.freeze(run.steps.map((candidate) => candidate.id === step.id ? approvedStep : candidate)),
        updatedAt: now,
      });
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(candidate, { type: "execution-queued" }, now)
          : candidate),
        runs: current.runs.map((candidate) => candidate.id === run.id ? runningRun : candidate),
        activities: [...current.activities, this.#activity(task.id, "gate", `${step.name}已批准`, comment || undefined, now, run.id, step.stepId)],
      };
    });
    if (input.decision === "approve") void this.#advance(runId).catch((error) => this.#failRun(runId, error)).catch((error) => this.#reportError(error));
    return bootstrap;
  }

  async abort(taskId: string): Promise<BoardBootstrap> {
    const state = await this.#repository.read();
    const task = this.#task(state, taskId);
    if (!task.activeRunId) throw new Error("任务当前没有可中止的流程");
    const runId = task.activeRunId;
    this.#waitingAdmissions.get(runId)?.controller.abort();
    const active = this.#activeAgents.get(runId);
    const now = this.#now();
    const bootstrap = await this.#commit((current) => {
      const latestTask = this.#task(current, taskId);
      const run = this.#run(current, runId);
      if (["failed", "blocked", "interrupted", "reported"].includes(run.status)) {
        throw new Error("流程已经进入终态，不能再次中止");
      }
      const interruptedRun: WorkflowRun = Object.freeze({
        ...run,
        status: "interrupted",
        currentStepId: undefined,
        steps: Object.freeze(run.steps.map((step) => step.status === "running" || step.status === "waiting"
          ? Object.freeze({ ...step, status: "interrupted" as const, runtimeToken: undefined, completedAt: now, error: "用户中止" })
          : step)),
        updatedAt: now,
        completedAt: now,
      });
      const interruptedTask = finishExecutionLifecycle(latestTask, { type: "execution-interrupted", reason: "用户中止流程" }, now);
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === taskId ? interruptedTask : candidate),
        runs: current.runs.map((candidate) => candidate.id === runId ? interruptedRun : candidate),
        activities: [...current.activities, this.#activity(taskId, "status", "流程已由用户中止", undefined, now, runId)],
      };
    });
    if (active) {
      active.abortRequested = true;
      active.controller.abort();
      await active.done;
    }
    return bootstrap;
  }

  async shutdown(): Promise<void> {
    this.#stopping = true;
    for (const waiting of this.#waitingAdmissions.values()) waiting.controller.abort();
    const active = [...this.#activeAgents.values()];
    const now = this.#now();
    const activeRunIds = new Set([
      ...active.map((entry) => entry.runId),
      ...this.#waitingAdmissions.keys(),
    ]);
    if (activeRunIds.size > 0) {
      await this.#repository.update((current) => {
        const tasksByRunId = new Map(current.tasks.filter((task) => task.activeRunId).map((task) => [task.activeRunId as string, task]));
        const interruptedRunIds = new Set(current.runs
          .filter((run) => activeRunIds.has(run.id) && (run.status === "queued" || run.status === "running"))
          .map((run) => run.id));
        if (interruptedRunIds.size === 0) return current;
        const activities = [...interruptedRunIds].flatMap((runId) => {
          const task = tasksByRunId.get(runId);
          if (!task) return [];
          return [this.#activity(task.id, "error", "应用关闭，流程已中断", "运行进程已在持久化终态后停止。", now, runId)];
        });
        return {
          ...current,
          tasks: current.tasks.map((task) => task.activeRunId && interruptedRunIds.has(task.activeRunId)
            ? finishExecutionLifecycle(task, { type: "execution-interrupted", reason: "应用关闭，流程已中断" }, now)
            : task),
          runs: current.runs.map((run) => interruptedRunIds.has(run.id)
            ? Object.freeze({
                ...run,
                status: "interrupted" as const,
                currentStepId: undefined,
                steps: Object.freeze(run.steps.map((step) => step.status === "running"
                  ? Object.freeze({ ...step, status: "interrupted" as const, runtimeToken: undefined, error: "应用关闭", completedAt: now })
                  : step)),
                updatedAt: now,
                completedAt: now,
              })
            : run),
          activities: [...current.activities, ...activities],
        };
      });
    }
    for (const entry of active) {
      entry.abortRequested = true;
      entry.controller.abort();
    }
    await Promise.all(active.map((entry) => entry.done));
    this.#waitingAdmissions.clear();
  }

  async #advance(runId: string): Promise<void> {
    if (this.#stopping) return;
    const state = await this.#repository.read();
    const run = this.#run(state, runId);
    const task = this.#task(state, run.taskId);
    if (run.executionAttempt !== task.executionAttempt || run.taskSpec.revision !== task.specRevision) return;
    if (task.activeRunId !== run.id || ["blocked", "failed", "interrupted", "reported"].includes(run.status)) return;
    const step = run.steps.find((candidate) => candidate.status === "pending");
    if (!step) {
      await this.#completeRun(run, task);
      return;
    }
    const definition = run.workflow.steps.find((candidate) => candidate.id === step.stepId);
    if (!definition) throw new Error(`流程快照缺少步骤定义: ${step.stepId}`);
    if (definition.kind === "human-gate") {
      await this.#waitAtGate(run, task, step);
      return;
    }
    const agent = run.agents.find((candidate) => candidate.id === definition.agentId);
    if (!agent) throw new Error(`流程快照缺少 Agent: ${definition.agentId}`);
    this.#assertWorkflowProfile(run.executionProfile.id, run.agents);
    const resolvedBackend = this.#backendRegistry.resolve(run.executionProfile.id);
    const controller = new AbortController();
    const waiting = Object.freeze({ taskId: task.id, controller });
    this.#waitingAdmissions.set(run.id, waiting);
    let capacity: ExecutionCapacityLease | undefined;
    let workspace: ExecutionWorkspaceHandle | undefined;
    try {
      capacity = await this.#capacity.acquire(`workflow:${run.id}:${step.stepId}`, controller.signal);
      workspace = await this.#workspace.acquire({
        projectPath: task.projectPath,
        preference: run.taskSpec.executionWorkspace ?? task.executionWorkspace,
        existingPlacement: run.workspacePlacement,
        executionAttempt: run.executionAttempt,
        agent,
        owner: {
          id: `workflow:${run.id}:${step.stepId}`,
          kind: "workflow",
          label: `Workflow · ${run.workflow.shortName} / ${agent.name} · ${resolvedBackend.profile.label}`,
          taskId: task.id,
          executionId: run.id,
        },
        signal: controller.signal,
        onQueued: (owner) => this.#queueForWriter(run, task, step, agent, owner.label),
      });
    } catch (cause) {
      workspace?.release();
      capacity?.release();
      if (cause instanceof ExecutionWorkspaceAbortError || cause instanceof ExecutionCapacityAbortError) return;
      throw cause;
    } finally {
      if (this.#waitingAdmissions.get(run.id) === waiting) this.#waitingAdmissions.delete(run.id);
    }
    if (this.#stopping) {
      workspace.release();
      capacity.release();
      return;
    }
    const latest = await this.#repository.read();
    const latestTask = latest.tasks.find((candidate) => candidate.id === task.id);
    const latestRun = latest.runs.find((candidate) => candidate.id === run.id);
    const latestStep = latestRun?.steps.find((candidate) => candidate.id === step.id);
    if (latestTask?.activeRunId !== run.id || !latestRun || !latestStep || latestStep.status !== "pending" || ["failed", "blocked", "interrupted", "reported"].includes(latestRun.status)) {
      workspace.release();
      capacity.release();
      return;
    }
    await this.#startAgent(
      run,
      task,
      step,
      definition.objective,
      agent,
      resolvedBackend.backend,
      resolvedBackend.health.version,
      workspace,
      capacity,
      controller,
    );
  }

  async #waitAtGate(run: WorkflowRun, task: KanbanTask, step: StepRun): Promise<void> {
    const now = this.#now();
    await this.#commit((current) => {
      const latestRun = this.#run(current, run.id);
      const latestTask = this.#task(current, task.id);
      if (latestTask.activeRunId !== run.id || ["blocked", "failed", "interrupted", "reported"].includes(latestRun.status)) return current;
      const waitingStep: StepRun = Object.freeze({ ...step, status: "waiting", startedAt: now });
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(candidate, { type: "awaiting-human" }, now)
          : candidate),
        runs: current.runs.map((candidate) => candidate.id === run.id
          ? Object.freeze({
              ...latestRun,
              status: "review" as const,
              currentStepId: step.stepId,
              steps: Object.freeze(latestRun.steps.map((item) => item.id === step.id ? waitingStep : item)),
              updatedAt: now,
            })
          : candidate),
        activities: [...current.activities, this.#activity(task.id, "gate", `等待人工处理：${step.name}`, undefined, now, run.id, step.stepId)],
      };
    });
  }

  async #queueForWriter(run: WorkflowRun, task: KanbanTask, step: StepRun, agent: AgentDefinition, blockingOwner: string): Promise<void> {
    const now = this.#now();
    await this.#commit((current) => {
      const latestRun = this.#run(current, run.id);
      const latestTask = this.#task(current, task.id);
      if (latestTask.activeRunId !== run.id || ["blocked", "failed", "interrupted", "reported"].includes(latestRun.status)) return current;
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(candidate, { type: "execution-queued" }, now)
          : candidate),
        runs: current.runs.map((candidate) => candidate.id === run.id
          ? Object.freeze({ ...latestRun, status: "queued" as const, currentStepId: step.stepId, updatedAt: now })
          : candidate),
        activities: [...current.activities, this.#activity(task.id, "status", `${agent.name}等待项目写入席位`, `当前占用者：${blockingOwner}`, now, run.id, step.stepId)],
      };
    });
  }

  async #startAgent(
    run: WorkflowRun,
    task: KanbanTask,
    step: StepRun,
    objective: string,
    agent: AgentDefinition,
    backend: ExecutionBackend,
    backendVersion: string | undefined,
    workspace: ExecutionWorkspaceHandle,
    capacity: ExecutionCapacityLease,
    controller: AbortController,
  ): Promise<void> {
    const runtimeToken = this.#id();
    const active: ActiveAgentRun = {
      taskId: task.id,
      runId: run.id,
      stepId: step.stepId,
      runtimeToken,
      controller,
      workspace,
      capacity,
      abortRequested: false,
    };
    this.#activeAgents.set(run.id, active);
    const startedAt = this.#now();
    let applied = false;
    try {
      await this.#commit((current) => {
        const latestRun = this.#run(current, run.id);
        const latestTask = this.#task(current, task.id);
        applied = latestTask.activeRunId === run.id && !["blocked", "failed", "interrupted", "reported"].includes(latestRun.status);
        if (!applied) return current;
        const runningStep: StepRun = Object.freeze({ ...step, status: "running", runtimeToken, backendVersion, startedAt });
        return {
          ...current,
          tasks: current.tasks.map((candidate) => candidate.id === task.id
            ? applyTaskLifecycle(candidate, { type: "execution-started" }, startedAt)
            : candidate),
          runs: current.runs.map((candidate) => candidate.id === run.id
            ? Object.freeze({
                ...latestRun,
                status: "running" as const,
                currentStepId: step.stepId,
                workspacePlacement: latestRun.workspacePlacement ?? workspace.placement,
                steps: Object.freeze(latestRun.steps.map((item) => item.id === step.id ? runningStep : item)),
                updatedAt: startedAt,
              })
            : candidate),
          activities: [...current.activities, this.#activity(
            task.id,
            "agent",
            `${agent.name}开始执行「${step.name}」`,
            workspace.placement.strategy === "isolated-worktree"
              ? `${workspace.placement.branch ?? agent.callsign} · ${workspace.cwd}`
              : agent.callsign,
            startedAt,
            run.id,
            step.stepId,
          )],
        };
      });
    } catch (cause) {
      this.#finalizeActive(active);
      throw cause;
    }
    if (!applied) {
      this.#finalizeActive(active);
      return;
    }
    const done = this.#executeAgent(active, backend, run, task, step, objective, agent);
    active.done = done;
    void done.catch((error) => this.#reportError(error));
  }

  async #executeAgent(
    active: ActiveAgentRun,
    backend: ExecutionBackend,
    run: WorkflowRun,
    task: KanbanTask,
    step: StepRun,
    objective: string,
    agent: AgentDefinition,
  ): Promise<void> {
    let shouldAdvance = false;
    try {
      const outcome = await backend.run({
        executionId: step.id,
        runtimeToken: active.runtimeToken,
        profile: run.executionProfile,
        cwd: active.workspace.cwd,
        trusted: active.workspace.trusted,
        sessionName: backgroundSessionName({ taskId: task.id, executionKind: "workflow-step", executionId: step.id, label: `${task.title} · ${step.name}` }),
        prompt: this.#promptFor(run, task, step, objective, agent),
        agent,
        expectedResult: "report",
      }, (event) => void this.#handleExecutionEvent(active, event).catch((error) => this.#failRun(active.runId, error, active.runtimeToken)).catch((error) => this.#reportError(error)), active.controller.signal);
      if (this.#activeAgents.get(active.runId) !== active || active.abortRequested) return;
      shouldAdvance = await this.#completeAgentStep(active, outcome);
    } catch (cause) {
      if (this.#activeAgents.get(active.runId) !== active || active.abortRequested || cause instanceof ExecutionAbortedError) return;
      await this.#failRun(active.runId, cause, active.runtimeToken);
    } finally {
      this.#finalizeActive(active);
    }
    if (shouldAdvance && !active.abortRequested && !this.#stopping) await this.#advance(active.runId);
  }

  async #handleExecutionEvent(active: ActiveAgentRun, event: ExecutionEvent): Promise<void> {
    if (this.#activeAgents.get(active.runId) !== active || active.abortRequested) return;
    const eventType = event.type === "tool-start"
      ? "tool_execution_start"
      : event.type === "tool-end"
        ? "tool_execution_end"
        : event.type;
    const toolName = event.type === "tool-start" || event.type === "tool-end" ? event.name : undefined;
    const message = event.type === "stderr" ? event.message : event.type === "assistant-output" ? event.text : undefined;
    this.#emitBoardEvent({
      type: "agent-event",
      taskId: active.taskId,
      runId: active.runId,
      stepId: active.stepId,
      eventType,
      toolName,
      message,
    });
    if (event.type === "tool-start" || event.type === "tool-end") {
      const now = this.#now();
      await this.#commit((current) => {
        const latestRun = current.runs.find((candidate) => candidate.id === active.runId);
        const latestStep = latestRun?.steps.find((candidate) => candidate.stepId === active.stepId);
        if (this.#activeAgents.get(active.runId) !== active || latestStep?.runtimeToken !== active.runtimeToken) return current;
        return {
          ...current,
          activities: [...current.activities, this.#activity(
            active.taskId,
            "tool",
            `${event.name}${event.type === "tool-start" ? "开始运行" : "运行结束"}`,
            undefined,
            now,
            active.runId,
            active.stepId,
          )],
        };
      });
    }
  }

  async #completeAgentStep(active: ActiveAgentRun, outcome: ExecutionOutcome): Promise<boolean> {
    if (outcome.result.kind !== "report") throw new Error("Workflow Agent Backend 返回了非报告结果");
    const board = await this.#repository.read();
    const run = this.#run(board, active.runId);
    if (["failed", "blocked", "interrupted", "reported"].includes(run.status)) return false;
    if (run.workspacePlacement?.resourceId !== active.workspace.placement.resourceId) {
      throw new Error(`WorkflowRun ${run.id} 的 Execution Workspace identity 已失效`);
    }
    const step = run.steps.find((candidate) => candidate.stepId === active.stepId && candidate.runtimeToken === active.runtimeToken);
    if (!step) throw new Error(`找不到运行步骤: ${active.stepId}`);
    const now = this.#now();
    const artifact: AgentArtifact = Object.freeze({
      title: `${step.name} · Agent 产物`,
      content: outcome.result.output,
      session: outcome.session,
      inputTokens: outcome.usage?.inputTokens,
      outputTokens: outcome.usage?.outputTokens,
      cost: outcome.usage?.cost,
      startedAt: step.startedAt,
      completedAt: now,
    });
    let applied = false;
    await this.#commit((current) => {
      const latestRun = this.#run(current, active.runId);
      const latestTask = this.#task(current, active.taskId);
      const latestStep = latestRun.steps.find((candidate) => candidate.stepId === active.stepId);
      if (this.#activeAgents.get(active.runId) !== active || latestTask.activeRunId !== active.runId || latestRun.status !== "running"
        || latestStep?.runtimeToken !== active.runtimeToken) {
        return current;
      }
      applied = true;
      const completedStep: StepRun = Object.freeze({
        ...latestStep,
        status: "succeeded",
        runtimeToken: undefined,
        backendVersion: outcome.backendVersion ?? latestStep.backendVersion,
        session: outcome.session,
        artifact,
        completedAt: now,
      });
      return {
        ...current,
        runs: current.runs.map((candidate) => candidate.id === active.runId
          ? Object.freeze({
              ...latestRun,
              status: "running" as const,
              currentStepId: undefined,
              steps: Object.freeze(latestRun.steps.map((item) => item.id === completedStep.id ? completedStep : item)),
              updatedAt: now,
            })
          : candidate),
        activities: [...current.activities, this.#activity(
          active.taskId,
          "artifact",
          `${step.name}已产出结果`,
          outcome.session?.sessionPath ?? outcome.session?.sessionId,
          now,
          active.runId,
          active.stepId,
        )],
      };
    });
    return applied;
  }

  #finalizeActive(active: ActiveAgentRun): void {
    active.workspace.release();
    active.capacity.release();
    if (this.#activeAgents.get(active.runId) === active) this.#activeAgents.delete(active.runId);
  }

  async #completeRun(run: WorkflowRun, task: KanbanTask): Promise<void> {
    const now = this.#now();
    await this.#commit((current) => {
      const latestRun = this.#run(current, run.id);
      const latestTask = this.#task(current, task.id);
      const reportedRun: WorkflowRun = Object.freeze({ ...latestRun, status: "reported" as const, acceptance: "pending" as const, currentStepId: undefined, updatedAt: now, completedAt: now });
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? reportWorkflowExecution(latestTask, reportedRun, now)
          : candidate),
        runs: current.runs.map((candidate) => candidate.id === run.id
          ? reportedRun
          : candidate),
        activities: [...current.activities, this.#activity(task.id, "status", "流程已完成", run.workflow.name, now, run.id)],
      };
    });
  }

  async #failRun(runId: string, cause: unknown, runtimeToken?: string): Promise<void> {
    const message = cause instanceof Error ? cause.message : String(cause);
    const active = this.#activeAgents.get(runId);
    if (runtimeToken !== undefined && active && active.runtimeToken !== runtimeToken) return;
    const ownedActive = active && (runtimeToken === undefined || active.runtimeToken === runtimeToken) ? active : undefined;
    const ownedExecution = runtimeToken !== undefined && ownedActive?.runtimeToken === runtimeToken;
    if (runtimeToken === undefined) this.#waitingAdmissions.get(runId)?.controller.abort();
    if (ownedActive && !ownedActive.abortRequested) {
      ownedActive.abortRequested = true;
      ownedActive.controller.abort();
    }
    const now = this.#now();
    await this.#commit((current) => {
      const latestRun = current.runs.find((candidate) => candidate.id === runId);
      if (!latestRun || ["failed", "blocked", "interrupted", "reported"].includes(latestRun.status)) return current;
      const latestTask = this.#task(current, latestRun.taskId);
      if (latestTask.activeRunId !== runId) return current;
      if (runtimeToken && !ownedExecution
        && !latestRun.steps.some((step) => step.status === "running" && step.runtimeToken === runtimeToken)) return current;
      const failedStepId = latestRun.steps.find((step) => step.stepId === latestRun.currentStepId && step.status === "running")?.stepId
        ?? latestRun.steps.find((step) => step.status === "running" || step.status === "pending")?.stepId;
      const protocolFailure = cause instanceof ExecutionProtocolError ? cause : undefined;
      const failedRun: WorkflowRun = Object.freeze({
        ...latestRun,
        status: "failed",
        currentStepId: undefined,
        steps: Object.freeze(latestRun.steps.map((step) => step.stepId === failedStepId
          ? Object.freeze({
              ...step,
              status: "failed" as const,
              runtimeToken: undefined,
              backendVersion: protocolFailure?.backendVersion ?? step.backendVersion,
              session: protocolFailure?.session ?? step.session,
              artifact: protocolFailure?.output
                ? Object.freeze({
                    title: `${step.name} · 失败前部分产物`,
                    content: protocolFailure.output,
                    session: protocolFailure.session,
                    inputTokens: protocolFailure.usage?.inputTokens,
                    outputTokens: protocolFailure.usage?.outputTokens,
                    cost: protocolFailure.usage?.cost,
                    startedAt: step.startedAt,
                    completedAt: now,
                  })
                : step.artifact,
              error: message,
              completedAt: now,
            })
          : step)),
        updatedAt: now,
        completedAt: now,
      });
      const failedTask = finishExecutionLifecycle(latestTask, { type: "execution-failed", reason: message }, now);
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === latestTask.id ? failedTask : candidate),
        runs: current.runs.map((candidate) => candidate.id === runId ? failedRun : candidate),
        activities: [...current.activities, this.#activity(latestTask.id, "error", "流程执行失败", message, now, runId, latestRun.currentStepId)],
      };
    });
    if (ownedActive && ownedActive.done === undefined) this.#finalizeActive(ownedActive);
  }

  #reportError(cause: unknown): void {
    this.#emitBoardEvent({
      type: "automation-error",
      source: "workflow-orchestrator",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  #promptFor(run: WorkflowRun, task: KanbanTask, step: StepRun, objective: string, agent: AgentDefinition): string {
    const artifacts = run.steps
      .filter((candidate) => candidate.artifact)
      .map((candidate) => `### ${candidate.name}\n${candidate.artifact?.content ?? ""}`)
      .join("\n\n");
    return [
      `# Stella 固定流程任务`,
      ``,
      `项目：${task.projectName}`,
      `任务：${run.taskSpec.title}`,
      `当前步骤：${step.name}`,
      `执行角色：${agent.name}（${agent.callsign}）`,
      ``,
      `## 任务说明`,
      run.taskSpec.description || "（未提供补充说明）",
      ``,
      `## 验收标准`,
      run.taskSpec.acceptanceCriteria || "（未提供补充标准，请以任务目标和项目约束为准）",
      ``,
      `## 当前步骤目标`,
      objective,
      ``,
      `## 角色固定指令`,
      agent.instructions,
      ``,
      `## 上游产物`,
      artifacts || "（这是第一个 Agent 步骤）",
      ``,
      `只完成当前角色职责。最终回复必须是一份可交给下一角色或人工关卡的独立产物，并如实写明失败和未验证项。`,
    ].join("\n");
  }

  #task(state: BoardState, taskId: string): KanbanTask {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`找不到任务: ${taskId}`);
    return task;
  }

  #run(state: BoardState, runId: string): WorkflowRun {
    const run = state.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`找不到流程实例: ${runId}`);
    return run;
  }

  #workflow(workflowId: string): WorkflowDefinition {
    const workflow = this.#catalog.workflows.find((candidate) => candidate.id === workflowId);
    if (!workflow) throw new Error(`未知流程模板: ${workflowId}`);
    return workflow;
  }

  #agent(agentId: string): AgentDefinition {
    const agent = this.#catalog.agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`未知 Agent: ${agentId}`);
    return agent;
  }

  #assertWorkflowProfile(profileId: ExecutionProfileId, agents: readonly AgentDefinition[]): void {
    this.#backendRegistry.assertCompatible(profileId, "workflow-step");
    const incompatibility = executionProfileAgentIncompatibility(profileId, agents);
    if (incompatibility) throw new Error(incompatibility);
  }

  #activity(
    taskId: string,
    kind: TaskActivity["kind"],
    summary: string,
    detail: string | undefined,
    now: string,
    runId?: string,
    stepId?: string,
  ): TaskActivity {
    return Object.freeze({ id: this.#id(), taskId, runId, stepId, kind, summary, detail, createdAt: now });
  }

  async #commit(transform: (current: BoardState) => BoardState): Promise<BoardBootstrap> {
    let changed = false;
    const board = await this.#repository.update((current) => {
      const next = transform(current);
      changed = next !== current;
      return next;
    });
    const bootstrap = Object.freeze({ board, catalog: catalogForBoard(this.#catalog, board) });
    if (changed) this.#emitBoardEvent({ type: "snapshot", bootstrap });
    return bootstrap;
  }
}
