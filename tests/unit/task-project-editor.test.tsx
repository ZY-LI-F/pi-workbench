import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TaskEditorDialog } from "../../src/renderer/src/features/kanban/TaskEditorDialog";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import type { CreateTaskInput } from "../../src/shared/kanban";

afterEach(cleanup);
function props() {
  return { workflows: BUILTIN_ORCHESTRATION_CATALOG.workflows, agents: BUILTIN_ORCHESTRATION_CATALOG.agents,
    squads: [], busy: false, onClose: vi.fn(), onCreate: vi.fn(async (_input: CreateTaskInput) => undefined), onUpdate: vi.fn(async () => undefined) };
}

it("creates a manual Task when no project has been selected", async () => {
  const f = props();
  const user = userEvent.setup();
  render(<TaskEditorDialog {...f} />);
  expect((screen.getByRole("combobox", { name: "任务所属项目" }) as HTMLSelectElement).value).toBe("none");
  await user.type(screen.getByPlaceholderText("清楚描述要交付的结果"), "记录未归属任务");
  await user.click(screen.getByRole("button", { name: /创建任务/ }));
  await waitFor(() => expect(f.onCreate).toHaveBeenCalledOnce());
  expect(f.onCreate.mock.calls[0]?.[0]).toMatchObject({ projectPath: undefined, projectName: "未归属项目", trusted: false, executionTarget: { kind: "manual" } });
});

it("allows an explicit no-project choice even while another workspace is open", async () => {
  const f = props();
  const user = userEvent.setup();
  render(<TaskEditorDialog {...f} project={{ cwd: "C:/actual", name: "实际项目", trusted: true, requiresTrust: false, requiresSelection: false }} />);
  await user.selectOptions(screen.getByRole("combobox", { name: "任务所属项目" }), "none");
  await user.type(screen.getByPlaceholderText("清楚描述要交付的结果"), "独立待办");
  await user.click(screen.getByRole("button", { name: /创建任务/ }));
  await waitFor(() => expect(f.onCreate).toHaveBeenCalledOnce());
  expect(f.onCreate.mock.calls[0]?.[0]).toMatchObject({ projectPath: undefined, trusted: false });
});
