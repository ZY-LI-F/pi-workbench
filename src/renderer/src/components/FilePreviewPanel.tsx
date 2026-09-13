import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  ExternalLink,
  FileSearch,
  Files,
  MessageSquareQuote,
  FolderOpen,
  LoaderCircle,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LocalFilePreviewData, LocalFilePreviewKind } from "@shared/file-preview";
import type { LocalPathInspection } from "@shared/local-path";
import type { StellaDesktopApi } from "@shared/contracts";
import type { SessionFileReference } from "../lib/session-files";
import { normalizePptxRelationshipTargets } from "../lib/pptx-package";
import { SpreadsheetPreview } from "./SpreadsheetPreview";
import { fileReferenceText } from "../lib/file-reference";

type PreviewState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: LocalFilePreviewData }
  | { readonly status: "error"; readonly message: string };

const PREVIEW_LABELS: Readonly<Record<LocalFilePreviewKind, string>> = Object.freeze({
  image: "图片",
  html: "HTML",
  markdown: "Markdown",
  text: "文本",
  pdf: "PDF",
  docx: "Word",
  pptx: "PowerPoint",
  spreadsheet: "Excel",
});

const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "img-src data: blob:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function bytesAsArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function prettyText(data: LocalFilePreviewData): string {
  const source = decodeText(data.bytes);
  if (data.mimeType !== "application/json") return source;
  try {
    return JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    return source;
  }
}

function secureHtmlDocument(source: string, extraStyle = ""): string {
  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll('meta[http-equiv="Content-Security-Policy"], base').forEach((node) => node.remove());
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = HTML_PREVIEW_CSP;
  document.head.prepend(policy);
  const charset = document.createElement("meta");
  charset.setAttribute("charset", "UTF-8");
  document.head.prepend(charset);
  if (extraStyle) {
    const style = document.createElement("style");
    style.textContent = extraStyle;
    document.head.append(style);
  }
  return `<!doctype html>${document.documentElement.outerHTML}`;
}

function sanitizedSvg(source: string): string {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror")) throw new Error("SVG 文件不是有效的 XML");
  document.querySelectorAll("script, foreignObject, iframe, object, embed, audio, video").forEach((node) => node.remove());
  document.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLocaleLowerCase("en-US");
      const value = attribute.value.trim();
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      if ((name === "href" || name === "xlink:href") && !value.startsWith("#") && !value.startsWith("data:image/")) {
        node.removeAttribute(attribute.name);
      }
      if (name === "style" && /url\((?!["']?data:image\/)/i.test(value)) node.removeAttribute(attribute.name);
    }
  });
  return new XMLSerializer().serializeToString(document.documentElement);
}

function useObjectUrl(bytes: Uint8Array, mimeType: string, transform?: (source: string) => string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const blob = transform
      ? new Blob([transform(decodeText(bytes))], { type: mimeType })
      : new Blob([bytesAsArrayBuffer(bytes)], { type: mimeType });
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, mimeType, transform]);
  return url;
}

function LoadingPreview({ label }: { readonly label: string }) {
  return <div className="file-preview__loading" role="status"><LoaderCircle className="spin" /><strong>{label}</strong><small>文件保留在本机，正在构建只读视图…</small></div>;
}

function ImagePreview({ data }: { readonly data: LocalFilePreviewData }) {
  const transformer = data.mimeType === "image/svg+xml" ? sanitizedSvg : undefined;
  const url = useObjectUrl(data.bytes, data.mimeType, transformer);
  return url
    ? <div className="file-preview__image"><img src={url} alt={data.name} /></div>
    : <LoadingPreview label="正在载入图片" />;
}

function PdfPreview({ data }: { readonly data: LocalFilePreviewData }) {
  const url = useObjectUrl(data.bytes, data.mimeType);
  return url
    ? <iframe className="file-preview__pdf" title={`${data.name} PDF 预览`} src={url} />
    : <LoadingPreview label="正在载入 PDF" />;
}

function HtmlPreview({ data }: { readonly data: LocalFilePreviewData }) {
  const source = useMemo(() => secureHtmlDocument(decodeText(data.bytes), `
    html, body { min-height: 100%; }
    body { margin: 0; }
  `), [data]);
  return <iframe className="file-preview__html" title={`${data.name} HTML 预览`} sandbox="" srcDoc={source} />;
}

