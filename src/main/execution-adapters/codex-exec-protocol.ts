import type { ExecutionEvent, ExecutionUsage } from "../execution-backend";
import type { ExecutionSessionReference } from "../../shared/execution-session";

interface CodexProtocolSnapshot {
  readonly session?: ExecutionSessionReference;
  readonly output?: string;
  readonly usage?: ExecutionUsage;
  readonly completed: boolean;
  readonly error?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function eventType(value: Record<string, unknown>): string | undefined {
  return stringValue(value.type);
}

function threadId(value: Record<string, unknown>): string | undefined {
  return stringValue(value.thread_id) ?? stringValue(value.threadId) ?? stringValue(record(value.thread)?.id);
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value === "string") return stringValue(value);
  const found = record(value);
  return stringValue(found?.message) ?? stringValue(found?.error) ?? stringValue(found?.detail);
}

function itemName(item: Record<string, unknown>): string {
  const type = stringValue(item.type) ?? "codex_tool";
  if (type === "command_execution") return stringValue(item.command)?.split(/\s+/u)[0] ?? "shell";
  if (type === "mcp_tool_call") {
    const server = stringValue(item.server);
    const tool = stringValue(item.tool) ?? stringValue(item.name);
    return [server, tool].filter(Boolean).join("/") || "mcp";
  }
  if (type === "web_search") return "web_search";
  if (type === "file_change") return "file_change";
  return type;
}

function isToolItem(item: Record<string, unknown>): boolean {
  return ["command_execution", "mcp_tool_call", "web_search", "file_change"].includes(String(item.type));
}

function usage(value: unknown): ExecutionUsage | undefined {
  const found = record(value);
  if (!found) return undefined;
  const inputTokens = numberValue(found.input_tokens) ?? numberValue(found.inputTokens);
  const outputTokens = numberValue(found.output_tokens) ?? numberValue(found.outputTokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return Object.freeze({ inputTokens, outputTokens });
}

export class CodexExecProtocolReducer {
  #session?: ExecutionSessionReference;
  #output?: string;
  #usage?: ExecutionUsage;
  #completed = false;
  #error?: string;

  accept(value: unknown): readonly ExecutionEvent[] {
    const event = record(value);
    if (!event) throw new Error("Codex JSONL 事件必须是对象");
    const type = eventType(event);
    if (!type) throw new Error("Codex JSONL 事件缺少 type");
    if (type === "thread.started") {
      const id = threadId(event);
      if (!id) throw new Error("Codex thread.started 缺少 thread_id");
      this.#session = Object.freeze({ backendId: "codex", sessionId: id });
      return Object.freeze([{ type: "session", session: this.#session }]);
    }
    if (type === "item.started" || type === "item.completed") {
      const item = record(event.item);
      if (!item) return Object.freeze([]);
      if (stringValue(item.type) === "agent_message" && type === "item.completed") {
        const text = stringValue(item.text) ?? stringValue(item.content);
        if (text) this.#output = text;
        return Object.freeze([]);
      }
      if (!isToolItem(item)) return Object.freeze([]);
      const name = itemName(item);
      if (type === "item.started") {
        return Object.freeze([{ type: "tool-start", name, detail: stringValue(item.command) }]);
      }
      const failed = item.status === "failed" || (numberValue(item.exit_code) ?? numberValue(item.exitCode) ?? 0) !== 0 || Boolean(item.error);
      return Object.freeze([{ type: "tool-end", name, failed }]);
    }
    if (type === "turn.completed") {
      this.#completed = true;
      this.#usage = usage(event.usage) ?? usage(record(event.turn)?.usage) ?? this.#usage;
      return this.#output ? Object.freeze([{ type: "assistant-output", text: this.#output }]) : Object.freeze([]);
    }
    if (type === "turn.failed" || type === "turn.cancelled" || type === "error") {
      this.#error = errorMessage(event.error) ?? errorMessage(event) ?? `Codex ${type}`;
    }
    return Object.freeze([]);
  }

  snapshot(): CodexProtocolSnapshot {
    return Object.freeze({
      session: this.#session,
      output: this.#output,
      usage: this.#usage,
      completed: this.#completed,
      error: this.#error,
    });
  }
}
