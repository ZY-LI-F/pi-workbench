import type { ConversationScrollPosition } from "../hooks/use-conversation-scroll";

export type NativeAttention = "idle" | "running" | "needs-input" | "completed" | "failed";
export interface NativeSessionView {
  readonly scroll?: ConversationScrollPosition;
  readonly selectedFile?: string;
  readonly unread?: boolean;
  readonly attention?: NativeAttention;
}
const STORAGE_KEY = "stella.native-session-views";

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export function parseNativeSessionViews(value: unknown): readonly (readonly [string, NativeSessionView])[] {
  if (!record(value) || value.version !== 1) throw new Error("会话视图存储版本不兼容，原数据未覆盖");
  if (!Array.isArray(value.sessions)) throw new Error("会话视图存储格式无效，原数据未覆盖");
  const keys = new Set<string>();
  for (const item of value.sessions) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string" || !record(item[1]) || keys.has(item[0])) throw new Error("会话视图条目无效");
    keys.add(item[0]);
    const view = item[1];
    if (view.selectedFile !== undefined && typeof view.selectedFile !== "string") throw new Error("会话文件选择无效");
    if (view.unread !== undefined && typeof view.unread !== "boolean") throw new Error("会话未读标记无效");
    if (view.attention !== undefined && !["idle", "running", "needs-input", "completed", "failed"].includes(String(view.attention))) throw new Error("会话 attention 无效");
    if (view.scroll !== undefined) {
      const scroll = view.scroll;
      if (!record(scroll) || typeof scroll.following !== "boolean" || typeof scroll.scrollTop !== "number" || !Number.isFinite(scroll.scrollTop) || scroll.scrollTop < 0) throw new Error("会话阅读位置无效");
      if (scroll.anchor !== undefined && (!record(scroll.anchor) || typeof scroll.anchor.key !== "string" || typeof scroll.anchor.offset !== "number" || !Number.isFinite(scroll.anchor.offset))) throw new Error("会话阅读锚点无效");
    }
  }
  return value.sessions as unknown as readonly (readonly [string, NativeSessionView])[];
}

/** Device-only presentation metadata. Never owns Pi or Board execution state. */
export class NativeSessionViews extends Map<string, ConversationScrollPosition> {
  readonly #views = new Map<string, NativeSessionView>();
  readonly #listeners = new Set<() => void>();
  readonly #storage: Pick<Storage, "getItem" | "setItem">;
  #timer?: ReturnType<typeof setTimeout>;
  #writable = true;
  #revision = 0;
  #visibleKey?: string;
  error?: string;

  constructor(storage: Pick<Storage, "getItem" | "setItem">) {
    super();
    this.#storage = storage;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return;
      for (const [key, view] of parseNativeSessionViews(JSON.parse(raw))) {
        // A saved running state is only a past observation, never live evidence after restart.
        this.#views.set(key, { ...view, attention: view.attention === "running" ? "idle" : view.attention });
        if (view.scroll) super.set(key, view.scroll);
      }
    } catch (cause) {
      this.#writable = false;
      this.error = `无法恢复会话查看状态：${String(cause)}。当前只使用临时视图，原存储不会覆盖。`;
    }
  }

  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  snapshot = () => this.#revision;
  view(key: string): NativeSessionView { return this.#views.get(key) ?? {}; }
  #publish() { this.#revision += 1; for (const listener of this.#listeners) listener(); }
  #changed() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), 200);
  }
  flush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.#writable) return;
    try {
      this.#storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, sessions: [...this.#views] }));
      if (this.error) { this.error = undefined; this.#publish(); }
    } catch (cause) {
      const error = `会话查看状态保存失败：${String(cause)}；当前阅读位置仍保留在内存。`;
      if (error !== this.error) { this.error = error; this.#publish(); }
    }
  }
  override set(key: string, position: ConversationScrollPosition): this {
    const previous = super.get(key);
    if (previous?.scrollTop === position.scrollTop && previous.following === position.following
      && previous.anchor?.key === position.anchor?.key && previous.anchor?.offset === position.anchor?.offset) return this;
    super.set(key, position);
    const view = this.view(key);
    this.#views.set(key, { ...view, scroll: position, unread: key === this.#visibleKey && position.following ? false : view.unread });
    if (view.unread && key === this.#visibleKey && position.following) this.#publish();
    this.#changed();
    return this;
  }
  selectFile(key: string, path: string): void {
    if (this.view(key).selectedFile === path) return;
    this.#views.set(key, { ...this.view(key), selectedFile: path });
    this.#changed();
  }
  visible(key: string | undefined): void {
    this.#visibleKey = key;
    if (key && this.view(key).unread && (this.view(key).scroll?.following ?? true)) {
      this.#views.set(key, { ...this.view(key), unread: false });
      this.#changed(); this.#publish();
    }
  }
  attention(key: string, attention: NativeAttention): void {
    const previous = this.view(key);
    if (previous.attention === attention) return;
    const terminal = attention === "completed" || attention === "failed" || attention === "needs-input";
    const readingLatest = key === this.#visibleKey && (previous.scroll?.following ?? true);
    const unread = terminal && previous.attention !== undefined && !readingLatest ? true : previous.unread ?? false;
    this.#views.set(key, { ...previous, attention, unread });
    this.#changed(); this.#publish();
  }
}
