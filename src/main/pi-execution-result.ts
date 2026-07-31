import type { PiResponse } from "../shared/contracts";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function responseData(response: PiResponse, command: string): Record<string, unknown> {
  if (!response.success) throw new Error(response.error);
  const data = "data" in response ? record(response.data) : undefined;
  if (!data) throw new Error(`Pi RPC 命令 ${command} 没有返回对象 data`);
  return data;
}

export interface FinalAssistantResult {
  readonly output: string;
  readonly messages: readonly unknown[];
}

export function coordinatorActionResult(messagesResponse: PiResponse): FinalAssistantResult {
  const messages = responseData(messagesResponse, "get_messages").messages;
  if (!Array.isArray(messages)) throw new Error("Pi RPC 命令 get_messages 没有返回 messages 数组");
  const toolResult = [...messages].reverse().map(record).find((message) =>
    message?.role === "toolResult" && message.toolName === "coordinator_action" && !message.isError,
  );
  const details = toolResult ? record(toolResult.details) : undefined;
  if (!details) {
    const lastAssistant = [...messages].reverse().map(record).find((message) => message?.role === "assistant");
    const errorMessage = typeof lastAssistant?.errorMessage === "string" ? lastAssistant.errorMessage.trim() : "";
    throw new Error(errorMessage || "LEAD 未调用必需的 coordinator_action 工具；自然语言或手写 JSON 不会被当作委派结果");
  }
  return Object.freeze({ output: JSON.stringify(details), messages: Object.freeze([...messages]) });
}

export function finalAssistantResult(textResponse: PiResponse, messagesResponse: PiResponse): FinalAssistantResult {
  const messages = responseData(messagesResponse, "get_messages").messages;
  if (!Array.isArray(messages)) throw new Error("Pi RPC 命令 get_messages 没有返回 messages 数组");
  const lastAssistant = [...messages].reverse().map(record).find((message) => message?.role === "assistant");
  const stopReason = lastAssistant?.stopReason;
  if (stopReason === "error" || stopReason === "aborted") {
    const errorMessage = lastAssistant?.errorMessage;
    throw new Error(typeof errorMessage === "string" && errorMessage.trim()
      ? errorMessage.trim()
      : `Agent 以 ${stopReason} 结束，且没有返回可用的错误说明`);
  }

  const text = responseData(textResponse, "get_last_assistant_text").text;
  const output = typeof text === "string" ? text.trim() : "";
  if (!output) {
    throw new Error(lastAssistant
      ? "Agent 已结束，但最后一条 assistant 消息没有文本产物"
      : "Agent 已结束，但会话中没有 assistant 消息或最终文本产物");
  }
  return Object.freeze({ output, messages: Object.freeze([...messages]) });
}