function MarkdownPreview({ api, data }: { readonly api: StellaDesktopApi; readonly data: LocalFilePreviewData }) {
  const source = useMemo(() => decodeText(data.bytes), [data]);
  return (
    <article className="file-preview__document-page markdown-body file-preview__markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const external = typeof href === "string" && /^https?:\/\//i.test(href);
            return <a href={external ? href : undefined} title={external ? href : "相对链接不会离开预览器"} onClick={(event) => {
              event.preventDefault();
              if (external && href) void api.openExternal(href);
            }}>{children}</a>;
          },
          img: ({ src, alt }) => {
            const safe = typeof src === "string" && src.startsWith("data:image/");
            return safe ? <img src={src} alt={alt ?? "Markdown 图片"} /> : <span className="file-preview__blocked-resource">图片资源已隔离：{alt || src}</span>;
          },
        }}
      >{source}</ReactMarkdown>
    </article>
  );
}

function TextPreview({ data }: { readonly data: LocalFilePreviewData }) {
  const source = useMemo(() => prettyText(data), [data]);
  return <pre className="file-preview__text">{source}</pre>;
}

function DocxPreview({ data }: { readonly data: LocalFilePreviewData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | { readonly error: string }>("loading");
  useEffect(() => {
    let active = true;
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    setState("loading");
    void import("docx-preview").then(({ renderAsync }) => renderAsync(
      bytesAsArrayBuffer(data.bytes),
      container,
      container,
      {
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        useBase64URL: true,
        renderAltChunks: false,
        renderComments: false,
        renderChanges: false,
        debug: false,
      },
    )).then(
      () => { if (active) setState("ready"); },
      (cause: unknown) => { if (active) setState({ error: errorMessage(cause) }); },
    );
    return () => {
      active = false;
      container.replaceChildren();
    };
  }, [data]);
  return (
    <div className="file-preview__docx">
      {state === "loading" && <LoadingPreview label="正在解析 Word 文档" />}
      {typeof state === "object" && <div className="file-preview__error" role="alert"><strong>Word 预览失败</strong><p>{state.error}</p></div>}
      <div className={state === "ready" ? "file-preview__docx-pages is-ready" : "file-preview__docx-pages"} ref={containerRef} />
    </div>
  );
}

function PptxPreview({ data }: { readonly data: LocalFilePreviewData }) {
  const [state, setState] = useState<
    | { readonly status: "loading" }
    | { readonly status: "ready"; readonly slides: readonly string[] }
    | { readonly status: "error"; readonly message: string }
  >({ status: "loading" });
  const [slideIndex, setSlideIndex] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    setSlideIndex(0);
    void normalizePptxRelationshipTargets(bytesAsArrayBuffer(data.bytes))
      .then(async (source) => {
        const { pptxToHtml } = await import("@jvmr/pptx-to-html");
        return pptxToHtml(source, { width: 960, height: 540, scaleToFit: true, letterbox: true });
      }).then(
      (slides) => { if (active) setState({ status: "ready", slides: Object.freeze([...slides]) }); },
      (cause: unknown) => { if (active) setState({ status: "error", message: errorMessage(cause) }); },
    );
    return () => { active = false; };
  }, [data]);
  if (state.status === "loading") return <LoadingPreview label="正在解析 PowerPoint 幻灯片" />;
  if (state.status === "error") return <div className="file-preview__error" role="alert"><strong>PowerPoint 预览失败</strong><p>{state.message}</p></div>;
  if (state.slides.length === 0) return <div className="file-preview__empty"><FileSearch size={30} /><strong>演示文稿中没有幻灯片</strong></div>;
  const slide = state.slides[slideIndex] ?? state.slides[0] ?? "";
  const document = secureHtmlDocument(slide, `
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #11131a; }
    body { display: grid; place-items: center; }
  `);
  return (
    <div className="file-preview__pptx">
      <div className="file-preview__pager">
        <button type="button" aria-label="上一张幻灯片" disabled={slideIndex === 0} onClick={() => setSlideIndex((value) => value - 1)}><ChevronLeft size={15} /></button>
        <label className="file-preview__slide-picker">
          <span className="sr-only">跳转幻灯片</span>
          <select aria-label="跳转幻灯片" value={slideIndex} onChange={(event) => setSlideIndex(Number(event.target.value))}>
            {state.slides.map((_, index) => <option value={index} key={index}>第 {index + 1} / {state.slides.length} 张</option>)}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
        <button type="button" aria-label="下一张幻灯片" disabled={slideIndex >= state.slides.length - 1} onClick={() => setSlideIndex((value) => value + 1)}><ChevronRight size={15} /></button>
      </div>
      <iframe className="file-preview__slide" title={`${data.name} 第 ${slideIndex + 1} 张`} sandbox="" srcDoc={document} />
    </div>
  );
}

