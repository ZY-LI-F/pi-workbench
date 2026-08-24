// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CodexExecProtocolReducer } from "../../src/main/execution-adapters/codex-exec-protocol";

describe("CodexExecProtocolReducer", () => {
  it("reduces thread, tool, final message, terminal state, and usage", () => {
    const reducer = new CodexExecProtocolReducer();
    expect(reducer.accept({ type: "thread.started", thread_id: "thread-1" })).toEqual([
      { type: "session", session: { backendId: "codex", sessionId: "thread-1" } },
    ]);
    expect(reducer.accept({ type: "item.started", item: { type: "command_execution", command: "npm test" } })).toEqual([
      { type: "tool-start", name: "npm", detail: "npm test" },
    ]);
    expect(reducer.accept({ type: "item.completed", item: { type: "command_execution", command: "npm test", exit_code: 1 } })).toEqual([
      { type: "tool-end", name: "npm", failed: true },
    ]);
    reducer.accept({ type: "item.completed", item: { type: "agent_message", text: "最终报告" } });
    expect(reducer.accept({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 20 } })).toEqual([
      { type: "assistant-output", text: "最终报告" },
    ]);
    expect(reducer.snapshot()).toEqual({
      session: { backendId: "codex", sessionId: "thread-1" },
      output: "最终报告",
      usage: { inputTokens: 10, outputTokens: 20 },
      completed: true,
      error: undefined,
    });
  });

  it("preserves explicit turn failure and ignores unknown forward-compatible events", () => {
    const reducer = new CodexExecProtocolReducer();
    expect(reducer.accept({ type: "future.event", extra: true })).toEqual([]);
    reducer.accept({ type: "turn.failed", error: { message: "上下文超限" } });
    expect(reducer.snapshot()).toMatchObject({ completed: false, error: "上下文超限" });
  });

  it("rejects malformed known identity events", () => {
    const reducer = new CodexExecProtocolReducer();
    expect(() => reducer.accept({ type: "thread.started" })).toThrow("缺少 thread_id");
    expect(() => reducer.accept("bad")).toThrow("必须是对象");
  });
});
