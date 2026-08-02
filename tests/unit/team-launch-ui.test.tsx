import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { TeamLaunchRoom } from "../../src/renderer/src/features/team/TeamLaunchRoom";

afterEach(() => cleanup());

const PROJECT = Object.freeze({
  cwd: "C:/project",
  name: "project",
  branch: "main",
  trusted: true,
  requiresTrust: false,
  requiresSelection: false,
});
const LEAD = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "lead");
const BUILDER = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
if (!LEAD || !BUILDER) throw new Error("测试目录缺少 LEAD 或 BUILDER");
const AGENTS = Object.freeze([LEAD, BUILDER]);

describe("TeamLaunchRoom", () => {
  it("selects LEAD from the visible roster, previews the new task, and submits one launch message", async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn(async () => undefined);
    render(<TeamLaunchRoom project={PROJECT} lead={LEAD} agents={AGENTS} presences={[]} busy={false} executionEnabled onLaunch={onLaunch} />);

    const composer = screen.getByPlaceholderText("@LEAD 处理复杂任务，或 @指定Worker 直接执行清晰任务…") as HTMLTextAreaElement;
    await user.type(composer, "@le");
    expect(screen.getByRole("listbox", { name: "选择要 @ 的 Agent" })).toBeTruthy();
    await user.keyboard("{Enter}");
    await user.type(composer, "评估 NLRP3 靶点并形成可审计报告");
    await user.type(screen.getByRole("textbox", { name: /验收标准/ }), "报告包含原始来源、反证与下一步实验");
    expect(screen.getByRole("status").textContent).toContain("将创建任务“评估 NLRP3 靶点并形成可审计报告”");
    await user.click(screen.getByRole("button", { name: "创建任务并交给 LEAD" }));

    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith("@LEAD 评估 NLRP3 靶点并形成可审计报告", "报告包含原始来源、反证与下一步实验"));
    expect(composer.value).toBe("");
  });

  it("accepts Team Pulse requests for LEAD and a direct Worker", async () => {
    const onLaunch = vi.fn(async () => undefined);
    const { rerender } = render(<TeamLaunchRoom project={PROJECT} lead={LEAD} agents={AGENTS} presences={[]} busy={false} executionEnabled onLaunch={onLaunch} />);
    const composer = screen.getByPlaceholderText("@LEAD 处理复杂任务，或 @指定Worker 直接执行清晰任务…") as HTMLTextAreaElement;
    rerender(<TeamLaunchRoom project={PROJECT} lead={LEAD} agents={AGENTS} presences={[]} mentionRequest={{ requestId: 1, agentId: "lead" }} busy={false} executionEnabled onLaunch={onLaunch} />);
    await waitFor(() => expect(composer.value).toBe("@LEAD "));

    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /验收标准/ }), "真实修改通过自动化验证");
    await user.clear(composer);
    await user.type(composer, "@BUILD 直接修改项目");
    expect(screen.getByRole("status").textContent).toContain("直接交给");
    const submit = screen.getByRole("button", { name: "创建并直接执行" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await user.click(submit);
    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith("@BUILD 直接修改项目", "真实修改通过自动化验证"));
  });
});
