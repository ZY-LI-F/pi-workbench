/** Display/grouping identity for absolute project paths. Filesystem admission still uses Main realpath checks. */
export function projectPathKey(path: string): string {
  const forward = path.replaceAll("\\", "/");
  const windows = /^[A-Za-z]:\//u.test(forward) || forward.startsWith("//");
  const prefix = forward.startsWith("//") ? "//" : forward.startsWith("/") ? "/" : "";
  const rootSegments = prefix === "//" ? 2 : windows ? 1 : 0;
  const parts: string[] = [];
  for (const part of forward.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length > rootSegments) parts.pop();
    else if (part !== "..") parts.push(part);
  }
  const normalized = prefix + parts.join("/");
  return windows ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function sameProjectPath(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && projectPathKey(left) === projectPathKey(right));
}

export function projectDirectoryName(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/u, "").split("/").at(-1) || path;
}
