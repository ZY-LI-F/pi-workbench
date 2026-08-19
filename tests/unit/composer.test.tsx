import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerImage } from "@renderer/components/Composer";

afterEach(cleanup);

function ComposerHarness({
  streaming = false,
  onSend = vi.fn().mockResolvedValue(undefined),
  onStop = vi.fn(),
  onQueueModeChange = vi.fn(),
  initialImages = Object.freeze([]),
  sendDisabled = false,
  commands = Object.freeze([{ name: "review", description: "审查改动", source: "prompt" as const }]),
}: {
  readonly streaming?: boolean;
  readonly onSend?: (message: string, images: readonly ComposerImage[]) => Promise<void>;
  readonly onStop?: () => void;
  readonly onQueueModeChange?: (mode: "steer" | "followUp") => void;
  readonly initialImages?: readonly ComposerImage[];
  readonly sendDisabled?: boolean;
  readonly commands?: React.ComponentProps<typeof Composer>["commands"];
}) {
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<readonly ComposerImage[]>(initialImages);
  const [height, setHeight] = useState<number | null>(null);
  return (
    <Composer
      draft={draft}
      onDraftChange={setDraft}
      images={images}
      onImagesChange={setImages}
      commands={commands}
      widgets={{}}
      streaming={streaming}
      queueMode="steer"
      onQueueModeChange={onQueueModeChange}
      onSend={onSend}
      onStop={onStop}
      onOpenTerminal={vi.fn()}
      onOpenPalette={vi.fn()}
      onError={vi.fn()}
      sendDisabled={sendDisabled}
      sendDisabledReason={sendDisabled ? "Pi 恢复后即可发送" : undefined}
      height={height}
      onHeightChange={setHeight}
    />
  );
}

describe("Composer", () => {
  it("submits with Enter and clears the draft only after success", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ComposerHarness onSend={onSend} />);
    const input = screen.getByLabelText("给 Pi 的消息");

    await user.type(input, "检查当前改动{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("检查当前改动", []));
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("inserts slash commands and exposes streaming controls", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const onQueueModeChange = vi.fn();
    render(<ComposerHarness streaming onStop={onStop} onQueueModeChange={onQueueModeChange} />);
    const input = screen.getByLabelText("给 Pi 的消息");

    await user.type(input, "/rev");
    await user.click(screen.getByRole("option", { name: /\/review/ }));
    expect((input as HTMLTextAreaElement).value).toBe("/review ");
    await user.click(screen.getByRole("button", { name: "排队" }));
    expect(onQueueModeChange).toHaveBeenCalledWith("followUp");
    await user.click(screen.getByRole("button", { name: "停止" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("finds Skills with /技能 and confirms the active option with arrow keys and Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    const commands = Object.freeze([
      { name: "skill:target-evidence", description: "检索靶点证据", source: "skill" as const },
      { name: "skill:clinical-landscape", description: "分析临床竞品", source: "skill" as const },
      { name: "review", description: "审查改动", source: "prompt" as const },
    ]);
    render(<ComposerHarness commands={commands} onSend={onSend} />);
    const input = screen.getByLabelText("给 Pi 的消息") as HTMLTextAreaElement;

    await user.type(input, "/技能");
    expect(screen.getByText("Pi Skills")).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);

    await user.keyboard("{ArrowDown}");
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    await user.keyboard("{Enter}");

    expect(input.value).toBe("/skill:clinical-landscape ");
    expect(screen.queryByRole("listbox", { name: "斜杠命令候选" })).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("wraps upward through Skill options and confirms with Tab", async () => {
    const user = userEvent.setup();
    const commands = Object.freeze([
      { name: "skill:target-evidence", description: "检索靶点证据", source: "skill" as const },
      { name: "skill:clinical-landscape", description: "分析临床竞品", source: "skill" as const },
    ]);
    render(<ComposerHarness commands={commands} />);
    const input = screen.getByLabelText("给 Pi 的消息") as HTMLTextAreaElement;

    await user.type(input, "/技能");
    await user.keyboard("{ArrowUp}{Tab}");

    expect(input.value).toBe("/skill:clinical-landscape ");
    expect(document.activeElement).toBe(input);
  });

  it("ignores composing Enter and lets Escape dismiss Skills before stopping a stream", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onStop = vi.fn();
    const commands = Object.freeze([
      { name: "skill:target-evidence", description: "检索靶点证据", source: "skill" as const },
    ]);
    render(<ComposerHarness commands={commands} streaming onSend={onSend} onStop={onStop} />);
    const input = screen.getByLabelText("给 Pi 的消息") as HTMLTextAreaElement;

    await user.type(input, "/技能");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input.value).toBe("/技能");
    expect(screen.getByRole("listbox", { name: "斜杠命令候选" })).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "斜杠命令候选" })).toBeNull();
    expect(onStop).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("retains text and attachments when sending fails", async () => {
    const user = userEvent.setup();
    const image = Object.freeze({ type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png", name: "target.png" });
    const onSend = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    render(<ComposerHarness initialImages={[image]} onSend={onSend} />);
    const input = screen.getByLabelText("给 Pi 的消息");

    await user.type(input, "继续分析{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("继续分析", [image]));
    expect((input as HTMLTextAreaElement).value).toBe("继续分析");
    expect(screen.getByAltText("target.png")).toBeTruthy();
  });

  it("keeps the composer editable while sending is explicitly unavailable", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ComposerHarness sendDisabled onSend={onSend} />);
    const input = screen.getByLabelText("给 Pi 的消息");

    await user.type(input, "先保存这段任务上下文{Enter}");
    expect((input as HTMLTextAreaElement).value).toBe("先保存这段任务上下文");
    expect(screen.getByText("Pi 恢复后即可发送")).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("resizes the input area with pointer and keyboard, then restores automatic height", () => {
    render(<ComposerHarness />);
    const separator = screen.getByRole("separator", { name: "调整输入区高度" });
    const input = screen.getByLabelText("给 Pi 的消息") as HTMLTextAreaElement;

    expect(separator.getAttribute("aria-valuetext")).toBe("自动高度");
    fireEvent.pointerDown(separator, { button: 0, clientY: 400 });
    fireEvent.pointerMove(window, { clientY: 300 });
    expect(separator.getAttribute("aria-valuenow")).toBe("140");
    expect(input.style.height).toBe("140px");
    fireEvent.pointerUp(window);

    fireEvent.keyDown(separator, { key: "ArrowUp", shiftKey: true });
    expect(separator.getAttribute("aria-valuenow")).toBe("188");
    fireEvent.doubleClick(separator);
    expect(separator.getAttribute("aria-valuetext")).toBe("自动高度");
  });
});
