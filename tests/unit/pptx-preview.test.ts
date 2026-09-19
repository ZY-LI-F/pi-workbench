import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePptxRelationshipTargets, relativePackageTarget } from "../../src/renderer/src/lib/pptx-package";
import { pptxSlideScale, preparePptxSlide, renderPptxSlides } from "../../src/renderer/src/lib/pptx-preview";

function asArrayBuffer(source: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

describe("PPTX relationship normalization", () => {
  it("turns package-root targets into paths relative to their owner part", () => {
    expect(relativePackageTarget("ppt", "/ppt/slides/slide1.xml")).toBe("slides/slide1.xml");
    expect(relativePackageTarget("ppt/slides", "/ppt/media/image1.png")).toBe("../media/image1.png");
    expect(relativePackageTarget("ppt/slideLayouts", "/ppt/slideMasters/slideMaster1.xml")).toBe("../slideMasters/slideMaster1.xml");
  });

  it("renders the project's real ten-slide deck after normalization", async () => {
    const source = await readFile(join(process.cwd(), "docs", "PI-GUI_产品能力与交互说明.pptx"));
    const normalized = await normalizePptxRelationshipTargets(asArrayBuffer(source));
    const { pptxToHtml } = await import("@jvmr/pptx-to-html");
    const slides = await pptxToHtml(normalized, { width: 960, height: 540, scaleToFit: true, letterbox: true });

    expect(slides).toHaveLength(10);
    expect(slides.join("\n")).toContain("PI-GUI");
  }, 30_000);
});

describe("native PPTX page geometry", () => {
  it.each([[1280, 720], [960, 720], [720, 1280]])("preserves native %s × %s slide proportions", (width, height) => {
    const slide = preparePptxSlide(`<div class="slide" style="width:${width}px;height:${height}px">content</div>`);
    expect(slide).toMatchObject({ width, height });
    expect(slide.document).toContain("default-src 'none'");
    expect(slide.document).toContain("content");
  });
  it.each(["", '<div class="slide" style="width:100%;height:720px"></div>', '<div class="slide" style="width:0px;height:720px"></div>'])("exposes unreadable geometry rather than inventing a page size", (html) => {
    expect(() => preparePptxSlide(html)).toThrow("无法读取");
  });
  it("fits both dimensions without enlarging or shrinking navigation controls", () => {
    const slide = { width: 1280, height: 720 };
    expect(pptxSlideScale(slide, { width: 408, height: 800 }, "fit")).toBe(0.3);
    expect(pptxSlideScale(slide, { width: 1304, height: 384 }, "fit")).toBe(0.5);
    expect(pptxSlideScale(slide, { width: 0, height: 0 }, "fit")).toBe(0);
    expect(pptxSlideScale(slide, { width: 400, height: 800 }, 100)).toBe(1);
  });
  it("keeps a negative-z-index slide background above the native white canvas", () => {
    const slide = preparePptxSlide('<div class="slide" style="position:relative;width:1280px;height:720px;background:#fff"><div style="position:absolute;z-index:-1;inset:0;background:#142b35"></div><p style="color:#fff">Visible title</p></div>');
    expect(slide.document).toContain(".slide { isolation: isolate; }");
    expect(slide.document).toContain("background:#142b35");
  });
  it("uses the real deck's native size and secures its generated HTML", async () => {
    const source = await readFile(join(process.cwd(), "docs", "PI-GUI_产品能力与交互说明.pptx"));
    const slides = await renderPptxSlides(asArrayBuffer(source));
    expect(slides).toHaveLength(10);
    expect(slides[0]!.width / slides[0]!.height).toBeCloseTo(16 / 9, 2);
    expect(slides[0]!.document).toContain("PI-GUI");
    expect(slides[0]!.document).toContain("form-action 'none'");
  }, 30_000);
});
