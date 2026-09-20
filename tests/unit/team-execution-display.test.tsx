import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentExecutionGraph } from "@renderer/features/kanban/AgentExecutionGraph";
import { TaskCard } from "@renderer/features/kanban/TaskCard";
import { teamBoardFixture } from "../fixtures/team-board";
import type { AgentTask, WorkflowRun } from "@shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "@shared/orchestration-catalog";

afterEach(cleanup);
const board = teamBoardFixture();

describe("team execution display", () => {
  it("gives each review its own merge row, including two reviews in the same round", () => {
    const { container } = render(<AgentExecutionGraph agentTasks={board.agentTasks} />);
    const reviews = container.querySelectorAll(".agent-execution-round__merge");
    expect(reviews).toHaveLength(2);
    for (const row of reviews) expect(row.querySelectorAll(".agent-execution-node")).toHaveLength(1);
    expect(screen.getByText("4 个节点")).toBeTruthy();
  });

  it("labels the owner separately from all currently running workers", () => {
    const root: AgentTask = { ...board.agentTasks[0]!, status: "waiting_children", acceptance: "not-ready" };
    const worker: AgentTask = { ...board.agentTasks[2]!, status: "running" };
    render(<TaskCard task={{ ...board.tasks[0]!, activeAgentTaskId: root.id }} executionLabel="团队任务" agentTask={root}
      activeAgents={[worker]} activities={[]} busy={false} executionEnabled onOpen={() => undefined} onDispatch={() => undefined}
      onDragStart={() => undefined} onDragEnd={() => undefined} />);
    expect(screen.getByText("协调负责人")).toBeTruthy();
    expect(screen.getByLabelText(`当前 Agent：${worker.agentSnapshot.name}`)).toBeTruthy();
    expect(screen.queryByLabelText(`当前 Agent：${root.agentSnapshot.name}`)).toBeNull();
  });

  it("does not let a previous workflow hide the current delegated worker or overwrite its status", () => {
    const root: AgentTask = { ...board.agentTasks[0]!, status: "waiting_children", acceptance: "not-ready" };
    const worker: AgentTask = { ...board.agentTasks[2]!, status: "running" };
    const previousRun: WorkflowRun = {
      id: "old-workflow", taskId: root.taskId, executionAttempt: 0, taskSpec: root.taskSpec, executionProfile: root.executionProfile,
      workflow: BUILTIN_ORCHESTRATION_CATALOG.workflows[0]!, agents: [], status: "failed", acceptance: "not-ready",
      startedAt: root.createdAt, updatedAt: root.updatedAt, currentStepId: "old-step",
      steps: [{ id: "old", stepId: "old-step", stepKind: "agent", name: "过去的工作流步骤", status: "failed" }],
    };
    render(<TaskCard task={{ ...board.tasks[0]!, activeAgentTaskId: root.id }} executionLabel="团队任务" agentTask={root}
      run={previousRun} activeAgents={[worker]} activities={[]} busy={false} executionEnabled onOpen={() => undefined}
      onDispatch={() => undefined} onDragStart={() => undefined} onDragEnd={() => undefined} />);
    expect(screen.getByLabelText("执行与验收状态").textContent).toContain("等待子任务");
    expect(screen.queryByText("过去的工作流步骤")).toBeNull();
    expect(screen.getByLabelText(`当前 Agent：${worker.agentSnapshot.name}`)).toBeTruthy();
  });
});
