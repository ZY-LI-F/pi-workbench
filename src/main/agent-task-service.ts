import { randomUUID } from "node:crypto";
import { requireTaskProject } from "../shared/task-project";
import { sameProjectPath } from "../shared/project-path";
import type { BoardRepository } from "./board-repository";
import { availableMentionAgentsForTask, parseAgentMentions } from "../shared/agent-mentions";
import { coordinatorActionMessage, isCoordinatorRootAgentTask, normalizeSquadLeaderInstructions, parseCoordinatorAction, type CoordinatorAction, type CoordinatorDelegation } from "../shared/coordinator-protocol";
import { catalogForBoard } from "../shared/orchestration-catalog";
import { applyTaskLifecycle } from "../shared/task-lifecycle";
import {
  beginAgentExecution,
  finishExecutionLifecycle,
  nextExecutionAttempt,
  reportAgentExecution,
  snapshotTaskSpec,
  supersedePendingExecutions,
} from "../shared/execution-state";
import { deriveTeamLaunchDraft } from "../shared/team-launch";
import { deriveAgentTaskQueue } from "../shared/agent-task-scheduler";
import {
  isTerminalAgentTaskStatus,
  type AgentDefinition,
  type AgentExecutionPlanSnapshot,
  type AgentTask,
  type BoardBootstrap,
  type BoardState,
  type CreateTaskCommentInput,
  cloneExecutionWorkspacePlacement,
  type ExecutionWorkspacePlacementSnapshot,
  type LaunchTeamTaskInput,
  type KanbanTask,
  type OrchestrationCatalog,
  type Squad,
  type TaskActivity,
  type TaskComment,
} from "../shared/kanban";
import {
  executionProfile,
  executionProfileAgentIncompatibility,
  PI_COORDINATOR_PROFILE_REQUIRED,
  profileSupports,
  snapshotExecutionProfile,
  type ExecutionProfileId,
  type ExecutionProfileSnapshot,
} from "../shared/execution-profile";
import type { ExecutionSessionReference } from "../shared/execution-session";

export interface TeamLaunchContext extends LaunchTeamTaskInput {
  readonly projectPath: string;
  readonly projectName: string;
  readonly trusted: boolean;
}

interface AgentTaskServiceDependencies {
  readonly repository: BoardRepository;
  readonly catalog: OrchestrationCatalog;
  readonly emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly skills: {
    assertAgentsReady(projectPath: string, trusted: boolean, agents: readonly AgentDefinition[]): Promise<void>;
  };
  readonly assertExecutionProfileAvailable?: (
    profileId: ExecutionProfileId,
    useCase: "direct-agent" | "worker-mention" | "coordinator" | "squad",
  ) => void;
  readonly now?: () => string;
  readonly id?: () => string;
}

export interface ClaimedAgentTask {
  readonly task: KanbanTask;
  readonly agentTask: AgentTask;
}

export interface AgentTaskResult {
  readonly output: string;
  /** Set when a Backend exits without its required terminal protocol result. */
  readonly protocolError?: string;
  readonly session?: ExecutionSessionReference;
  readonly backendVersion?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
}

export type AgentTaskFailureResult = Omit<AgentTaskResult, "protocolError">;

interface AgentTaskResultFields {
  readonly runtimeToken: undefined;
  readonly output: string;
  readonly session?: ExecutionSessionReference;
  readonly backendVersion?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
  readonly updatedAt: string;
}

export interface AbortedAgentTask {
  readonly bootstrap: BoardBootstrap;
  readonly agentTaskId: string;
  readonly runningAgentTaskId?: string;
  readonly wasRunning: boolean;
}

export class AgentTaskRuntimeExpiredError extends Error {
  readonly agentTaskId: string;

  constructor(agentTaskId: string) {
    super(`AgentTask ${agentTaskId} 的 Runtime 已失效`);
    this.name = "AgentTaskRuntimeExpiredError";
    this.agentTaskId = agentTaskId;
  }
}

function cloneAgent(agent: AgentDefinition): AgentDefinition {
  return Object.freeze({
    ...agent,
    allowedTools: Object.freeze([...agent.allowedTools]),
    requiredSkills: agent.requiredSkills ? Object.freeze([...agent.requiredSkills]) : undefined,
  });
}

function coordinatorPlan(availableAgents: readonly AgentDefinition[]): AgentExecutionPlanSnapshot {
  return Object.freeze({
    kind: "coordinator",
    delegates: Object.freeze(availableAgents.filter((agent) => agent.id !== "lead").map(cloneAgent)),
  });
}

function squadPlan(squad: Squad, members: readonly AgentDefinition[]): Extract<AgentExecutionPlanSnapshot, { readonly kind: "squad" }> {
  return Object.freeze({
    kind: "squad",
    squadId: squad.id,
    squadVersion: squad.version,
    squadName: squad.name,
    leaderInstructions: normalizeSquadLeaderInstructions(squad.leaderInstructions),
    delegates: Object.freeze(members.map(cloneAgent)),
  });
}

function normalizedRequired(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}必须是字符串`);
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label}不能为空`);
  return normalized;
}

function agentTaskRound(agentTask: AgentTask): number {
  return agentTask.delegationRound ?? 1;
}

function coordinatorRole(agentTask: AgentTask): string {
  return agentTask.executionPlan?.kind === "squad" ? "Squad Leader" : "LEAD";
}

function coordinatorProtocolInstructions(): readonly string[] {
  return Object.freeze([
    "必须把 coordinator_action 工具作为本回合最后且唯一的终止动作；不要手写 JSON，也不要用自然语言或 @mention 代替工具调用。",
    "action 必须是 delegate、request_revision、replan、complete、ask_human 之一。",
    "delegate/request_revision/replan 必须提供非空 delegations；每项精确包含 agentId、objective、acceptanceCriteria。",
    "ask_human 必须提供 question 且 delegations 为空。complete 的 delegations 必须为空。",
    "Stella 只接受 coordinator_action 的已校验 details，然后才会创建真实 AgentTask；不得声称尚未返回报告的 Agent 已完成工作。",
  ]);
}

export class AgentTaskService {
  readonly #repository: BoardRepository;
  readonly #catalog: OrchestrationCatalog;
  readonly #emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly #now: () => string;
  readonly #id: () => string;
  readonly #skills: AgentTaskServiceDependencies["skills"];
  readonly #assertExecutionProfileAvailable: NonNullable<AgentTaskServiceDependencies["assertExecutionProfileAvailable"]>;

  constructor(dependencies: AgentTaskServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#emitChanged = dependencies.emitChanged;
    this.#skills = dependencies.skills;
    this.#assertExecutionProfileAvailable = dependencies.assertExecutionProfileAvailable ?? (() => undefined);
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#id = dependencies.id ?? randomUUID;
  }

