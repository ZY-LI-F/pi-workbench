import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SerializableMessage, StellaDesktopApi } from "../../src/shared/contracts";
import { MessageCard } from "../../src/renderer/src/components/MessageCard";

afterEach(cleanup);

const api = {
  openExternal: vi.fn(async () => undefined),
  copyText: vi.fn(async () => undefined),
} as unknown as StellaDesktopApi;

describe("MessageCard Skill invocation", () => {
  it("copies the user-facing Skill invocation, not its expanded instructions", async () => {
    const desktop = { ...api, copyText: vi.fn(async () => undefined) };
    render(<MessageCard api={desktop} message={{ role: "user", timestamp: 1, content: '<skill name="evidence" location="C:/SKILL.md">\nINTERNAL BODY\n</skill>\n\nmy task' }} toolExecutions={{}} onFork={vi.fn()} onPreviewFile={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(screen.getByTitle("已复制")).toBeTruthy());
    expect(desktop.copyText).toHaveBeenCalledWith("/skill:evidence my task");
  });

  it("preserves ordinary or malformed Skill text and mixed image attachments", () => {
    const text = '<skill name="unfinished">\nnot a valid expansion';
    render(<MessageCard api={api} message={{ role: "user", timestamp: 1, content: [
      { type: "text", text }, { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ] }} toolExecutions={{}} onFork={vi.fn()} onPreviewFile={vi.fn()} />);
    expect(screen.getByText(/not a valid expansion/).textContent).toBe(text);
    expect(screen.getByAltText("附件 1").getAttribute("src")).toBe("data:image/png;base64,aW1hZ2U=");
    expect(screen.queryByText("PI SKILL")).toBeNull();
  });

  it("reports clipboard failures without displaying a false copied state", async () => {
    const desktop = { ...api, copyText: vi.fn(async () => { throw new Error("clipboard locked"); }) };
    render(<MessageCard api={desktop} message={{ role: "user", timestamp: 1, content: "retain me" }} toolExecutions={{}} onFork={vi.fn()} onPreviewFile={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("clipboard locked"));
    expect(screen.queryByTitle("已复制")).toBeNull();
    expect(screen.getByText("retain me")).toBeTruthy();
  });

  it("does not claim a historical tool with no recorded result is running", () => {
    render(<MessageCard api={api} message={{ role: "assistant", timestamp: 1, provider: "test", model: "test", stopReason: "aborted", content: [
      { type: "toolCall", id: "interrupted", name: "read", arguments: { path: "README.md" } },
    ] }} toolExecutions={{}} onFork={vi.fn()} onPreviewFile={vi.fn()} />);
    expect(screen.getByLabelText("未记录结果")).toBeTruthy();
    expect(screen.queryByLabelText("执行中")).toBeNull();
  });

  it("collapses Pi-expanded Skill Markdown while preserving the user request", () => {
    const message: SerializableMessage = {
      role: "user",
      content: [{
        type: "text",
        text: '<skill name="target-evidence" location="C:\\Users\\test\\.pi\\agent\\skills\\target-evidence\\SKILL.md">\nReferences are relative to C:\\Users\\test\\.pi\\agent\\skills\\target-evidence.\n\n# Target Evidence\n\nInternal instructions that should start collapsed.\n</skill>\n\n评估 CDK2 的遗传学与临床证据',
      }],
      timestamp: Date.now(),
    };

    const { container } = render(
      <MessageCard api={api} message={message} toolExecutions={{}} onFork={vi.fn()} onPreviewFile={vi.fn()} />,
    );

    const toggle = screen.getByRole("button", { name: /skill:target-evidence/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("评估 CDK2 的遗传学与临床证据")).toBeTruthy();
    expect(container.querySelector(".skill-invocation__instructions")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Target Evidence")).toBeTruthy();
    expect(screen.getByText(/Internal instructions/)).toBeTruthy();
  });
});
