import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeSessionViews, parseNativeSessionViews } from "../../src/renderer/src/lib/native-session-views";

const instances: NativeSessionViews[] = [];
function memory(raw?: string) {
  let saved = raw ?? null;
  const storage = { getItem: () => saved, setItem: vi.fn((_key: string, value: string) => { saved = value; }) };
  const views = new NativeSessionViews(storage); instances.push(views);
  return { views, storage, saved: () => saved };
}
afterEach(() => { for (const views of instances.splice(0)) views.flush(); });
describe("native session presentation memory", () => {
  it("restores stable reading anchors and file choice after recreating the view", () => {
    const env = memory(); const key = "project\0session";
    env.views.set(key, { following: false, scrollTop: 420, anchor: { key: "entry:session:id", offset: -4 } });
    env.views.selectFile(key, "C:/report.docx"); env.views.flush();
    const restored = memory(env.saved()!);
    expect(restored.views.get(key)?.anchor?.key).toBe("entry:session:id");
    expect(restored.views.view(key).selectedFile).toBe("C:/report.docx");
  });
  it("keeps completion unread while reading history and marks it read only on returning to latest", () => {
    const { views } = memory(); const key = "project\0session";
    views.visible(key); views.set(key, { following: false, scrollTop: 20 });
    views.attention(key, "running"); views.attention(key, "completed");
    expect(views.view(key).unread).toBe(true);
    views.visible(key); expect(views.view(key).unread).toBe(true);
    views.set(key, { following: true, scrollTop: 500 }); expect(views.view(key).unread).toBe(false);
  });
  it("does not present a saved running observation as a currently running process", () => {
    const env = memory(); env.views.attention("key", "running"); env.views.flush();
    expect(memory(env.saved()!).views.view("key").attention).toBe("idle");
  });
  it("preserves future schema and displays an error instead of resetting the file", () => {
    const raw = JSON.stringify({ version: 300, sessions: [], futureData: true });
    const env = memory(raw); env.views.set("key", { following: true, scrollTop: 0 }); env.views.flush();
    expect(env.views.error).toContain("原存储不会覆盖"); expect(env.saved()).toBe(raw); expect(env.storage.setItem).not.toHaveBeenCalled();
  });
  it("surfaces quota failure and retains the in-memory reading position", () => {
    const env = memory(); env.storage.setItem.mockImplementation(() => { throw new Error("quota"); });
    env.views.set("key", { following: false, scrollTop: 200 }); env.views.flush();
    expect(env.views.error).toContain("quota"); expect(env.views.get("key")?.scrollTop).toBe(200);
  });
  it("rejects malformed anchors and duplicate session keys", () => {
    expect(() => parseNativeSessionViews({ version: 1, sessions: [["key", { scroll: { following: true, scrollTop: 2, anchor: { key: "id", offset: NaN } } }]] })).toThrow("锚点");
    expect(() => parseNativeSessionViews({ version: 1, sessions: [["key", {}], ["key", {}]] })).toThrow("条目");
  });
});
