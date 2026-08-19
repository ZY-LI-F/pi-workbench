import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Settings2 } from "lucide-react";
import { HeaderOverflowMenu } from "../../src/renderer/src/components/HeaderOverflowMenu";

afterEach(() => cleanup());

describe("HeaderOverflowMenu", () => {
  it("exposes compact header actions and closes after selection", async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    render(
      <HeaderOverflowMenu
        ariaLabel="更多会话操作"
        status="Pi 已就绪"
        actions={[
          { id: "settings", label: "设置", description: "调整界面和运行偏好", icon: <Settings2 />, onSelect: onSettings },
          { id: "disabled", label: "不可用操作", icon: <Settings2 />, disabled: true, onSelect: vi.fn() },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "更多会话操作" }));
    expect(screen.getByRole("status").textContent).toContain("Pi 已就绪");
    expect((screen.getByRole("menuitem", { name: /不可用操作/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("menuitem", { name: /设置/ }));
    expect(onSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("returns focus to the trigger when Escape closes the menu", async () => {
    const user = userEvent.setup();
    render(<HeaderOverflowMenu ariaLabel="更多操作" actions={[{ id: "settings", label: "设置", icon: <Settings2 />, selected: true, onSelect: vi.fn() }]} />);
    const trigger = screen.getByRole("button", { name: "更多操作" });
    await user.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: "设置" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
