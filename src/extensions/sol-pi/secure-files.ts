import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** No recursive mkdir through an unchecked junction. Parent aliases must be resolved at the trusted session anchor. */
async function directoryIdentity(path: string, create: boolean): Promise<string> {
  const absolute = resolve(path);
  if (absolute !== parse(absolute).root) await directoryIdentity(dirname(absolute), create);
  if (create && absolute !== parse(absolute).root) {
    try { await mkdir(absolute, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || !info.isDirectory() || !samePath(await realpath(absolute), absolute)) {
    throw new Error(`Sol 归档目录不是可信普通目录：${absolute}`);
  }
  return `${info.dev}:${info.ino}`;
}

/** Validate the opened handle, not just the filename. O_NOFOLLOW alone does not exist on Windows. */
export async function openArchive(path: string, mode: "read" | "create" | "append"): Promise<FileHandle> {
  const parent = dirname(resolve(path));
  const parentIdentity = await directoryIdentity(parent, mode !== "read");
  const before = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" && mode !== "read") return undefined;
    throw error;
  });
  if (before && (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)) throw new Error(`Sol 归档拒绝链接或特殊文件：${path}`);
  const flags = mode === "read" ? constants.O_RDONLY : mode === "create"
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
    : constants.O_WRONLY | constants.O_APPEND | (before ? 0 : constants.O_CREAT | constants.O_EXCL);
  const handle = await open(path, flags | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const actual = await handle.stat();
    const after = await lstat(path);
    if (!actual.isFile() || actual.nlink !== 1 || after.isSymbolicLink()
      || actual.dev !== after.dev || actual.ino !== after.ino
      || (before && (before.dev !== actual.dev || before.ino !== actual.ino))
      || await directoryIdentity(parent, false) !== parentIdentity) throw new Error(`Sol 归档在打开时被替换：${path}`);
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

export async function storeImmutable(path: string, text: string): Promise<void> {
  let handle: FileHandle;
  try { handle = await openArchive(path, "create"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await openArchive(path, "read");
    try { if (await existing.readFile("utf8") !== text) throw new Error(`Sol 归档完整性校验失败：${path}`); }
    finally { await existing.close(); }
    return;
  }
  try { await handle.writeFile(text, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}

export async function appendArchive(path: string, text: string): Promise<void> {
  const handle = await openArchive(path, "append");
  try { await handle.writeFile(text, "utf8"); }
  finally { await handle.close(); }
}