function PreviewContent({ api, data }: { readonly api: StellaDesktopApi; readonly data: LocalFilePreviewData }) {
  if (data.kind === "image") return <ImagePreview data={data} />;
  if (data.kind === "html") return <HtmlPreview data={data} />;
  if (data.kind === "markdown") return <MarkdownPreview api={api} data={data} />;
  if (data.kind === "text") return <TextPreview data={data} />;
  if (data.kind === "pdf") return <PdfPreview data={data} />;
  if (data.kind === "docx") return <DocxPreview data={data} />;
  if (data.kind === "pptx") return <PptxPreview data={data} />;
  return <SpreadsheetPreview data={data} />;
}

type SessionFileState =
  | { readonly status: "loading"; readonly reference: SessionFileReference }
  | { readonly status: "ready"; readonly reference: SessionFileReference; readonly inspection: LocalPathInspection }
  | { readonly status: "error"; readonly reference: SessionFileReference; readonly message: string };

function pathIdentity(path: string): string {
  return /^[A-Za-z]:[\\/]/.test(path) ? path.toLocaleLowerCase("en-US") : path;
}

function formatReferenceTime(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function SessionFilePicker({
  api,
  references,
  activeInspection,
  onSelect,
}: {
  readonly api: StellaDesktopApi;
  readonly references: readonly SessionFileReference[];
  readonly activeInspection?: LocalPathInspection;
  readonly onSelect: (inspection: LocalPathInspection) => void;
}) {
  const effectiveReferences = useMemo(() => {
    if (!activeInspection) return references;
    const activeKey = pathIdentity(activeInspection.canonicalPath);
    if (references.some((reference) => pathIdentity(reference.path) === activeKey)) return references;
    return Object.freeze([
      ...references,
      Object.freeze({ path: activeInspection.canonicalPath, timestamp: 0 }),
    ]);
  }, [activeInspection, references]);
  const [items, setItems] = useState<readonly SessionFileState[]>(() => effectiveReferences.map(
    (reference) => Object.freeze({ status: "loading" as const, reference }),
  ));

  useEffect(() => {
    let active = true;
    setItems(effectiveReferences.map((reference) => Object.freeze({ status: "loading" as const, reference })));
    for (const reference of effectiveReferences) {
      void api.inspectLocalPath(reference.path).then(
        (inspection) => {
          if (!active) return;
          setItems((current) => current.map((item) => pathIdentity(item.reference.path) === pathIdentity(reference.path)
            ? Object.freeze({ status: "ready" as const, reference, inspection })
            : item));
        },
        (cause: unknown) => {
          if (!active) return;
          setItems((current) => current.map((item) => pathIdentity(item.reference.path) === pathIdentity(reference.path)
            ? Object.freeze({ status: "error" as const, reference, message: errorMessage(cause) })
            : item));
        },
      );
    }
    return () => { active = false; };
  }, [api, effectiveReferences]);

  const activePath = activeInspection ? pathIdentity(activeInspection.canonicalPath) : "";
  const selectable = items.some((item) => item.status === "ready" && item.inspection.kind === "file" && item.inspection.preview);

  return (
    <label className="file-preview-file-picker">
      <span className="file-preview-file-picker__label"><Files size={14} /><strong>会话文件</strong><small>{items.length} 项 · 最新在前</small></span>
      <span className="file-preview-file-picker__select">
        <select
          aria-label="切换会话文件"
          value={activePath}
          disabled={!selectable}
          title={activeInspection?.canonicalPath ?? "选择当前会话中的输出文件"}
          onChange={(event) => {
            const selected = items.find((item) => pathIdentity(item.reference.path) === event.target.value);
            if (selected?.status === "ready" && selected.inspection.kind === "file" && selected.inspection.preview) {
              onSelect(selected.inspection);
            }
          }}
        >
          {!activePath && <option value="">{items.length === 0 ? "会话中暂无输出文件" : "选择一个会话文件"}</option>}
        {items.map((item) => {
          const inspection = item.status === "ready" ? item.inspection : undefined;
          const canPreview = Boolean(inspection?.kind === "file" && inspection.preview);
          const kind = inspection?.kind === "directory"
            ? "文件夹"
            : inspection?.preview
              ? PREVIEW_LABELS[inspection.preview.kind]
              : item.status === "loading"
                ? "正在检查"
                : item.status === "error"
                  ? `文件不可用：${item.message}`
                  : "暂不支持预览";
          const time = item.reference.timestamp > 0 ? formatReferenceTime(item.reference.timestamp) : "本次打开";
          return (
            <option
              key={pathIdentity(item.reference.path)}
              value={pathIdentity(item.reference.path)}
              disabled={!canPreview}
              title={item.status === "error" ? `${item.reference.path}\n${item.message}` : item.reference.path}
            >
              {inspection?.name ?? fileNameFromPath(item.reference.path)} · {kind} · {time}
            </option>
          );
        })}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </span>
    </label>
  );
}

export function FilePreviewPanel({
  api,
  inspection,
  references,
  onSelect,
  onReference,
}: {
  readonly api: StellaDesktopApi;
  readonly inspection?: LocalPathInspection;
  readonly references: readonly SessionFileReference[];
  readonly onSelect: (inspection: LocalPathInspection) => void;
  readonly onReference?: (text: string) => void;
}) {
  const [state, setState] = useState<PreviewState>({ status: inspection ? "loading" : "idle" });
  const [reload, setReload] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [maximized, setMaximized] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [selectedText, setSelectedText] = useState("");
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceFeedback, setReferenceFeedback] = useState<string>();

  useEffect(() => {
    const captureSelection = () => {
      const selection = window.getSelection();
      const viewport = viewportRef.current;
      if (selection?.rangeCount && viewport?.contains(selection.anchorNode) && viewport.contains(selection.focusNode)) {
        setSelectedText(selection.toString());
      }
    };
    document.addEventListener("selectionchange", captureSelection);
    return () => document.removeEventListener("selectionchange", captureSelection);
  }, []);

  useEffect(() => {
    setSelectedText("");
    setReferenceFeedback(undefined);
    if (!inspection) {
      setState({ status: "idle" });
      setActionError(undefined);
      setZoom(100);
      setMaximized(false);
      setMoreOpen(false);
      return;
    }
    let active = true;
    setState({ status: "loading" });
    setActionError(undefined);
    setZoom(100);
    setMoreOpen(false);
    void api.readLocalFilePreview(inspection.canonicalPath).then(
      (data) => { if (active) setState({ status: "ready", data }); },
      (cause: unknown) => { if (active) setState({ status: "error", message: errorMessage(cause) }); },
    );
    return () => { active = false; };
  }, [api, inspection, reload]);

  useEffect(() => {
    if (!moreOpen) return;
    const dismissOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreMenuRef.current?.contains(event.target)) setMoreOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("pointerdown", dismissOnPointerDown);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismissOnPointerDown);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [moreOpen]);

  const data = state.status === "ready" ? state.data : undefined;
  const nativePdfZoom = data?.kind === "pdf";
  const statusNote = data?.kind === "html"
    ? "只读 · 脚本、表单与外部资源已隔离"
    : data?.kind === "docx" || data?.kind === "pptx" || data?.kind === "spreadsheet"
      ? "只读 · 不执行宏或嵌入式程序"
      : "只读 · 文件不会上传";

  const runAction = async (operation: () => Promise<void>) => {
    setActionError(undefined);
    try {
      await operation();
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  };

  const runMenuAction = (operation: () => Promise<void>) => {
    setMoreOpen(false);
    void runAction(operation);
  };

  const referenceFile = async () => {
    if (!data || !onReference) return;
    setReferenceBusy(true);
    try {
      const current = await api.readLocalFilePreview(data.canonicalPath);
      if (!data.version || current.version !== data.version) throw new Error("文件版本已变化，请刷新预览后重新选择并引用。当前草稿未改变。");
      onReference(fileReferenceText(data, selectedText));
      setReferenceFeedback(selectedText ? "选区引用已追加到输入草稿" : "文件引用已追加到输入草稿");
    } finally { setReferenceBusy(false); }
  };

  return (
    <section className={`file-preview-panel${maximized ? " is-maximized" : ""}`} aria-label="文件检查器">
      <div className="file-preview-panel__body">
        <section className={`file-preview__reader${inspection ? "" : " file-preview__reader--empty"}`} aria-label={inspection ? `预览 ${inspection.name}` : "文件预览空状态"}>
          <div className="file-preview__toolbar">
            <SessionFilePicker api={api} references={references} activeInspection={inspection} onSelect={onSelect} />
            {inspection && <div className="file-preview__identity">
              <span>{data ? PREVIEW_LABELS[data.kind] : inspection.preview ? PREVIEW_LABELS[inspection.preview.kind] : "文件"}</span>
              <strong title={inspection.canonicalPath}>{inspection.name}</strong>
              <code title={inspection.canonicalPath}>{inspection.canonicalPath}</code>
              <small>{data ? formatBytes(data.sizeBytes) : inspection.sizeBytes !== undefined ? formatBytes(inspection.sizeBytes) : "正在读取"} · {statusNote}</small>
              {data?.version && <small title={`SHA-256: ${data.version}`}>本机读取已验证 · 版本 {data.version.slice(0, 12)}</small>}
            </div>}
            {inspection && <div className="file-preview__controls">
              {!nativePdfZoom && <div className="file-preview__zoom" aria-label="预览缩放">
                <button type="button" aria-label="缩小预览" disabled={zoom <= 50} onClick={() => setZoom((value) => Math.max(50, value - 10))}><ZoomOut size={14} /></button>
                <button type="button" aria-label="重置预览缩放" onClick={() => setZoom(100)}>{zoom}%</button>
                <button type="button" aria-label="放大预览" disabled={zoom >= 200} onClick={() => setZoom((value) => Math.min(200, value + 10))}><ZoomIn size={14} /></button>
              </div>}
              <button type="button" aria-label="刷新预览" title="重新读取磁盘文件" onClick={() => setReload((value) => value + 1)}><RefreshCw size={14} /></button>
              {onReference && <button type="button" aria-label={selectedText ? "引用选区到对话" : "引用文件到对话"} title={selectedText ? `引用选区（${selectedText.length} 字符）` : "只追加路径和版本，不发送全文"} disabled={!data || referenceBusy} onClick={() => void runAction(referenceFile)}><MessageSquareQuote size={14} /><span>{selectedText ? "引用选区" : "引用"}</span></button>}
              <button type="button" aria-label={maximized ? "退出铺满窗口" : "铺满窗口"} title={maximized ? "退出铺满窗口" : "铺满窗口"} onClick={() => setMaximized((value) => !value)}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
              <div className="file-preview__more" ref={moreMenuRef}>
                <button type="button" className="file-preview__more-trigger" aria-label="更多文件操作" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><Ellipsis size={15} /><span>更多</span></button>
                {moreOpen && <div className="file-preview__more-menu" role="menu" aria-label="更多文件操作">
                  {inspection.directOpenAllowed && <button type="button" role="menuitem" onClick={() => runMenuAction(() => api.openPath(inspection.canonicalPath))}><ExternalLink size={14} /><span><strong>系统打开</strong><small>使用默认桌面应用</small></span></button>}
                  <button type="button" role="menuitem" onClick={() => runMenuAction(() => api.revealPath(inspection.canonicalPath))}><FolderOpen size={14} /><span><strong>所在位置</strong><small>在文件管理器中显示</small></span></button>
                  <button type="button" role="menuitem" onClick={() => runMenuAction(() => api.copyText(inspection.canonicalPath))}><Copy size={14} /><span><strong>复制路径</strong><small>复制完整本地地址</small></span></button>
                </div>}
              </div>
            </div>}
          </div>
          {actionError && <div className="file-preview__action-error" role="alert">操作失败：{actionError}</div>}
          {referenceFeedback && <div className="file-preview__reference-feedback" role="status">{referenceFeedback}</div>}
          <div className={`file-preview__stage file-preview__stage--${inspection ? data?.kind ?? "loading" : "idle"}`}>
            {!inspection && <div className="file-preview__empty" role="status"><FileSearch size={30} /><strong>选择一个会话文件</strong><p>从上方下拉框选择输出，或点击对话中的“预览”按钮。</p></div>}
            {inspection && state.status === "loading" && <LoadingPreview label="正在读取本地文件" />}
            {inspection && state.status === "error" && <div className="file-preview__error" role="alert"><strong>无法预览这个文件</strong><p>{state.message}</p><button type="button" className="button-secondary" onClick={() => setReload((value) => value + 1)}><RotateCcw size={14} />重新读取</button></div>}
            {inspection && data && <div ref={viewportRef} className="file-preview__viewport" style={{ "--file-preview-zoom": zoom / 100 } as CSSProperties}><PreviewContent api={api} data={data} /></div>}
          </div>
        </section>
      </div>
    </section>
  );
}
