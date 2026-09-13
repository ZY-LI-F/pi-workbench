import { describe, expect, it } from "vitest";
import { deriveAgentPresences } from "../../src/shared/agent-presence";
import { BOARD_SCHEMA_VERSION, EMPTY_BOARD_STATE, parseBoardState, type AgentTask, type KanbanTask, type ProjectAgentDefinition } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG, catalogForBoard } from "../../src/shared/orchestration-catalog";
import { snapshotExecutionProfile } from "../../src/shared/execution-profile";

const NOW = "2026-07-18T03:00:00.000Z";
const builder = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
const lead = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "lead");
if (!builder || !lead) throw new Error("测试目录缺少 builder 或 lead");

function customAgent(id: string, projectPath: string): ProjectAgentDefinition {
  return Object.freeze({
    id,
    version: 1,
    name: id,
    callsign: id.toLocaleUpperCase(),
    responsibility: "项目专用研究",
    instructions: "只报告真实证据",
    workspaceAccess: "read",
    allowedTools: Object.freeze(["read"]),
    thinking: "medium",
    disableExtensions: true,
    disableSkills: true,
    disablePromptTemplates: true,
    disableContextFiles: true,
    projectPath,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("Agent Presence projection", () => {
  it("keeps project-scoped Agents visible across Windows path spelling variants without merging POSIX case", () => {
    const state = { ...EMPTY_BOARD_STATE, customAgents: [customAgent("windows", "C:/One"), customAgent("posix", "/work/One")] };
    const catalog = catalogForBoard(BUILTIN_ORCHESTRATION_CATALOG, state);
    expect(deriveAgentPresences(state, catalog, "c:\\one\\", NOW).some((presence) => presence.agent.id === "windows")).toBe(true);
    expect(deriveAgentPresences(state, catalog, "/work/one", NOW).some((presence) => presence.agent.id === "posix")).toBe(false);
  });
  it("derives live state from executions and filters project-scoped Agents", () => {
    const state = parseBoardState({
      version: BOARD_SCHEMA_VERSION,
      tasks: [
        { id: "task-running", title: "实现", description: "", acceptanceCriteria: "", priority: "high", projectPath: "C:/one", projectName: "one", trusted: true, executionTarget: { kind: "agent", agentId: "builder" }, executionProfileId: "pi.rpc", stage: "running", specRevision: 1, executionAttempt: 1, activeAgentTaskId: "builder-task", createdAt: NOW, updatedAt: NOW },
        { id: "task-waiting", title: "范围决定", description: "", acceptanceCriteria: "", priority: "medium", projectPath: "C:/one", projectName: "one", trusted: true, executionTarget: { kind: "agent", agentId: "lead" }, executionProfileId: "pi.rpc", stage: "review", specRevision: 1, executionAttempt: 1, activeAgentTaskId: "lead-task", createdAt: NOW, updatedAt: NOW },
      ],
      runs: [],
      activities: [],
      comments: [],
      agentTasks: [
        { id: "builder-task", taskId: "task-running", executionAttempt: 1, taskSpec: { revision: 1, title: "实现", description: "", acceptanceCriteria: "", priority: "high", executionTarget: { kind: "agent", agentId: "builder" }, executionProfileId: "pi.rpc" }, executionProfile: snapshotExecutionProfile("pi.rpc"), agentSnapshot: builder, kind: "direct", status: "running", acceptance: "not-ready", prompt: "执行", runtimeToken: "runtime", createdAt: NOW, updatedAt: NOW, startedAt: NOW },
        { id: "lead-task", taskId: "task-waiting", executionAttempt: 1, taskSpec: { revision: 1, title: "范围决定", description: "", acceptanceCriteria: "", priority: "medium", executionTarget: { kind: "agent", agentId: "lead" }, executionProfileId: "pi.rpc" }, executionProfile: snapshotExecutionProfile("pi.rpc"), agentSnapshot: lead, kind: "coordinator", status: "waiting_human", acceptance: "not-ready", prompt: "规划", output: "{}", createdAt: NOW, updatedAt: NOW, startedAt: NOW },
      ],
      customAgents: [customAgent("custom-one", "C:/one"), customAgent("custom-two", "C:/two")],
      squads: [],
      autopilots: [],
      autopilotRuns: [],
    });
    const catalog = catalogForBoard(BUILTIN_ORCHESTRATION_CATALOG, state);
    const presences = deriveAgentPresences(state, catalog, "C:/one");

    expect(presences.find((presence) => presence.agent.id === "builder")).toMatchObject({ state: "running", activeTaskId: "task-running", workload: 1 });
    expect(presences.find((presence) => presence.agent.id === "lead")).toMatchObject({ state: "waiting", activeTaskId: "task-waiting", detail: "等待用户回复" });
    expect(presences.find((presence) => presence.agent.id === "custom-one")).toMatchObject({ state: "available", workload: 0 });
    expect(presences.some((presence) => presence.agent.id === "custom-two")).toBe(false);
  });

  it("surfaces a current protocol failure without letting historical executions override presence", () => {
    const task: KanbanTask = Object.freeze({
      id: "task", title: "协调失败", description: "", acceptanceCriteria: "可核查", priority: "high",
      projectPath: "C:/one", projectName: "one", trusted: true,
      executionTarget: Object.freeze({ kind: "agent", agentId: "lead" }), executionProfileId: "pi.rpc", stage: "blocked", blockedReason: "协议无效",
      specRevision: 1, executionAttempt: 2, createdAt: NOW, updatedAt: NOW,
    });
    const failed: AgentTask = Object.freeze({
      id: "failed", taskId: task.id, executionAttempt: 2,
      taskSpec: Object.freeze({ revision: 1, title: task.title, description: "", acceptanceCriteria: "可核查", priority: "high", executionTarget: task.executionTarget, executionProfileId: "pi.rpc" }),
      executionProfile: snapshotExecutionProfile("pi.rpc"),
      agentSnapshot: lead, kind: "coordinator", status: "protocol-invalid", acceptance: "not-ready", prompt: "规划",
      error: "未调用 coordinator_action", createdAt: NOW, updatedAt: NOW, completedAt: NOW,
    });
    const historical: AgentTask = Object.freeze({ ...failed, id: "historical", executionAttempt: 1, status: "reported", error: undefined });
    const state = Object.freeze({ ...EMPTY_BOARD_STATE, tasks: Object.freeze([task]), agentTasks: Object.freeze([historical, failed]) });
    const presences = deriveAgentPresences(state, BUILTIN_ORCHESTRATION_CATALOG, "C:/one", NOW);

    expect(presences.find((presence) => presence.agent.id === "lead")).toMatchObject({
      state: "attention",
      activeTaskId: task.id,
      detail: "未调用 coordinator_action",
    });
  });
});