  async addComment(input: CreateTaskCommentInput): Promise<BoardBootstrap> {
    const body = normalizedRequired(input.body, "评论内容");
    const dispatchMentions = input.dispatchMentions !== false;
    const preview = await this.#repository.read();
    const previewTask = this.#task(preview, input.taskId);
    const previewAgents = dispatchMentions ? availableMentionAgentsForTask(previewTask, this.#catalogFor(preview), preview.squads) : Object.freeze([]);
    const previewMentions = dispatchMentions ? parseAgentMentions(body, previewAgents).agents : Object.freeze([]);
    const previewRoot = previewTask.activeAgentTaskId ? preview.agentTasks.find((candidate) => candidate.id === previewTask.activeAgentTaskId) : undefined;
    const previewResumesCoordinator = previewMentions.length === 0 && previewRoot !== undefined && isCoordinatorRootAgentTask(previewRoot) && previewRoot.status === "waiting_human";
    if (previewMentions.length > 0 || previewResumesCoordinator) {
      this.#assertMentionExecution(previewTask, previewMentions, previewResumesCoordinator ? previewRoot : undefined);
    }
    if (previewMentions.length > 0) await this.#skills.assertAgentsReady(requireTaskProject(previewTask), previewTask.trusted, previewMentions);
    const now = this.#now();
    return this.#commit((current) => {
      const task = this.#task(current, input.taskId);
      const availableAgents = dispatchMentions ? availableMentionAgentsForTask(task, this.#catalogFor(current), current.squads) : Object.freeze([]);
      const mentions = dispatchMentions ? parseAgentMentions(body, availableAgents).agents : Object.freeze([]);
      const activeRoot = task.activeAgentTaskId ? this.#agentTask(current, task.activeAgentTaskId) : undefined;
      const resumingCoordinator = mentions.length === 0 && activeRoot !== undefined && isCoordinatorRootAgentTask(activeRoot) && activeRoot.status === "waiting_human";
      if (mentions.length > 0 || resumingCoordinator) {
        this.#assertMentionExecution(task, mentions, resumingCoordinator ? activeRoot : undefined);
      }
      if (mentions.length > 0 && (task.activeRunId || task.activeAgentTaskId)) {
        throw new Error("任务正在执行；请先中止或等待完成后再使用 @mention 分发");
      }
      if (mentions.length > 0 && task.stage === "completed") {
        throw new Error("已完成任务需先移回待规划列才能使用 @mention 分发");
      }

      const comment: TaskComment = Object.freeze({ id: this.#id(), taskId: task.id, author: "user", messageKind: "comment", body, createdAt: now });
      const activities: TaskActivity[] = [this.#activity(task.id, "comment", "用户添加了评论", body, now)];
      if (resumingCoordinator && activeRoot) {
        const reviewRound = Math.max(1, this.#nextCoordinatorRound(current, activeRoot) - 1);
        const review = this.#coordinatorReviewTask(current, task, activeRoot, now, body, reviewRound);
        const waitingRoot: AgentTask = Object.freeze({ ...activeRoot, status: "waiting_children", updatedAt: now });
        const queuedTask = applyTaskLifecycle(task, { type: "execution-queued" }, now);
        return {
          ...current,
          tasks: current.tasks.map((candidate) => candidate.id === task.id ? queuedTask : candidate),
          comments: [...current.comments, comment],
          agentTasks: [...current.agentTasks.map((candidate) => candidate.id === activeRoot.id ? waitingRoot : candidate), review],
          activities: [...current.activities, ...activities, this.#activity(task.id, "dispatch", `用户回复已交给 ${coordinatorRole(activeRoot)} 继续决策`, body, now, review.id)],
        };
      }
      if (mentions.length === 0) {
        return { ...current, comments: [...current.comments, comment], activities: [...current.activities, ...activities] };
      }

      const comments = [...current.comments.filter((candidate) => candidate.taskId === task.id), comment];
      const rootAgent = mentions[0];
      if (!rootAgent) throw new Error("mention 解析结果缺少根 Agent");
      const leadMention = mentions.find((agent) => agent.id === "lead");
      if (leadMention && rootAgent.id !== "lead") throw new Error("@lead 必须是消息中的第一个 Agent mention，由 LEAD 决定后续委派");
      if (leadMention && mentions.length > 1) {
        throw new Error("@lead 协调模式不能与直接 Worker mention 混用；请让 LEAD 通过结构化计划委派");
      }
      const rootId = this.#id();
      const executionAttempt = nextExecutionAttempt(task);
      const taskSpec = snapshotTaskSpec(task);
      const executionProfile = this.#executionProfile(task);
      const squadId = task.executionTarget.kind === "squad" ? task.executionTarget.squadId : undefined;
      const root: AgentTask = Object.freeze({
        id: rootId,
        taskId: task.id,
        executionAttempt,
        taskSpec,
        executionProfile,
        agentSnapshot: cloneAgent(rootAgent),
        kind: rootAgent.id === "lead" ? "coordinator" : mentions.length > 1 ? "mention-root" : "direct",
        status: "queued",
        acceptance: "not-ready",
        prompt: rootAgent.id === "lead"
          ? this.#coordinatorPrompt(task, body, availableAgents, comments)
          : this.#promptFor(task, rootAgent, comments),
        squadId,
        executionPlan: rootAgent.id === "lead" ? coordinatorPlan(availableAgents) : undefined,
        createdAt: now,
        updatedAt: now,
      });
      const children = (rootAgent.id === "lead" ? [] : mentions.slice(1)).map((agent) => Object.freeze({
        id: this.#id(),
        taskId: task.id,
        executionAttempt,
        taskSpec,
        executionProfile,
        agentSnapshot: cloneAgent(agent),
        kind: "delegated" as const,
        status: "queued" as const,
        acceptance: "not-ready" as const,
        prompt: this.#mentionPrompt(task, agent, body),
        parentAgentTaskId: rootId,
        squadId,
        createdAt: now,
        updatedAt: now,
      }));
      const superseded = supersedePendingExecutions(current, task.id);
      const nextTask = beginAgentExecution(task, rootId, executionAttempt, now);
      activities.push(this.#activity(task.id, "dispatch", `评论已分发给 ${mentions.map((agent) => agent.name).join("、")}`, body, now, rootId));
      return {
        ...superseded,
        tasks: superseded.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate),
        comments: [...superseded.comments, comment],
        agentTasks: [...superseded.agentTasks, root, ...children],
        activities: [...superseded.activities, ...activities],
      };
    });
  }

  async launchTeamTask(input: TeamLaunchContext): Promise<BoardBootstrap> {
    const body = normalizedRequired(input.body, "启动指令");
    const acceptanceCriteria = normalizedRequired(input.acceptanceCriteria, "验收标准");
    const draft = deriveTeamLaunchDraft(body, acceptanceCriteria);
    const projectPath = normalizedRequired(input.projectPath, "项目路径");
    const projectName = normalizedRequired(input.projectName, "项目名称");
    const preview = await this.#repository.read();
    const previewAvailable = availableMentionAgentsForTask(
      { projectPath, executionTarget: Object.freeze({ kind: "agent", agentId: "lead" }) },
      this.#catalogFor(preview),
      preview.squads,
    );
    const previewParsed = parseAgentMentions(body, previewAvailable);
    if (previewParsed.tokens.length !== 1 || previewParsed.agents.length !== 1) throw new Error("任务启动台必须指定一个无歧义的负责人");
    const previewTarget = previewParsed.agents[0];
    if (!previewTarget) throw new Error(`找不到任务负责人：@${draft.targetToken}`);
    this.#assertExecutionFor("pi.rpc", previewTarget.id === "lead" ? "coordinator" : "direct-agent", Object.freeze([previewTarget]));
    await this.#skills.assertAgentsReady(projectPath, input.trusted, Object.freeze([previewTarget]));
    const now = this.#now();
    return this.#commit((current) => {
      const catalog = this.#catalogFor(current);
      const availableForProject = availableMentionAgentsForTask(
        { projectPath, executionTarget: Object.freeze({ kind: "agent", agentId: "lead" }) },
        catalog,
        current.squads,
      );
      const parsed = parseAgentMentions(body, availableForProject);
      if (parsed.tokens.length !== 1 || parsed.agents.length !== 1) throw new Error("任务启动台必须指定一个无歧义的负责人");
      const target = parsed.agents[0];
      if (!target) throw new Error(`找不到任务负责人：@${draft.targetToken}`);
      this.#assertExecutionFor("pi.rpc", target.id === "lead" ? "coordinator" : "direct-agent", Object.freeze([target]));

      const task: KanbanTask = Object.freeze({
        id: this.#id(),
        title: draft.title,
        description: draft.objective,
        acceptanceCriteria: draft.acceptanceCriteria,
        priority: draft.priority,
        projectPath,
        projectName,
        trusted: input.trusted,
        executionTarget: Object.freeze({ kind: "agent", agentId: target.id }),
        executionProfileId: "pi.rpc",
        stage: "planned",
        specRevision: 1,
        executionAttempt: 0,
        createdAt: now,
        updatedAt: now,
      });
      const availableAgents = availableMentionAgentsForTask(task, catalog, current.squads);

      const comment: TaskComment = Object.freeze({
        id: this.#id(),
        taskId: task.id,
        author: "user",
        messageKind: "comment",
        body,
        createdAt: now,
      });
      const seeded: BoardState = {
        ...current,
        tasks: [task, ...current.tasks],
        comments: [...current.comments, comment],
        activities: [
          ...current.activities,
          this.#activity(task.id, "task", "任务由任务启动台创建", draft.objective, now),
          this.#activity(task.id, "comment", `用户向 ${target.name} 提交了启动指令`, body, now),
        ],
      };
      const root = this.#rootAgentTask(
        task,
        target,
        target.id === "lead" ? "coordinator" : "direct",
        target.id === "lead"
          ? this.#coordinatorPrompt(task, body, availableAgents, [comment])
          : this.#promptFor(task, target, [comment]),
        now,
        undefined,
        target.id === "lead" ? coordinatorPlan(availableAgents) : undefined,
      );
      return this.#withDispatchedRoot(
        seeded,
        task,
        root,
        target.id === "lead" ? "任务启动台已交给 LEAD 协调" : `任务启动台已直接交给 ${target.name}`,
        `@${target.callsign}`,
        now,
      );
    });
  }

  async dispatchDirect(taskId: string): Promise<BoardBootstrap> {
    const preview = await this.#repository.read();
    const previewTask = this.#dispatchableTask(preview, taskId);
    if (previewTask.executionTarget.kind !== "agent") throw new Error("任务的执行目标不是单 Agent");
    const previewAgent = this.#agent(preview, previewTask.executionTarget.agentId, previewTask.projectPath);
    this.#assertTaskExecution(previewTask, previewAgent.id === "lead" ? "coordinator" : "direct-agent", Object.freeze([previewAgent]));
    await this.#skills.assertAgentsReady(previewTask.projectPath, previewTask.trusted, Object.freeze([previewAgent]));
    const now = this.#now();
    return this.#commit((current) => {
      const task = this.#dispatchableTask(current, taskId);
      if (task.executionTarget.kind !== "agent") throw new Error("任务的执行目标不是单 Agent");
      const agent = this.#agent(current, task.executionTarget.agentId, task.projectPath);
      this.#assertTaskExecution(task, agent.id === "lead" ? "coordinator" : "direct-agent", Object.freeze([agent]));
      const agentTask = this.#rootAgentTask(
        task,
        agent,
        agent.id === "lead" ? "coordinator" : "direct",
        agent.id === "lead"
          ? this.#coordinatorPrompt(task, `请规划并推进任务「${task.title}」`, availableMentionAgentsForTask(task, this.#catalogFor(current), current.squads), current.comments.filter((comment) => comment.taskId === task.id))
          : this.#promptFor(task, agent, current.comments.filter((comment) => comment.taskId === task.id)),
        now,
        undefined,
        agent.id === "lead"
          ? coordinatorPlan(availableMentionAgentsForTask(task, this.#catalogFor(current), current.squads))
          : undefined,
      );
      return this.#withDispatchedRoot(current, task, agentTask, `已分发给 ${agent.name}`, `@${agent.id}`, now);
    });
  }

