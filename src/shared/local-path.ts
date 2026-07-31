export type LocalPathKind = "file" | "directory" | "other";

export interface LocalPathInspection {
  readonly canonicalPath: string;
  readonly name: string;
  readonly kind: LocalPathKind;
  readonly directOpenAllowed: boolean;
  readonly directOpenBlockedReason?: string;
}
