import type { SessionEntrySummary, SessionTreeSummary } from "../shared/contracts";

/** Pi's getTree ordering/labels, with no recursive object graph across the bridge. */
export function sessionTreeSummary(entries: readonly SessionEntrySummary[], rawEntries: readonly Record<string, unknown>[]): readonly SessionTreeSummary[] {
  const labels = new Map<string, string>();
  for (const entry of rawEntries) {
    if (entry.type !== "label" || typeof entry.targetId !== "string") continue;
    if (typeof entry.label === "string" && entry.label) labels.set(entry.targetId, entry.label);
    else labels.delete(entry.targetId);
  }
  const nodes = new Map<string, { entry: SessionEntrySummary; children: string[]; label?: string }>();
  for (const entry of entries) {
    if (nodes.has(entry.id)) throw new Error(`Pi 会话包含重复节点：${entry.id}`);
    nodes.set(entry.id, { entry, children: [], label: labels.get(entry.id) });
  }
  for (const entry of entries) {
    if (entry.parentId !== null && entry.parentId !== entry.id) nodes.get(entry.parentId)?.children.push(entry.id);
  }
  for (const node of nodes.values()) {
    node.children.sort((a, b) => Date.parse(nodes.get(a)!.entry.timestamp) - Date.parse(nodes.get(b)!.entry.timestamp));
    Object.freeze(node.children);
    Object.freeze(node);
  }
  return Object.freeze([...nodes.values()]);
}
