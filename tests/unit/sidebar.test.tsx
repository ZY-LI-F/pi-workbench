import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeBootstrap } from "@shared/contracts";
import { Sidebar } from "@renderer/components/Sidebar";

afterEach(() => cleanup());

function bootstrap(): RuntimeBootstrap {
  return {
    project: { cwd: "C:/project", name: "project", trusted: true, requiresTrust: false, requiresSelection: false },
    recentProjects: [],
    state: {
      sessionFile: "C:/sessions/running.jsonl",
      sessionId: "running-session",
      sessionName: undefined,
      messageCount: 1,
      thinkingLevel: "off",
      isStreaming: true,
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      autoCompactionEnabled: true,
      pendingMessageCount: 0,
    },
    messages: [{ role: "user", content: "生成 CDK2 早研任务", timestamp: Date.now() }],
    sessions: [],
    models: [],
    thinkingLevels: ["off"],
    commands: [],
    stats: {
      sessionFile: "C:/sessions/running.jsonl",
      sessionId: "running-session",
      userMessages: 1,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 1,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    },
    entries: [],
    tree: [],
    leafId: null,
    piVersion: "0.80.10",
  } as unknown as RuntimeBootstrap;
}

function renderSidebar(source = bootstrap(), teamFeaturesEnabled = false, open = true) {
  return render(
    <Sidebar
      bootstrap={source}
      capabilities={{ pi: { state: "ready" }, task: { state: "ready" }, schedule: { state: "ready" }, webhook: { state: "ready" } }}
      skin="stella"
      open={open}
      activeView="chat"
      teamFeaturesEnabled={teamFeaturesEnabled}
      modelChanging={false}
      onClose={() => undefined}
      onNewSession={() => undefined}
      onNewTask={() => undefined}
      onSwitchView={() => undefined}
      onChooseProject={() => undefined}
      onOpenRecentProject={() => undefined}
      onSwitchSession={() => undefined}
      onOpenPalette={() => undefined}
      onOpenTerminal={() => undefined}
      onOpenInspector={() => undefined}
      onOpenSettings={() => undefined}
      onModelChange={() => undefined}
    />,
  );
}

describe("Sidebar", () => {
  it("defaults to the task rail and keeps Pi-native navigation in its own tab", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSidebar();

    expect(screen.getByRole("tab", { name: /任务栏/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("全局运行模型")).toBeTruthy();
    expect(screen.getByRole("button", { name: /生成 CDK2 早研任务/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "当前会话" })).toBeNull();
    expect(screen.queryByRole("button", { name: /团队协作/ })).toBeNull();
    expect(screen.getByRole("button", { name: "任务看板" })).toBeTruthy();
    expect(screen.getByLabelText("能力状态").children).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "关闭侧栏" })).toHaveLength(1);

    await user.click(screen.getByRole("tab", { name: "PI 原生工作台" }));
    expect(screen.getByRole("button", { name: "当前会话" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "模型配置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skills 管理" })).toBeTruthy();

    unmount();
    renderSidebar(bootstrap(), true);
    expect(screen.getByRole("button", { name: /团队协作/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "任务看板" })).toBeTruthy();
    expect(screen.getByLabelText("能力状态").children).toHaveLength(4);
  });

  it("shows the current running session before it appears in historical session summaries", () => {
    renderSidebar();

    expect(screen.getByRole("button", { name: /生成 CDK2 早研任务/ })).toBeTruthy();
    expect(screen.queryByText("这个项目还没有会话。")).toBeNull();
  });

  it("does not duplicate the current session when Pi already returns it in history", () => {
    const source = bootstrap();
    const session = {
      path: "C:/sessions/running.jsonl",
      id: "running-session",
      cwd: "C:/project",
      name: "历史标题",
      created: "2026-07-18T00:00:00.000Z",
      modified: "2026-07-18T00:01:00.000Z",
      messageCount: 2,
      firstMessage: "历史消息",
    };
    renderSidebar({ ...source, sessions: [session] } as RuntimeBootstrap);

    expect(screen.getAllByRole("button", { name: /生成 CDK2 早研任务|历史标题/ })).toHaveLength(1);
  });

  it("removes a collapsed sidebar from the accessibility and interaction path", () => {
    const { container } = renderSidebar(bootstrap(), false, false);
    const sidebar = container.querySelector(".sidebar");

    expect(sidebar?.classList.contains("is-collapsed")).toBe(true);
    expect(sidebar?.getAttribute("aria-hidden")).toBe("true");
    expect(sidebar?.hasAttribute("inert")).toBe(true);
  });
});
