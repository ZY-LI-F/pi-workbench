import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentExecutionGraph } from "../../src/renderer/src/features/kanban/AgentExecutionGraph";
import type { AgentTask } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

afterEach(() => cleanup());

const NOW = "2026-08-02T08:00:00.000Z";
const lead = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "lead");
const builder = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
if (!lead || !builder) throw new Error("测试目录缺少 lead 或 builder");

function node(input: Partial<AgentTask> & Pick<AgentTask, "id" | "kind" | "status" | "agentSnapshot">): AgentTask {
  return Object.freeze({
    taskId: "task",
    executionAttempt: 1,
    taskSpec: Object.freeze({ revision: 1, title: "实现任务", description: "", acceptanceCriteria: "测试通过", priority: "high", executionTarget: Object.freeze({ kind: "agent" as const, agentId: "lead" }) }),
    acceptance: "not-ready",
    prompt: "执行",
    createdAt: NOW,
    updatedAt: NOW,
    ...input,
  });
}

describe("AgentExecutionGraph", () => {
  it("renders the real root, delegation round, worker and review nodes", () => {
    const root = node({ id: "root", kind: "coordinator", status: "waiting_children", agentSnapshot: lead });
    const worker = node({ id: "worker", kind: "delegated", status: "failed", agentSnapshot: builder, parentAgentTaskId: root.id, delegationRound: 1, error: "测试失败", completedAt: NOW });
    const review = node({ id: "review", kind: "coordinator-review", status: "queued", agentSnapshot: lead, parentAgentTaskId: root.id, delegationRound: 1 });

    render(<AgentExecutionGraph agentTasks={[root, worker, review]} activeRootId={root.id} />);

    expect(screen.getByRole("region", { name: "Agent 执行图" }).textContent).toContain("团队执行图");
    expect(screen.getByText("第 1 轮")).toBeTruthy();
    expect(screen.getByText("Worker 委派")).toBeTruthy();
    expect(screen.getByText("Leader 验收")).toBeTruthy();
    expect(screen.getByTitle("测试失败")).toBeTruthy();
  });
});
