import { describe, expect, it } from "vitest";
import type { SerializableMessage } from "../../src/shared/contracts";
import { sessionFileReferences } from "../../src/renderer/src/lib/session-files";

function assistant(text: string, timestamp: number): SerializableMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "test",
    model: "test",
    stopReason: "stop",
    timestamp,
  };
}

describe("sessionFileReferences", () => {
  it("returns the current session's assistant output paths newest first", () => {
    const older = "C:\\workspace\\older.md";
    const newest = "C:\\workspace\\newest.pptx";
    const references = sessionFileReferences([
      assistant(`输出：\`${older}\``, 100),
      { role: "user", content: "C:\\workspace\\private-user-input.pdf", timestamp: 150 },
      assistant(`结果：\`${newest}\``, 300),
    ]);

    expect(references).toEqual([
      { path: newest, timestamp: 300 },
      { path: older, timestamp: 100 },
    ]);
  });

  it("deduplicates Windows paths case-insensitively at their newest mention", () => {
    const references = sessionFileReferences([
      assistant("`C:\\WORKSPACE\\Report.docx`", 100),
      assistant("`c:\\workspace\\report.docx`", 400),
      assistant("`C:\\workspace\\table.xlsx`", 200),
    ]);

    expect(references).toEqual([
      { path: "c:\\workspace\\report.docx", timestamp: 400 },
      { path: "C:\\workspace\\table.xlsx", timestamp: 200 },
    ]);
  });
});
