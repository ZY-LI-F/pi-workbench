import type { LocalPathInspection } from "./local-path";

export interface ArtifactDirectoryEntry {
  readonly path: string;
  readonly name: string;
  readonly inspection?: LocalPathInspection;
  readonly error?: string;
}
export interface ArtifactDirectory {
  readonly directory: LocalPathInspection;
  readonly entries: readonly ArtifactDirectoryEntry[];
}
export interface ArtifactLinkRequest {
  readonly fromPath: string;
  readonly href: string;
  /** Explicitly associated reading-package root, for a report's artifact_checks. */
  readonly artifactRoot?: string;
}
export interface ArtifactLink {
  readonly inspection: LocalPathInspection;
  readonly fragment: string;
}
