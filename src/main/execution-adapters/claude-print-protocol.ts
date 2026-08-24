import type { ExecutionSessionReference } from "../../shared/execution-session";
import type { ExecutionEvent, ExecutionUsage } from "../execution-backend";

interface ClaudePrintProtocolSnapshot {
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

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function contentBlocks(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.flatMap((item): readonly Record<string, unknown>[] => {
    const found = record(item);
    return found ? [found] : [];
  }));
}

function usage(value: unknown, cost?: number): ExecutionUsage | undefined {
  const found = record(value);
  const inputTokens = numberValue(found?.input_tokens) ?? numberValue(found?.inputTokens);
  const outputTokens = numberValue(found?.output_tokens) ?? numberValue(found?.outputTokens);
  if (inputTokens === undefined && outputTokens === undefined && cost === undefined) return undefined;
  return Object.freeze({ inputTokens, outputTokens, cost });
}

function errorMessage(event: Record<string, unknown>): string | undefined {
  const errors = Array.isArray(event.errors) ? event.errors.flatMap((item) => stringValue(item) ?? stringValue(record(item)?.message) ?? []) : [];
  return stringValue(event.error)
    ?? stringValue(record(event.error)?.message)
    ?? errors[0]
    ?? stringValue(event.result);
}

function permissionDenialMessage(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const tools = value.flatMap((item) => {
    const denial = record(item);
    return stringValue(denial?.tool_name) ?? stringValue(denial?.toolName) ?? [];
  });
  return tools.length > 0
    ? `Claude CLI 未获授权执行工具：${[...new Set(tools)].join("、")}`
    : "Claude CLI 存在未获授权的工具调用";
}

function blockText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((item) => stringValue(item) ?? stringValue(record(item)?.text) ?? []).join("\n");
}

export class ClaudePrintProtocolReducer {
  #session?: ExecutionSessionReference;
  #output?: string;
  #usage?: ExecutionUsage;
  #assistantInputTokens = 0;
  #assistantOutputTokens = 0;
  #completed = false;
  #error?: string;
  #permissionError?: string;
  readonly #tools = new Map<string, string>();

  accept(value: unknown): readonly ExecutionEvent[] {
    const event = record(value);
    if (!event) throw new Error("Claude stream-json 事件必须是对象");
    const type = stringValue(event.type);
    if (!type) throw new Error("Claude stream-json 事件缺少 type");
    if (type === "system" && event.subtype === "init") return this.#acceptInit(event);
    if (type === "assistant") return this.#acceptAssistant(event);
    if (type === "user") return this.#acceptUser(event);
    if (type === "result") return this.#acceptResult(event);
    return Object.freeze([]);
  }

  snapshot(): ClaudePrintProtocolSnapshot {
    return Object.freeze({
      session: this.#session,
      output: this.#output,
      usage: this.#usage,
      completed: this.#completed,
      error: this.#error,
    });
  }

  #acceptInit(event: Record<string, unknown>): readonly ExecutionEvent[] {
    const sessionId = stringValue(event.session_id) ?? stringValue(event.sessionId);
    if (!sessionId) throw new Error("Claude system/init 缺少 session_id");
    this.#session = Object.freeze({ backendId: "claude", sessionId });
    return Object.freeze([{ type: "session", session: this.#session }]);
  }

  #acceptAssistant(event: Record<string, unknown>): readonly ExecutionEvent[] {
    const message = record(event.message);
    if (!message) throw new Error("Claude assistant 事件缺少 message");
    const events: ExecutionEvent[] = [];
    const texts: string[] = [];
    for (const block of contentBlocks(message.content)) {
      const blockType = stringValue(block.type);
      if (blockType === "text") {
        const text = stringValue(block.text);
        if (text) texts.push(text);
      } else if (blockType === "tool_use") {
        const id = stringValue(block.id);
        const name = stringValue(block.name);
        if (!id || !name) throw new Error("Claude tool_use 缺少 id 或 name");
        this.#tools.set(id, name);
        events.push({ type: "tool-start", name });
      }
    }
    if (texts.length > 0) this.#output = texts.join("\n");
    const messageUsage = usage(message.usage);
    this.#assistantInputTokens += messageUsage?.inputTokens ?? 0;
    this.#assistantOutputTokens += messageUsage?.outputTokens ?? 0;
    if (messageUsage) this.#usage = Object.freeze({
      inputTokens: this.#assistantInputTokens,
      outputTokens: this.#assistantOutputTokens,
      cost: this.#usage?.cost,
    });
    return Object.freeze(events);
  }

  #acceptUser(event: Record<string, unknown>): readonly ExecutionEvent[] {
    const message = record(event.message);
    if (!message) return Object.freeze([]);
    const events: ExecutionEvent[] = [];
    for (const block of contentBlocks(message.content)) {
      if (block.type !== "tool_result") continue;
      const toolUseId = stringValue(block.tool_use_id) ?? stringValue(block.toolUseId);
      if (!toolUseId) throw new Error("Claude tool_result 缺少 tool_use_id");
      const name = this.#tools.get(toolUseId) ?? "Claude tool";
      const failed = booleanValue(block.is_error) === true;
      events.push({ type: "tool-end", name, failed });
      const content = blockText(block.content);
      if (failed && /permission|not granted|not allowed|未授权|未获授权/iu.test(content)) {
        this.#permissionError = `Claude CLI 未获授权执行工具 ${name}：${content}`;
      }
      this.#tools.delete(toolUseId);
    }
    return Object.freeze(events);
  }

  #acceptResult(event: Record<string, unknown>): readonly ExecutionEvent[] {
    const sessionId = stringValue(event.session_id) ?? stringValue(event.sessionId);
    if (sessionId) this.#session = Object.freeze({ backendId: "claude", sessionId });
    this.#completed = true;
    const resultOutput = stringValue(event.result);
    if (resultOutput) this.#output = resultOutput;
    const cost = numberValue(event.total_cost_usd) ?? numberValue(event.totalCostUsd);
    const resultUsage = usage(event.usage, cost);
    if (resultUsage || this.#usage) this.#usage = Object.freeze({
      inputTokens: resultUsage?.inputTokens ?? this.#usage?.inputTokens,
      outputTokens: resultUsage?.outputTokens ?? this.#usage?.outputTokens,
      cost: resultUsage?.cost ?? this.#usage?.cost,
    });
    const permissionError = permissionDenialMessage(event.permission_denials ?? event.permissionDenials);
    const subtype = stringValue(event.subtype);
    const failed = booleanValue(event.is_error) === true || (subtype !== undefined && subtype !== "success");
    this.#error = permissionError ?? this.#permissionError ?? (failed ? errorMessage(event) ?? `Claude ${subtype ?? "result error"}` : undefined);
    if (this.#error || !this.#output) return Object.freeze([]);
    return Object.freeze([{ type: "assistant-output", text: this.#output }]);
  }
}
