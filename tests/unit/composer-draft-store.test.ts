// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ComposerDraftStore } from "../../src/main/composer-draft-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "stella-composer-drafts-"));
  directories.push(directory);
  return Object.freeze({ directory, store: new ComposerDraftStore(directory) });
}

describe("ComposerDraftStore", () => {
  it("persists attachment bytes outside metadata and restores the complete session draft", async () => {
    const { directory, store } = await fixture();
    const input = Object.freeze({
      key: "C:/project\u0000session-a",
      text: "继续完成靶点报告",
      images: Object.freeze([Object.freeze({
        type: "image" as const,
        data: Buffer.from("binary-image").toString("base64"),
        mimeType: "image/png",
        name: "evidence.png",
      })]),
    });

    await store.save(input);
    await expect(store.load(input.key)).resolves.toMatchObject(input);

    const draftDirectories = await readdir(directory);
    expect(draftDirectories).toHaveLength(1);
    const files = await readdir(join(directory, draftDirectories[0]!));
    expect(files).toContain("draft.json");
    expect(files.some((file) => /^image-.+\.bin$/u.test(file))).toBe(true);
    expect(await readFile(join(directory, draftDirectories[0]!, "draft.json"), "utf8")).not.toContain(input.images[0].data);

    await store.save(Object.freeze({ key: input.key, text: "", images: Object.freeze([]) }));
    await expect(store.load(input.key)).resolves.toBeUndefined();
  });

  it("surfaces corrupt metadata and rejects malformed attachment input", async () => {
    const { directory, store } = await fixture();
    const key = "C:/project\u0000session-b";
    await store.save(Object.freeze({ key, text: "valid", images: Object.freeze([]) }));
    const [draftDirectory] = await readdir(directory);
    await writeFile(join(directory, draftDirectory!, "draft.json"), "{corrupted", "utf8");

    await expect(store.load(key)).rejects.toThrow("无法解析会话草稿");
    await expect(store.save({
      key,
      text: "invalid image",
      images: [{ type: "image", data: "not base64!", mimeType: "image/png", name: "bad.png" }],
    })).rejects.toThrow("Base64");
  });

  it("migrates the newest draft from an unsaved Pi session after an application restart", async () => {
    const { directory, store } = await fixture();
    const project = join(directory, "project");
    const previousSessionFile = join(directory, "sessions", "previous.jsonl");
    const restartedSessionFile = join(directory, "sessions", "restarted.jsonl");
    const previousKey = `${project}\0${previousSessionFile}`;
    const restartedKey = `${project}\0${restartedSessionFile}`;
    const image = Object.freeze({
      type: "image" as const,
      data: Buffer.from("restart-image").toString("base64"),
      mimeType: "image/png",
      name: "restart.png",
    });

    await store.save(Object.freeze({ key: previousKey, text: "未发送的重启草稿", images: Object.freeze([image]) }));
    await expect(store.load(restartedKey)).resolves.toMatchObject({
      key: restartedKey,
      text: "未发送的重启草稿",
      images: [image],
      recoveredFromPreviousSession: true,
    });
    const exact = await store.load(restartedKey);
    expect(exact).toMatchObject({ key: restartedKey, text: "未发送的重启草稿" });
    expect(exact).not.toHaveProperty("recoveredFromPreviousSession");
    await expect(readdir(directory)).resolves.toHaveLength(1);
  });
});
