// @vitest-environment node
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("global font-size preference", () => {
  it("keeps component typography in rem so every page follows the root preference", async () => {
    const directory = join(process.cwd(), "src", "renderer", "src", "styles");
    const names = (await readdir(directory)).filter((name) => name.endsWith(".css"));
    const sources = await Promise.all(names.map(async (name) => ({ name, source: await readFile(join(directory, name), "utf8") })));
    const fixed = sources.flatMap(({ name, source }) => [...source.matchAll(/font-size\s*:\s*[0-9.]+px/g)].map((match) => `${name}:${match[0]}`));
    const unreadablySmall = sources.flatMap(({ name, source }) => [...source.matchAll(/font-size\s*:\s*([0-9.]+)rem/g)]
      .filter((match) => Number(match[1]) < 0.75)
      .map((match) => `${name}:${match[0]}`));
    const remCount = sources.reduce((count, { source }) => count + [...source.matchAll(/font-size\s*:\s*[0-9.]+rem/g)].length, 0);

    expect(fixed).toEqual([
      "tokens.css:font-size: 16px",
      "tokens.css:font-size: 14px",
      "tokens.css:font-size: 19px",
    ]);
    expect(unreadablySmall).toEqual([]);
    expect(remCount).toBeGreaterThan(400);
  });
});
