const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/](?![\\/])/;
const POSIX_ABSOLUTE_PATH = /^\/(?!\/)/;
const TRAILING_SENTENCE_PUNCTUATION = /[。；，、;,]+$/u;

function stripMarkdownPrefix(value: string): string {
  return value
    .replace(/^\s*(?:[-+*]|\d+[.)]|>)\s+/, "")
    // Labels such as “参考文件” and “Report” are not part of an absolute path.
    .replace(/^\s*[^\r\n:：/\\]+[：:]\s*(?=(?:[A-Za-z]:[\\/]|\/(?!\/)))/u, "");
}

function stripWrappingPair(value: string): string {
  const pairs: Readonly<Record<string, string>> = Object.freeze({
    '"': '"',
    "'": "'",
    "<": ">",
    "（": "）",
    "(": ")",
  });
  const closing = pairs[value[0] ?? ""];
  return closing && value.endsWith(closing) ? value.slice(1, -1).trim() : value;
}

export function normalizeLocalPathCandidate(value: string): string | null {
  const normalized = stripWrappingPair(stripMarkdownPrefix(value.trim()))
    .replace(TRAILING_SENTENCE_PUNCTUATION, "")
    .trim();
  if (!normalized || normalized.includes("\n") || normalized.includes("\r")) return null;
  if (WINDOWS_ABSOLUTE_PATH.test(normalized)) {
    return /[<>"|?*]/.test(normalized.slice(3)) ? null : normalized;
  }
  if (POSIX_ABSOLUTE_PATH.test(normalized)) return normalized.includes("\0") ? null : normalized;
  return null;
}

function collectCandidate(target: string[], candidate: string): void {
  const path = normalizeLocalPathCandidate(candidate);
  if (path) target.push(path);
}

export function extractLocalPaths(markdown: string): readonly string[] {
  const candidates: string[] = [];

  for (const match of markdown.matchAll(/```[^\r\n]*\r?\n([\s\S]*?)```/g)) {
    for (const line of (match[1] ?? "").split(/\r?\n/)) collectCandidate(candidates, line);
  }
  for (const match of markdown.matchAll(/(^|[^`])`([^`\r\n]+)`(?!`)/gm)) {
    collectCandidate(candidates, match[2] ?? "");
  }
  for (const match of markdown.matchAll(/\]\(([^)\r\n]+)\)/g)) {
    collectCandidate(candidates, match[1] ?? "");
  }
  for (const match of markdown.matchAll(/["']([A-Za-z]:[\\/][^"'\r\n]+)["']/g)) {
    collectCandidate(candidates, match[1] ?? "");
  }
  for (const line of markdown.split(/\r?\n/)) collectCandidate(candidates, line);

  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    const key = WINDOWS_ABSOLUTE_PATH.test(candidate)
      ? candidate.toLocaleLowerCase("en-US")
      : candidate;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return Object.freeze([...unique.values()]);
}
