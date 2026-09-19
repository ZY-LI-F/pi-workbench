import type { LocalFilePreviewDescriptor } from "./file-preview";

export type LocalPathKind = "file" | "directory" | "other";

export interface LocalPathInspection {
  readonly canonicalPath: string;
  readonly name: string;
  readonly kind: LocalPathKind;
  readonly sizeBytes?: number;
  readonly modifiedAt?: number;
  readonly preview?: LocalFilePreviewDescriptor;
  readonly directOpenAllowed: boolean;
  readonly directOpenBlockedReason?: string;
}
