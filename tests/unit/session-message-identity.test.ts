// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { identifySnapshotMessages } from "../../src/main/session-message-identity";
import type { SerializableMessage } from "../../src/shared/contracts";

const message: SerializableMessage = { role: "user", content: "same text at same time", timestamp: 12345 };
function entry(id: string, parentId: string | null): SessionEntry {
  return { id, parentId, type: "message", timestamp: "2026-09-12T00:00:00Z", message } as SessionEntry;
}
describe("official Pi message identities", () => {
  it("retains distinct IDs for same-time, same-content occurrences on the active branch", () => {
    const messages = identifySnapshotMessages([message, message], [entry("one", null), entry("two", "one"), entry("other-branch", "one")], "two", "session");
    expect(messages.map((item) => item.stella?.entryId)).toEqual(["one", "two"]);
    expect(new Set(messages.map((item) => item.stella?.key)).size).toBe(2);
  });
  it("changes the fork target with the official active branch, never a timestamp map", () => {
    const entries = [entry("one", null), entry("two", "one"), entry("other", "one")];
    expect(identifySnapshotMessages([message, message], entries, "other", "session")[1]?.stella?.entryId).toBe("other");
  });
  it("does not invent a durable entry ID for an unpersisted occurrence", () => {
    const items = identifySnapshotMessages([message, message], [entry("one", null)], "one", "session");
    expect(items[1]?.stella?.entryId).toBeUndefined();
    expect(items[0]?.stella?.key).not.toBe(items[1]?.stella?.key);
  });
});
