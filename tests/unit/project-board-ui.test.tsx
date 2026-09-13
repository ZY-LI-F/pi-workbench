import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectBoardWorkspace } from "../../src/renderer/src/features/projects/ProjectBoardWorkspace";
import { KanbanWorkspace } from "../../src/renderer/src/features/kanban/KanbanWorkspace";
import { EMPTY_BOARD_STATE, type KanbanTask } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import type { ProjectRegistrySnapshot, RegisteredProject } from "../../src/shared/project-registry";
import type { StellaDesktopApi } from "../../src/shared/contracts";
import type { KanbanController } from "../../src/renderer/src/hooks/use-kanban";
import type { ProjectRegistryController } from "../../src/renderer/src/hooks/use-project-registry";

afterEach(cleanup);
const time = "2026-09-13T00:00:00Z";
const projects: readonly RegisteredProject[] = [
  { id: "a", path: "C:/alpha", name: "Alpha", description: "研发", stage: "active", pinned: false, archived: false, createdAt: time, updatedAt: time },
  { id: "b", path: "C:/beta", name: "Beta", description: "交付", stage: "planned", pinned: false, archived: false, createdAt: time, updatedAt: time },
  { id: "c", path: "C:/archive", name: "Archive", description: "", stage: "completed", pinned: false, archived: true, createdAt: time, updatedAt: time },
];
const task: KanbanTask = { id: "task-beta", projectPath: "C:/beta", projectName: "Beta", title: "验收发布说明", description: "交付准备", acceptanceCriteria: "可阅读", stage: "review", priority: "high", executionTarget: { kind: "manual" }, trusted: false, specRevision: 1, createdAt: time, updatedAt: time };
const snapshot: ProjectRegistrySnapshot = { version: 1, revision: 1, projects, checkedAt: time, directories: { a: { state: "available" }, b: { state: "available" }, c: { state: "missing", detail: "目录不存在" } } };

function fixture(options: { failure?: boolean; boardError?: string } = {}) {
  const api = { chooseProject: vi.fn(async () => ({ path: "C:/new", name: "New", requiresTrust: true })), onEvent: () => () => undefined } as unknown as StellaDesktopApi;
  const controller: ProjectRegistryController = { snapshot, loading: false, busy: false, error: undefined, refresh: vi.fn(async () => undefined),
    add: vi.fn(async () => { if (options.failure) throw new Error("保存失败：磁盘已满"); return snapshot; }), update: vi.fn(async () => snapshot) };
  const kanban = { state: { phase: "ready", bootstrap: { board: { ...EMPTY_BOARD_STATE, tasks: [task] }, catalog: BUILTIN_ORCHESTRATION_CATALOG }, error: options.boardError, pending: [], liveEvents: {}, liveAgentTaskEvents: {} } } as unknown as KanbanController;
  const onOpenWorkspace = vi.fn(async () => undefined);
  const onViewTasks = vi.fn();
  const props = { api, controller, kanban, project: { cwd: "C:/alpha", name: "Alpha", trusted: false, requiresTrust: false, requiresSelection: false }, onOpenSidebar: vi.fn(), onViewTasks, onOpenWorkspace, onRetryTasks: vi.fn(), onError: vi.fn(), createRequest: 0, onCreateRequestConsumed: vi.fn() };
  return { ...props, props };
}

