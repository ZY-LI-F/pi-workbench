import { describe, expect, it, vi } from "vitest";
import { writeVerifiedClipboardText } from "../../src/main/clipboard-service";

describe("writeVerifiedClipboardText", () => {
  it("returns only after the system clipboard round-trips the requested text", () => {
    let stored = "";
    const writeText = vi.fn((value: string) => { stored = value; });

    expect(() => writeVerifiedClipboardText({ writeText, readText: () => stored }, "C:\\submission\\session.jsonl")).not.toThrow();
    expect(writeText).toHaveBeenCalledWith("C:\\submission\\session.jsonl");
  });

  it("accepts platform newline normalization without weakening content comparison", () => {
    expect(() => writeVerifiedClipboardText({
      writeText: () => undefined,
      readText: () => "line one\r\nline two",
    }, "line one\nline two")).not.toThrow();
  });

  it("exposes a clipboard backend that silently refuses the write", () => {
    expect(() => writeVerifiedClipboardText({
      writeText: () => undefined,
      readText: () => "",
    }, "expected value")).toThrow("系统剪贴板未接受待复制文本");
  });
});
