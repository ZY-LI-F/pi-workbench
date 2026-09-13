import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface ConversationScrollPosition {
  readonly following: boolean;
  readonly scrollTop: number;
  readonly anchor?: { readonly key: string; readonly offset: number };
}
export type ConversationScrollMemory = Map<string, ConversationScrollPosition>;
const BOTTOM_TOLERANCE = 48;

function readAnchor(scroller: HTMLElement, content: HTMLElement): ConversationScrollPosition["anchor"] {
  const top = scroller.getBoundingClientRect().top;
  const children = content.children;
  // Ordered message boxes let us find the first visible item without measuring
  // every message in a long session on every scroll event.
  let low = 0;
  let high = children.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (children[middle]!.getBoundingClientRect().bottom <= top) low = middle + 1;
    else high = middle;
  }
  const element = children[low] as HTMLElement | undefined;
  const key = element?.dataset.messageKey;
  return key && element ? { key, offset: element.getBoundingClientRect().top - top } : undefined;
}

export function useConversationScroll(sessionKey: string, memory: ConversationScrollMemory) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);

  const remember = useCallback(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    memory.set(sessionKey, {
      following: followingRef.current,
      scrollTop: scroller.scrollTop,
      anchor: followingRef.current ? undefined : readAnchor(scroller, content),
    });
  }, [memory, sessionKey]);

  const restore = useCallback(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const saved = memory.get(sessionKey);
    followingRef.current = saved?.following ?? true;
    setFollowing(followingRef.current);
    if (followingRef.current) scroller.scrollTop = scroller.scrollHeight;
    else {
      const anchor = saved?.anchor;
      const element = anchor && Array.from(content.children).find((child) => (child as HTMLElement).dataset.messageKey === anchor.key);
      scroller.scrollTop = element && anchor
        ? scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset
        : saved?.scrollTop ?? 0;
    }
    remember();
  }, [memory, remember, sessionKey]);

  useLayoutEffect(() => {
    restore();
    // Images, expanded tool results, sidebar resizing and font changes can
    // change layout without a new message. Preserve the same reading anchor.
    const observer = new ResizeObserver(restore);
    if (scrollerRef.current) observer.observe(scrollerRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [restore]);

  // Restore after React commits a stream delta, before paint. Browser anchoring
  // is disabled on this scroller so it cannot fight the explicit session anchor.
  useLayoutEffect(() => { restore(); });

  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    followingRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < BOTTOM_TOLERANCE;
    setFollowing(followingRef.current);
    remember();
  }, [remember]);

  const jumpToLatest = useCallback(() => {
    memory.set(sessionKey, { following: true, scrollTop: 0 });
    restore();
  }, [memory, restore, sessionKey]);

  return { scrollerRef, contentRef, following, onScroll, jumpToLatest };
}
