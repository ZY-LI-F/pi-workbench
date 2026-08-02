import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeBootstrap } from "@shared/contracts";
import { Topbar } from "@renderer/components/Topbar";

afterEach(cleanup);

const BOOTSTRAP = {
  project: { name: "PI-GUI", branch: "main" },
  state: { thinkingLevel: "off", model: { provider: "aliyun-maas", id: "qwen3.6-flash", name: "Qwen 3.6 Flash" } },
  thinkingLevels: ["off"],
} as unknown as RuntimeBootstrap;

function renderTopbar(online: boolean) {
  const onFocusSession = vi.fn();
  const onNewSession = vi.fn();
  const onOpenModels = vi.fn();
  render(
    <Topbar
      bootstrap={BOOTSTRAP}
      streaming={false}
      compacting={false}
      retrying={false}
      online={online}
      onOpenSidebar={vi.fn()}
      onFocusSession={onFocusSession}
      onNewSession={onNewSession}
      onToggleInspector={vi.fn()}
      onOpenModels={onOpenModels}
      onOpenSettings={vi.fn()}
      onThinkingChange={vi.fn()}
      onAbortRetry={vi.fn()}
    />,
  );
  return Object.freeze({ onFocusSession, onNewSession, onOpenModels });
}

describe("Topbar", () => {
  it("keeps current and new session actions visible in the chat workspace", async () => {
    const user = userEvent.setup();
    const actions = renderTopbar(true);

    await user.click(screen.getByRole("button", { name: "聚焦当前会话" }));
    await user.click(screen.getByRole("button", { name: "新建会话" }));
    expect(actions.onFocusSession).toHaveBeenCalledOnce();
    expect(actions.onNewSession).toHaveBeenCalledOnce();
  });

  it("exposes the offline state without removing the session controls", () => {
    renderTopbar(false);

    expect(screen.getByText("Pi 暂不可用")).toBeTruthy();
    expect(screen.getByRole("button", { name: "聚焦当前会话" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "新建会话" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "会话检查器" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the active model visible and opens the shared model configuration", async () => {
    const user = userEvent.setup();
    const actions = renderTopbar(true);

    const model = screen.getByRole("button", { name: "当前模型：aliyun-maas / Qwen 3.6 Flash，打开模型配置" });
    expect(model.textContent).toContain("aliyun-maas / Qwen 3.6 Flash");
    await user.click(model);
    expect(actions.onOpenModels).toHaveBeenCalledOnce();
  });
});
