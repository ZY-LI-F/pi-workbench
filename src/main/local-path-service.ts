import { basename, extname, isAbsolute, resolve } from "node:path";
import { localFilePreviewDescriptor } from "../shared/file-preview";
import type { LocalPathInspection, LocalPathKind } from "../shared/local-path";

interface PathMetadata {
  isFile(): boolean;
  isDirectory(): boolean;
  readonly size?: number;
}

export interface LocalPathServiceDependencies {
  readonly allowedRoots: () => readonly string[];
  readonly canonicalizeWithinRoots: (
    candidatePath: string,
    rootPaths: readonly string[],
  ) => Promise<string | null>;
  readonly inspectPath: (canonicalPath: string) => Promise<PathMetadata>;
  readonly openWithSystem: (canonicalPath: string) => Promise<string>;
  readonly revealWithSystem: (canonicalPath: string) => void;
}

const DIRECT_OPEN_FILE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".csv",
  ".doc",
  ".docx",
  ".gif",
  ".heic",
  ".jpeg",
  ".jpg",
  ".json",
  ".log",
  ".m4a",
  ".markdown",
  ".md",
  ".mov",
  ".mp3",
  ".mp4",
  ".ods",
  ".odp",
  ".odt",
  ".ogg",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".rtf",
  ".text",
  ".tsv",
  ".txt",
  ".wav",
  ".webp",
  ".xls",
  ".xlsx",
  ".xml",
  ".yaml",
  ".yml",
]);

function requiredAbsolutePath(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("本地路径必须是非空字符串");
  }
  const normalized = value.trim();
  if (/^[\\/]{2}/.test(normalized)) {
    throw new Error(`不允许访问网络（UNC）路径: ${normalized}`);
  }
  if (!isAbsolute(normalized)) {
    throw new Error(`只允许打开绝对本地路径: ${normalized}`);
  }
  return resolve(normalized);
}

function pathKind(metadata: PathMetadata): LocalPathKind {
  if (metadata.isFile()) return "file";
  if (metadata.isDirectory()) return "directory";
  return "other";
}

function directOpenBlockReason(canonicalPath: string, kind: LocalPathKind): string | undefined {
  if (kind === "other") return "该路径不是普通文件或文件夹，只能在系统文件管理器中定位";
  if (kind === "directory") return undefined;
  if (DIRECT_OPEN_FILE_EXTENSIONS.has(extname(canonicalPath).toLocaleLowerCase("en-US"))) return undefined;
  return "该文件类型不在可直接打开的安全清单中；请先打开所在位置后手动检查";
}

export class LocalPathService {
  readonly #dependencies: LocalPathServiceDependencies;

  constructor(dependencies: LocalPathServiceDependencies) {
    this.#dependencies = dependencies;
  }

  async inspect(value: unknown): Promise<LocalPathInspection> {
    const requestedPath = requiredAbsolutePath(value);
    const canonicalPath = await this.#dependencies.canonicalizeWithinRoots(
      requestedPath,
      this.#dependencies.allowedRoots(),
    );
    if (!canonicalPath) {
      throw new Error(`只允许访问当前项目、Pi 数据或应用数据目录内的路径: ${requestedPath}`);
    }
    const metadata = await this.#dependencies.inspectPath(canonicalPath);
    const kind = pathKind(metadata);
    const directOpenBlockedReason = directOpenBlockReason(canonicalPath, kind);
    const preview = kind === "file" ? localFilePreviewDescriptor(canonicalPath) : undefined;
    const sizeBytes = kind === "file" && typeof metadata.size === "number" && Number.isFinite(metadata.size)
      ? metadata.size
      : undefined;
    return Object.freeze({
      canonicalPath,
      name: basename(canonicalPath),
      kind,
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      ...(preview ? { preview } : {}),
      directOpenAllowed: directOpenBlockedReason === undefined,
      ...(directOpenBlockedReason ? { directOpenBlockedReason } : {}),
    });
  }

  async open(value: unknown): Promise<void> {
    const inspection = await this.inspect(value);
    if (!inspection.directOpenAllowed) {
      throw new Error(inspection.directOpenBlockedReason ?? "该路径不允许直接打开");
    }
    const error = await this.#dependencies.openWithSystem(inspection.canonicalPath);
    if (error) throw new Error(error);
  }

  async reveal(value: unknown): Promise<void> {
    const inspection = await this.inspect(value);
    if (inspection.kind === "directory" && inspection.directOpenAllowed) {
      const error = await this.#dependencies.openWithSystem(inspection.canonicalPath);
      if (error) throw new Error(error);
      return;
    }
    this.#dependencies.revealWithSystem(inspection.canonicalPath);
  }
}
