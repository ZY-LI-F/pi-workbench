import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeBootstrap, StellaDesktopApi } from "../../src/shared/contracts";
import { Conversation } from "../../src/renderer/src/components/Conversation";

afterEach(cleanup);

const BOOTSTRAP = {
  project: { name: "PI-GUI" },
  entries: [],
  state: { sessionId: "test" },
} as unknown as RuntimeBootstrap;

describe("Conversation", () => {
  it("keeps the empty-session suggestions visible when Pi contains display:false custom records", () => {
    render(
      <Conversation
        api={{} as StellaDesktopApi}
        bootstrap={BOOTSTRAP}
        messages={[{
          role: "custom",
          customType: "extension-internal",
          content: "hidden runtime state",
          display: false,
          timestamp: Date.now(),
        }]}
        tools={{}}
        streaming={false}
        scrollMemory={new Map()}
        onPrefill={vi.fn()}
        onFork={vi.fn()}
        onPreviewFile={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /实现功能/ })).toBeTruthy();
    expect(screen.queryByText("hidden runtime state")).toBeNull();
  });
});
