import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ComposerDraftImage, SaveComposerDraftInput } from "@shared/composer-draft";
import type { RuntimeBootstrap, StellaDesktopApi } from "@shared/contracts";

export type ComposerImage = ComposerDraftImage;

interface SessionComposerDraft {
  readonly text: string;
  readonly images: readonly ComposerImage[];
}

export type ComposerDraftPersistence =
  | { readonly status: "loading" }
  | { readonly status: "saving" }
  | { readonly status: "saved" }
  | { readonly status: "recovered" }
  | { readonly status: "error"; readonly message: string };

interface SessionComposerDraftController extends SessionComposerDraft {
  readonly persistence: ComposerDraftPersistence;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly setImages: Dispatch<SetStateAction<readonly ComposerImage[]>>;
  readonly clear: () => void;
  readonly prepareSend: () => (() => void);
  readonly flush: () => Promise<void>;
}

const EMPTY_DRAFT: SessionComposerDraft = Object.freeze({ text: "", images: Object.freeze([]) });
const SAVE_DELAY_MS = 180;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function frozenDraft(draft: SessionComposerDraft): SessionComposerDraft {
  return Object.freeze({ text: draft.text, images: Object.freeze([...draft.images]) });
}

export function sessionComposerDraftKey(bootstrap: RuntimeBootstrap | undefined): string | undefined {
  if (!bootstrap) return undefined;
  return `${bootstrap.project.cwd}\u0000${bootstrap.state.sessionFile ?? bootstrap.state.sessionId}`;
}

