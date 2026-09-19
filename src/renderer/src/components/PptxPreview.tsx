import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, FileSearch, LoaderCircle, Scan, ZoomIn, ZoomOut } from "lucide-react";
import type { LocalFilePreviewData } from "@shared/file-preview";
import { pptxSlideScale, renderPptxSlides, type PptxSlide, type PptxZoom, type PreviewSize } from "../lib/pptx-preview";

type PptxState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly slides: readonly PptxSlide[] }
  | { readonly status: "error"; readonly message: string };

function SlideReader({ name, slides }: { readonly name: string; readonly slides: readonly PptxSlide[] }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [zoom, setZoom] = useState<PptxZoom>("fit");
  const [viewport, setViewport] = useState<PreviewSize>({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const slide = slides[slideIndex]!;
  const scale = pptxSlideScale(slide, viewport, zoom);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () => setViewport((current) => current.width === canvas.clientWidth && current.height === canvas.clientHeight
      ? current : { width: canvas.clientWidth, height: canvas.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { canvasRef.current?.scrollTo({ top: 0, left: 0 }); }, [slideIndex, zoom]);

  const move = (index: number) => setSlideIndex(Math.max(0, Math.min(slides.length - 1, index)));
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || (event.target instanceof Element && event.target.closest("select, input, textarea, [contenteditable=true]"))) return;
    const destination = { ArrowLeft: slideIndex - 1, PageUp: slideIndex - 1, ArrowRight: slideIndex + 1,
      PageDown: slideIndex + 1, Home: 0, End: slides.length - 1 }[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    move(destination);
  };
  const changeZoom = (delta: number) => setZoom(Math.max(10, Math.min(200, Math.round(scale * 100) + delta)));

  return (
    <div className="file-preview__pptx" role="region" aria-label="PowerPoint 幻灯片预览" tabIndex={0} onKeyDown={navigate}>
      <div className="file-preview__pager">
        <div className="file-preview__slide-navigation" aria-label="幻灯片导航">
          <button type="button" aria-label="上一张幻灯片" title="上一张（← / Page Up）" disabled={slideIndex === 0} onClick={() => move(slideIndex - 1)}><ChevronLeft size={16} /></button>
          <label className="file-preview__slide-picker">
            <span className="sr-only">跳转幻灯片</span>
            <select aria-label="跳转幻灯片" value={slideIndex} onChange={(event) => move(Number(event.target.value))}>
              {slides.map((_, index) => <option value={index} key={index}>第 {index + 1} / {slides.length} 张</option>)}
            </select>
            <ChevronDown size={13} aria-hidden="true" />
          </label>
          <button type="button" aria-label="下一张幻灯片" title="下一张（→ / Page Down）" disabled={slideIndex >= slides.length - 1} onClick={() => move(slideIndex + 1)}><ChevronRight size={16} /></button>
        </div>
        <div className="file-preview__slide-controls">
          <div className="file-preview__zoom" aria-label="幻灯片缩放">
            <button type="button" aria-label="缩小幻灯片" disabled={scale <= 0.1} onClick={() => changeZoom(-10)}><ZoomOut size={14} /></button>
            <button type="button" aria-label="按原始尺寸预览" title="原始尺寸 100%" onClick={() => setZoom(100)}>{scale > 0 ? `${Math.round(scale * 100)}%` : "—"}</button>
            <button type="button" aria-label="放大幻灯片" disabled={scale >= 2} onClick={() => changeZoom(10)}><ZoomIn size={14} /></button>
          </div>
          <button type="button" aria-label="适应整页" aria-pressed={zoom === "fit"} title="按可用宽度和高度完整显示，保留原始比例" onClick={() => setZoom("fit")}><Scan size={14} /><span>适应</span></button>
        </div>
      </div>
      <div className="file-preview__slide-canvas" ref={canvasRef}>
        <div className="file-preview__slide-canvas-content">
          <div className="file-preview__slide-frame" style={{ width: slide.width * scale, height: slide.height * scale }}>
            <iframe className="file-preview__slide" title={`${name} 第 ${slideIndex + 1} 张`} sandbox=""
              style={{ width: slide.width, height: slide.height, transform: `scale(${scale})` }} srcDoc={slide.document} />
          </div>
        </div>
      </div>
      <small className="file-preview__slide-note">只读预览 · 不播放动画；复杂排版可能与 PowerPoint 不同</small>
    </div>
  );
}

export function PptxPreview({ data }: { readonly data: LocalFilePreviewData }) {
  const [state, setState] = useState<PptxState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    const bytes = new Uint8Array(data.bytes.byteLength);
    bytes.set(data.bytes);
    void renderPptxSlides(bytes.buffer).then(
      (slides) => { if (active) setState({ status: "ready", slides }); },
      (cause: unknown) => { if (active) setState({ status: "error", message: cause instanceof Error ? cause.message : String(cause) }); },
    );
    return () => { active = false; };
  }, [data]);

  if (state.status === "loading") return <div className="file-preview__loading" role="status"><LoaderCircle className="spin" /><strong>正在解析 PowerPoint 幻灯片</strong><small>文件保留在本机，正在构建只读视图…</small></div>;
  if (state.status === "error") return <div className="file-preview__error" role="alert"><strong>PowerPoint 预览失败</strong><p>{state.message}</p><small>可刷新重试，或通过“更多”使用系统应用打开。</small></div>;
  if (state.slides.length === 0) return <div className="file-preview__empty"><FileSearch size={30} /><strong>演示文稿中没有幻灯片</strong></div>;
  return <SlideReader name={data.name} slides={state.slides} />;
}
