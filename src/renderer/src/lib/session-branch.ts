import type { RuntimeBootstrap } from "@shared/contracts";

export type BranchCompactionCount =
  | { readonly count: number; readonly error?: never }
  | { readonly count?: never; readonly error: string };

/** A null leaf is Pi's empty branch, not a request to count every historical branch. */
export function activeBranchCompactions(bootstrap: Pick<RuntimeBootstrap, "leafId" | "entries">): BranchCompactionCount {
  if (bootstrap.leafId === null) return { count: 0 };
  const byId = new Map(bootstrap.entries.map((entry) => [entry.id, entry]));
  const visited = new Set<string>();
  let current: string | null = bootstrap.leafId;
  let count = 0;
  while (current !== null) {
    if (visited.has(current)) return { error: "当前分支记录存在循环，无法统计压缩次数" };
    const entry = byId.get(current);
    if (!entry) return { error: "当前分支记录不完整，无法统计压缩次数" };
    visited.add(current);
    if (entry.type === "compaction") count += 1;
    current = entry.parentId;
  }
  return { count };
}
