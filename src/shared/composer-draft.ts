export interface ComposerDraftImage {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
  readonly name: string;
}

export interface ComposerDraftSnapshot {
  readonly key: string;
  readonly text: string;
  readonly images: readonly ComposerDraftImage[];
  readonly updatedAt: number;
  readonly recoveredFromPreviousSession?: boolean;
}

export interface SaveComposerDraftInput {
  readonly key: string;
  readonly text: string;
  readonly images: readonly ComposerDraftImage[];
}
