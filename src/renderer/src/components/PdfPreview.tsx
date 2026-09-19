import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import type { LocalFilePreviewData } from "@shared/file-preview";

type PdfLibrary = typeof import("pdfjs-dist");
type PdfState = { readonly document: PDFDocumentProxy; readonly library: PdfLibrary };

function PdfPage({ document, library, pageNumber, width, zoom, scrollRoot }: PdfState & {
  readonly pageNumber: number; readonly width: number; readonly zoom: "fit" | number; readonly scrollRoot: HTMLDivElement | null;
}) {
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textRoot = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy>();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string>();
  const [textStatus, setTextStatus] = useState<string>();
  const native = page?.getViewport({ scale: 1 });
  const scale = native ? zoom === "fit" ? Math.max(1, width - 32) / native.width : zoom / 100 : 1;
  const viewport = page?.getViewport({ scale });

  useEffect(() => {
    let active = true;
    void document.getPage(pageNumber).then((next) => { if (active) setPage(next); }, (cause: unknown) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [document, pageNumber]);
  useEffect(() => {
    if (!root.current || !scrollRoot) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { root: scrollRoot, rootMargin: "600px 0px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [scrollRoot]);
  useEffect(() => {
    if (!page || !visible || !canvas.current || !textRoot.current || width <= 0) return;
    let active = true;
    const viewport = page.getViewport({ scale });
    const element = canvas.current;
    const container = textRoot.current;
    const pixelRatio = window.devicePixelRatio || 1;
    element.width = Math.ceil(viewport.width * pixelRatio);
    element.height = Math.ceil(viewport.height * pixelRatio);
    let rendering: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setError(undefined);
    setTextStatus(undefined);
    void (async () => {
      rendering = page.render({ canvas: element, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      await rendering.promise;
      if (!active) return;
      const content = await page.getTextContent();
      if (!active) return;
      textLayer = new library.TextLayer({ textContentSource: content, container, viewport });
      await textLayer.render();
      if (active && !content.items.some((item) => "str" in item && item.str.trim())) setTextStatus("此页没有可提取文字（可能是扫描图像）；未运行 OCR。");
    })().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; rendering?.cancel(); textLayer?.cancel(); container.replaceChildren(); element.width = 0; element.height = 0; };
  }, [page, visible, scale, width, library]);

  return <section ref={root} className="file-preview__pdf-page" data-page={pageNumber} aria-label={`PDF 第 ${pageNumber} 页`}
    style={{ width: viewport?.width ?? Math.max(1, width - 32), minHeight: viewport?.height ?? 600, "--total-scale-factor": scale * (page?.userUnit ?? 1) } as CSSProperties}>
    <div className="file-preview__pdf-paper" style={{ width: viewport?.width, height: viewport?.height }}>
      <canvas ref={canvas} aria-hidden="true" style={{ width: viewport?.width, height: viewport?.height }} />
      <div className="textLayer" ref={textRoot} />
    </div>
    {(error || textStatus) && <p className="file-preview__pdf-page-status" role={error ? "alert" : "note"}>{error ? `第 ${pageNumber} 页预览 / 文字提取失败：${error}` : textStatus}</p>}
  </section>;
}

function PdfReader({ document, library, requestedPage }: PdfState & { readonly requestedPage?: number }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [linkError, setLinkError] = useState<string>();
  const appliedLinkPage = useRef<number | undefined>(undefined);
  useEffect(() => {
    setLinkError(undefined);
    if (!root || width <= 0 || requestedPage === undefined) return;
    if (appliedLinkPage.current === requestedPage) return;
    if (requestedPage > document.numPages) { setLinkError(`链接请求第 ${requestedPage} 页，但此 PDF 只有 ${document.numPages} 页。`); return; }
    const timer = requestAnimationFrame(() => {
      appliedLinkPage.current = requestedPage;
      setPageNumber(requestedPage);
      root.querySelector<HTMLElement>(`[data-page="${requestedPage}"]`)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(timer);
  }, [document, requestedPage, root, width]);
  useEffect(() => {
    if (!root) return;
    const update = () => setWidth(root.clientWidth);
    const observer = new ResizeObserver(update); observer.observe(root); update();
    return () => observer.disconnect();
  }, [root]);
  const go = (page: number) => {
    const next = Math.min(document.numPages, Math.max(1, page));
    setPageNumber(next);
    root?.querySelector<HTMLElement>(`[data-page="${next}"]`)?.scrollIntoView({ block: "start" });
  };
  const onScroll = () => {
    if (!root) return;
    const viewport = root.getBoundingClientRect();
    let mostVisible = 0;
    let next = pageNumber;
    for (const page of root.querySelectorAll<HTMLElement>("[data-page]")) {
      const bounds = page.getBoundingClientRect();
      const visible = Math.max(0, Math.min(bounds.bottom, viewport.bottom) - Math.max(bounds.top, viewport.top));
      // A narrow fit-to-width page can be shorter than the viewport. Keeping
      // the first partially visible page selected undoes explicit page jumps.
      if (visible > mostVisible) { mostVisible = visible; next = Number(page.dataset.page); }
    }
    if (mostVisible > 0) setPageNumber(next);
  };
  return <div className="file-preview__pdf-reader" role="region" aria-label="PDF 本地阅读器">
    <div className="file-preview__pager">
      <div className="file-preview__slide-navigation">
        <button type="button" aria-label="上一页 PDF" disabled={pageNumber <= 1} onClick={() => go(pageNumber - 1)}><ChevronLeft size={16} /></button>
        <select aria-label="跳转 PDF 页" value={pageNumber} onChange={(event) => go(Number(event.target.value))}>
          {Array.from({ length: document.numPages }, (_, index) => <option key={index} value={index + 1}>第 {index + 1} / {document.numPages} 页</option>)}
        </select>
        <button type="button" aria-label="下一页 PDF" disabled={pageNumber >= document.numPages} onClick={() => go(pageNumber + 1)}><ChevronRight size={16} /></button>
      </div>
      <select aria-label="PDF 缩放" value={zoom} onChange={(event) => setZoom(event.target.value === "fit" ? "fit" : Number(event.target.value))}>
        <option value="fit">适应宽度</option>{[50, 75, 100, 125, 150, 200].map((value) => <option key={value} value={value}>{value}%</option>)}
      </select>
    </div>
    <div className="file-preview__pdf-scroll" ref={setRoot} onScroll={onScroll} tabIndex={0} aria-label="PDF 页面滚动区域">
      {Array.from({ length: document.numPages }, (_, index) => <PdfPage key={index} document={document} library={library} pageNumber={index + 1} width={width} zoom={zoom} scrollRoot={root} />)}
    </div>
    <small className="file-preview__slide-note" role={linkError ? "alert" : undefined}>{linkError ?? "本地只读 · 文字可选择复制 · 不执行 PDF 脚本、不自动下载 OCR"}</small>
  </div>;
}

export function PdfPreview({ data, requestedPage }: { readonly data: LocalFilePreviewData; readonly requestedPage?: number }) {
  const [pdf, setPdf] = useState<PdfState>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    let task: ReturnType<PdfLibrary["getDocument"]> | undefined;
    setPdf(undefined); setError(undefined);
    void (async () => {
      const library = await import("pdfjs-dist");
      if (!active) return;
      library.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const assetDirectory = "../pdf-assets/";
      const assets = import.meta.env.DEV ? "/pdf-assets/" : new URL(assetDirectory, import.meta.url).href;
      task = library.getDocument({ data: new Uint8Array(data.bytes),
        cMapUrl: `${assets}cmaps/`, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/` });
      const document = await task.promise;
      if (active) setPdf({ document, library });
    })().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; void task?.destroy(); };
  }, [data]);
  if (error) return <div className="file-preview__error" role="alert"><strong>PDF 预览失败</strong><p>{error}</p><small>可刷新重试，或通过“更多”使用系统应用打开。</small></div>;
  return pdf ? <PdfReader {...pdf} requestedPage={requestedPage} /> : <div className="file-preview__loading" role="status"><LoaderCircle className="spin" /><strong>正在本地载入 PDF</strong></div>;
}
