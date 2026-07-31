import { describe, expect, it } from "vitest";
import { parseBashResult } from "../../src/renderer/src/lib/pi-bash-result";

describe("parseBashResult", () => {
  it("preserves a completed Pi Bash result", () => {
    expect(parseBashResult({ output: "done", exitCode: 0, cancelled: false, truncated: false })).toEqual({
      output: "done",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      fullOutputPath: undefined,
    });
  });

  it("normalizes the exit code omitted by Pi after cancellation", () => {
    expect(parseBashResult({ output: "partial", cancelled: true, truncated: false })).toEqual({
      output: "partial",
      exitCode: null,
      cancelled: true,
      truncated: false,
      fullOutputPath: undefined,
    });
  });

  it("rejects an omitted exit code for a command that was not cancelled", () => {
    expect(() => parseBashResult({ output: "", cancelled: false, truncated: false })).toThrow("Pi 返回的 Bash 结果字段不完整");
  });

  it("rejects malformed protocol payloads", () => {
    expect(() => parseBashResult({ output: [], exitCode: 0, cancelled: false, truncated: false })).toThrow("Pi 返回的 Bash 结果字段不完整");
  });
});
