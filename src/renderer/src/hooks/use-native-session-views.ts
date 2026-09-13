import { useEffect, useState, useSyncExternalStore } from "react";
import { NativeSessionViews, type NativeAttention } from "../lib/native-session-views";
import type { RuntimeUiState } from "../lib/runtime-state";

export function useNativeSessionViews(state: RuntimeUiState, chatVisible: boolean) {
  const [views] = useState(() => new NativeSessionViews(localStorage));
  const revision = useSyncExternalStore(views.subscribe, views.snapshot);
  const [focused, setFocused] = useState(() => document.hasFocus());
  const key = state.bootstrap ? `${state.bootstrap.project.cwd}\u0000${state.bootstrap.state.sessionId}` : undefined;
  const last = state.messages.at(-1);
  const attention: NativeAttention = state.extensionRequest ? "needs-input"
    : state.error || (last?.role === "assistant" && last.stopReason === "error") ? "failed"
      : state.streaming || state.compacting || state.retrying ? "running"
        : last?.role === "assistant" && last.stopReason ? "completed" : "idle";
  useEffect(() => {
    const focus = () => setFocused(document.hasFocus() && document.visibilityState !== "hidden");
    window.addEventListener("focus", focus); window.addEventListener("blur", focus); document.addEventListener("visibilitychange", focus);
    const persist = () => views.flush();
    window.addEventListener("pagehide", persist);
    return () => {
      window.removeEventListener("focus", focus); window.removeEventListener("blur", focus); document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("pagehide", persist); views.flush();
    };
  }, [views]);
  useEffect(() => { views.visible(chatVisible && focused ? key : undefined); }, [chatVisible, focused, key, views]);
  useEffect(() => { if (key) views.attention(key, attention); }, [attention, key, views]);
  return { views, key, revision, error: views.error };
}
