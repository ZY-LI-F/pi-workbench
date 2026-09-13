import { buildContextEntries, sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { SerializableMessage } from "../shared/contracts";

/** Match occurrences in the official active context, never deduplicate by content or timestamp. */
export function identifySnapshotMessages(
  messages: readonly SerializableMessage[], entries: readonly SessionEntry[], leafId: string | null, sessionId: string,
): readonly SerializableMessage[] {
  const occurrences = new Map<string, { readonly ids: string[]; cursor: number }>();
  for (const entry of buildContextEntries([...entries], leafId)) {
    for (const message of sessionEntryToContextMessages(entry)) {
      const serialized = JSON.stringify(message);
      const bucket = occurrences.get(serialized) ?? { ids: [], cursor: 0 };
      bucket.ids.push(entry.id);
      occurrences.set(serialized, bucket);
    }
  }
  return Object.freeze(messages.map((message, index) => {
    const bucket = occurrences.get(JSON.stringify(message));
    const entryId = bucket?.ids[bucket.cursor++];
    // get_messages may include an in-flight message not yet appended on message_end.
    const key = entryId ? `entry:${sessionId}:${entryId}` : `snapshot:${sessionId}:${index}`;
    return Object.freeze({ ...message, stella: Object.freeze({ key, entryId }) });
  }));
}
