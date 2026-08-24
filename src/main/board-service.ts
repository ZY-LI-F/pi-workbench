import { randomUUID } from "node:crypto";
import type { BoardRepository } from "./board-repository";
import {
  AGENT_THINKING_LEVELS,
  TASK_PRIORITIES,
  canMoveTaskManually,
  type BoardBootstrap,
  type BoardState,
  type CreateProjectAgentInput,
  type CreateTaskInput,
  type ExecutionTarget,
  type KanbanTask,
  type ManualTaskStage,
  type OrchestrationCatalog,
  type ProjectAgentDefinition,
  type TaskActivity,
  type UpdateProjectAgentInput,
  type UpdateTaskInput,
} from "../shared/kanban";
import { catalogForBoard } from "../shared/orchestration-catalog";
import { supersedePendingExecutions } from "../shared/execution-state";
import { assertExecutionProfileTarget, type ExecutionProfileId } from "../shared/execution-profile";
import { cloneExecutionSessionReference } from "../shared/execution-session";

interface BoardServiceDependencies {
  readonly repository: BoardRepository;
  readonly catalog: OrchestrationCatalog;
  readonly emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly projectIdentity: (projectPath: string) => string;
  readonly now?: () => string;
  readonly id?: () => string;
}

function normalizedText(value: string, label: string, required: boolean): string {
  const normalized = value.trim();
  if (required && normalized.length === 0) throw new Error(`${label}不能为空`);
  return normalized;
}

function taskStageLabel(stage: ManualTaskStage): string {
  if (stage === "planned") return "待规划";
  if (stage === "running") return "执行中";
  if (stage === "review") return "待审核";
  if (stage === "blocked") return "受阻";
  return "已完成";
}

export class BoardService {
  readonly #repository: BoardRepository;
  readonly #catalog: OrchestrationCatalog;
  readonly #emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly #projectIdentity: (projectPath: string) => string;
  readonly #now: () => string;
  readonly #id: () => string;

  constructor(dependencies: BoardServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#emitChanged = dependencies.emitChanged;
    this.#projectIdentity = dependencies.projectIdentity;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#id = dependencies.id ?? randomUUID;
  }

