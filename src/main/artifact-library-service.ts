import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { ArtifactDirectory, ArtifactDirectoryEntry, ArtifactLink } from "../shared/artifact-library";
import type { LocalPathInspection } from "../shared/local-path";

export interface ArtifactLibraryDependencies {
  readonly inspect: (path: unknown) => Promise<LocalPathInspection>;
  readonly readDirectory: (path: string) => Promise<readonly string[]>;
  readonly chooseDirectory: () => Promise<string | undefined>;
  readonly realpath: (path: string) => Promise<string>;
  readonly isDirectory: (path: string) => Promise<boolean>;
  readonly grantReadDirectory: (path: string) => void;
}

function localPath(value: unknown): string {
  if (typeof value !== "string" || !value || value.includes("\0") || /^[\\/]{2}/.test(value)) throw new Error("只读产物必须使用本机路径，不允许网络路径或空路径");
  return value;
}

export class ArtifactLibraryService {
  constructor(readonly dependencies: ArtifactLibraryDependencies) {}

  async choose(): Promise<LocalPathInspection | null> {
    const selected = await this.dependencies.chooseDirectory();
    if (selected === undefined) return null;
    if (!isAbsolute(localPath(selected))) throw new Error("产物目录必须是绝对路径");
    const canonical = localPath(await this.dependencies.realpath(selected));
    if (!await this.dependencies.isDirectory(canonical)) throw new Error("选择的路径不是文件夹");
    this.dependencies.grantReadDirectory(canonical);
    return this.dependencies.inspect(canonical);
  }

  async list(value: unknown): Promise<ArtifactDirectory> {
    const directory = await this.dependencies.inspect(value);
    if (directory.kind !== "directory") throw new Error("产物浏览器需要一个文件夹");
    const names = await this.dependencies.readDirectory(directory.canonicalPath);
    const entries: ArtifactDirectoryEntry[] = [];
    // One level only. No speculative recursive crawl into environments or models.
    for (const name of names) {
      const path = join(directory.canonicalPath, name);
      try {
        entries.push(Object.freeze({ path, name, inspection: await this.dependencies.inspect(path) }));
      } catch (cause) {
        entries.push(Object.freeze({ path, name, error: cause instanceof Error ? cause.message : String(cause) }));
      }
    }
    entries.sort((a, b) => Number(b.inspection?.kind === "directory") - Number(a.inspection?.kind === "directory")
      || (b.inspection?.modifiedAt ?? 0) - (a.inspection?.modifiedAt ?? 0) || a.name.localeCompare(b.name));
    return Object.freeze({ directory, entries: Object.freeze(entries) });
  }

  async resolveLink(value: unknown): Promise<ArtifactLink> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("文件链接参数无效");
    const request = value as Record<string, unknown>;
    const source = await this.dependencies.inspect(request.fromPath);
    if (source.kind !== "file") throw new Error("链接来源必须是已授权的普通文件");
    if (typeof request.href !== "string" || !request.href.trim()) throw new Error("文件链接为空");
    const [encodedPath, ...fragments] = request.href.split("#");
    let path: string;
    let fragment: string;
    try { path = decodeURIComponent(encodedPath!); fragment = decodeURIComponent(fragments.join("#")); }
    catch { throw new Error("文件链接包含无效的 URL 编码"); }
    if (path && (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))) throw new Error("此链接协议不可用于本地预览");
    if (path) localPath(path);
    let base = dirname(source.canonicalPath);
    if (request.artifactRoot !== undefined) {
      const root = await this.dependencies.inspect(request.artifactRoot);
      if (root.kind !== "directory") throw new Error("关联产物根路径不是文件夹");
      base = root.canonicalPath;
    }
    const candidate = path ? resolve(base, path) : source.canonicalPath;
    const inspection = await this.dependencies.inspect(candidate);
    if (inspection.kind !== "file" || !inspection.preview) throw new Error(`无法在检查器内预览：${basename(candidate)}`);
    return Object.freeze({ inspection, fragment });
  }
}
