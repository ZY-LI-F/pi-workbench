import type { RuntimeBootstrap, SerializableMessage } from "@shared/contracts";

export interface MessageProjection {
  readonly messages: readonly SerializableMessage[];
  readonly activeMessages: Readonly<Record<string, number>>;
  readonly nextMessageOrdinal: number;
}

function lane(message: SerializableMessage): string {
  return message.role === "toolResult" ? `toolResult:${message.toolCallId}`
    : message.role === "custom" ? `custom:${message.customType}` : message.role;
}

/** Pi serializes each message lifecycle; independent starts always create new occurrences. */
export function projectMessage(
  state: MessageProjection, type: "message_start" | "message_update" | "message_end", incoming: SerializableMessage, scope: string, sequence?: number,
): MessageProjection {
  const messageLane = lane(incoming);
  const activeIndex = type === "message_start" ? undefined : state.activeMessages[messageLane];
  const index = activeIndex ?? state.messages.length;
  const previous = state.messages[index];
  const key = previous?.stella?.key ?? `live:${scope}:${state.nextMessageOrdinal}`;
  const message = Object.freeze({ ...incoming, stella: Object.freeze({ key, entryId: previous?.stella?.entryId, liveScope: scope,
    startSequence: previous?.stella?.startSequence ?? sequence, endSequence: type === "message_end" ? sequence : undefined }) });
  const messages = [...state.messages];
  messages[index] = message;
  const activeMessages = { ...state.activeMessages };
  if (type === "message_end") delete activeMessages[messageLane];
  else activeMessages[messageLane] = index;
  return {
    messages: Object.freeze(messages), activeMessages: Object.freeze(activeMessages),
    nextMessageOrdinal: state.nextMessageOrdinal + (activeIndex === undefined ? 1 : 0),
  };
}

/** get_messages excludes streamingMessage. Merge only the live tail after its exact wire read barrier. */
export function reconcileSnapshotMessages(state: MessageProjection, bootstrap: RuntimeBootstrap): MessageProjection {
  const scope = bootstrap.scope;
  if (!scope || bootstrap.messageSequence === undefined) return resumeMessageProjection(bootstrap.messages, bootstrap.state.isStreaming);
  const liveScope = `${scope.generation}:${scope.scope}`;
  const tail = state.messages.filter((message) => message.stella?.liveScope === liveScope
    && (message.stella.endSequence === undefined || message.stella.endSequence > bootstrap.messageSequence!));
  const messages = Object.freeze([...bootstrap.messages, ...tail]);
  const activeMessages: Record<string, number> = {};
  for (let index = bootstrap.messages.length; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.stella?.endSequence === undefined) activeMessages[lane(message)] = index;
  }
  return { messages, activeMessages: Object.freeze(activeMessages), nextMessageOrdinal: Math.max(state.nextMessageOrdinal, messages.length) };
}

export function resumeMessageProjection(messages: readonly SerializableMessage[], streaming: boolean): MessageProjection {
  const last = messages.at(-1);
  // Only an unfinished assistant can be resumed; a finalized same-timestamp message is never reused.
  const activeMessages: Readonly<Record<string, number>> = streaming && last?.role === "assistant" && !last.stopReason
    ? { assistant: messages.length - 1 } : {};
  return { messages, activeMessages, nextMessageOrdinal: messages.length };
}