  async bootstrap(): Promise<BoardBootstrap> {
    const board = await this.#repository.read();
    return Object.freeze({ board, catalog: catalogForBoard(this.#catalog, board) });
  }

  async updateProjectTrust(projectPath: string, trusted: boolean): Promise<BoardBootstrap> {
    const identity = this.#projectIdentity(projectPath);
    const now = this.#now();
    return this.#commit((current) => {
      const changedTasks = current.tasks.filter(
        (task) => this.#projectIdentity(task.projectPath) === identity && task.trusted !== trusted,
      );
      const changedAutopilots = current.autopilots.filter(
        (autopilot) => this.#projectIdentity(autopilot.projectPath) === identity && autopilot.trusted !== trusted,
      );
      const tasks = current.tasks.map((task) =>
        this.#projectIdentity(task.projectPath) === identity && task.trusted !== trusted
          ? Object.freeze({ ...task, trusted, updatedAt: now })
          : task,
      );
      const autopilots = current.autopilots.map((autopilot) =>
        this.#projectIdentity(autopilot.projectPath) === identity && autopilot.trusted !== trusted
          ? Object.freeze({ ...autopilot, trusted, updatedAt: now })
          : autopilot,
      );
      if (changedTasks.length === 0 && changedAutopilots.length === 0) return current;
      const label = trusted ? "项目已授予信任执行权限" : "项目已撤销信任执行权限";
      return {
        ...current,
        tasks,
        autopilots,
        activities: [
          ...current.activities,
          ...changedTasks.map((task) => this.#activity(task.id, "status", label, projectPath, now)),
        ],
      };
    });
  }

  async createTask(input: CreateTaskInput): Promise<BoardBootstrap> {
    if (!TASK_PRIORITIES.includes(input.priority)) throw new Error(`无效优先级: ${String(input.priority)}`);
    const now = this.#now();
    return this.#commit((current) => {
      this.#assertExecutionTarget(current, input.executionTarget, input.projectPath);
      const executionProfileId = this.#executionProfileId(input.executionTarget, input.executionProfileId);
      const task: KanbanTask = Object.freeze({
        id: this.#id(),
        title: normalizedText(input.title, "任务标题", true),
        description: normalizedText(input.description, "任务说明", false),
        acceptanceCriteria: normalizedText(input.acceptanceCriteria, "验收标准", false),
        priority: input.priority,
        projectPath: normalizedText(input.projectPath, "项目路径", true),
        projectName: normalizedText(input.projectName, "项目名称", true),
        trusted: input.trusted,
        executionTarget: Object.freeze({ ...input.executionTarget }),
        executionProfileId,
        stage: "planned",
        specRevision: 1,
        executionAttempt: 0,
        sourceSession: cloneExecutionSessionReference(input.sourceSession),
        externalOrigin: input.externalOrigin ? Object.freeze({
          ...input.externalOrigin,
          session: cloneExecutionSessionReference(input.externalOrigin.session),
        }) : undefined,
        createdAt: now,
        updatedAt: now,
      });
      return {
        ...current,
        tasks: [task, ...current.tasks],
        activities: [...current.activities, this.#activity(task.id, "task", "任务已创建", undefined, now)],
      };
    });
  }

  async updateTask(input: UpdateTaskInput): Promise<BoardBootstrap> {
    if (!TASK_PRIORITIES.includes(input.priority)) throw new Error(`无效优先级: ${String(input.priority)}`);
    const now = this.#now();
    return this.#commit((current) => {
      const task = this.#task(current, input.taskId);
      if (task.activeRunId || task.activeAgentTaskId) throw new Error("运行中的任务不能编辑；请先中止执行");
      if (task.awaitingReviewExecution) throw new Error("任务正在等待验收；请先验收或退回本次执行，再修改任务规格");
      this.#assertExecutionTarget(current, input.executionTarget, task.projectPath);
      const executionProfileId = this.#executionProfileId(input.executionTarget, input.executionProfileId);
      const title = normalizedText(input.title, "任务标题", true);
      const description = normalizedText(input.description, "任务说明", false);
      const acceptanceCriteria = normalizedText(input.acceptanceCriteria, "验收标准", false);
      const targetChanged = JSON.stringify(task.executionTarget) !== JSON.stringify(input.executionTarget);
      const profileChanged = task.executionProfileId !== executionProfileId;
      const resetManualProgress = task.executionTarget.kind === "manual"
        && input.executionTarget.kind !== "manual"
        && (task.stage === "running" || task.stage === "review");
      const specChanged = task.title !== title
        || task.description !== description
        || task.acceptanceCriteria !== acceptanceCriteria
        || task.priority !== input.priority
        || targetChanged
        || profileChanged;
      const nextTask: KanbanTask = Object.freeze({
        ...task,
        title,
        description,
        acceptanceCriteria,
        priority: input.priority,
        executionTarget: Object.freeze({ ...input.executionTarget }),
        executionProfileId,
        stage: resetManualProgress ? "planned" : task.stage,
        blockedReason: resetManualProgress ? undefined : task.blockedReason,
        specRevision: specChanged ? task.specRevision + 1 : task.specRevision,
        updatedAt: now,
      });
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate),
        activities: [
          ...current.activities,
          this.#activity(task.id, "task", "任务内容已更新", undefined, now),
          ...(resetManualProgress ? [this.#activity(task.id, "status", "任务改为自动执行，已移回待规划", undefined, now)] : []),
        ],
      };
    });
  }

  #executionProfileId(target: ExecutionTarget, requested: ExecutionProfileId | undefined): ExecutionProfileId | undefined {
    const profileId = target.kind === "manual" ? undefined : requested ?? "pi.rpc";
    assertExecutionProfileTarget(target, profileId);
    return profileId;
  }

  async moveTask(taskId: string, stage: ManualTaskStage): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const task = this.#task(current, taskId);
      if (!canMoveTaskManually(task, stage)) {
        throw new Error(task.executionTarget.kind === "manual"
          ? "手工任务只能在未运行自动执行时移到待规划、执行中、待审核、受阻或已完成列"
          : "自动任务只能在未运行时手动移到待规划、受阻或已完成列");
      }
      const superseded = supersedePendingExecutions(current, task.id, "任务已由用户手动移动，原执行不再等待验收");
      const nextTask: KanbanTask = Object.freeze({
        ...task,
        stage,
        awaitingReviewExecution: undefined,
        blockedReason: stage === "blocked" ? "由用户手动标记为受阻" : undefined,
        updatedAt: now,
      });
      return {
        ...superseded,
        tasks: superseded.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate),
        activities: [...superseded.activities, this.#activity(task.id, "status", `任务已移到${taskStageLabel(stage)}`, undefined, now)],
      };
    });
  }

  async deleteTask(taskId: string): Promise<BoardBootstrap> {
    return this.#commit((current) => {
      const task = this.#task(current, taskId);
      if (task.activeRunId || task.activeAgentTaskId) throw new Error("运行中的任务不能删除；请先中止执行");
      return {
        ...current,
        tasks: current.tasks.filter((candidate) => candidate.id !== task.id),
        runs: current.runs.filter((run) => run.taskId !== task.id),
        activities: current.activities.filter((activity) => activity.taskId !== task.id),
        comments: current.comments.filter((comment) => comment.taskId !== task.id),
        agentTasks: current.agentTasks.filter((agentTask) => agentTask.taskId !== task.id),
      };
    });
  }

  async createProjectAgent(input: CreateProjectAgentInput): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const definition = this.#validatedProjectAgent(input, now);
      if (this.#catalogFor(current).agents.some((agent) => agent.id === definition.id || agent.callsign.toLocaleLowerCase() === definition.callsign.toLocaleLowerCase())) {
        throw new Error(`Agent ID 或呼号已存在: @${definition.callsign}`);
      }
      return { ...current, customAgents: [...current.customAgents, definition] };
    });
  }

  async updateProjectAgent(input: UpdateProjectAgentInput): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const existing = current.customAgents.find((agent) => agent.id === input.agentId);
      if (!existing) throw new Error(`找不到自定义 Agent: ${input.agentId}`);
      if (existing.projectPath !== input.projectPath) throw new Error("自定义 Agent 不能跨项目迁移");
      const draft = this.#validatedProjectAgent(input, now, existing);
      const duplicate = this.#catalogFor(current).agents.find((agent) => agent.id !== existing.id && agent.callsign.toLocaleLowerCase() === draft.callsign.toLocaleLowerCase());
      if (duplicate) throw new Error(`Agent 呼号已存在: @${draft.callsign}`);
      const updated: ProjectAgentDefinition = Object.freeze({ ...draft, id: existing.id, version: existing.version + 1, createdAt: existing.createdAt });
      return { ...current, customAgents: current.customAgents.map((agent) => agent.id === existing.id ? updated : agent) };
    });
  }

  async deleteProjectAgent(agentId: string): Promise<BoardBootstrap> {
    return this.#commit((current) => {
      const agent = current.customAgents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error(`找不到自定义 Agent: ${agentId}`);
      if (current.tasks.some((task) => task.executionTarget.kind === "agent" && task.executionTarget.agentId === agent.id)) throw new Error("仍有任务引用该 Agent，不能删除");
      if (current.squads.some((squad) => squad.leaderAgentId === agent.id || squad.memberAgentIds.includes(agent.id))) throw new Error("仍有 Squad 引用该 Agent，不能删除");
      if (current.autopilots.some((autopilot) => autopilot.executionTarget.kind === "agent" && autopilot.executionTarget.agentId === agent.id)) throw new Error("仍有 Autopilot 引用该 Agent，不能删除");
      return { ...current, customAgents: current.customAgents.filter((candidate) => candidate.id !== agent.id) };
    });
  }

  #task(state: BoardState, taskId: string): KanbanTask {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`找不到任务: ${taskId}`);
    return task;
  }

  #assertExecutionTarget(state: BoardState, target: ExecutionTarget, projectPath: string): void {
    if (target.kind === "manual") return;
    const catalog = this.#catalogFor(state);
    if (target.kind === "workflow" && !this.#catalog.workflows.some((workflow) => workflow.id === target.workflowId)) {
      throw new Error(`未知流程模板: ${target.workflowId}`);
    }
    if (target.kind === "agent") {
      const agent = catalog.agents.find((candidate) => candidate.id === target.agentId);
      if (!agent) throw new Error(`未知 Agent: ${target.agentId}`);
      const scoped = agent as Partial<ProjectAgentDefinition>;
      if (scoped.projectPath && scoped.projectPath !== projectPath) throw new Error(`Agent ${agent.id} 属于其他项目`);
    }
    if (target.kind === "squad") {
      const squad = state.squads.find((candidate) => candidate.id === target.squadId);
      if (!squad) throw new Error(`未知 Squad: ${target.squadId}`);
      if (squad.scope === "project" && this.#projectIdentity(squad.projectPath!) !== this.#projectIdentity(projectPath)) {
        throw new Error(`Squad ${squad.id} 属于其他项目`);
      }
      const scopedAgents = [squad.leaderAgentId, ...squad.memberAgentIds]
        .map((agentId) => catalog.agents.find((agent) => agent.id === agentId) as Partial<ProjectAgentDefinition> | undefined)
        .filter((agent): agent is Partial<ProjectAgentDefinition> => Boolean(agent?.projectPath));
      if (scopedAgents.some((agent) => agent.projectPath !== projectPath)) throw new Error(`Squad ${squad.id} 包含其他项目的自定义 Agent`);
    }
  }

  #validatedProjectAgent(input: CreateProjectAgentInput, now: string, existing?: ProjectAgentDefinition): ProjectAgentDefinition {
    const callsign = normalizedText(input.callsign, "Agent 呼号", true).toLocaleUpperCase();
    if (!/^[A-Z0-9_-]+$/u.test(callsign)) throw new Error("Agent 呼号只能包含英文字母、数字、下划线或连字符");
    const workspaceAccess = input.workspaceAccess;
    if (workspaceAccess !== "read" && workspaceAccess !== "write") throw new Error(`无效 workspaceAccess: ${String(workspaceAccess)}`);
    const allowedToolSet = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);
    const allowedTools = Object.freeze([...new Set(input.allowedTools.map((tool) => normalizedText(tool, "Agent 工具", true)))]);
    if (allowedTools.length === 0 || allowedTools.some((tool) => !allowedToolSet.has(tool))) throw new Error("Agent 工具列表包含空值或不支持的工具");
    if (workspaceAccess === "read" && allowedTools.some((tool) => tool === "bash" || tool === "edit" || tool === "write")) {
      throw new Error("只读 Agent 不能启用 bash、edit 或 write");
    }
    if (!AGENT_THINKING_LEVELS.includes(input.thinking)) throw new Error(`无效 thinking level: ${String(input.thinking)}`);
    const requiredSkills = input.requiredSkills?.map((skill) => normalizedText(skill, "Required Skill", true));
    const id = existing?.id ?? `custom-${callsign.toLocaleLowerCase()}`;
    return Object.freeze({
      id,
      version: existing?.version ?? 1,
      name: normalizedText(input.name, "Agent 名称", true),
      callsign,
      responsibility: normalizedText(input.responsibility, "Agent 职责", true),
      instructions: normalizedText(input.instructions, "Agent 指令", true),
      workspaceAccess,
      allowedTools,
      requiredSkills: requiredSkills?.length ? Object.freeze([...new Set(requiredSkills)]) : undefined,
      thinking: input.thinking,
      provider: input.provider?.trim() || undefined,
      model: input.model?.trim() || undefined,
      disableExtensions: input.disableExtensions,
      disableSkills: input.disableSkills,
      disablePromptTemplates: input.disablePromptTemplates,
      disableContextFiles: input.disableContextFiles,
      projectPath: normalizedText(input.projectPath, "项目路径", true),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  #catalogFor(state: BoardState): OrchestrationCatalog {
    return catalogForBoard(this.#catalog, state);
  }

  #activity(taskId: string, kind: TaskActivity["kind"], summary: string, detail: string | undefined, now: string): TaskActivity {
    return Object.freeze({ id: this.#id(), taskId, kind, summary, detail, createdAt: now });
  }

  async #commit(transform: (current: BoardState) => BoardState): Promise<BoardBootstrap> {
    const board = await this.#repository.update(transform);
    const bootstrap = Object.freeze({ board, catalog: this.#catalogFor(board) });
    this.#emitChanged(bootstrap);
    return bootstrap;
  }
}
