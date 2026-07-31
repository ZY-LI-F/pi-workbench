// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PiResponse } from "../../src/shared/contracts";
import { coordinatorActionResult, finalAssistantResult } from "../../src/main/pi-execution-result";

function success(command: string, data: Record<string, unknown>): PiResponse {
  return { id: command, type: "response", command, success: true, data } as PiResponse;
}

describe("finalAssistantResult", () => {
  it("surfaces a missing final text as an explicit execution error instead of calling trim on undefined", () => {
    const text = success("get_last_assistant_text", {});
    const messages = success("get_messages", {
      messages: [{ role: "assistant", stopReason: "stop", content: [] }],
    });

    expect(() => finalAssistantResult(text, messages))
      .toThrow("最后一条 assistant 消息没有文本产物");
  });

  it("preserves the Runtime error when the last assistant turn failed", () => {
    const text = success("get_last_assistant_text", { text: undefined });
    const messages = success("get_messages", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "provider rejected request" }],
    });

    expect(() => finalAssistantResult(text, messages)).toThrow("provider rejected request");
  });
});

describe("coordinatorActionResult", () => {
  it("reads only a successful terminating coordinator_action tool result", () => {
    const details = { action: "complete", summary: "证据已验收", delegations: [] };
    const response = success("get_messages", {
      messages: [
        { role: "assistant", stopReason: "toolUse", content: [] },
        { role: "toolResult", toolName: "coordinator_action", isError: false, details },
      ],
    });

    expect(JSON.parse(coordinatorActionResult(response).output)).toEqual(details);
  });

  it("rejects prose, handwritten JSON, and failed tool results", () => {
    const prose = success("get_messages", { messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "{\"action\":\"complete\"}" }] }] });
    const failed = success("get_messages", { messages: [{ role: "toolResult", toolName: "coordinator_action", isError: true, details: { action: "complete" } }] });

    expect(() => coordinatorActionResult(prose)).toThrow("未调用必需的 coordinator_action 工具");
    expect(() => coordinatorActionResult(failed)).toThrow("未调用必需的 coordinator_action 工具");
  });
});
