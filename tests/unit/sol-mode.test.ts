// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_SOL_MODE, parseSolModeConfig, solFeatures } from "../../src/shared/sol-mode";
import { SolModeService } from "../../src/main/sol-mode-service";
import { appendArchive, openArchive, storeImmutable } from "../../src/extensions/sol-pi/secure-files";
import { createObservationPackExtension } from "../../src/extensions/sol-pi/vendor/extensions/observation-pack/index";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const directories: string[] = [];
async function temporary() { const root = await realpath(await mkdtemp(join(tmpdir(), "stella-sol-test-"))); directories.push(root); return root; }
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("Sol mode configuration and actual activation", () => {
  it("requires valid explicit advanced configuration and rejects unknown fields", () => {
    expect(parseSolModeConfig(DEFAULT_SOL_MODE)).toEqual(DEFAULT_SOL_MODE);
    expect(() => parseSolModeConfig({ ...DEFAULT_SOL_MODE, enabled: "true" })).toThrow("布尔");
    expect(() => parseSolModeConfig({ ...DEFAULT_SOL_MODE, shell: "unsafe" })).toThrow("未知");
    expect(() => parseSolModeConfig({ ...DEFAULT_SOL_MODE, constructor: "invalid" })).toThrow("未知");
    expect(() => parseSolModeConfig({ ...DEFAULT_SOL_MODE, cacheWriteReadRatio: Infinity })).toThrow("比例");
    expect(() => parseSolModeConfig({ ...DEFAULT_SOL_MODE, enabled: true, evidencePreservingReducer: true })).toThrow("选择");
    expect(() => parseSolModeConfig({ ...DEFAULT_SOL_MODE, enabled: true, actionFusion: false, observationPack: false })).toThrow("至少");
  });
  it("does not report enabled until this launch confirms its exact mechanisms", async () => {
    const config = { ...DEFAULT_SOL_MODE, enabled: true };
    const storage = { read: async () => config, write: vi.fn(async () => {}) };
    const service = new SolModeService(storage, vi.fn());
    await service.initialize();
    const launch = service.begin(20_000);
    const report = { launchId: "stale", sessionId: "s", phase: "active", features: solFeatures(config), auxiliaryTokens: 0,
      activity: { time: new Date().toISOString(), mechanism: "runtime", level: "info", message: "loaded" } };
    service.accept(JSON.stringify(report));
    expect(service.snapshot().phase).toBe("loading");
    service.accept(JSON.stringify({ ...report, launchId: launch.id }));
    service.ready();
    expect(service.snapshot().phase).toBe("active");
    service.begin(20_000);
    expect(() => service.ready()).toThrow("加载确认");
    expect(service.snapshot().phase).toBe("error");
    await service.configure(DEFAULT_SOL_MODE);
    service.begin(20_000); service.ready();
    expect(service.snapshot().phase).toBe("disabled");
  });
  it("makes invalid disk configuration visible until explicitly replaced", async () => {
    const service = new SolModeService({ read: async () => ({}), write: vi.fn(async () => {}) }, vi.fn());
    await service.initialize();
    expect(() => service.begin(20_000)).toThrow("配置读取失败");
    await service.configure(DEFAULT_SOL_MODE);
    service.begin(20_000); service.ready();
    expect(service.snapshot().error).toBeUndefined();
  });
  it("does not save configuration when storage fails", async () => {
    const service = new SolModeService({ read: async () => undefined, write: async () => { throw new Error("disk full"); } }, vi.fn());
    await service.initialize();
    await expect(service.configure({ ...DEFAULT_SOL_MODE, enabled: true })).rejects.toThrow("disk full");
    expect(service.snapshot().config.enabled).toBe(false);
  });
});

describe("Sol archive integrity", () => {
  it("archives exactly, reuses identical objects and rejects corruption", async () => {
    const root = await temporary(); const path = join(root, "nested", "object.txt");
    await storeImmutable(path, "原始\n证据\n");
    await storeImmutable(path, "原始\n证据\n");
    await expect(storeImmutable(path, "different")).rejects.toThrow("完整性");
    const file = await openArchive(path, "read");
    try { expect(await file.readFile("utf8")).toBe("原始\n证据\n"); } finally { await file.close(); }
    await appendArchive(join(root, "ledger.jsonl"), "one\n");
    await appendArchive(join(root, "ledger.jsonl"), "two\n");
    expect(await readFile(join(root, "ledger.jsonl"), "utf8")).toBe("one\ntwo\n");
  });
  it("rejects Windows junction / POSIX directory symlink traversal before storing data", async () => {
    const root = await temporary(); const outside = await temporary();
    await symlink(outside, join(root, "redirect"), process.platform === "win32" ? "junction" : "dir");
    await expect(storeImmutable(join(root, "redirect", "object.txt"), "must not escape")).rejects.toThrow("可信普通目录");
    await expect(readFile(join(outside, "object.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects hardlinked archive and ledger files", async () => {
    const root = await temporary();
    await writeFile(join(root, "original"), "unchanged");
    await link(join(root, "original"), join(root, "object"));
    await expect(appendArchive(join(root, "object"), "mutation")).rejects.toThrow("拒绝链接");
    await expect(openArchive(join(root, "object"), "read")).rejects.toThrow("拒绝链接");
    expect(await readFile(join(root, "original"), "utf8")).toBe("unchanged");
  });
});

it("ObservationPack resets projection counts on branch changes and preserves source messages", async () => {
  const root = await temporary();
  const handlers = new Map<string, (event: any, context: ExtensionContext) => any>();
  const tools = new Map<string, any>();
  createObservationPackExtension()({ on: (name: string, handler: any) => handlers.set(name, handler), registerTool: (tool: any) => tools.set(tool.name, tool) } as unknown as ExtensionAPI);
  const context = { sessionManager: { getSessionDir: () => root, getSessionId: () => "session" }, mode: "rpc" } as unknown as ExtensionContext;
  const body = "Exact evidence line\n".repeat(1000);
  const message = { role: "toolResult", toolName: "read", toolCallId: "read-1", isError: false, content: [{ type: "text", text: body }], timestamp: 0 };
  const project = () => handlers.get("context")!({ messages: [message] }, context);
  await project(); await project();
  expect(JSON.stringify(await project())).toContain("large tool result replaced");
  expect(message.content[0]?.text).toBe(body);
  handlers.get("session_tree")!({}, context);
  expect((await project()).messages[0].content[0].text).toBe(body);
  const projected = await project();
  expect(projected.messages[0].content[0].text).toBe(body);
  const id = JSON.stringify(await project()).match(/obs_[a-f0-9]{24}/u)![0];
  const recall = await tools.get("obs_recall").execute("recall", { id, offset: 0 }, undefined, undefined, context);
  expect(recall.content[0].text).toContain("Exact evidence line");
});
