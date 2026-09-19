import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { StellaDesktopApi } from "@shared/contracts";
import type { NotebookBundle } from "../lib/notebook-data";
import { notebookText } from "../lib/notebook-data";
import { previewError } from "../lib/artifact-preview";
import { ArtifactImage, embeddedImage } from "./ArtifactMedia";

interface Heading { readonly id: string; readonly text: string; readonly depth: number }
interface MarkdownNode { readonly type: string; readonly value?: string; readonly depth?: number; readonly children?: MarkdownNode[]; data?: { hProperties?: Record<string, unknown> } }
function nodeText(node: MarkdownNode): string { return node.value ?? node.children?.map(nodeText).join("") ?? ""; }
function headingsPlugin() {
  return (tree: MarkdownNode) => {
    const seen = new Map<string, number>();
    const visit = (node: MarkdownNode) => {
      if (node.type === "heading") {
        const base = nodeText(node).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s+/g, "-") || "section";
        const count = seen.get(base) ?? 0; seen.set(base, count + 1);
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: count ? `${base}-${count}` : base } };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function MarkdownImage({ api, fromPath, src, alt, attachments }: {
  readonly api: StellaDesktopApi; readonly fromPath: string; readonly src: string; readonly alt: string;
  readonly attachments?: Readonly<Record<string, NotebookBundle>>;
}) {
  const [image, setImage] = useState<{ bytes: Uint8Array; mimeType: string }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    setImage(undefined); setError(undefined);
    void (async () => {
      if (src.startsWith("data:")) return embeddedImage(src);
      if (src.startsWith("attachment:")) {
        const name = decodeURIComponent(src.slice("attachment:".length));
        const bundle = attachments && Object.hasOwn(attachments, name) ? attachments[name] : undefined;
        const mime = ["image/png", "image/jpeg", "image/svg+xml"].find((type) => bundle && Object.hasOwn(bundle, type));
        if (!mime || !bundle) throw new Error(`缺少可读取的 Notebook 附件：${name}`);
        const text = notebookText(bundle[mime], name);
        return mime === "image/svg+xml" ? { bytes: new TextEncoder().encode(text), mimeType: mime } : embeddedImage(`data:${mime};base64,${text}`);
      }
      if (/^(?:https?:|\/\/)/i.test(src)) throw new Error("外部图片不会自动加载；请将图片保存到已授权的本地目录");
      const target = await api.resolveArtifactLink({ fromPath, href: src });
      if (target.inspection.preview?.kind !== "image") throw new Error("链接不是可预览的图像文件");
      return api.readLocalFilePreview(target.inspection.canonicalPath);
    })().then((data) => { if (active) setImage(data); }, (cause: unknown) => { if (active) setError(previewError(cause)); });
    return () => { active = false; };
  }, [api, fromPath, src, attachments]);
  if (error) return <span role="alert" className="artifact-error">{alt || src}：{error}</span>;
  return image ? <ArtifactImage {...image} name={alt || src} /> : <span role="status">正在读取 {alt || "本地图片"}…</span>;
}

export interface AcademicMarkdownProps {
  readonly api: StellaDesktopApi; readonly source: string; readonly fromPath: string;
  readonly onNavigate: (href: string, root?: string) => Promise<void>;
  readonly fragment?: string; readonly attachments?: Readonly<Record<string, NotebookBundle>>;
  readonly onReady?: () => void; readonly compact?: boolean;
}
export default function AcademicMarkdown({ api, source, fromPath, onNavigate, fragment, attachments, onReady, compact }: AcademicMarkdownProps) {
  const root = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<readonly Heading[]>([]);
  const [error, setError] = useState<string>();
  const plugins = useMemo(() => [remarkGfm, remarkMath, headingsPlugin], []);
  useEffect(() => {
    setHeadings(Array.from(root.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? []).map((heading) => ({ id: heading.id, text: heading.textContent ?? "", depth: Number(heading.tagName.slice(1)) })));
    onReady?.();
  }, [source, onReady]);
  useEffect(() => {
    if (!fragment || !root.current) return;
    const element = Array.from(root.current.querySelectorAll<HTMLElement>("[id]")).find((candidate) => candidate.id === fragment || candidate.id === `user-content-${fragment}`);
    if (element) element.scrollIntoView?.({ block: "start" });
    else setError(`正文中没有锚点：${fragment}`);
  }, [fragment, source]);
  const navigate = async (href: string) => {
    setError(undefined);
    try {
      if (href.startsWith("#")) {
        const id = decodeURIComponent(href.slice(1));
        const target = Array.from(root.current?.querySelectorAll<HTMLElement>("[id]") ?? []).find((node) => node.id === id);
        if (!target) throw new Error(`正文中没有锚点：${id}`);
        target.scrollIntoView?.({ block: "start" }); return;
      }
      if (/^https?:\/\//i.test(href)) await api.openExternal(href);
      else await onNavigate(href);
    } catch (cause) { setError(previewError(cause)); }
  };
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  // Component identities must survive runtime metrics/width updates. Otherwise
  // React remounts every link/image and interrupts focus, scrolling and decoding.
  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => <a href={href && !/^(?:javascript|vbscript|data):/i.test(href) ? href : undefined} title={href} onClick={(event) => { event.preventDefault(); if (href) void navigateRef.current(href); }}>{children}</a>,
    img: ({ src, alt }) => typeof src === "string" ? <MarkdownImage api={api} fromPath={fromPath} src={src} alt={alt ?? ""} attachments={attachments} /> : null,
  }), [api, fromPath, attachments]);
  return <article ref={root} className={`file-preview__document-page markdown-body file-preview__markdown${compact ? " artifact-markdown--compact" : ""}`}>
    {!compact && headings.length > 0 && <details className="artifact-toc"><summary>章节目录 · {headings.length}</summary><nav aria-label="文档章节">{headings.map((heading) => <a key={heading.id} href={`#${heading.id}`} style={{ paddingInlineStart: `${(heading.depth - 1) * 12}px` }} onClick={(event) => { event.preventDefault(); void navigate(`#${heading.id}`); }}>{heading.text}</a>)}</nav></details>}
    {error && <p role="alert" className="artifact-error">{error}</p>}
    <ReactMarkdown remarkPlugins={plugins} rehypePlugins={[[rehypeKatex, { trust: false, strict: "warn" }]]}
      urlTransform={(url) => url}
      components={components}>{source}</ReactMarkdown>
  </article>;
}
