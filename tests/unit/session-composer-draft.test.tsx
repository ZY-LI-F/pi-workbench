import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeBootstrap } from "@shared/contracts";
import {
  sessionComposerDraftKey,
  useSessionComposerDraft,
  type ComposerImage,
} from "@renderer/hooks/use-session-composer-draft";

afterEach(cleanup);

function bootstrap(project: string, sessionId: string): RuntimeBootstrap {
  return {
    project: { cwd: project, name: project, trusted: true, requiresTrust: false, requiresSelection: false },
    state: { sessionId },
  } as unknown as RuntimeBootstrap;
}

describe("useSessionComposerDraft", () => {
  it("keeps independent text and attachments for every project session", () => {
    const first = bootstrap("C:/project-a", "session-a");
    const second = bootstrap("C:/project-b", "session-b");
    const image: ComposerImage = Object.freeze({
      type: "image",
      data: "aW1hZ2U=",
      mimeType: "image/png",
      name: "evidence.png",
    });
    const { result, rerender } = renderHook(
      ({ source }: { readonly source: RuntimeBootstrap | undefined }) => useSessionComposerDraft(source),
      { initialProps: { source: first } },
    );

    act(() => {
      result.current.setText("项目 A 的待发送说明");
      result.current.setImages([image]);
    });
    expect(result.current.text).toBe("项目 A 的待发送说明");
    expect(result.current.images).toEqual([image]);

    rerender({ source: second });
    expect(result.current.text).toBe("");
    expect(result.current.images).toEqual([]);
    act(() => result.current.setText("项目 B 的独立草稿"));

    rerender({ source: first });
    expect(result.current.text).toBe("项目 A 的待发送说明");
    expect(result.current.images).toEqual([image]);

    act(() => result.current.clear());
    expect(result.current.text).toBe("");
    expect(result.current.images).toEqual([]);
  });

  it("uses project and session identity together as the draft key", () => {
    expect(sessionComposerDraftKey(bootstrap("C:/project", "session"))).toBe("C:/project\u0000session");
    expect(sessionComposerDraftKey(undefined)).toBeUndefined();
  });
});
