// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validatedPiCommand } from "../../src/main/pi-command-validation";

describe("validatedPiCommand", () => {
  it("rejects missing command fields before Pi can call string methods on undefined", () => {
    expect(() => validatedPiCommand({ type: "set_session_name" })).toThrow("会话名称");
    expect(() => validatedPiCommand({ type: "prompt" })).toThrow("prompt.message");
    expect(() => validatedPiCommand({ type: "set_model", provider: "openai" })).toThrow("modelId");
    expect(() => validatedPiCommand({ type: "set_auto_retry", enabled: "yes" })).toThrow("布尔值");
  });

  it("validates image payloads and preserves image-only prompts", () => {
    expect(validatedPiCommand({
      type: "prompt",
      message: "",
      images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
      streamingBehavior: "followUp",
    })).toEqual({
      type: "prompt",
      message: "",
      images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
      streamingBehavior: "followUp",
    });
    expect(() => validatedPiCommand({
      type: "prompt",
      message: "inspect",
      images: [{ type: "image", data: "aW1hZ2U=", mimeType: "text/plain" }],
    })).toThrow("图片 MIME");
  });

  it("returns a frozen, field-scoped command instead of forwarding renderer-owned extras", () => {
    const result = validatedPiCommand({
      type: "bash",
      command: "npm test",
      excludeFromContext: false,
      id: "renderer-controlled-id",
      unexpected: "not-forwarded",
    });

    expect(result).toEqual({ type: "bash", command: "npm test", excludeFromContext: false });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects unknown commands explicitly", () => {
    expect(() => validatedPiCommand({ type: "launch_everything" })).toThrow("不支持的 Pi RPC 命令");
    expect(() => validatedPiCommand(null)).toThrow("必须是对象");
  });
});
