// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BOARD_SCHEMA_VERSION, parseBoardFile } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

const NOW = "2026-07-24T00:00:00.000Z";
const BUILDER = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
const LEAD = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "lead");
if (!BUILDER || !LEAD) throw new Error("测试目录缺少 builder 或 lead");
const { disableContextFiles: _builderContext, ...LEGACY_BUILDER } = BUILDER;
const { disableContextFiles: _leadContext, ...LEGACY_LEAD } = LEAD;

function collections() {
  return { runs: [], activities: [], comments: [], agentTasks: [], customAgents: [], squads: [], autopilots: [], autopilotRuns: [] };
}

describe("schema v5 to v6 migration", () => {
  it("adds immutable execution identity and derives project Squad ownership", () => {
    const customAgent = {
      ...LEGACY_BUILDER,
      id: "custom-researcher",
      callsign: "RESEARCH",
      projectPath: "C:/project",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const parsed = parseBoardFile({
      version: 5,
      ...collections(),
      tasks: [{
        id: "task-v5", title: "旧版报告", description: "旧目标", acceptanceCriteria: "可核查", priority: "high",
        projectPath: "C:/project", projectName: "project", trusted: true,
        executionTarget: { kind: "agent", agentId: customAgent.id }, stage: "review", executionAttempt: 1,
        awaitingReviewExecution: { kind: "agent-task", id: "root-v5", attempt: 1 }, createdAt: NOW, updatedAt: NOW,
      }],
      agentTasks: [{
        id: "root-v5", taskId: "task-v5", agentSnapshot: customAgent, kind: "direct", status: "reported",
        acceptance: "pending", prompt: "旧提示", output: "旧报告", createdAt: NOW, updatedAt: NOW, completedAt: NOW,
      }],
      customAgents: [customAgent],
      squads: [{
        id: "squad-v5", name: "项目研究组", description: "", leaderAgentId: customAgent.id, memberAgentIds: ["builder"],
        leaderInstructions: "真实研究", createdAt: NOW, updatedAt: NOW,
      }],
    });

    expect(parsed.migratedFrom).toBe(5);
    expect(parsed.state.version).toBe(BOARD_SCHEMA_VERSION);
    expect(parsed.state.tasks[0]).toMatchObject({ specRevision: 1, executionAttempt: 1 });
    expect(parsed.state.agentTasks[0]).toMatchObject({
      executionAttempt: 1,
      taskSpec: { revision: 1, title: "旧版报告", executionTarget: { kind: "agent", agentId: customAgent.id } },
      agentSnapshot: { disableContextFiles: false },
    });
    expect(parsed.state.squads[0]).toMatchObject({ version: 1, scope: "project", projectPath: "C:/project" });
  });

  it("terminates an unrecoverable active Coordinator instead of inventing a plan", () => {
    const parsed = parseBoardFile({
      version: 5,
      ...collections(),
      tasks: [{
        id: "task-coordinator", title: "旧协调任务", description: "", acceptanceCriteria: "", priority: "medium",
        projectPath: "C:/project", projectName: "project", trusted: true,
        executionTarget: { kind: "agent", agentId: "lead" }, stage: "queued", executionAttempt: 1,
        activeAgentTaskId: "lead-root", createdAt: NOW, updatedAt: NOW,
      }],
      agentTasks: [{
        id: "lead-root", taskId: "task-coordinator", agentSnapshot: LEGACY_LEAD, kind: "coordinator", status: "queued",
        acceptance: "not-ready", prompt: "旧协调提示", createdAt: NOW, updatedAt: NOW,
      }],
    });

    expect(parsed.state.tasks[0]).toMatchObject({ stage: "blocked", activeAgentTaskId: undefined, blockedReason: expect.stringContaining("无法恢复") });
    expect(parsed.state.agentTasks[0]).toMatchObject({ status: "protocol-invalid", error: expect.stringContaining("缺少 executionPlan") });
    expect(parsed.state.activities).toContainEqual(expect.objectContaining({ kind: "error", summary: "旧版团队执行已安全终止" }));
  });
});
