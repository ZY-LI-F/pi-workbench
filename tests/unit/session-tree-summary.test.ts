// @vitest-environment node
import { expect, it } from "vitest";
import { sessionTreeSummary } from "../../src/main/session-tree-summary";
import type { SessionEntrySummary } from "../../src/shared/contracts";

it("transports 10,000 entries without nested child objects or losing branches", () => {
  const entries: SessionEntrySummary[] = Array.from({ length: 10_000 }, (_, index) => ({ id: String(index), parentId: index ? String(index - 1) : null, type: "message", timestamp: new Date(index * 1000).toISOString() }));
  const tree = sessionTreeSummary(entries, []);
  expect(tree).toHaveLength(10_000);
  expect(tree[0]?.children).toEqual(["1"]);
  expect(tree.at(-1)?.children).toEqual([]);
  expect(JSON.parse(JSON.stringify(tree))).toHaveLength(10_000);
});
it("preserves sibling ordering, orphan roots and label changes", () => {
  const entries = [
    { id: "root", parentId: null, type: "message", timestamp: "2026-09-19T00:00:00Z" },
    { id: "new", parentId: "root", type: "message", timestamp: "2026-09-19T02:00:00Z" },
    { id: "old", parentId: "root", type: "message", timestamp: "2026-09-19T01:00:00Z" },
    { id: "orphan", parentId: "missing", type: "message", timestamp: "2026-09-19T00:00:00Z" },
  ];
  const tree = sessionTreeSummary(entries, [{ type: "label", targetId: "new", label: "旧标签" }, { type: "label", targetId: "new", label: "" }, { type: "label", targetId: "old", label: "已验收" }]);
  expect(tree[0]?.children).toEqual(["old", "new"]);
  expect(tree[1]?.label).toBeUndefined(); expect(tree[2]?.label).toBe("已验收");
  expect(tree[3]?.entry.parentId).toBe("missing");
});
