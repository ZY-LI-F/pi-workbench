import type { LocalPathInspection } from "@shared/local-path";

export function previewError(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
export function previewText(bytes: Uint8Array, encoding = "auto"): string {
  const selected = encoding === "auto" ? bytes[0] === 255 && bytes[1] === 254 ? "utf-16le"
    : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8" : encoding;
  try { return new TextDecoder(selected, { fatal: true }).decode(bytes); }
  catch { throw new Error(`无法按 ${selected} 解码文件；请确认编码${encoding === "auto" ? "或选择其他编码" : ""}。`); }
}
export function previewParent(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index === 0) return trimmed.slice(0, 1);
  if (index === 2 && /^[a-z]:/i.test(trimmed)) return trimmed.slice(0, 3);
  return index < 0 ? path : trimmed.slice(0, index);
}
export type ArtifactCategory = "正文与说明" | "补充材料" | "图像" | "表格" | "PDF 文档" | "验证与数据" | "Notebook" | "源码" | "其他";
export function artifactCategory(file: Pick<LocalPathInspection, "name" | "preview">): ArtifactCategory {
  if (/supplement|supp[_-]|补充/i.test(file.name)) return "补充材料";
  switch (file.preview?.kind) {
    case "markdown": case "docx": case "pptx": case "html": return "正文与说明";
    case "image": return "图像";
    case "delimited": case "spreadsheet": return "表格";
    case "pdf": return "PDF 文档";
    case "json": case "text": return "验证与数据";
    case "notebook": return "Notebook";
    case "code": return "源码";
    default: return "其他";
  }
}
export function pdfFragmentPage(fragment: string): number | undefined {
  const match = /^page=([1-9]\d*)$/.exec(fragment);
  const value = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(value) ? value : undefined;
}
