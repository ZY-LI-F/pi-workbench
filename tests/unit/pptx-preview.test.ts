import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePptxRelationshipTargets, relativePackageTarget } from "../../src/renderer/src/lib/pptx-package";

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
