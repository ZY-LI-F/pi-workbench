import type { SerializableMessage } from "@shared/contracts";
import { extractLocalPaths } from "./local-paths";

export interface SessionFileReference {
  readonly path: string;
  readonly timestamp: number;
}

function pathIdentity(path: string): string {
  return /^[A-Za-z]:[\\/]/.test(path) ? path.toLocaleLowerCase("en-US") : path;
}

function assistantText(message: Extract<SerializableMessage, { role: "assistant" }>): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

/**
 * Returns the output paths mentioned by the current session's assistant messages.
 * A path mentioned repeatedly appears once at the time of its newest mention.
 */
export function sessionFileReferences(messages: readonly SerializableMessage[]): readonly SessionFileReference[] {
  const newestByPath = new Map<string, SessionFileReference>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const path of extractLocalPaths(assistantText(message))) {
      const key = pathIdentity(path);
      const previous = newestByPath.get(key);
      if (!previous || message.timestamp >= previous.timestamp) {
        newestByPath.set(key, Object.freeze({ path, timestamp: message.timestamp }));
      }
    }
  }

  return Object.freeze(
    [...newestByPath.values()].sort((left, right) => right.timestamp - left.timestamp),
  );
}
