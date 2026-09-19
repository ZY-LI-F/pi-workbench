import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeBootstrap, SerializableMessage, StellaDesktopApi } from "../../src/shared/contracts";
import { Conversation } from "../../src/renderer/src/components/Conversation";

const metrics = vi.hoisted(() => ({ parses: 0 }));
vi.mock("remark-gfm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("remark-gfm")>();
  return { default: function (this: Parameters<typeof actual.default>[0], ...args: Parameters<typeof actual.default>) {
    metrics.parses += 1;
    return actual.default.apply(this as never, args);
  } };
});
afterEach(cleanup);
describe("native conversation rendering work", () => {
  it("does not reparse historical Markdown for each incoming stream update", () => {
    metrics.parses = 0;
    const history: SerializableMessage[] = Array.from({ length: 80 }, (_, index) => ({
      role: "assistant", timestamp: index, provider: "test", model: "test", stopReason: "stop",
      stella: { key: `entry:session:${index}`, entryId: String(index) },
      content: [{ type: "text", text: `## Evidence ${index}\n\n| Item | Value |\n| --- | --- |\n| Stable | ${index} |\n\n**Historical Markdown** is unchanged.` }],
    }));
    const props = { api: { openExternal: vi.fn() } as unknown as StellaDesktopApi,
      bootstrap: { project: { name: "test", cwd: "project" }, state: { sessionId: "session" }, entries: [] } as unknown as RuntimeBootstrap,
      tools: {}, streaming: true, scrollMemory: new Map(), onPrefill: vi.fn(), onFork: vi.fn(), onPreviewFile: vi.fn() };
    const live = (index: number): SerializableMessage => ({ role: "assistant", timestamp: 100, provider: "test", model: "test", stopReason: "stop",
      stella: { key: "live:session" }, content: [{ type: "text", text: `Stream revision ${index}` }] });
    const view = render(<Conversation {...props} messages={[...history, live(0)]} />);
    const initial = metrics.parses;
    for (let index = 1; index <= 40; index += 1) view.rerender(<Conversation {...props} messages={[...history, live(index)]} />);
    expect(initial).toBe(81);
    expect(metrics.parses - initial).toBe(40);
    expect(view.container.querySelectorAll(".conversation-entry")).toHaveLength(81);
    // Work is bounded by parser-call assertions, not a machine-dependent jsdom
    // wall-clock budget; 80 tables + 40 renders exceed 5s on loaded Windows hosts.
  }, 20_000);
});
