import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const releaseDirectory = join(process.cwd(), "release");
const manifestName = process.env.STELLA_CHECKSUM_MANIFEST?.trim() || "SHA256SUMS.txt";
if (!/^SHA256SUMS(?:-[a-z0-9-]+)?\.txt$/u.test(manifestName)) {
  throw new Error(`STELLA_CHECKSUM_MANIFEST 名称无效: ${manifestName}`);
}
const extensions = (process.env.STELLA_CHECKSUM_EXTENSIONS?.trim() || "exe,dmg,zip")
  .split(",")
  .map((extension) => extension.trim().toLocaleLowerCase("en-US"))
  .filter(Boolean);
if (extensions.length === 0 || extensions.some((extension) => !/^[a-z0-9]+$/u.test(extension))) {
  throw new Error("STELLA_CHECKSUM_EXTENSIONS 无效");
}
const allowedExtensions = new Set(extensions);
const names = (await readdir(releaseDirectory))
  .filter((name) => allowedExtensions.has(name.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? ""))
  .sort();
if (names.length === 0) throw new Error(`${releaseDirectory} 中没有 installer artifact`);
const lines = await Promise.all(names.map(async (name) => {
  const digest = createHash("sha256").update(await readFile(join(releaseDirectory, name))).digest("hex").toUpperCase();
  return `${digest}  ${name}`;
}));
await writeFile(join(releaseDirectory, manifestName), `${lines.join("\n")}\n`, "utf8");
