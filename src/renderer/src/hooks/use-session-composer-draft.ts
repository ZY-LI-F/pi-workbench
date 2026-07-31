import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { RuntimeBootstrap } from "@shared/contracts";

export interface ComposerImage {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
  readonly name: string;
}

interface SessionComposerDraft {
  readonly text: string;
  readonly images: readonly ComposerImage[];
}

interface SessionComposerDraftController extends SessionComposerDraft {
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly setImages: Dispatch<SetStateAction<readonly ComposerImage[]>>;
  readonly clear: () => void;
}

const EMPTY_DRAFT: SessionComposerDraft = Object.freeze({ text: "", images: Object.freeze([]) });

export function sessionComposerDraftKey(bootstrap: RuntimeBootstrap | undefined): string | undefined {
  if (!bootstrap) return undefined;
  return `${bootstrap.project.cwd}\u0000${bootstrap.state.sessionId}`;
}

export function useSessionComposerDraft(bootstrap: RuntimeBootstrap | undefined): SessionComposerDraftController {
  const [drafts, setDrafts] = useState<Readonly<Record<string, SessionComposerDraft>>>(Object.freeze({}));
  const key = sessionComposerDraftKey(bootstrap);
  const draft = useMemo(() => key ? drafts[key] ?? EMPTY_DRAFT : EMPTY_DRAFT, [drafts, key]);

  const setText = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    if (!key) return;
    setDrafts((current) => {
      const existing = current[key] ?? EMPTY_DRAFT;
      const text = typeof next === "function" ? next(existing.text) : next;
      return Object.freeze({ ...current, [key]: Object.freeze({ ...existing, text }) });
    });
  }, [key]);

  const setImages = useCallback<Dispatch<SetStateAction<readonly ComposerImage[]>>>((next) => {
    if (!key) return;
    setDrafts((current) => {
      const existing = current[key] ?? EMPTY_DRAFT;
      const images = Object.freeze([...(typeof next === "function" ? next(existing.images) : next)]);
      return Object.freeze({ ...current, [key]: Object.freeze({ ...existing, images }) });
    });
  }, [key]);

  const clear = useCallback(() => {
    if (!key) return;
    setDrafts((current) => {
      if (!(key in current)) return current;
      const remaining = Object.fromEntries(
        Object.entries(current).filter(([candidateKey]) => candidateKey !== key),
      );
      return Object.freeze(remaining);
    });
  }, [key]);

  return useMemo(() => Object.freeze({ ...draft, setText, setImages, clear }), [clear, draft, setImages, setText]);
}
