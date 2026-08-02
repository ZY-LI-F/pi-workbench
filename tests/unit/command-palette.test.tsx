import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Command } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../../src/renderer/src/components/CommandPalette";

afterEach(cleanup);

describe("CommandPalette", () => {
  it("separates native operations, Pi commands, and Skills while preserving keyboard execution", async () => {
    const user = userEvent.setup();
    const onInsertCommand = vi.fn();
    render(
      <CommandPalette
        actions={[{ id: "new", label: "新建会话", detail: "开始 Pi 会话", icon: Command, run: vi.fn() }]}
        commands={[
          { name: "review", description: "审查改动", source: "prompt" },
          { name: "skill:target-evidence", description: "靶点证据", source: "skill" },
        ]}
        onInsertCommand={onInsertCommand}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("工作台操作")).toBeTruthy();
    expect(screen.getByText("Pi 命令与提示词")).toBeTruthy();
    expect(screen.getByText("Pi Skills")).toBeTruthy();

    const input = screen.getByRole("combobox", { name: "搜索操作、技能或提示词" });
    await user.type(input, "target-evidence");
    expect(screen.queryByText("Pi 命令与提示词")).toBeNull();
    expect(screen.getByText("Pi Skills")).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(onInsertCommand).toHaveBeenCalledWith(expect.objectContaining({ name: "skill:target-evidence" }));
  });
});
