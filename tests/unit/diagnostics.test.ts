// @vitest-environment node
import { describe, expect, it } from "vitest";
import { appendDiagnosticText, DIAGNOSTIC_TRUNCATION_MARKER } from "../../src/shared/diagnostics";

describe("appendDiagnosticText", () => {
  it("retains complete small diagnostics and marks an intentional tail-only cache", () => {
    expect(appendDiagnosticText("first", " second", 64)).toBe("first second");
    const result = appendDiagnosticText("older-output".repeat(8), " newest-output", 48);
    expect(result).toHaveLength(48);
    expect(result.startsWith(DIAGNOSTIC_TRUNCATION_MARKER)).toBe(true);
    expect(result.endsWith("newest-output")).toBe(true);
  });
});
