import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { KanbanTask } from "../../src/shared/kanban";
import {
  TaskCollaborationBadge,
  taskCollaborationScope,
} from "../../src/renderer/src/features/kanban/TaskCollaborationBadge";

afterEach(() => cleanup());

const MANUAL_TASK = Object.freeze({ executionTarget: Object.freeze({ kind: "manual" as const }) });
const AGENT_TASK = Object.freeze({ executionTarget: Object.freeze({ kind: "agent" as const, agentId: "builder" }) });

describe("task collaboration badge", () => {
  it("keeps untouched manual tasks personal", () => {
    expect(taskCollaborationScope(MANUAL_TASK, false)).toBe("personal");
    render(<TaskCollaborationBadge scope="personal" />);
    expect(screen.getByLabelText("任务归属：个人").textContent).toBe("个人");
  });

  it("marks configured or historically delegated tasks as Team tasks", () => {
    expect(taskCollaborationScope(AGENT_TASK as Pick<KanbanTask, "executionTarget">, false)).toBe("team");
    expect(taskCollaborationScope(MANUAL_TASK, true)).toBe("team");
    render(<TaskCollaborationBadge scope="team" />);
    expect(screen.getByLabelText("任务归属：TEAM").textContent).toBe("TEAM");
  });
});
