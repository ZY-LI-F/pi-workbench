import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const releaseDirectory = join(process.cwd(), "release");
const manifestName = process.env.STELLA_CHECKSUM_MANIFEST?.trim() || "SHA256SUMS.txt";
if (!/^SHA256SUMS(?:-[a-z0-9-]+)?\.txt$/u.test(manifestName)) {
  throw new Error(`STELLA_CHECKSUM_MANIFEST 名称无效: ${manifestName}`);
}
const names = (await readdir(releaseDirectory))
  .filter((name) => /\.(?:exe|dmg|zip)$/u.test(name))
  .sort();
if (names.length === 0) throw new Error(`${releaseDirectory} 中没有 installer artifact`);
const lines = await Promise.all(names.map(async (name) => {
  const digest = createHash("sha256").update(await readFile(join(releaseDirectory, name))).digest("hex").toUpperCase();
  return `${digest}  ${name}`;
}));
await writeFile(join(releaseDirectory, manifestName), `${lines.join("\n")}\n`, "utf8");