describe("project board interaction", () => {
  it("browses and drills into another project's real Task without opening its workspace", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ProjectBoardWorkspace {...f.props} />);
    await user.click(screen.getByRole("button", { name: "查看项目 Beta" }));
    const detail = screen.getByRole("complementary", { name: "项目详情 Beta" });
    expect(within(detail).getByText("手工任务等待审核")).toBeTruthy();
    await user.click(within(detail).getByRole("button", { name: /验收发布说明/ }));
    expect(f.onViewTasks).toHaveBeenCalledWith("C:/beta", "task-beta");
    expect(f.onOpenWorkspace).not.toHaveBeenCalled();
    await user.click(within(detail).getByRole("button", { name: "打开工作区" }));
    expect(f.onOpenWorkspace).toHaveBeenCalledWith("C:/beta");
  });

  it("keeps plan stages and task completion independent, supports keyboard movement and native drag", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ProjectBoardWorkspace {...f.props} />);
    await user.selectOptions(screen.getByLabelText("项目阶段 Beta"), "completed");
    expect(f.controller.update).toHaveBeenCalledWith({ projectId: "b", stage: "completed" });
    expect(f.kanban.state.bootstrap?.board.tasks[0]?.stage).toBe("review");
    await user.click(screen.getByRole("button", { name: "阶段看板" }));
    fireEvent.drop(screen.getByRole("region", { name: "暂缓项目" }), { dataTransfer: { getData: () => "b" } });
    await waitFor(() => expect(f.controller.update).toHaveBeenCalledWith({ projectId: "b", stage: "paused" }));
    fireEvent.drop(screen.getByRole("region", { name: "暂缓项目" }), { dataTransfer: { getData: () => "outside-project" } });
    expect(f.controller.update).toHaveBeenCalledTimes(2);
  });

  it("filters task attention and text, restores archived projects and exposes missing directories", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<ProjectBoardWorkspace {...f.props} />);
    await user.selectOptions(screen.getByLabelText("项目活动筛选"), "attention");
    expect(screen.queryByRole("button", { name: "查看项目 Alpha" })).toBeNull();
    expect(screen.getByRole("button", { name: "查看项目 Beta" })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("项目活动筛选"), "all");
    await user.type(screen.getByLabelText("搜索项目"), "missing");
    expect(screen.getByText("没有符合筛选条件的项目")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    await user.selectOptions(screen.getByLabelText("项目归档筛选"), "archived");
    await user.click(screen.getByRole("button", { name: "查看项目 Archive" }));
    const detail = screen.getByRole("complementary", { name: "项目详情 Archive" });
    expect(within(detail).getByRole("button", { name: "打开工作区" }).hasAttribute("disabled")).toBe(true);
    await user.click(within(detail).getByRole("button", { name: "恢复项目" }));
    expect(f.controller.update).toHaveBeenCalledWith({ projectId: "c", archived: false });
  });

  it("retains form input after a save failure and directory picking does not open a workspace", async () => {
    const f = fixture({ failure: true });
    const user = userEvent.setup();
    render(<ProjectBoardWorkspace {...f.props} />);
    await user.click(screen.getByRole("button", { name: "添加项目", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "添加项目" });
    await user.click(within(dialog).getByRole("button", { name: "选择目录" }));
    await user.type(within(dialog).getByLabelText("项目说明"), "保留我的输入");
    await user.click(within(dialog).getByRole("button", { name: "添加项目", exact: true }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "保存失败：磁盘已满");
    expect(within(dialog).getByLabelText("项目说明")).toHaveProperty("value", "保留我的输入");
    expect(f.onOpenWorkspace).not.toHaveBeenCalled();
  });

  it("shows unknown task statistics explicitly when Task Control fails", () => {
    const f = fixture({ boardError: "Board 读取失败" });
    render(<ProjectBoardWorkspace {...f.props} />);
    expect(screen.getByRole("alert").textContent).toContain("Board 读取失败");
    expect(screen.getAllByText("任务统计暂不可用")).toHaveLength(2);
    expect(screen.getByLabelText("项目活动筛选").hasAttribute("disabled")).toBe(true);
  });
});

it("opens Kanban scoped to a non-current project and selected Task, keeping mutations unavailable until workspace switch", async () => {
  const f = fixture();
  render(<KanbanWorkspace api={f.api} controller={f.kanban} project={f.project} projects={projects} initialProjectPath="C:/beta" initialTaskId="task-beta"
    executionEnabled={false} teamFeaturesEnabled={false} taskCapabilityRetrying={false} onRetryTaskCapability={() => undefined} createRequest={0} onCreateRequestConsumed={() => undefined}
    onContinueTaskSession={async () => undefined} onOpenProject={f.onOpenWorkspace} onOpenSidebar={() => undefined} onOpenTerminal={() => undefined} onError={() => undefined} />);
  expect(screen.getByLabelText("筛选任务项目")).toHaveProperty("value", "C:/beta");
  expect(screen.getByRole("button", { name: "新建任务", exact: true }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "打开项目", exact: true })).toBeTruthy();
});
