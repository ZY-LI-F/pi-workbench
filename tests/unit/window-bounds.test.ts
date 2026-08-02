// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mainWindowBounds } from "../../src/main/window-bounds";

describe("mainWindowBounds", () => {
  it("uses the designed window size when the work area is large enough", () => {
    expect(mainWindowBounds({ width: 1920, height: 1080 })).toEqual({
      width: 1480,
      height: 940,
      minWidth: 980,
      minHeight: 680,
    });
  });

  it("keeps the initial window inside a scaled 1080p work area", () => {
    expect(mainWindowBounds({ width: 1536, height: 864 })).toEqual({
      width: 1480,
      height: 840,
      minWidth: 980,
      minHeight: 680,
    });
  });

  it("reduces minimum bounds when the display itself is smaller", () => {
    expect(mainWindowBounds({ width: 900, height: 650 })).toEqual({
      width: 876,
      height: 626,
      minWidth: 876,
      minHeight: 626,
    });
  });

  it("rejects invalid display geometry", () => {
    expect(() => mainWindowBounds({ width: 0, height: 900 })).toThrow("工作区宽度");
    expect(() => mainWindowBounds({ width: 1400, height: Number.NaN })).toThrow("工作区高度");
  });
});
