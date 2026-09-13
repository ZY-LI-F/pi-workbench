import type { SerializableMessage } from "@shared/contracts";
import type { ToolExecutionState } from "./runtime-state";

/** Only persisted results prove completion; a tool call alone proves neither start nor success. */
export function historicalTools(messages: readonly SerializableMessage[]): Readonly<Record<string, ToolExecutionState>> {
  const calls = new Map<string, { readonly args: Readonly<Record<string, unknown>>; readonly timestamp: number }>();
  const results: Record<string, ToolExecutionState> = {};
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "toolCall") calls.set(block.id, { args: block.arguments, timestamp: message.timestamp });
      }
    }
    if (message.role !== "toolResult") continue;
    const call = calls.get(message.toolCallId);
    results[message.toolCallId] = Object.freeze({
      id: message.toolCallId,
      name: message.toolName,
      args: call?.args ?? Object.freeze({}),
      status: message.isError ? "error" : "complete",
      result: message.content,
      startedAt: call?.timestamp ?? message.timestamp,
    });
  }
  return Object.freeze(results);
}