  async dispatchSquad(taskId: string): Promise<BoardBootstrap> {
    const preview = await this.#repository.read();
    const previewTask = this.#dispatchableTask(preview, taskId);
    if (previewTask.executionTarget.kind !== "squad") throw new Error("任务的执行目标不是 Squad");
    const previewSquad = this.#squad(preview, previewTask.executionTarget.squadId);
    const previewLeader = this.#agent(preview, previewSquad.leaderAgentId, previewTask.projectPath);
    this.#assertTaskExecution(previewTask, "squad", Object.freeze([previewLeader]));
    await this.#skills.assertAgentsReady(previewTask.projectPath, previewTask.trusted, Object.freeze([previewLeader]));
    const now = this.#now();
    return this.#commit((current) => {
      const task = this.#dispatchableTask(current, taskId);
      if (task.executionTarget.kind !== "squad") throw new Error("任务的执行目标不是 Squad");
      const squad = this.#squad(current, task.executionTarget.squadId);
      const leader = this.#agent(current, squad.leaderAgentId, task.projectPath);
      const members = squad.memberAgentIds.map((agentId) => this.#agent(current, agentId, task.projectPath));
      this.#assertTaskExecution(task, "squad", Object.freeze([leader, ...members]));
      const plan = squadPlan(squad, members);
      const agentTask = this.#rootAgentTask(task, leader, "coordinator", this.#squadCoordinatorPrompt(
        task,
        plan,
        leader,
        current.comments.filter((comment) => comment.taskId === task.id),
      ), now, squad.id, plan);
      return this.#withDispatchedRoot(current, task, agentTask, `Squad「${squad.name}」已启动`, `${leader.name} 担任 Leader`, now);
    });
  }

  async nextQueued(excludedAgentTaskIds: ReadonlySet<string> = new Set()): Promise<ClaimedAgentTask | undefined> {
    for (;;) {
      const current = await this.#repository.read();
      const queue = deriveAgentTaskQueue(current, this.#now());
      const invalid = queue.find((entry) => entry.disposition === "invalid");
      if (invalid) {
        await this.rejectQueued(invalid.agentTask.id, new Error(`AgentTask 队列状态无效：${invalid.reason}`));
        continue;
      }
      const next = queue
        .filter((entry) => entry.disposition === "ready" && !excludedAgentTaskIds.has(entry.agentTask.id))
        .sort((left, right) => (left.queuePosition ?? Number.MAX_SAFE_INTEGER) - (right.queuePosition ?? Number.MAX_SAFE_INTEGER))[0]
        ?.agentTask;
      if (!next) return undefined;
      try {
        const task = this.#task(current, next.taskId);
        return Object.freeze({ task, agentTask: next });
      } catch (cause) {
        await this.rejectQueued(next.id, cause);
      }
    }
  }

  async claim(agentTaskId: string): Promise<ClaimedAgentTask | undefined> {
    const runtimeToken = this.#id();
    const now = this.#now();
    let claimed = false;
    const board = await this.#repository.update((current) => {
      const next = current.agentTasks.find((agentTask) => agentTask.id === agentTaskId);
      if (!next || next.status !== "queued") return current;
      const queue = deriveAgentTaskQueue(current, now);
      if (queue.some((entry) => entry.disposition === "invalid")) return current;
      if (queue.find((entry) => entry.agentTask.id === agentTaskId)?.disposition !== "ready") return current;
      const task = this.#task(current, next.taskId);
      claimed = true;
      let normalized = next.kind === "squad-leader" && next.executionPlan?.kind === "squad"
        ? Object.freeze({
            ...next,
            prompt: this.#squadCoordinatorPrompt(
              task,
              next.executionPlan,
              next.agentSnapshot,
              current.comments.filter((comment) => comment.taskId === task.id),
            ),
          })
        : next;
      if (next.kind === "delegated" && next.parentAgentTaskId) {
        const parent = current.agentTasks.find((candidate) => candidate.id === next.parentAgentTaskId);
        if (parent?.kind === "mention-root") {
          const group = current.agentTasks.filter((candidate) => candidate.id === parent.id || candidate.parentAgentTaskId === parent.id);
          const nextIndex = group.findIndex((candidate) => candidate.id === next.id);
          const predecessors = group.slice(0, Math.max(0, nextIndex)).filter((candidate) => candidate.output);
          normalized = Object.freeze({ ...normalized, prompt: this.#mentionHandoffPrompt(normalized.prompt, predecessors) });
        }
      }
      const running: AgentTask = Object.freeze({ ...normalized, status: "running", runtimeToken, startedAt: now, updatedAt: now });
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(candidate, { type: "execution-started" }, now)
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => candidate.id === next.id ? running : candidate),
        activities: [...current.activities, this.#activity(task.id, "agent", `${next.agentSnapshot.name}开始执行`, next.kind, now, next.id)],
      };
    });
    if (!claimed) return undefined;
    const bootstrap = Object.freeze({ board, catalog: this.#catalogFor(board) });
    this.#emitChanged(bootstrap);
    const agentTask = board.agentTasks.find((candidate) => candidate.id === agentTaskId);
    if (!agentTask) throw new Error(`认领后找不到 AgentTask: ${agentTaskId}`);
    return Object.freeze({ task: this.#task(board, agentTask.taskId), agentTask });
  }

  async recordWorkspacePlacement(
    agentTaskId: string,
    placement: ExecutionWorkspacePlacementSnapshot,
  ): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#agentTask(current, agentTaskId);
      if (agentTask.status !== "queued") throw new Error(`AgentTask ${agentTaskId} 不在 queued 状态`);
      if (agentTask.workspacePlacement) {
        if (agentTask.workspacePlacement.strategy !== placement.strategy
          || agentTask.workspacePlacement.resourceId !== placement.resourceId
          || agentTask.workspacePlacement.cwd !== placement.cwd) {
          throw new Error(`AgentTask ${agentTaskId} 已绑定另一个 Execution Workspace`);
        }
        return current;
      }
      const snapshot = cloneExecutionWorkspacePlacement(placement);
      const location = snapshot?.strategy === "isolated-worktree"
        ? `${snapshot.branch ?? "isolated worktree"} · ${snapshot.cwd}`
        : snapshot?.cwd;
      return {
        ...current,
        agentTasks: current.agentTasks.map((candidate) => candidate.id === agentTask.id
          ? Object.freeze({ ...candidate, workspacePlacement: snapshot, updatedAt: now })
          : candidate),
        activities: [...current.activities, this.#activity(
          agentTask.taskId,
          "status",
          `${agentTask.agentSnapshot.name}执行工作区已准备`,
          location,
          now,
          agentTask.id,
        )],
      };
    });
  }

  async recordWorkspaceWait(agentTaskId: string, blockingOwner: string): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#agentTask(current, agentTaskId);
      if (agentTask.status !== "queued") return current;
      return {
        ...current,
        activities: [...current.activities, this.#activity(
          agentTask.taskId,
          "status",
          `${agentTask.agentSnapshot.name}等待项目写入席位`,
          `当前占用者：${blockingOwner}`,
          now,
          agentTask.id,
        )],
      };
    });
  }

  async rejectQueued(agentTaskId: string, cause: unknown): Promise<BoardBootstrap> {
    const message = cause instanceof Error ? cause.message : String(cause);
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#agentTask(current, agentTaskId);
      if (agentTask.status !== "queued") throw new Error(`AgentTask ${agentTaskId} 不在 queued 状态`);
      const task = this.#task(current, agentTask.taskId);
      const recovered = this.#recoverCoordinatorChildFailure(current, task, agentTask, message, now);
      if (recovered) return recovered;
      const rootId = this.#rootAgentTaskId(current, agentTask);
      const groupIds = this.#agentTaskGroupIds(current, rootId);
      if (task.activeAgentTaskId !== rootId) {
        return {
          ...current,
          agentTasks: current.agentTasks.map((candidate) => {
            if (!groupIds.has(candidate.id) || isTerminalAgentTaskStatus(candidate.status)) return candidate;
            return Object.freeze({
              ...candidate,
              status: candidate.id === agentTask.id || candidate.id === rootId ? "failed" as const : "cancelled" as const,
              runtimeToken: undefined,
              error: candidate.id === agentTask.id || candidate.id === rootId ? message : "过期执行组已取消",
              updatedAt: now,
              completedAt: now,
            });
          }),
          activities: [
            ...current.activities,
            this.#activity(task.id, "error", "已拒绝不属于当前执行的 AgentTask", message, now, agentTask.id),
          ],
        };
      }
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? finishExecutionLifecycle(task, { type: "execution-failed", reason: message }, now)
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => {
          if (candidate.id === agentTask.id) return Object.freeze({ ...candidate, status: "failed" as const, error: message, updatedAt: now, completedAt: now });
          if (!groupIds.has(candidate.id) || isTerminalAgentTaskStatus(candidate.status)) return candidate;
          if (candidate.id === rootId) return Object.freeze({ ...candidate, status: "failed" as const, error: `子任务无法启动：${message}`, updatedAt: now, completedAt: now });
          return Object.freeze({ ...candidate, status: "cancelled" as const, error: "同组 AgentTask 无法安全启动", updatedAt: now, completedAt: now });
        }),
        activities: [...current.activities, this.#activity(task.id, "error", `${agentTask.agentSnapshot.name}未通过启动前权限验证`, message, now, agentTask.id)],
      };
    });
  }

  async reconcileWaitingParents(): Promise<BoardBootstrap | undefined> {
    const current = await this.#repository.read();
    const failedStatus = (candidate: AgentTask): boolean => candidate.status === "failed" || candidate.status === "interrupted" || candidate.status === "cancelled" || candidate.status === "protocol-invalid";
    const waitingParents = current.agentTasks.filter((candidate) => candidate.status === "waiting_children");
    const recoverableParents = waitingParents.filter((parent) => {
      if (!isCoordinatorRootAgentTask(parent)) return false;
      const delegated = current.agentTasks.filter((child) => child.parentAgentTaskId === parent.id && child.kind === "delegated");
      if (delegated.length === 0) return false;
      const latestRound = Math.max(...delegated.map(agentTaskRound));
      const roundChildren = delegated.filter((child) => agentTaskRound(child) === latestRound);
      const reviewExists = current.agentTasks.some((child) => child.parentAgentTaskId === parent.id
        && child.kind === "coordinator-review"
        && agentTaskRound(child) === latestRound);
      return !reviewExists && roundChildren.every((child) => isTerminalAgentTaskStatus(child.status));
    });
    const brokenParents = waitingParents.filter((parent) => {
      const children = current.agentTasks.filter((child) => child.parentAgentTaskId === parent.id);
      if (!isCoordinatorRootAgentTask(parent)) return children.some(failedStatus);
      return children.some((child) => child.kind === "coordinator-review" && failedStatus(child));
    });
    if (recoverableParents.length === 0 && brokenParents.length === 0) return undefined;
    const now = this.#now();
    const brokenIds = new Set(brokenParents.map((parent) => parent.id));
    return this.#commit((state) => {
      const reviews = recoverableParents.flatMap((snapshot) => {
        const parent = state.agentTasks.find((candidate) => candidate.id === snapshot.id);
        const task = state.tasks.find((candidate) => candidate.id === snapshot.taskId);
        if (!parent || !task || parent.status !== "waiting_children" || !isCoordinatorRootAgentTask(parent)) return [];
        const delegated = state.agentTasks.filter((child) => child.parentAgentTaskId === parent.id && child.kind === "delegated");
        if (delegated.length === 0) return [];
        const latestRound = Math.max(...delegated.map(agentTaskRound));
        const roundChildren = delegated.filter((child) => agentTaskRound(child) === latestRound);
        const reviewExists = state.agentTasks.some((child) => child.parentAgentTaskId === parent.id
          && child.kind === "coordinator-review"
          && agentTaskRound(child) === latestRound);
        if (reviewExists || !roundChildren.every((child) => isTerminalAgentTaskStatus(child.status))) return [];
        return [this.#coordinatorReviewTask(state, task, parent, now, undefined, latestRound)];
      });
      const activities = brokenParents.map((parent) => this.#activity(
        parent.taskId,
        "error",
        "父 AgentTask 因子任务终态失败",
        "应用恢复时发现失败、中断或取消的子任务。",
        now,
        parent.id,
      ));
      const recoveryActivities = reviews.map((review) => this.#activity(
        review.taskId,
        "dispatch",
        `恢复第 ${agentTaskRound(review)} 轮 Coordinator 验收回合`,
        "应用启动时发现成员均已返回终态，但验收回合尚未入队。",
        now,
        review.id,
      ));
      return {
        ...state,
        tasks: state.tasks.map((task) => task.activeAgentTaskId && brokenIds.has(task.activeAgentTaskId)
          ? finishExecutionLifecycle(task, { type: "execution-failed", reason: "子 AgentTask 未成功完成" }, now)
          : task),
        agentTasks: [...state.agentTasks.map((agentTask) => {
          if (brokenIds.has(agentTask.id)) {
            return Object.freeze({ ...agentTask, status: "failed" as const, error: "子 AgentTask 未成功完成", updatedAt: now, completedAt: now });
          }
          if (agentTask.parentAgentTaskId && brokenIds.has(agentTask.parentAgentTaskId) && !isTerminalAgentTaskStatus(agentTask.status)) {
            return Object.freeze({ ...agentTask, status: "cancelled" as const, runtimeToken: undefined, error: "父 AgentTask 已失败", updatedAt: now, completedAt: now });
          }
          return agentTask;
        }), ...reviews],
        activities: [...state.activities, ...activities, ...recoveryActivities],
      };
    });
  }

  async complete(agentTaskId: string, runtimeToken: string, result: AgentTaskResult, workspaceResourceId?: string): Promise<BoardBootstrap> {
    const output = normalizedRequired(result.output, "Agent 最终输出");
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#runningAgentTask(current, agentTaskId, runtimeToken, workspaceResourceId);
      const task = this.#task(current, agentTask.taskId);
      const resultFields: AgentTaskResultFields = Object.freeze({
        runtimeToken: undefined,
        output,
        session: result.session,
        backendVersion: result.backendVersion,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: result.cost,
        updatedAt: now,
      });
      const comment: TaskComment = Object.freeze({
        id: this.#id(), taskId: task.id, author: "agent", authorAgentId: agentTask.agentSnapshot.id,
        messageKind: "execution-report", agentTaskId: agentTask.id, body: output, createdAt: now,
      });
      const baseActivities = [...current.activities, this.#activity(task.id, "artifact", `${agentTask.agentSnapshot.name}已产出结果`, result.session?.sessionPath, now, agentTask.id)];

      if (agentTask.kind === "coordinator" || agentTask.kind === "coordinator-review" || agentTask.kind === "squad-leader") {
        const plan = agentTask.executionPlan;
        if (!plan) throw new Error(`Coordinator AgentTask ${agentTask.id} 缺少分发时执行计划快照`);
        if (result.protocolError) {
          return this.#applyCoordinatorProtocolFailure(current, task, agentTask, resultFields, comment, baseActivities, new Error(result.protocolError), now);
        }
        let action: CoordinatorAction;
        try {
          action = parseCoordinatorAction(output, plan.delegates);
        } catch (cause) {
          return this.#applyCoordinatorProtocolFailure(current, task, agentTask, resultFields, comment, baseActivities, cause, now);
        }
        const coordinatorComment: TaskComment = Object.freeze({ ...comment, body: coordinatorActionMessage(action) });
        return this.#applyCoordinatorAction(current, task, agentTask, resultFields, action, coordinatorComment, baseActivities, now);
      }

      if (agentTask.kind === "mention-root") {
        const children = current.agentTasks.filter((candidate) => candidate.parentAgentTaskId === agentTask.id);
        if (children.length === 0) throw new Error(`mention root ${agentTask.id} 缺少子任务`);
        const waitingRoot: AgentTask = Object.freeze({ ...agentTask, ...resultFields, status: "waiting_children" });
        return {
          ...current,
          tasks: current.tasks.map((candidate) => candidate.id === task.id
            ? applyTaskLifecycle(candidate, { type: "execution-queued" }, now)
            : candidate),
          agentTasks: current.agentTasks.map((candidate) => candidate.id === agentTask.id ? waitingRoot : candidate),
          comments: [...current.comments, comment],
          activities: baseActivities,
        };
      }

      const reported: AgentTask = Object.freeze({
        ...agentTask,
        ...resultFields,
        status: "reported",
        acceptance: agentTask.parentAgentTaskId ? "not-ready" : "pending",
        completedAt: now,
      });
      if (agentTask.kind === "delegated") {
        const parent = this.#agentTask(current, agentTask.parentAgentTaskId ?? "");
        if (parent.status !== "waiting_children") throw new Error(`父 AgentTask ${parent.id} 未在等待子任务`);
        if (isCoordinatorRootAgentTask(parent)) {
          const round = agentTaskRound(agentTask);
          const workers = current.agentTasks
            .filter((candidate) => candidate.parentAgentTaskId === parent.id
              && candidate.kind === "delegated"
              && agentTaskRound(candidate) === round)
            .map((candidate) => candidate.id === agentTask.id ? reported : candidate);
          const allTerminal = workers.length > 0 && workers.every((candidate) => isTerminalAgentTaskStatus(candidate.status));
          const review = allTerminal ? this.#coordinatorReviewTask(current, task, parent, now, reported, round) : undefined;
          return {
            ...current,
            tasks: current.tasks.map((candidate) => candidate.id === task.id
              ? applyTaskLifecycle(candidate, { type: "execution-queued" }, now)
              : candidate),
            agentTasks: [
              ...current.agentTasks.map((candidate) => candidate.id === agentTask.id ? reported : candidate),
              ...(review ? [review] : []),
            ],
            comments: [...current.comments, comment],
            activities: review
              ? [...baseActivities, this.#activity(task.id, "dispatch", `第 ${round} 轮成员已全部返回终态，${coordinatorRole(parent)} 进入验收回合`, undefined, now, review.id)]
              : baseActivities,
          };
        }
        const children = current.agentTasks
          .filter((candidate) => candidate.parentAgentTaskId === parent.id)
          .map((candidate) => candidate.id === agentTask.id ? reported : candidate);
        const allReported = children.every((candidate) => candidate.status === "reported");
        const completedParent: AgentTask = allReported
          ? Object.freeze({ ...parent, status: "reported", acceptance: "pending", updatedAt: now, completedAt: now })
          : parent;
        return {
          ...current,
          tasks: current.tasks.map((candidate) => candidate.id === task.id
            ? allReported
              ? reportAgentExecution(task, parent, now)
              : applyTaskLifecycle(task, { type: "execution-queued" }, now)
            : candidate),
          agentTasks: current.agentTasks.map((candidate) => {
            if (candidate.id === agentTask.id) return reported;
            if (candidate.id === parent.id) return completedParent;
            return candidate;
          }),
          comments: [...current.comments, comment],
          activities: allReported
            ? [...baseActivities, this.#activity(task.id, "status", "所有 Squad/mention 子任务已完成", undefined, now, parent.id)]
            : baseActivities,
        };
      }

      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? reportAgentExecution(task, agentTask, now)
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => candidate.id === agentTask.id ? reported : candidate),
        comments: [...current.comments, comment],
        activities: baseActivities,
      };
    });
  }

  async fail(agentTaskId: string, runtimeToken: string, cause: unknown, result?: AgentTaskFailureResult, workspaceResourceId?: string): Promise<BoardBootstrap> {
    const message = cause instanceof Error ? cause.message : String(cause);
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#runningAgentTask(current, agentTaskId, runtimeToken, workspaceResourceId);
      const task = this.#task(current, agentTask.taskId);
      const failureFields = result ? Object.freeze({
        output: normalizedRequired(result.output, "Agent 部分输出"),
        session: result.session,
        backendVersion: result.backendVersion,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: result.cost,
      }) : undefined;
      const recovered = this.#recoverCoordinatorChildFailure(current, task, agentTask, message, now, failureFields);
      if (recovered) return recovered;
      const rootId = this.#rootAgentTaskId(current, agentTask);
      const groupIds = this.#agentTaskGroupIds(current, rootId);
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? finishExecutionLifecycle(task, { type: "execution-failed", reason: message }, now)
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => {
          if (candidate.id === agentTask.id) return Object.freeze({ ...candidate, ...failureFields, status: "failed" as const, runtimeToken: undefined, error: message, updatedAt: now, completedAt: now });
          if (!groupIds.has(candidate.id) || isTerminalAgentTaskStatus(candidate.status)) return candidate;
          if (candidate.id === rootId) return Object.freeze({ ...candidate, status: "failed" as const, runtimeToken: undefined, error: `子任务失败：${message}`, updatedAt: now, completedAt: now });
          return Object.freeze({ ...candidate, status: "cancelled" as const, runtimeToken: undefined, error: "同组 AgentTask 已失败", updatedAt: now, completedAt: now });
        }),
        activities: [...current.activities, this.#activity(task.id, "error", `${agentTask.agentSnapshot.name}执行失败`, message, now, agentTask.id)],
      };
    });
  }

  async abortTask(taskId: string, expectedAgentTaskId?: string): Promise<AbortedAgentTask> {
    const now = this.#now();
    let rootId = "";
    let runningAgentTaskId: string | undefined;
    const bootstrap = await this.#commit((current) => {
      const task = this.#task(current, taskId);
      if (!task.activeAgentTaskId) throw new Error("任务当前没有可中止的 Agent 执行");
      if (expectedAgentTaskId && task.activeAgentTaskId !== expectedAgentTaskId) {
        throw new Error("AgentTask execution 已变化，请刷新后重试");
      }
      const root = this.#agentTask(current, task.activeAgentTaskId);
      if (isTerminalAgentTaskStatus(root.status)) throw new Error("AgentTask 已经进入终态");
      rootId = root.id;
      const groupIds = this.#agentTaskGroupIds(current, root.id);
      const running = current.agentTasks.find((candidate) => groupIds.has(candidate.id) && candidate.status === "running");
      runningAgentTaskId = running?.id;
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? finishExecutionLifecycle(task, { type: "execution-interrupted", reason: "用户中止 Agent 执行" }, now)
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => {
          if (!groupIds.has(candidate.id) || isTerminalAgentTaskStatus(candidate.status)) return candidate;
          const wasRunning = candidate.status === "running";
          return Object.freeze({
            ...candidate,
            status: wasRunning ? "interrupted" as const : "cancelled" as const,
            runtimeToken: undefined,
            error: wasRunning ? "用户中止 Agent 执行" : "用户取消同组排队执行",
            updatedAt: now,
            completedAt: now,
          });
        }),
        activities: [...current.activities, this.#activity(task.id, "status", running ? "Agent 执行已由用户中止" : "排队执行已由用户取消", undefined, now, root.id)],
      };
    });
    return Object.freeze({ bootstrap, agentTaskId: rootId, runningAgentTaskId, wasRunning: runningAgentTaskId !== undefined });
  }

  async interruptRunning(agentTaskId: string, runtimeToken: string, reason: string, workspaceResourceId?: string): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#runningAgentTask(current, agentTaskId, runtimeToken, workspaceResourceId);
      const task = this.#task(current, agentTask.taskId);
      const rootId = this.#rootAgentTaskId(current, agentTask);
      const groupIds = this.#agentTaskGroupIds(current, rootId);
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? finishExecutionLifecycle(task, { type: "execution-interrupted", reason }, now)
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => {
          if (!groupIds.has(candidate.id) || isTerminalAgentTaskStatus(candidate.status)) return candidate;
          return Object.freeze({
            ...candidate,
            status: candidate.id === agentTask.id || candidate.id === rootId ? "interrupted" as const : "cancelled" as const,
            runtimeToken: undefined,
            error: candidate.id === agentTask.id || candidate.id === rootId ? reason : "同组运行在应用关闭时取消",
            updatedAt: now,
            completedAt: now,
          });
        }),
        activities: [...current.activities, this.#activity(task.id, "error", "Agent 执行已中断", reason, now, agentTask.id)],
      };
    });
  }

  async recordToolEvent(agentTaskId: string, runtimeToken: string, toolName: string, started: boolean, workspaceResourceId?: string): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#runningAgentTask(current, agentTaskId, runtimeToken, workspaceResourceId);
      return {
        ...current,
        activities: [...current.activities, this.#activity(agentTask.taskId, "tool", `${toolName}${started ? "开始运行" : "运行结束"}`, undefined, now, agentTask.id)],
      };
    });
  }

  async read(): Promise<BoardState> {
    return this.#repository.read();
  }

  #dispatchableTask(state: BoardState, taskId: string): KanbanTask & { readonly projectPath: string } {
    const task = this.#task(state, taskId);
    if (task.activeRunId || task.activeAgentTaskId) throw new Error("任务已有正在进行的执行");
    if (task.stage === "completed") throw new Error("已完成任务需先移回待规划列才能重新分发");
    return { ...task, projectPath: requireTaskProject(task) };
  }

  #rootAgentTask(
    task: KanbanTask,
    agent: AgentDefinition,
    kind: "direct" | "squad-leader" | "coordinator",
    prompt: string,
    now: string,
    squadId?: string,
    executionPlan?: AgentExecutionPlanSnapshot,
  ): AgentTask {
    const executionAttempt = nextExecutionAttempt(task);
    return Object.freeze({
      id: this.#id(), taskId: task.id, executionAttempt, taskSpec: snapshotTaskSpec(task), executionProfile: this.#executionProfile(task), agentSnapshot: cloneAgent(agent), kind, status: "queued", acceptance: "not-ready", prompt, squadId, executionPlan, createdAt: now, updatedAt: now,
    });
  }

  #executionProfile(task: KanbanTask): ExecutionProfileSnapshot {
    if (!task.executionProfileId) throw new Error(`任务 ${task.id} 未选择执行 Profile`);
    return snapshotExecutionProfile(task.executionProfileId);
  }

  #assertMentionExecution(task: KanbanTask, agents: readonly AgentDefinition[], coordinator?: AgentTask): void {
    const profileId = coordinator?.executionProfile.id ?? task.executionProfileId;
    if (!profileId) throw new Error(`任务 ${task.id} 未选择执行 Profile`);
    const useCase = coordinator || agents.some((agent) => agent.id === "lead") ? "coordinator" : "worker-mention";
    this.#assertExecutionFor(profileId, useCase, agents);
  }

  #assertTaskExecution(
    task: KanbanTask,
    useCase: "direct-agent" | "worker-mention" | "coordinator" | "squad",
    agents: readonly AgentDefinition[],
  ): void {
    if (!task.executionProfileId) throw new Error(`任务 ${task.id} 未选择执行 Profile`);
    this.#assertExecutionFor(task.executionProfileId, useCase, agents);
  }

  #assertExecutionFor(
    profileId: ExecutionProfileId,
    useCase: "direct-agent" | "worker-mention" | "coordinator" | "squad",
    agents: readonly AgentDefinition[],
  ): void {
    if (profileId !== "pi.rpc" && (useCase === "coordinator" || useCase === "squad")) {
      throw new Error(PI_COORDINATOR_PROFILE_REQUIRED);
    }
    if (!profileSupports(profileId, useCase)) {
      throw new Error(`${executionProfile(profileId).label} 不支持 ${useCase}`);
    }
    const reason = executionProfileAgentIncompatibility(profileId, agents);
    if (reason) throw new Error(reason);
    this.#assertExecutionProfileAvailable(profileId, useCase);
  }

  #withDispatchedRoot(
    state: BoardState,
    task: KanbanTask,
    agentTask: AgentTask,
    summary: string,
    detail: string,
    now: string,
  ): BoardState {
    const superseded = supersedePendingExecutions(state, task.id);
    const nextTask = beginAgentExecution(task, agentTask.id, agentTask.executionAttempt, now);
    return {
      ...superseded,
      tasks: superseded.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate),
      agentTasks: [...superseded.agentTasks, agentTask],
      activities: [...superseded.activities, this.#activity(task.id, "dispatch", summary, detail, now, agentTask.id)],
    };
  }

  #runningAgentTask(state: BoardState, agentTaskId: string, runtimeToken: string, workspaceResourceId?: string): AgentTask {
    const agentTask = this.#agentTask(state, agentTaskId);
    if (agentTask.status !== "running" || agentTask.runtimeToken !== runtimeToken
      || (workspaceResourceId !== undefined && agentTask.workspacePlacement?.resourceId !== workspaceResourceId)) {
      throw new AgentTaskRuntimeExpiredError(agentTaskId);
    }
    return agentTask;
  }

  #rootAgentTaskId(state: BoardState, agentTask: AgentTask): string {
    let current = agentTask;
    const visited = new Set<string>();
    while (current.parentAgentTaskId) {
      if (visited.has(current.id)) throw new Error(`AgentTask ${agentTask.id} 存在循环父子关系`);
      visited.add(current.id);
      current = this.#agentTask(state, current.parentAgentTaskId);
    }
    return current.id;
  }

  #agentTaskGroupIds(state: BoardState, rootId: string): ReadonlySet<string> {
    const ids = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of state.agentTasks) {
        if (candidate.parentAgentTaskId && ids.has(candidate.parentAgentTaskId) && !ids.has(candidate.id)) {
          ids.add(candidate.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  #nextCoordinatorRound(state: BoardState, root: AgentTask): number {
    const latest = state.agentTasks
      .filter((candidate) => candidate.parentAgentTaskId === root.id && candidate.kind === "delegated")
      .reduce((maximum, candidate) => Math.max(maximum, agentTaskRound(candidate)), 0);
    return latest + 1;
  }

  #recoverCoordinatorChildFailure(
    state: BoardState,
    task: KanbanTask,
    agentTask: AgentTask,
    message: string,
    now: string,
    failureFields?: Partial<AgentTask>,
  ): BoardState | undefined {
    if (agentTask.kind !== "delegated" || !agentTask.parentAgentTaskId) return undefined;
    const parent = state.agentTasks.find((candidate) => candidate.id === agentTask.parentAgentTaskId);
    if (!parent || !isCoordinatorRootAgentTask(parent) || parent.status !== "waiting_children" || task.activeAgentTaskId !== parent.id) return undefined;

    const failed: AgentTask = Object.freeze({
      ...agentTask,
      ...failureFields,
      status: "failed",
      runtimeToken: undefined,
      error: message,
      updatedAt: now,
      completedAt: now,
    });
    const round = agentTaskRound(agentTask);
    const roundChildren = state.agentTasks
      .filter((candidate) => candidate.parentAgentTaskId === parent.id
        && candidate.kind === "delegated"
        && agentTaskRound(candidate) === round)
      .map((candidate) => candidate.id === failed.id ? failed : candidate);
    const allTerminal = roundChildren.length > 0 && roundChildren.every((candidate) => isTerminalAgentTaskStatus(candidate.status));
    const reviewExists = state.agentTasks.some((candidate) => candidate.parentAgentTaskId === parent.id
      && candidate.kind === "coordinator-review"
      && agentTaskRound(candidate) === round);
    const review = allTerminal && !reviewExists
      ? this.#coordinatorReviewTask(state, task, parent, now, failed, round)
      : undefined;
    return {
      ...state,
      tasks: state.tasks.map((candidate) => candidate.id === task.id
        ? applyTaskLifecycle(Object.freeze({ ...candidate, activeAgentTaskId: parent.id }), { type: "execution-queued" }, now)
        : candidate),
      agentTasks: [
        ...state.agentTasks.map((candidate) => candidate.id === failed.id ? failed : candidate),
        ...(review ? [review] : []),
      ],
      activities: [
        ...state.activities,
        this.#activity(task.id, "error", `${agentTask.agentSnapshot.name}执行失败，等待 ${coordinatorRole(parent)} 决策`, message, now, agentTask.id),
        ...(review ? [this.#activity(task.id, "dispatch", `第 ${round} 轮成员已全部返回终态，${coordinatorRole(parent)} 进入恢复决策`, undefined, now, review.id)] : []),
      ],
    };
  }

  #task(state: BoardState, taskId: string): KanbanTask {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`找不到任务: ${taskId}`);
    return task;
  }

  #agentTask(state: BoardState, agentTaskId: string): AgentTask {
    const agentTask = state.agentTasks.find((candidate) => candidate.id === agentTaskId);
    if (!agentTask) throw new Error(`找不到 AgentTask: ${agentTaskId}`);
    return agentTask;
  }

  #squad(state: BoardState, squadId: string): Squad {
    const squad = state.squads.find((candidate) => candidate.id === squadId);
    if (!squad) throw new Error(`找不到 Squad: ${squadId}`);
    return squad;
  }

  #agent(state: BoardState, agentId: string, projectPath: string): AgentDefinition {
    const agent = this.#catalogFor(state).agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`未知 Agent: ${agentId}`);
    const scoped = agent as AgentDefinition & { readonly projectPath?: string };
    if (scoped.projectPath && !sameProjectPath(scoped.projectPath, projectPath)) throw new Error(`Agent ${agent.id} 属于其他项目`);
    return agent;
  }

  #catalogFor(state: BoardState): OrchestrationCatalog {
    return catalogForBoard(this.#catalog, state);
  }

  #applyCoordinatorAction(
    state: BoardState,
    task: KanbanTask,
    attempt: AgentTask,
    resultFields: AgentTaskResultFields,
    action: CoordinatorAction,
    comment: TaskComment,
    activities: readonly TaskActivity[],
    now: string,
  ): BoardState {
    const root = isCoordinatorRootAgentTask(attempt) ? attempt : this.#agentTask(state, attempt.parentAgentTaskId ?? "");
    if (!isCoordinatorRootAgentTask(root)) throw new Error(`Coordinator review ${attempt.id} 的父任务不是 Coordinator`);
    const completedAttempt: AgentTask | undefined = attempt.id === root.id ? undefined : Object.freeze({
      ...attempt,
      ...resultFields,
      status: "reported",
      acceptance: "not-ready",
      completedAt: now,
    });
    const resultOnRoot = attempt.id === root.id
      ? resultFields
      : Object.freeze({ output: resultFields.output, updatedAt: now });

    if (action.action === "delegate" || action.action === "request_revision" || action.action === "replan") {
      const round = this.#nextCoordinatorRound(state, root);
      const children = action.delegations.map((delegation) => this.#coordinatorDelegatedTask(task, root, action, delegation, round, now));
      const waitingRoot: AgentTask = Object.freeze({
        ...root,
        ...resultOnRoot,
        runtimeToken: undefined,
        status: "waiting_children",
        acceptance: "not-ready",
        completedAt: undefined,
      });
      return {
        ...state,
        tasks: state.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(Object.freeze({ ...candidate, activeAgentTaskId: root.id }), { type: "execution-queued" }, now)
          : candidate),
        agentTasks: [
          ...state.agentTasks.map((candidate) => {
            if (candidate.id === root.id) return waitingRoot;
            if (completedAttempt && candidate.id === completedAttempt.id) return completedAttempt;
            return candidate;
          }),
          ...children,
        ],
        comments: [...state.comments, comment],
        activities: [...activities, this.#activity(task.id, "dispatch", `${coordinatorRole(root)} ${action.action === "request_revision" ? "要求修订" : action.action === "replan" ? "重新规划并委派" : "完成委派"}`, `第 ${round} 轮 · ${action.delegations.map((item) => `@${item.agentId}`).join("、")}`, now, root.id)],
      };
    }

    if (action.action === "ask_human") {
      const waitingRoot: AgentTask = Object.freeze({
        ...root,
        ...resultOnRoot,
        runtimeToken: undefined,
        status: "waiting_human",
        acceptance: "not-ready",
        completedAt: undefined,
      });
      return {
        ...state,
        tasks: state.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(Object.freeze({ ...candidate, activeAgentTaskId: root.id }), { type: "awaiting-human" }, now)
          : candidate),
        agentTasks: state.agentTasks.map((candidate) => {
          if (candidate.id === root.id) return waitingRoot;
          if (completedAttempt && candidate.id === completedAttempt.id) return completedAttempt;
          return candidate;
        }),
        comments: [...state.comments, comment],
        activities: [...activities, this.#activity(task.id, "gate", `${coordinatorRole(root)} 请求用户决定`, action.question, now, root.id)],
      };
    }

    const reportedRoot: AgentTask = Object.freeze({
      ...root,
      ...resultOnRoot,
      runtimeToken: undefined,
      status: "reported",
      acceptance: "pending",
      completedAt: now,
    });
    return {
      ...state,
      tasks: state.tasks.map((candidate) => candidate.id === task.id
        ? reportAgentExecution(candidate, root, now)
        : candidate),
      agentTasks: state.agentTasks.map((candidate) => {
        if (candidate.id === root.id) return reportedRoot;
        if (completedAttempt && candidate.id === completedAttempt.id) return completedAttempt;
        return candidate;
      }),
      comments: [...state.comments, comment],
      activities: [...activities, this.#activity(task.id, "status", `${coordinatorRole(root)} 已完成团队验收，等待用户接受报告`, action.summary, now, root.id)],
    };
  }

  #applyCoordinatorProtocolFailure(
    state: BoardState,
    task: KanbanTask,
    attempt: AgentTask,
    resultFields: AgentTaskResultFields,
    rawComment: TaskComment,
    activities: readonly TaskActivity[],
    cause: unknown,
    now: string,
  ): BoardState {
    const root = isCoordinatorRootAgentTask(attempt) ? attempt : this.#agentTask(state, attempt.parentAgentTaskId ?? "");
    const validationError = cause instanceof Error ? cause.message : String(cause);
    const message = `${coordinatorRole(root)} 协议无效：${validationError}`;
    const groupIds = this.#agentTaskGroupIds(state, root.id);
    return {
      ...state,
      tasks: state.tasks.map((candidate) => candidate.id === task.id
        ? finishExecutionLifecycle(candidate, { type: "execution-failed", reason: message }, now)
        : candidate),
      agentTasks: state.agentTasks.map((candidate) => {
        if (candidate.id === attempt.id) {
          return Object.freeze({
            ...candidate,
            ...resultFields,
            status: "protocol-invalid" as const,
            acceptance: "not-ready" as const,
            error: validationError,
            completedAt: now,
          });
        }
        if (candidate.id === root.id) {
          return Object.freeze({
            ...candidate,
            runtimeToken: undefined,
            status: "protocol-invalid" as const,
            acceptance: "not-ready" as const,
            error: validationError,
            updatedAt: now,
            completedAt: now,
          });
        }
        if (groupIds.has(candidate.id) && !isTerminalAgentTaskStatus(candidate.status)) {
          return Object.freeze({
            ...candidate,
            runtimeToken: undefined,
            status: "cancelled" as const,
            error: "Coordinator 协议无效，同组执行已取消",
            updatedAt: now,
            completedAt: now,
          });
        }
        return candidate;
      }),
      comments: [...state.comments, rawComment],
      activities: [...activities, this.#activity(task.id, "error", `${coordinatorRole(root)} 输出未通过 Coordinator 协议校验`, validationError, now, attempt.id)],
    };
  }

  #coordinatorDelegatedTask(
    task: KanbanTask,
    root: AgentTask,
    action: CoordinatorAction,
    delegation: CoordinatorDelegation,
    round: number,
    now: string,
  ): AgentTask {
    const plan = root.executionPlan;
    if (!plan) throw new Error(`Coordinator AgentTask ${root.id} 缺少分发时执行计划快照`);
    const agent = plan.delegates.find((candidate) => candidate.id === delegation.agentId);
    if (!agent) throw new Error(`Coordinator 本轮执行计划不允许委派 Agent: ${delegation.agentId}`);
    return Object.freeze({
      id: this.#id(),
      taskId: task.id,
      executionAttempt: root.executionAttempt,
      taskSpec: root.taskSpec,
      executionProfile: root.executionProfile,
      agentSnapshot: cloneAgent(agent),
      kind: "delegated",
      status: "queued",
      acceptance: "not-ready",
      prompt: this.#coordinatorDelegatedPrompt(task, agent, action, delegation, plan, round),
      parentAgentTaskId: root.id,
      delegationRound: round,
      squadId: plan.kind === "squad" ? plan.squadId : undefined,
      createdAt: now,
      updatedAt: now,
    });
  }

  #coordinatorReviewTask(
    state: BoardState,
    task: KanbanTask,
    root: AgentTask,
    now: string,
    extraReport?: AgentTask | string,
    round?: number,
  ): AgentTask {
    return Object.freeze({
      id: this.#id(),
      taskId: task.id,
      executionAttempt: root.executionAttempt,
      taskSpec: root.taskSpec,
      executionProfile: root.executionProfile,
      agentSnapshot: cloneAgent(root.agentSnapshot),
      kind: "coordinator-review",
      status: "queued",
      acceptance: "not-ready",
      prompt: this.#coordinatorReviewPrompt(state, task, root, extraReport),
      parentAgentTaskId: root.id,
      delegationRound: round,
      squadId: root.squadId,
      executionPlan: root.executionPlan,
      createdAt: now,
      updatedAt: now,
    });
  }

  #promptFor(task: KanbanTask, agent: AgentDefinition, comments: readonly TaskComment[]): string {
    const discussion = comments.map((comment) => `- ${comment.author === "user" ? "用户" : comment.authorAgentId ?? comment.author}：${comment.body}`).join("\n");
    return [
      "# Stella 单 Agent 任务", "", `项目：${task.projectName}`, `任务：${task.title}`,
      `执行角色：${agent.name}（@${agent.id} / ${agent.callsign}）`, "", "## 任务说明",
      task.description || "（未提供补充说明）", "", "## 验收标准",
      task.acceptanceCriteria || "（未提供补充标准，请以任务目标和项目约束为准）", "", "## 任务讨论",
      discussion || "（暂无评论）", "", "## 角色固定指令", agent.instructions,
      "", "只完成当前角色职责。必须真实操作并验证；最终回复是一份独立结果，明确写出失败和未验证项。",
    ].join("\n");
  }

  #coordinatorPrompt(
    task: KanbanTask,
    request: string,
    availableAgents: readonly AgentDefinition[],
    comments: readonly TaskComment[],
  ): string {
    const workers = availableAgents.filter((agent) => agent.id !== "lead").map((agent) => `- ${agent.id} / @${agent.callsign}：${agent.responsibility}；workspace=${agent.workspaceAccess}`).join("\n");
    const discussion = comments.map((comment) => `- ${comment.author === "user" ? "用户" : comment.authorAgentId ?? comment.author}：${comment.body}`).join("\n");
    return [
      "# Stella Coordinator 回合", "", `任务：${task.title}`, `用户请求：${request}`,
      "", "## 任务说明", task.description || "（未提供补充说明）",
      "", "## 验收标准", task.acceptanceCriteria || "（未提供补充标准）",
      "", "## Task Room", discussion || "（暂无其他消息）",
      "", "## 可委派 Agent", workers || "（没有可委派 Agent；只能 complete 或 ask_human）",
      "", "## 严格行动协议",
      ...coordinatorProtocolInstructions(),
    ].join("\n");
  }

  #coordinatorReviewPrompt(
    state: BoardState,
    task: KanbanTask,
    root: AgentTask,
    extraReport?: AgentTask | string,
  ): string {
    const reportOverride = typeof extraReport === "string" ? undefined : extraReport;
    const reports = state.agentTasks
      .filter((candidate) => candidate.parentAgentTaskId === root.id && candidate.kind === "delegated")
      .map((candidate) => candidate.id === reportOverride?.id ? reportOverride : candidate)
      .map((candidate) => {
        const result = candidate.output
          ? candidate.output
          : candidate.error
            ? `执行失败：${candidate.error}`
            : `未返回报告；当前状态：${candidate.status}`;
        return `### 第 ${agentTaskRound(candidate)} 轮 · ${candidate.agentSnapshot.name} (@${candidate.agentSnapshot.id}) · ${candidate.status}\n${result}`;
      });
    const reply = typeof extraReport === "string" ? extraReport : undefined;
    const discussion = state.comments.filter((comment) => comment.taskId === task.id).map((comment) => `- ${comment.author === "user" ? "用户" : comment.authorAgentId ?? comment.author}：${comment.body}`).join("\n");
    const plan = root.executionPlan;
    const delegates = plan?.delegates.map((agent) => `- ${agent.id} / @${agent.callsign}：${agent.responsibility}；workspace=${agent.workspaceAccess}`).join("\n");
    return [
      "# Stella Coordinator 验收回合", "", `任务：${task.title}`,
      ...(plan?.kind === "squad" ? ["", "## Squad 范围", `Squad：${plan.squadName}`, `Leader 固定指令：${normalizeSquadLeaderInstructions(plan.leaderInstructions)}`] : []),
      "", "## 任务验收标准", task.acceptanceCriteria || "（未提供补充标准）",
      "", "## 成员真实报告与失败", reports.join("\n\n") || "（本回合没有成员报告）",
      ...(reply ? ["", "## 用户刚刚的回复", reply] : []),
      "", "## Task Room", discussion || "（暂无消息）",
      "", "## 可继续委派 Agent", delegates || "（没有可委派 Agent；只能 complete 或 ask_human）",
      "", "核对报告是否满足验收标准。信息充分时 complete；需要成员补做时 request_revision；任务拆解需要变化时 replan；缺少用户决定时 ask_human。",
      "必须调用 coordinator_action 作为本回合最后动作；不要输出 JSON、自然语言前后缀或 @mention 来冒充行动。",
    ].join("\n");
  }

  #coordinatorDelegatedPrompt(
    task: KanbanTask,
    agent: AgentDefinition,
    action: CoordinatorAction,
    delegation: CoordinatorDelegation,
    plan: AgentExecutionPlanSnapshot,
    round: number,
  ): string {
    return [
      "# Stella Coordinator 委派", "", `任务：${task.title}`, `委派轮次：第 ${round} 轮`, `执行角色：${agent.name}（@${agent.id}）`,
      ...(plan.kind === "squad" ? [`Squad：${plan.squadName}`] : []),
      "", `## ${plan.kind === "squad" ? "Squad Leader" : "LEAD"} 决策`, action.summary,
      "", "## 你的目标", delegation.objective,
      "", "## 本次委派验收标准", delegation.acceptanceCriteria,
      "", "## 任务总体验收标准", task.acceptanceCriteria || "（未提供补充标准）",
      "", "## 角色固定指令", agent.instructions,
      "", "只执行本次委派。必须真实操作并验证；最终报告明确列出结果、证据、失败和未验证项。不要在输出中 @mention 其他 Agent。",
    ].join("\n");
  }

  #squadCoordinatorPrompt(
    task: KanbanTask,
    plan: Extract<AgentExecutionPlanSnapshot, { readonly kind: "squad" }>,
    leader: AgentDefinition,
    comments: readonly TaskComment[],
  ): string {
    const memberList = plan.delegates.map((agent) => `- ${agent.id} / @${agent.callsign}：${agent.responsibility}；workspace=${agent.workspaceAccess}`).join("\n");
    const discussion = comments.map((comment) => `- ${comment.author === "user" ? "用户" : comment.authorAgentId ?? comment.author}：${comment.body}`).join("\n");
    return [
      "# Stella Squad Coordinator 回合", "", `Squad：${plan.squadName}`, `Leader：${leader.name}`, `任务：${task.title}`,
      "", "## 任务说明", task.description || "（未提供补充说明）", "", "## 验收标准",
      task.acceptanceCriteria || "（未提供补充标准）", "", "## 任务讨论", discussion || "（暂无评论）",
      "", "## 可委派成员（严格限定）", memberList || "（没有可委派成员；只能 complete 或 ask_human）", "", "## Leader 指令", normalizeSquadLeaderInstructions(plan.leaderInstructions),
      "", "## Leader 角色固定指令", leader.instructions,
      "", "## 严格行动协议", ...coordinatorProtocolInstructions(),
    ].join("\n");
  }

  #mentionPrompt(task: KanbanTask, agent: AgentDefinition, comment: string): string {
    return [
      "# Stella @mention 委派任务", "", `任务：${task.title}`, `执行角色：${agent.name}（@${agent.id}）`,
      "", "## 用户委派评论", comment, "", "## 任务说明", task.description || "（未提供补充说明）",
      "", "## 验收标准", task.acceptanceCriteria || "（未提供补充标准）",
      "", "## 角色固定指令", agent.instructions,
      "", "完成被提及角色的真实工作并验证；最终明确报告结果、失败和未验证项。",
    ].join("\n");
  }

  #mentionHandoffPrompt(prompt: string, predecessors: readonly AgentTask[]): string {
    const marker = "<!-- stella-mention-handoff -->";
    const markerIndex = prompt.indexOf(marker);
    const basePrompt = (markerIndex >= 0 ? prompt.slice(0, markerIndex) : prompt).trimEnd();
    if (predecessors.length === 0) return basePrompt;
    return [
      basePrompt,
      "",
      marker,
      "## 前序 Agent 实际产物",
      ...predecessors.map((candidate) => `### ${candidate.agentSnapshot.name}（@${candidate.agentSnapshot.callsign}）\n${candidate.output ?? ""}`),
      "",
      "请基于以上已持久化产物继续工作；不要重新假设前序工作尚未发生。",
    ].join("\n");
  }

  #activity(
    taskId: string,
    kind: TaskActivity["kind"],
    summary: string,
    detail: string | undefined,
    now: string,
    agentTaskId?: string,
  ): TaskActivity {
    return Object.freeze({ id: this.#id(), taskId, agentTaskId, kind, summary, detail, createdAt: now });
  }

  async #commit(transform: (current: BoardState) => BoardState): Promise<BoardBootstrap> {
    let changed = false;
    const board = await this.#repository.update((current) => {
      const next = transform(current);
      changed = next !== current;
      return next;
    });
    const bootstrap = Object.freeze({ board, catalog: this.#catalogFor(board) });
    if (changed) this.#emitChanged(bootstrap);
    return bootstrap;
  }
}
