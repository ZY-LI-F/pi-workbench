import { describe, expect, it } from "vitest";
import { activeBranchCompactions } from "@renderer/lib/session-branch";

const entries = [
  { id: "root", parentId: null, type: "compaction", timestamp: "2026-09-12" },
  { id: "left", parentId: "root", type: "message", timestamp: "2026-09-12" },
  { id: "right", parentId: "root", type: "compaction", timestamp: "2026-09-12" },
];

describe("active branch compaction evidence", () => {
  it("counts only the selected lineage, including an explicitly empty branch", () => {
    expect(activeBranchCompactions({ entries, leafId: null })).toEqual({ count: 0 });
    expect(activeBranchCompactions({ entries, leafId: "left" })).toEqual({ count: 1 });
    expect(activeBranchCompactions({ entries, leafId: "right" })).toEqual({ count: 2 });
  });
  it("does not disguise missing entries or cycles as a valid count", () => {
    expect(activeBranchCompactions({ entries, leafId: "missing" }).error).toContain("不完整");
    expect(activeBranchCompactions({ entries: [{ ...entries[0]!, parentId: "missing" }], leafId: "root" }).error).toContain("不完整");
    expect(activeBranchCompactions({ entries: [{ ...entries[0]!, parentId: "root" }], leafId: "root" }).error).toContain("循环");
  });
});
