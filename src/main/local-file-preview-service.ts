import type { LocalFilePreviewData } from "../shared/file-preview";
import type { LocalPathInspection } from "../shared/local-path";
import { createHash } from "node:crypto";

export interface LocalFilePreviewServiceDependencies {
  readonly inspectLocalPath: (path: unknown) => Promise<LocalPathInspection>;
  readonly readFile: (canonicalPath: string) => Promise<Uint8Array>;
}

export class LocalFilePreviewService {
  readonly #dependencies: LocalFilePreviewServiceDependencies;

  constructor(dependencies: LocalFilePreviewServiceDependencies) {
    this.#dependencies = dependencies;
  }

  async read(path: unknown): Promise<LocalFilePreviewData> {
    const inspection = await this.#dependencies.inspectLocalPath(path);
    if (inspection.kind !== "file") throw new Error("只有普通文件可以预览");
    if (!inspection.preview) throw new Error(`暂不支持预览该文件类型: ${inspection.name}`);

    const source = await this.#dependencies.readFile(inspection.canonicalPath);
    const bytes = new Uint8Array(source.byteLength);
    bytes.set(source);
    return Object.freeze({
      canonicalPath: inspection.canonicalPath,
      name: inspection.name,
      kind: inspection.preview.kind,
      mimeType: inspection.preview.mimeType,
      sizeBytes: bytes.byteLength,
      version: createHash("sha256").update(bytes).digest("hex"),
      bytes,
    });
  }
}
