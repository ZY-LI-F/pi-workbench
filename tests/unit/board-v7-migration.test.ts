import { describe, expect, it } from "vitest";
import { BOARD_SCHEMA_VERSION, BOARD_SCHEMA_V7, parseBoardFile } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

const NOW = "2026-08-24T00:00:00.000Z";
const AGENT = BUILTIN_ORCHESTRATION_CATALOG.agents[0];
const WORKFLOW = BUILTIN_ORCHESTRATION_CATALOG.workflows[0];
if (!AGENT || !WORKFLOW) throw new Error("测试编排目录为空");

function v7Fixture() {
  return {
    version: BOARD_SCHEMA_V7,
    tasks: [
      {
        id: "task-workflow", title: "旧流程", description: "", acceptanceCriteria: "", priority: "medium",
        projectPath: "C:/project", projectName: "project", trusted: true,
        executionTarget: { kind: "workflow", workflowId: WORKFLOW.id }, stage: "planned", specRevision: 1, executionAttempt: 1,
        sourcePiSessionPath: "C:/sessions/source.jsonl", sourcePiSessionId: "source-id", createdAt: NOW, updatedAt: NOW,
      },
      {
        id: "task-agent", title: "旧 Agent", description: "", acceptanceCriteria: "", priority: "medium",
        projectPath: "C:/project", projectName: "project", trusted: true,
        executionTarget: { kind: "agent", agentId: AGENT.id }, stage: "planned", specRevision: 1, executionAttempt: 1,
        createdAt: NOW, updatedAt: NOW,
      },
      {
        id: "task-manual", title: "手工任务", description: "", acceptanceCriteria: "", priority: "low",
        projectPath: "C:/project", projectName: "project", trusted: true,
        executionTarget: { kind: "manual" }, stage: "planned", specRevision: 1, executionAttempt: 0,
        createdAt: NOW, updatedAt: NOW,
      },
    ],
    runs: [{
      id: "run-1", taskId: "task-workflow", executionAttempt: 1,
      taskSpec: { revision: 1, title: "旧流程", description: "", acceptanceCriteria: "", priority: "medium", executionTarget: { kind: "workflow", workflowId: WORKFLOW.id } },
      workflow: WORKFLOW, agents: BUILTIN_ORCHESTRATION_CATALOG.agents, status: "reported", acceptance: "accepted", reviewedAt: NOW,
      steps: [{
        id: "step-run-1", stepId: WORKFLOW.steps[0]?.id, stepKind: WORKFLOW.steps[0]?.kind, name: WORKFLOW.steps[0]?.name,
        status: "succeeded", sessionPath: "C:/sessions/workflow.jsonl",
        artifact: { title: "产物", content: "完成", sessionPath: "C:/sessions/artifact.jsonl" }, completedAt: NOW,
      }],
      startedAt: NOW, updatedAt: NOW, completedAt: NOW,
    }],
    activities: [], comments: [],
    agentTasks: [{
      id: "agent-task-1", taskId: "task-agent", executionAttempt: 1,
      taskSpec: { revision: 1, title: "旧 Agent", description: "", acceptanceCriteria: "", priority: "medium", executionTarget: { kind: "agent", agentId: AGENT.id } },
      agentSnapshot: AGENT, kind: "direct", status: "reported", acceptance: "accepted", reviewedAt: NOW,
      prompt: "执行", output: "完成", sessionPath: "C:/sessions/agent.jsonl", createdAt: NOW, updatedAt: NOW, completedAt: NOW,
    }],
    customAgents: [], squads: [],
    autopilots: [{
      id: "autopilot-1", name: "旧规则", enabled: true, trigger: { kind: "manual" },
      taskTemplate: { title: "模板", description: "", acceptanceCriteria: "", priority: "medium" },
      projectPath: "C:/project", projectName: "project", trusted: true,
      executionTarget: { kind: "agent", agentId: AGENT.id }, createdAt: NOW, updatedAt: NOW,
    }],
    autopilotRuns: [],
  };
}

describe("schema v7 to v8 migration", () => {
  it("assigns Pi profiles, unifies sessions, and is stable when parsed again", () => {
    const parsed = parseBoardFile(v7Fixture());
    expect(parsed.migratedFrom).toBe(BOARD_SCHEMA_V7);
    expect(parsed.state.version).toBe(BOARD_SCHEMA_VERSION);
    expect(parsed.state.tasks.map((task) => task.executionProfileId)).toEqual(["pi.rpc", "pi.rpc", undefined]);
    expect(parsed.state.tasks[0]?.sourceSession).toEqual({ backendId: "pi", sessionId: "source-id", sessionPath: "C:/sessions/source.jsonl" });
    expect(parsed.state.runs[0]).toMatchObject({
      executionProfile: { id: "pi.rpc", revision: 1, backendId: "pi" },
      taskSpec: { executionProfileId: "pi.rpc" },
      steps: [{ session: { backendId: "pi", sessionPath: "C:/sessions/workflow.jsonl" }, artifact: { session: { backendId: "pi", sessionPath: "C:/sessions/artifact.jsonl" } } }],
    });
    expect(parsed.state.agentTasks[0]).toMatchObject({
      executionProfile: { id: "pi.rpc", revision: 1, backendId: "pi" },
      taskSpec: { executionProfileId: "pi.rpc" },
      session: { backendId: "pi", sessionPath: "C:/sessions/agent.jsonl" },
    });
    expect(parsed.state.autopilots[0]?.executionProfileId).toBe("pi.rpc");
    const serialized = JSON.stringify(parsed.state);
    expect(serialized).not.toContain("sourcePiSession");
    const stored = JSON.parse(serialized) as { agentTasks: Array<Record<string, unknown>>; runs: Array<{ steps: Array<Record<string, unknown>> }> };
    expect(stored.agentTasks[0]).not.toHaveProperty("sessionPath");
    expect(stored.runs[0]?.steps[0]).not.toHaveProperty("sessionPath");

    const second = parseBoardFile(JSON.parse(serialized));
    expect(second.migratedFrom).toBeUndefined();
    expect(JSON.stringify(second.state)).toBe(serialized);
  });
});
