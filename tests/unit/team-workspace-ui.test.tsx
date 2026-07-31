import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StellaDesktopApi } from "@shared/contracts";
import { BOARD_SCHEMA_VERSION, type BoardBootstrap, type KanbanTask } from "@shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "@shared/orchestration-catalog";
import type { KanbanController } from "@renderer/hooks/use-kanban";
import { TeamWorkspace } from "@renderer/features/team/TeamWorkspace";

afterEach(() => cleanup());

const PROJECT = Object.freeze({
  cwd: "C:/project",
  name: "project",
  branch: "main",
  trusted: true,
  requiresTrust: false,
  requiresSelection: false,
});

const OTHER_PROJECT = Object.freeze({ ...PROJECT, cwd: "C:/other", name: "other" });

function makeTask(id: string, title: string, project = PROJECT): KanbanTask {
  return Object.freeze({
    id,
    title,
    description: "说明",
    acceptanceCriteria: "验收标准",
    priority: "medium",
    projectPath: project.cwd,
    projectName: project.name,
    trusted: true,
    executionTarget: Object.freeze({ kind: "agent", agentId: "builder" }),
    stage: "planned",
    specRevision: 1,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  });
}

const BOOTSTRAP: BoardBootstrap = Object.freeze({
  board: Object.freeze({
    version: BOARD_SCHEMA_VERSION,
    tasks: Object.freeze([makeTask("task-1", "任务一"), makeTask("task-2", "任务二"), makeTask("task-other", "其他项目任务", OTHER_PROJECT)]),
    runs: Object.freeze([]),
    activities: Object.freeze([]),
    comments: Object.freeze([]),
    agentTasks: Object.freeze([]),
    customAgents: Object.freeze([]),
    squads: Object.freeze([]),
    autopilots: Object.freeze([]),
    autopilotRuns: Object.freeze([]),
  }),
  catalog: BUILTIN_ORCHESTRATION_CATALOG,
});

function stubController(): KanbanController {
  const operation = vi.fn(async () => BOOTSTRAP);
  return {
    state: {
      phase: "ready",
      bootstrap: BOOTSTRAP,
      pending: Object.freeze([]),
      liveEvents: Object.freeze({}),
      liveAgentTaskEvents: Object.freeze({}),
    },
    createTask: operation,
    launchTeamTask: operation,
    updateTask: operation,
    moveTask: operation,
    deleteTask: operation,
    addComment: operation,
    createAgent: operation,
    updateAgent: operation,
    deleteAgent: operation,
    createSquad: operation,
    updateSquad: operation,
    deleteSquad: operation,
    createAutopilot: operation,
    updateAutopilot: operation,
    deleteAutopilot: operation,
    triggerAutopilot: operation,
    dispatchTask: operation,
    resolveGate: operation,
    reviewExecution: operation,
    abortTask: operation,
  };
}

const API = Object.freeze({
  revealPath: vi.fn(async () => undefined),
  copyText: vi.fn(async () => undefined),
}) as unknown as StellaDesktopApi;

function renderWorkspace() {
  return render(
    <TeamWorkspace
      api={API}
      controller={stubController()}
      project={PROJECT}
      executionEnabled
      onOpenSidebar={() => undefined}
      onNewTask={() => undefined}
      onContinueTaskSession={async () => undefined}
      onError={() => undefined}
    />,
  );
}

describe("TeamWorkspace", () => {
  it("keeps the open task room while searching for other channels", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: /任务一/ }));
    expect(screen.getByLabelText("任务详情：任务一")).toBeTruthy();

    await user.type(screen.getByLabelText("搜索已创建任务"), "毫无匹配的关键字");
    expect(screen.queryByRole("button", { name: /任务一/ })).toBeNull();
    expect(screen.getByLabelText("任务详情：任务一")).toBeTruthy();
  });

  it("resets confirm-delete state when switching to another task room", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: /任务一/ }));
    await user.click(screen.getByRole("button", { name: "删除任务" }));
    expect(screen.getByRole("button", { name: "确认删除" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /任务二/ }));
    expect(screen.getByLabelText("任务详情：任务二")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认删除" })).toBeNull();
    expect(screen.getByRole("button", { name: "删除任务" })).toBeTruthy();
  });

  it("closes a hidden Task Room when the current project changes", async () => {
    const user = userEvent.setup();
    const controller = stubController();
    const view = render(
      <TeamWorkspace api={API} controller={controller} project={PROJECT} executionEnabled onOpenSidebar={() => undefined} onNewTask={() => undefined} onContinueTaskSession={async () => undefined} onError={() => undefined} />,
    );
    await user.click(screen.getByRole("button", { name: /任务一/ }));
    expect(screen.getByLabelText("任务详情：任务一")).toBeTruthy();

    view.rerender(
      <TeamWorkspace api={API} controller={controller} project={OTHER_PROJECT} executionEnabled onOpenSidebar={() => undefined} onNewTask={() => undefined} onContinueTaskSession={async () => undefined} onError={() => undefined} />,
    );

    await waitFor(() => expect(screen.queryByLabelText("任务详情：任务一")).toBeNull());
    expect(screen.getByRole("button", { name: /其他项目任务/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: "任务启动台" })).toBeTruthy();
  });
});
