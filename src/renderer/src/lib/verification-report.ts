import { jsonRecord } from "./notebook-data";

const STATUS = {
  mechanical_failure: { label: "机械校验失败", tone: "error" },
  unreviewed: { label: "尚未完成复核", tone: "warning" },
  unresolved_discrepancies: { label: "存在未解决差异", tone: "error" },
  reviewed_with_limitations: { label: "已复核（存在限制）", tone: "warning" },
  reviewed: { label: "已完成复核", tone: "success" },
} as const;
export function reviewStatus(status: unknown) {
  return typeof status === "string" && Object.hasOwn(STATUS, status) ? STATUS[status as keyof typeof STATUS] : undefined;
}
export function verificationReport(value: unknown) {
  if (!jsonRecord(value) || !reviewStatus(value.status)) return undefined;
  return {
    status: reviewStatus(value.status)!,
    mechanical: value.mechanical_ok === true ? "通过" : value.mechanical_ok === false ? "失败" : "未记录",
    reviewed: value.all_sources_agent_reviewed === true || value.all_pages_agent_reviewed === true ? "报告标记为已复核" : "未声明全部复核",
    issues: Array.isArray(value.issues) ? value.issues : undefined,
    scope: typeof value.scope === "string" ? value.scope : undefined,
    limitations: value.limitations,
    documents: jsonRecord(value.documents) ? Object.entries(value.documents).map(([name, data]) => ({ name, data })) : [],
    artifacts: Array.isArray(value.artifact_checks) ? value.artifact_checks.filter(jsonRecord) : [],
  };
}

export interface JsonMatch { readonly path: string; readonly value: unknown }
export function searchJson(value: unknown, query: string): readonly JsonMatch[] {
  if (!query.trim()) return [];
  const term = query.toLowerCase(); const matches: JsonMatch[] = [];
  const pending = [{ path: "$", value }];
  while (pending.length) {
    const node = pending.pop()!;
    const compound = node.value !== null && typeof node.value === "object";
    if (node.path.toLowerCase().includes(term) || (!compound && String(node.value).toLowerCase().includes(term))) matches.push(node);
    if (compound) {
      const entries = Object.entries(node.value as object);
      for (let index = entries.length - 1; index >= 0; index--) {
        const [key, child] = entries[index]!;
        pending.push({ path: Array.isArray(node.value) ? `${node.path}[${key}]` : `${node.path}.${key}`, value: child });
      }
    }
  }
  return matches;
}
