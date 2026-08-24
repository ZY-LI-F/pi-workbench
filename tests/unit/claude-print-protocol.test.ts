// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ClaudePrintProtocolReducer } from "../../src/main/execution-adapters/claude-print-protocol";

describe("ClaudePrintProtocolReducer", () => {
  it("reduces init, assistant tool use, tool result, final result, usage, and cost", () => {
    const reducer = new ClaudePrintProtocolReducer();
    expect(reducer.accept({ type: "system", subtype: "init", session_id: "session-1" })).toEqual([
      { type: "session", session: { backendId: "claude", sessionId: "session-1" } },
    ]);
    expect(reducer.accept({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "toolu-1", name: "Bash", input: { command: "npm test" } }],
        usage: { input_tokens: 10, output_tokens: 4 },
      },
    })).toEqual([{ type: "tool-start", name: "Bash" }]);
    expect(reducer.accept({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu-1", is_error: false, content: "ok" }] },
    })).toEqual([{ type: "tool-end", name: "Bash", failed: false }]);
    reducer.accept({
      type: "assistant",
      message: { content: [{ type: "text", text: "最终报告" }], usage: { input_tokens: 2, output_tokens: 8 } },
    });
    expect(reducer.accept({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "最终报告",
      session_id: "session-1",
      usage: { input_tokens: 12, output_tokens: 12 },
      total_cost_usd: 0.04,
      permission_denials: [],
    })).toEqual([{ type: "assistant-output", text: "最终报告" }]);
    expect(reducer.snapshot()).toEqual({
      session: { backendId: "claude", sessionId: "session-1" },
      output: "最终报告",
      usage: { inputTokens: 12, outputTokens: 12, cost: 0.04 },
      completed: true,
      error: undefined,
    });
  });

  it("turns permission denials and error results into explicit terminal failures", () => {
    const denied = new ClaudePrintProtocolReducer();
    denied.accept({ type: "system", subtype: "init", session_id: "denied" });
    denied.accept({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu-write", name: "Write" }] } });
    denied.accept({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu-write", is_error: true, content: "Permission not granted" }] } });
    denied.accept({ type: "result", subtype: "success", is_error: false, result: "无法写入", permission_denials: [{ tool_name: "Write" }] });
    expect(denied.snapshot()).toMatchObject({ completed: true, error: "Claude CLI 未获授权执行工具：Write" });

    const failed = new ClaudePrintProtocolReducer();
    failed.accept({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["API 暂时不可用"], session_id: "failed" });
    expect(failed.snapshot()).toMatchObject({ completed: true, error: "API 暂时不可用" });
  });

  it("ignores forward-compatible events and rejects malformed known events", () => {
    const reducer = new ClaudePrintProtocolReducer();
    expect(reducer.accept({ type: "rate_limit_event", status: "allowed" })).toEqual([]);
    expect(() => reducer.accept({ type: "system", subtype: "init" })).toThrow("缺少 session_id");
    expect(() => reducer.accept({ type: "assistant" })).toThrow("缺少 message");
    expect(() => reducer.accept("bad")).toThrow("必须是对象");
  });
});
