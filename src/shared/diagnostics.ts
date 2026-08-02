export const DIAGNOSTIC_TEXT_LIMIT = 512 * 1024;
export const DIAGNOSTIC_TRUNCATION_MARKER = "[较早的诊断输出已从界面缓存中移除]\n";

export function appendDiagnosticText(
  current: string,
  incoming: string,
  limit = DIAGNOSTIC_TEXT_LIMIT,
): string {
  if (!Number.isSafeInteger(limit) || limit <= DIAGNOSTIC_TRUNCATION_MARKER.length) {
    throw new Error("诊断文本缓存上限必须是大于截断标记长度的正整数");
  }
  const combined = `${current}${incoming}`;
  if (combined.length <= limit) return combined;
  const available = limit - DIAGNOSTIC_TRUNCATION_MARKER.length;
  return `${DIAGNOSTIC_TRUNCATION_MARKER}${combined.slice(-available)}`;
}