export function useSessionComposerDraft(
  bootstrap: RuntimeBootstrap | undefined,
  api: Pick<StellaDesktopApi, "composerDraftLoad" | "composerDraftSave">,
): SessionComposerDraftController {
  const [drafts, setDrafts] = useState<Readonly<Record<string, SessionComposerDraft>>>(Object.freeze({}));
  const [persistence, setPersistence] = useState<Readonly<Record<string, ComposerDraftPersistence>>>(Object.freeze({}));
  const draftsRef = useRef<Readonly<Record<string, SessionComposerDraft>>>(Object.freeze({}));
  const revisionsRef = useRef(new Map<string, number>());
  const textRevisionsRef = useRef(new Map<string, number>());
  const savedRevisionsRef = useRef(new Map<string, number>());
  const loadedRef = useRef(new Set<string>());
  const loadingRef = useRef(new Map<string, Promise<void>>());
  const dirtyTextRef = useRef(new Set<string>());
  const dirtyImagesRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  const mountedRef = useRef(true);
  const key = sessionComposerDraftKey(bootstrap);
  const draft = useMemo(() => key ? drafts[key] ?? EMPTY_DRAFT : EMPTY_DRAFT, [drafts, key]);

  const setPersistenceFor = useCallback((draftKey: string, next: ComposerDraftPersistence) => {
    if (!mountedRef.current) return;
    setPersistence((current) => Object.freeze({ ...current, [draftKey]: next }));
  }, []);

  const persistNow = useCallback(async (draftKey: string): Promise<void> => {
    const timer = timersRef.current.get(draftKey);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(draftKey);
    if (!loadedRef.current.has(draftKey)) {
      const loading = loadingRef.current.get(draftKey);
      if (loading) await loading;
    }
    if (!loadedRef.current.has(draftKey)) {
      throw new Error("会话草稿尚未成功加载，未覆盖本机草稿文件");
    }

    const pending = inFlightRef.current.get(draftKey);
    if (pending) return pending;
    if (savedRevisionsRef.current.get(draftKey) === (revisionsRef.current.get(draftKey) ?? 0)) return;

    // Exactly one writer per session. A flush also drains edits made during
    // an earlier save, so an older IPC result cannot overwrite a newer draft.
    const operation = (async () => {
      while (savedRevisionsRef.current.get(draftKey) !== (revisionsRef.current.get(draftKey) ?? 0)) {
        const revision = revisionsRef.current.get(draftKey) ?? 0;
        const current = draftsRef.current[draftKey] ?? EMPTY_DRAFT;
        const input: SaveComposerDraftInput = Object.freeze({ key: draftKey, text: current.text, images: current.images });
        setPersistenceFor(draftKey, Object.freeze({ status: "saving" }));
        await api.composerDraftSave(input);
        savedRevisionsRef.current.set(draftKey, revision);
      }
      setPersistenceFor(draftKey, Object.freeze({ status: "saved" }));
    })().catch((cause: unknown) => {
      const message = errorMessage(cause);
      setPersistenceFor(draftKey, Object.freeze({ status: "error", message }));
      throw cause;
    }).finally(() => {
      if (inFlightRef.current.get(draftKey) === operation) inFlightRef.current.delete(draftKey);
    });
    inFlightRef.current.set(draftKey, operation);
    await operation;
  }, [api, setPersistenceFor]);

  const schedulePersist = useCallback((draftKey: string) => {
    if (!loadedRef.current.has(draftKey)) return;
    const existing = timersRef.current.get(draftKey);
    if (existing) clearTimeout(existing);
    setPersistenceFor(draftKey, Object.freeze({ status: "saving" }));
    timersRef.current.set(draftKey, setTimeout(() => {
      timersRef.current.delete(draftKey);
      void persistNow(draftKey).catch(() => undefined);
    }, SAVE_DELAY_MS));
  }, [persistNow, setPersistenceFor]);

  const updateDraft = useCallback((
    draftKey: string,
    transform: (current: SessionComposerDraft) => SessionComposerDraft,
  ) => {
    const next = frozenDraft(transform(draftsRef.current[draftKey] ?? EMPTY_DRAFT));
    draftsRef.current = Object.freeze({ ...draftsRef.current, [draftKey]: next });
    revisionsRef.current.set(draftKey, (revisionsRef.current.get(draftKey) ?? 0) + 1);
    setDrafts(draftsRef.current);
    schedulePersist(draftKey);
  }, [schedulePersist]);

  useEffect(() => {
    if (!key || loadedRef.current.has(key) || loadingRef.current.has(key)) return;
    setPersistenceFor(key, Object.freeze({ status: "loading" }));
    const loading = api.composerDraftLoad(key).then((stored) => {
      const current = draftsRef.current[key] ?? EMPTY_DRAFT;
      const next = frozenDraft({
        text: dirtyTextRef.current.has(key) ? current.text : stored?.text ?? "",
        images: dirtyImagesRef.current.has(key) ? current.images : stored?.images ?? Object.freeze([]),
      });
      draftsRef.current = Object.freeze({ ...draftsRef.current, [key]: next });
      loadedRef.current.add(key);
      setDrafts(draftsRef.current);
      if (dirtyTextRef.current.has(key) || dirtyImagesRef.current.has(key)) {
        schedulePersist(key);
      } else {
        savedRevisionsRef.current.set(key, revisionsRef.current.get(key) ?? 0);
        setPersistenceFor(key, Object.freeze({ status: stored?.recoveredFromPreviousSession ? "recovered" : "saved" }));
      }
    }).catch((cause: unknown) => {
      setPersistenceFor(key, Object.freeze({ status: "error", message: errorMessage(cause) }));
      throw cause;
    }).finally(() => {
      loadingRef.current.delete(key);
    });
    loadingRef.current.set(key, loading);
    void loading.catch(() => undefined);
  }, [api, key, schedulePersist, setPersistenceFor]);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      for (const draftKey of timers.keys()) {
        void persistNow(draftKey).catch(() => undefined);
      }
    };
  }, [persistNow]);

  const setText = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    if (!key) return;
    textRevisionsRef.current.set(key, (textRevisionsRef.current.get(key) ?? 0) + 1);
    dirtyTextRef.current.add(key);
    updateDraft(key, (current) => Object.freeze({
      ...current,
      text: typeof next === "function" ? next(current.text) : next,
    }));
  }, [key, updateDraft]);

  const setImages = useCallback<Dispatch<SetStateAction<readonly ComposerImage[]>>>((next) => {
    if (!key) return;
    dirtyImagesRef.current.add(key);
    updateDraft(key, (current) => Object.freeze({
      ...current,
      images: Object.freeze([...(typeof next === "function" ? next(current.images) : next)]),
    }));
  }, [key, updateDraft]);

  const clear = useCallback(() => {
    if (!key) return;
    textRevisionsRef.current.set(key, (textRevisionsRef.current.get(key) ?? 0) + 1);
    dirtyTextRef.current.add(key);
    dirtyImagesRef.current.add(key);
    updateDraft(key, () => EMPTY_DRAFT);
  }, [key, updateDraft]);

  const prepareSend = useCallback(() => {
    if (!key) throw new Error("没有可提交草稿的 Pi 会话");
    const snapshot = draftsRef.current[key] ?? EMPTY_DRAFT;
    const textRevision = textRevisionsRef.current.get(key) ?? 0;
    return () => {
      // Capture both identity and revision. Returning to this session and typing
      // identical text still creates a NEW draft that an old ack must not erase.
      const textUnchanged = (textRevisionsRef.current.get(key) ?? 0) === textRevision;
      if (textUnchanged) dirtyTextRef.current.add(key);
      if (snapshot.images.length > 0) dirtyImagesRef.current.add(key);
      updateDraft(key, (current) => ({
        text: textUnchanged && current.text === snapshot.text ? "" : current.text,
        images: current.images.filter((image) => !snapshot.images.includes(image)),
      }));
    };
  }, [key, updateDraft]);

  const flush = useCallback(async () => {
    if (!key) return;
    await persistNow(key);
    const inFlight = inFlightRef.current.get(key);
    if (inFlight) await inFlight;
  }, [key, persistNow]);

  return useMemo(() => Object.freeze({
    ...draft,
    persistence: key ? persistence[key] ?? Object.freeze({ status: "loading" as const }) : Object.freeze({ status: "saved" as const }),
    setText,
    setImages,
    clear,
    prepareSend,
    flush,
  }), [clear, draft, flush, key, persistence, prepareSend, setImages, setText]);
}
