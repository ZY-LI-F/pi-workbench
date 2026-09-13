import { describe, expect, it } from "vitest";
import { formatTokenMillions } from "@renderer/lib/token-format";

describe("session token units", () => {
  it.each([[0, "0M"], [1, "0.000001M"], [120, "0.00012M"], [131_072, "0.131M"], [1_000_000, "1M"], [1_234_567, "1.23M"], [12_345_678, "12.3M"]] as const)("formats %s without hiding small nonzero counts", (input, expected) => {
    expect(formatTokenMillions(input)).toBe(expected);
  });
  it("distinguishes unknown or invalid usage from zero", () => {
    for (const value of [undefined, null, Number.NaN, Infinity, -1]) expect(formatTokenMillions(value)).toBe("—");
  });
});
