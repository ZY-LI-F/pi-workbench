// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NativeDiagnostics, validateDiagnosticLayout } from "../../src/main/native-diagnostics";
import type { NativeSubmissionReceipt } from "../../src/shared/native-submission";

describe("native structural diagnostics", () => {
  it("never captures raw prompts, images, stderr, unknown event types or receipt errors", () => {
    const service = new NativeDiagnostics(() => "2026-09-12T00:00:00Z");
    const scope = { generation: "generation", scope: 0, sequence: 1, cwd: "C:/project", sessionId: "session" };
    service.event({ type: "message_update", text: "PRIVATE-PROMPT", image: "PRIVATE-IMAGE", apiKey: "PRIVATE-KEY" }, scope);
    service.event({ type: "runtime_stderr", message: "PRIVATE-STDERR" }, { ...scope, sequence: 2 });
    service.event({ type: "PRIVATE-IN-TYPE" }, { ...scope, sequence: 3 });
    service.request({ id: "request-id", command: "prompt", stage: "accepted" }, scope);
    const layout = validateDiagnosticLayout({ width: 1280, height: 800, inspectorWidth: 420, inspectorOpen: true, sidebarOpen: false, fontSize: "default", apiKey: "PRIVATE-LAYOUT" });
    const receipt = { id: "request-id", sessionId: "session", generation: "generation", command: "prompt", status: "rejected", error: "PRIVATE-ERROR" } as NativeSubmissionReceipt;
    const snapshot = service.snapshot("0.6.0", "0.84.2", scope, layout, [receipt]);
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE-");
    expect(snapshot.runs[0]?.counts).toMatchObject({ message_update: 1, runtime_stderr: 1, unknown_event: 1 });
    expect(snapshot.requests[0]?.id).toBe(snapshot.submissions[0]?.id);
  });
  it("rejects invalid layouts without serializing arbitrary input", () => {
    expect(() => validateDiagnosticLayout({ width: NaN })).toThrow("无效");
    expect(() => validateDiagnosticLayout(null)).toThrow("无效");
  });
});
