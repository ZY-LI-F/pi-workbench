export type LocalFilePreviewKind =
  | "image"
  | "html"
  | "markdown"
  | "text"
  | "code"
  | "json"
  | "delimited"
  | "notebook"
  | "pdf"
  | "docx"
  | "pptx"
  | "spreadsheet";

export interface LocalFilePreviewDescriptor {
  readonly kind: LocalFilePreviewKind;
  readonly mimeType: string;
}

export interface LocalFilePreviewData extends LocalFilePreviewDescriptor {
  readonly canonicalPath: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly bytes: Uint8Array;
  /** SHA-256 of the exact bytes shown, not a timestamp guessed from chat messages. */
  readonly version?: string;
}

const PREVIEW_BY_EXTENSION: Readonly<Record<string, LocalFilePreviewDescriptor>> = Object.freeze({
  ".avif": Object.freeze({ kind: "image", mimeType: "image/avif" }),
  ".bmp": Object.freeze({ kind: "image", mimeType: "image/bmp" }),
  ".gif": Object.freeze({ kind: "image", mimeType: "image/gif" }),
  ".jpeg": Object.freeze({ kind: "image", mimeType: "image/jpeg" }),
  ".jpg": Object.freeze({ kind: "image", mimeType: "image/jpeg" }),
  ".png": Object.freeze({ kind: "image", mimeType: "image/png" }),
  ".svg": Object.freeze({ kind: "image", mimeType: "image/svg+xml" }),
  ".webp": Object.freeze({ kind: "image", mimeType: "image/webp" }),
  ".htm": Object.freeze({ kind: "html", mimeType: "text/html" }),
  ".html": Object.freeze({ kind: "html", mimeType: "text/html" }),
  ".markdown": Object.freeze({ kind: "markdown", mimeType: "text/markdown" }),
  ".md": Object.freeze({ kind: "markdown", mimeType: "text/markdown" }),
  ".csv": Object.freeze({ kind: "delimited", mimeType: "text/csv" }),
  ".json": Object.freeze({ kind: "json", mimeType: "application/json" }),
  ".ipynb": Object.freeze({ kind: "notebook", mimeType: "application/x-ipynb+json" }),
  ".log": Object.freeze({ kind: "text", mimeType: "text/plain" }),
  ".text": Object.freeze({ kind: "text", mimeType: "text/plain" }),
  ".tsv": Object.freeze({ kind: "delimited", mimeType: "text/tab-separated-values" }),
  ".txt": Object.freeze({ kind: "text", mimeType: "text/plain" }),
  ".xml": Object.freeze({ kind: "text", mimeType: "application/xml" }),
  ".yaml": Object.freeze({ kind: "text", mimeType: "application/yaml" }),
  ".yml": Object.freeze({ kind: "text", mimeType: "application/yaml" }),
  ".py": Object.freeze({ kind: "code", mimeType: "text/x-python" }),
  ".r": Object.freeze({ kind: "code", mimeType: "text/x-r" }),
  ".sh": Object.freeze({ kind: "code", mimeType: "text/x-shellscript" }),
  ".bash": Object.freeze({ kind: "code", mimeType: "text/x-shellscript" }),
  ".ps1": Object.freeze({ kind: "code", mimeType: "text/x-powershell" }),
  ".js": Object.freeze({ kind: "code", mimeType: "text/javascript" }),
  ".mjs": Object.freeze({ kind: "code", mimeType: "text/javascript" }),
  ".cjs": Object.freeze({ kind: "code", mimeType: "text/javascript" }),
  ".ts": Object.freeze({ kind: "code", mimeType: "text/typescript" }),
  ".tsx": Object.freeze({ kind: "code", mimeType: "text/typescript" }),
  ".jsx": Object.freeze({ kind: "code", mimeType: "text/javascript" }),
  ".pdf": Object.freeze({ kind: "pdf", mimeType: "application/pdf" }),
  ".docx": Object.freeze({
    kind: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
  ".pptx": Object.freeze({
    kind: "pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  }),
  ".xlsm": Object.freeze({
    kind: "spreadsheet",
    mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12",
  }),
  ".xlsx": Object.freeze({
    kind: "spreadsheet",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }),
});

function fileExtension(value: string): string {
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  const dot = value.lastIndexOf(".");
  return dot > slash ? value.slice(dot).toLocaleLowerCase("en-US") : "";
}

export function localFilePreviewDescriptor(path: string): LocalFilePreviewDescriptor | undefined {
  return PREVIEW_BY_EXTENSION[fileExtension(path)];
}
