import { describe, expect, it } from "vitest";
import { BOARD_SCHEMA_V8, BOARD_SCHEMA_VERSION, parseBoardFile } from "../../src/shared/kanban";
import { snapshotExecutionProfile } from "../../src/shared/execution-profile";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

const NOW = "2026-08-28T00:00:00.000Z";
const AGENT = BUILTIN_ORCHESTRATION_CATALOG.agents.find((candidate) => candidate.id === "builder")
  ?? BUILTIN_ORCHESTRATION_CATALOG.agents[0];
const WORKFLOW = BUILTIN_ORCHESTRATION_CATALOG.workflows[0];
if (!AGENT || !WORKFLOW) throw new Error("测试编排目录为空");

function v8Fixture() {
  const workflowStep = WORKFLOW.steps[0];
  if (!workflowStep) throw new Error("测试流程没有步骤");
  return {
    version: BOARD_SCHEMA_V8,
    tasks: [
      {
        id: "task-workflow", title: "历史流程", description: "", acceptanceCriteria: "", priority: "medium",
        projectPath: "/项目 空格", projectName: "project", trusted: true,
        executionTarget: { kind: "workflow", workflowId: WORKFLOW.id }, executionProfileId: "pi.rpc",
        stage: "completed", specRevision: 1, executionAttempt: 1, createdAt: NOW, updatedAt: NOW,
      },
      {
        id: "task-running", title: "正在运行", description: "", acceptanceCriteria: "", priority: "high",
        projectPath: "/项目 空格", projectName: "project", trusted: true,
        executionTarget: { kind: "agent", agentId: AGENT.id }, executionProfileId: "pi.rpc",
        stage: "running", specRevision: 1, executionAttempt: 3, activeAgentTaskId: "agent-task-running",
        createdAt: NOW, updatedAt: NOW,
      },
    ],
    runs: [{
      id: "run-history", taskId: "task-workflow", executionAttempt: 1,
      taskSpec: {
        revision: 1, title: "历史流程", description: "", acceptanceCriteria: "", priority: "medium",
        executionTarget: { kind: "workflow", workflowId: WORKFLOW.id }, executionProfileId: "pi.rpc",
      },
      executionProfile: snapshotExecutionProfile("pi.rpc"), workflow: WORKFLOW,
      agents: BUILTIN_ORCHESTRATION_CATALOG.agents, status: "reported", acceptance: "accepted", reviewedAt: NOW,
      steps: [{
        id: "step-history", stepId: workflowStep.id, stepKind: workflowStep.kind, name: workflowStep.name,
        status: "succeeded", session: { backendId: "pi", sessionId: "session-history", sessionPath: "/会话/session.jsonl" },
        artifact: { title: "历史产物", content: "完成", session: { backendId: "pi", sessionPath: "/会话/artifact.jsonl" } },
        completedAt: NOW,
      }],
      startedAt: NOW, updatedAt: NOW, completedAt: NOW,
    }],
    activities: [], comments: [],
    agentTasks: [{
      id: "agent-task-running", taskId: "task-running", executionAttempt: 3,
      taskSpec: {
        revision: 1, title: "正在运行", description: "", acceptanceCriteria: "", priority: "high",
        executionTarget: { kind: "agent", agentId: AGENT.id }, executionProfileId: "pi.rpc",
      },
      executionProfile: snapshotExecutionProfile("pi.rpc"), agentSnapshot: AGENT,
      kind: "direct", status: "running", acceptance: "not-ready", prompt: "执行",
      runtimeToken: "runtime-fence-v8", createdAt: NOW, updatedAt: NOW, startedAt: NOW,
    }],
    customAgents: [], squads: [], autopilots: [], autopilotRuns: [],
  };
}

describe("schema v8 to v9 migration", () => {
  it("adds current-folder preferences and placements without changing sessions or runtime fencing", () => {
    const parsed = parseBoardFile(v8Fixture());

    expect(parsed.migratedFrom).toBe(BOARD_SCHEMA_V8);
    expect(parsed.state.version).toBe(BOARD_SCHEMA_VERSION);
    expect(parsed.state.tasks.map((task) => task.executionWorkspace)).toEqual([
      { strategy: "current-folder" },
      { strategy: "current-folder" },
    ]);
    expect(parsed.state.runs[0]).toMatchObject({
      taskSpec: { executionWorkspace: { strategy: "current-folder" } },
      workspacePlacement: {
        revision: 1, strategy: "current-folder", projectPath: "/项目 空格", cwd: "/项目 空格",
        ownership: "project", lifecycle: "retained",
      },
      steps: [{
        session: { backendId: "pi", sessionId: "session-history", sessionPath: "/会话/session.jsonl" },
        artifact: { session: { backendId: "pi", sessionPath: "/会话/artifact.jsonl" } },
      }],
    });
    expect(parsed.state.agentTasks[0]).toMatchObject({
      runtimeToken: "runtime-fence-v8",
      taskSpec: { executionWorkspace: { strategy: "current-folder" } },
      workspacePlacement: {
        strategy: "current-folder", projectPath: "/项目 空格", cwd: "/项目 空格", ownership: "project",
      },
    });

    const serialized = JSON.stringify(parsed.state);
    const reparsed = parseBoardFile(JSON.parse(serialized));
    expect(reparsed.migratedFrom).toBeUndefined();
    expect(JSON.stringify(reparsed.state)).toBe(serialized);
  });
});
