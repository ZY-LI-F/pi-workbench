import { secureHtmlDocument } from "./html-preview";
import { normalizePptxRelationshipTargets } from "./pptx-package";

export interface PreviewSize {
  readonly width: number;
  readonly height: number;
}

export interface PptxSlide extends PreviewSize {
  readonly document: string;
}

export type PptxZoom = "fit" | number;
export const PPTX_CANVAS_PADDING = 12;

/** Keep the parser's native page size, including 4:3 and portrait presentations. */
export function preparePptxSlide(html: string): PptxSlide {
  const document = new DOMParser().parseFromString(html, "text/html");
  const slide = document.querySelector<HTMLElement>(".slide");
  const width = Number(slide?.style.width.replace(/px$/, ""));
  const height = Number(slide?.style.height.replace(/px$/, ""));
  if (!slide?.style.width.endsWith("px") || !slide.style.height.endsWith("px")
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("无法读取 PowerPoint 幻灯片尺寸，不能正确预览此文件。");
  }
  return Object.freeze({
    width,
    height,
    // The converter paints slide backgrounds at z-index:-1. Native-size output
    // has no transform, so it needs its own stacking context to keep them visible.
    document: secureHtmlDocument(html, "html, body { margin: 0; padding: 0; overflow: hidden; background: #fff; } .slide { isolation: isolate; }"),
  });
}

export async function renderPptxSlides(source: ArrayBuffer): Promise<readonly PptxSlide[]> {
  const normalized = await normalizePptxRelationshipTargets(source);
  const { pptxToHtml } = await import("@jvmr/pptx-to-html");
  // Parse once at native resolution. Pane resizing only changes the display scale.
  const slides = await pptxToHtml(normalized);
  return Object.freeze(slides.map(preparePptxSlide));
}

export function pptxSlideScale(slide: PreviewSize, viewport: PreviewSize, zoom: PptxZoom): number {
  if (zoom !== "fit") return zoom / 100;
  const width = Math.max(0, viewport.width - PPTX_CANVAS_PADDING * 2);
  const height = Math.max(0, viewport.height - PPTX_CANVAS_PADDING * 2);
  return Math.min(width / slide.width, height / slide.height);
}
