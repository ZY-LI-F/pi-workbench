import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeBootstrap } from "@shared/contracts";
import type { ComposerDraftSnapshot, SaveComposerDraftInput } from "@shared/composer-draft";
import {
  sessionComposerDraftKey,
  useSessionComposerDraft,
  type ComposerImage,
} from "@renderer/hooks/use-session-composer-draft";

afterEach(cleanup);

function draftApi(initial: Readonly<Record<string, ComposerDraftSnapshot>> = {}) {
  const values = new Map(Object.entries(initial));
  return Object.freeze({
    values,
    composerDraftLoad: async (key: string) => values.get(key),
    composerDraftSave: async (input: SaveComposerDraftInput) => {
      if (!input.text && input.images.length === 0) values.delete(input.key);
      else values.set(input.key, Object.freeze({ ...input, updatedAt: Date.now() }));
    },
  });
}

function bootstrap(project: string, sessionId: string): RuntimeBootstrap {
  return {
    project: { cwd: project, name: project, trusted: true, requiresTrust: false, requiresSelection: false },
    state: { sessionId },
  } as unknown as RuntimeBootstrap;
}

describe("useSessionComposerDraft", () => {
  it("consumes only the captured session revision, even when newer text is identical", async () => {
    const first = bootstrap("C:/project", "A");
    const second = bootstrap("C:/project", "B");
    const api = draftApi();
    const { result, rerender } = renderHook(({ source }) => useSessionComposerDraft(source, api), { initialProps: { source: first } });
    await waitFor(() => expect(result.current.persistence.status).toBe("saved"));
    act(() => result.current.setText("same text"));
    const acknowledgeOld = result.current.prepareSend();
    rerender({ source: second });
    act(() => result.current.setText("B's draft"));
    rerender({ source: first });
    act(() => { result.current.setText(""); result.current.setText("same text"); });
    act(() => acknowledgeOld());
    expect(result.current.text).toBe("same text");
    const acknowledgeCurrent = result.current.prepareSend();
    rerender({ source: second });
    act(() => acknowledgeCurrent());
    expect(result.current.text).toBe("B's draft");
    rerender({ source: first });
    expect(result.current.text).toBe("");
  });

  it("serializes saves and flushes the latest edit even if an earlier save is pending", async () => {
    const accepts: (() => void)[] = [];
    const saved: string[] = [];
    const api = {
      composerDraftLoad: async () => undefined,
      composerDraftSave: vi.fn((input: SaveComposerDraftInput) => new Promise<void>((resolve) => {
        accepts.push(() => { saved.push(input.text); resolve(); });
      })),
    };
    const { result } = renderHook(() => useSessionComposerDraft(bootstrap("C:/project", "session"), api));
    await waitFor(() => expect(result.current.persistence.status).toBe("saved"));
    act(() => result.current.setText("old"));
    let firstFlush!: Promise<void>;
    act(() => { firstFlush = result.current.flush(); });
    expect(api.composerDraftSave).toHaveBeenCalledTimes(1);
    act(() => result.current.setText("new"));
    let latestFlush!: Promise<void>;
    act(() => { latestFlush = result.current.flush(); });
    expect(api.composerDraftSave).toHaveBeenCalledTimes(1);
    await act(async () => { accepts[0]!(); });
    expect(api.composerDraftSave).toHaveBeenCalledTimes(2);
    expect(result.current.persistence.status).toBe("saving");
    await act(async () => { accepts[1]!(); await Promise.all([firstFlush, latestFlush]); });
    expect(saved).toEqual(["old", "new"]);
    expect(result.current.persistence.status).toBe("saved");
  });

  it("exposes a failed save without consuming the draft and lets flush retry it", async () => {
    const api = {
      composerDraftLoad: async () => undefined,
      composerDraftSave: vi.fn().mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useSessionComposerDraft(bootstrap("C:/project", "session"), api));
    await waitFor(() => expect(result.current.persistence.status).toBe("saved"));
    act(() => result.current.setText("must survive"));
    await act(async () => { await expect(result.current.flush()).rejects.toThrow("disk unavailable"); });
    expect(result.current.text).toBe("must survive");
    expect(result.current.persistence).toEqual({ status: "error", message: "disk unavailable" });
    await act(() => result.current.flush());
    expect(result.current.persistence.status).toBe("saved");
    expect(api.composerDraftSave).toHaveBeenLastCalledWith(expect.objectContaining({ text: "must survive" }));
  });

  it("keeps independent text and attachments for every project session", async () => {
    const first = bootstrap("C:/project-a", "session-a");
    const second = bootstrap("C:/project-b", "session-b");
    const image: ComposerImage = Object.freeze({
      type: "image",
      data: "aW1hZ2U=",
      mimeType: "image/png",
      name: "evidence.png",
    });
    const api = draftApi();
    const { result, rerender } = renderHook(
      ({ source }: { readonly source: RuntimeBootstrap | undefined }) => useSessionComposerDraft(source, api),
      { initialProps: { source: first } },
    );

    act(() => {
      result.current.setText("项目 A 的待发送说明");
      result.current.setImages([image]);
    });
    await act(() => result.current.flush());
    expect(result.current.text).toBe("项目 A 的待发送说明");
    expect(result.current.images).toEqual([image]);

    rerender({ source: second });
    expect(result.current.text).toBe("");
    expect(result.current.images).toEqual([]);
    act(() => result.current.setText("项目 B 的独立草稿"));
    await act(() => result.current.flush());

    rerender({ source: first });
    expect(result.current.text).toBe("项目 A 的待发送说明");
    expect(result.current.images).toEqual([image]);

    act(() => result.current.clear());
    await act(() => result.current.flush());
    expect(result.current.text).toBe("");
    expect(result.current.images).toEqual([]);
  });

  it("restores text and attachments from the durable desktop draft store", async () => {
    const source = bootstrap("C:/project", "session");
    const key = sessionComposerDraftKey(source)!;
    const image: ComposerImage = Object.freeze({ type: "image", data: "aW1hZ2U=", mimeType: "image/png", name: "evidence.png" });
    const api = draftApi({
      [key]: Object.freeze({ key, text: "重启前草稿", images: Object.freeze([image]), updatedAt: Date.now() }),
    });

    const { result } = renderHook(() => useSessionComposerDraft(source, api));
    await waitFor(() => expect(result.current.persistence.status).toBe("saved"));
    expect(result.current.text).toBe("重启前草稿");
    expect(result.current.images).toEqual([image]);
  });

  it("uses project and session identity together as the draft key", () => {
    expect(sessionComposerDraftKey(bootstrap("C:/project", "session"))).toBe("C:/project\u0000session");
    expect(sessionComposerDraftKey(undefined)).toBeUndefined();
  });
});
