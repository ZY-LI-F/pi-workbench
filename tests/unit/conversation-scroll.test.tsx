import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConversationScroll, type ConversationScrollMemory } from "@renderer/hooks/use-conversation-scroll";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Harness({ session, memory }: { readonly session: string; readonly memory: ConversationScrollMemory }) {
  const scroll = useConversationScroll(session, memory);
  return <><div data-testid="scroll" ref={scroll.scrollerRef} onScroll={scroll.onScroll}>
    <div ref={scroll.contentRef}>{Array.from({ length: 5 }, (_, index) => <div key={index} data-message-key={`${session}-${index}`}>{index}</div>)}</div>
  </div><button onClick={scroll.jumpToLatest}>{scroll.following ? "following" : "history"}</button></>;
}

describe("conversation reading anchors", () => {
  it("keeps the same message and offset after earlier content grows, then restores each session independently", () => {
    let resized!: () => void;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resized = callback; }
      observe() {} disconnect() {}
    });
    const memory: ConversationScrollMemory = new Map();
    const { rerender } = render(<Harness session="A" memory={memory} />);
    const scroller = screen.getByTestId("scroll");
    let top = 0;
    let precedingGrowth = 0;
    Object.defineProperties(scroller, {
      clientHeight: { get: () => 100 },
      scrollHeight: { get: () => 500 + precedingGrowth },
      scrollTop: { get: () => top, set: (next: number) => { top = Math.max(0, Math.min(400 + precedingGrowth, next)); } },
    });
    vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(() => ({ top: 0, bottom: 100 } as DOMRect));
    Array.from(scroller.firstElementChild!.children).forEach((element, index) => {
      vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => ({
        top: index * 100 + (index ? precedingGrowth : 0) - top,
        bottom: (index + 1) * 100 + precedingGrowth - top,
      } as DOMRect));
    });
    act(() => resized());
    expect(top).toBe(400);
    scroller.scrollTop = 150;
    fireEvent.scroll(scroller);
    expect(memory.get("A")?.anchor).toEqual({ key: "A-1", offset: -50 });
    precedingGrowth = 100;
    act(() => resized());
    expect(top).toBe(250);
    expect(screen.getByRole("button").textContent).toBe("history");
    rerender(<Harness session="B" memory={memory} />);
    expect(top).toBe(500);
    rerender(<Harness session="A" memory={memory} />);
    expect(top).toBe(250);
    fireEvent.click(screen.getByRole("button"));
    expect(top).toBe(500);
    expect(memory.get("A")?.following).toBe(true);
  });
});
