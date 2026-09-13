// @vitest-environment node
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AtomicJsonFile } from "../../src/main/atomic-json-file";
import { ProjectRegistryService, type DiscoveredProject } from "../../src/main/project-registry-service";
import { discoverKnownProjects } from "../../src/main/project-discovery";
import { EMPTY_BOARD_STATE, type KanbanTask } from "../../src/shared/kanban";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "stella-project-registry-"));
  directories.push(root);
  const path = join(root, "projects.json");
  const disk = new AtomicJsonFile(path);
  const seeds: DiscoveredProject[] = [];
  let sequence = 0;
  let failures = false;
  let changes = 0;
  let warning: string | undefined;
  const dependencies: ConstructorParameters<typeof ProjectRegistryService>[0] = {
    // Explicit write-failure injection; reads and all successful writes use the real file.
    storage: { read: () => disk.read(), write: (value) => { if (failures) throw new Error("磁盘写入失败"); return disk.write(value); } },
    discover: async () => ({ projects: seeds, warning }),
    now: () => "2026-09-13T10:00:00.000Z",
    id: () => `project-${++sequence}`,
    emitChanged: () => { changes += 1; },
    inspectDirectory: async (path) => {
      try { const canonicalPath = await realpath(path); if (!(await stat(canonicalPath)).isDirectory()) throw new Error("不是目录"); return { state: "available", canonicalPath }; }
      catch (cause) { return { state: (cause as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable", detail: String(cause) }; }
    },
  };
  const directory = async (name: string) => { const target = join(root, name); await mkdir(target); return realpath(target); };
  return { root, path, seeds, disk, dependencies, service: new ProjectRegistryService(dependencies), directory,
    failWrites: (value: boolean) => { failures = value; }, changes: () => changes, warn: (value: string) => { warning = value; } };
}

describe("project registry persistence", () => {
  it("discovers history once, preserves metadata, and retains projects beyond the recent-project window across restart", async () => {
    const f = await fixture();
    for (let index = 0; index < 16; index += 1) f.seeds.push({ path: await f.directory(`项目 ${index}`), name: `历史项目 ${index}` });
    const first = await f.service.initialize();
    expect(first.projects).toHaveLength(16);
    const project = first.projects[0]!;
    await f.service.update({ projectId: project.id, name: "自己命名", description: "重点", pinned: true, archived: true, stage: "paused" });
    f.seeds.splice(0, 4);
    const restored = await new ProjectRegistryService(f.dependencies).initialize();
    expect(restored.projects).toHaveLength(16);
    expect(restored.projects[0]).toMatchObject({ id: project.id, path: project.path, name: "自己命名", description: "重点", pinned: true, archived: true, stage: "paused" });
    expect(restored.revision).toBe(2);
    expect(f.changes()).toBe(2);
  });

  it("registers a real directory without opening a Runtime and prevents duplicate registration even after archive", async () => {
    const f = await fixture();
    const directory = await f.directory("space 中文");
    const result = await f.service.add({ path: directory, name: "新项目", description: "范围" });
    const project = result.projects[0]!;
    expect(project).toMatchObject({ name: "新项目", path: directory, stage: "planned", archived: false });
    expect(result.directories[project.id]).toEqual({ state: "available" });
    await f.service.update({ projectId: project.id, archived: true });
    await expect(f.service.add({ path: `${directory}/.`, name: "另一个名称", description: "" })).rejects.toThrow("已经在项目清单");
    await f.service.update({ projectId: project.id, archived: false });
    expect((await f.service.initialize()).projects).toHaveLength(1);
    await expect(f.service.add({ path: "relative", name: "x", description: "" })).rejects.toThrow("绝对路径");
    await expect(f.service.add({ path: f.path, name: "文件", description: "" })).rejects.toThrow("不是目录");
  });

  it("serializes field patches and leaves durable state intact on a failed write", async () => {
    const f = await fixture();
    const created = await f.service.add({ path: await f.directory("workspace"), name: "初始", description: "" });
    const project = created.projects[0]!;
    await Promise.all([f.service.update({ projectId: project.id, name: "新名称" }), f.service.update({ projectId: project.id, pinned: true })]);
    const saved = await readFile(f.path, "utf8");
    f.failWrites(true);
    await expect(f.service.update({ projectId: project.id, stage: "completed" })).rejects.toThrow("磁盘写入失败");
    expect(await readFile(f.path, "utf8")).toBe(saved);
    expect(f.changes()).toBe(3);
    f.failWrites(false);
    const next = await f.service.update({ projectId: project.id, description: "恢复后保存" });
    expect(next.projects[0]).toMatchObject({ name: "新名称", pinned: true, stage: "planned", description: "恢复后保存" });
    await expect(f.service.update({ projectId: project.id, pinned: "true" })).rejects.toThrow("布尔值");
    await expect(f.service.update({ projectId: project.id, stage: "running" })).rejects.toThrow("阶段无效");
    await expect(f.service.update({ projectId: "missing", name: "x" })).rejects.toThrow("找不到项目");
  });

  it.each(["{bad json", JSON.stringify({ version: 99, revision: 0, projects: [] }), JSON.stringify({ version: 1, revision: 0, projects: [{}] })])("exposes malformed and future files without overwriting them: %s", async (contents) => {
    const f = await fixture();
    await writeFile(f.path, contents);
    f.seeds.push({ path: await f.directory("seed") });
    await expect(f.service.initialize()).rejects.toThrow();
    await expect(f.service.add({ path: await f.directory("new"), name: "x", description: "" })).rejects.toThrow();
    expect(await readFile(f.path, "utf8")).toBe(contents);
    expect(f.changes()).toBe(0);
  });

  it("keeps missing directories and exposes incomplete discovery without converting them to empty success", async () => {
    const f = await fixture();
    f.seeds.push({ path: join(f.root, "deleted-repo"), name: "历史项目" });
    f.warn("Task Control 不可用，未读取历史任务");
    const result = await f.service.initialize();
    expect(result.projects[0]?.name).toBe("历史项目");
    expect(result.directories[result.projects[0]!.id]?.state).toBe("missing");
    expect(result.discoveryWarning).toContain("Task Control 不可用");
  });

  it("does not follow changed canonical locations when presenting historical project identity", async () => {
    const f = await fixture();
    const oldPath = await f.directory("original");
    const newPath = await f.directory("replacement");
    f.seeds.push({ path: oldPath });
    const service = new ProjectRegistryService({ ...f.dependencies, inspectDirectory: async () => ({ state: "available", canonicalPath: newPath }) });
    const result = await service.initialize();
    expect(result.projects[0]?.path).toBe(oldPath);
    expect(result.directories[result.projects[0]!.id]).toMatchObject({ state: "moved", detail: expect.stringContaining(newPath) });
  });
});

it("discovers Board project scopes but excludes the implicit Pi placeholder", () => {
  const board = { ...EMPTY_BOARD_STATE, tasks: [{ projectPath: "/history", projectName: "历史" } as KanbanTask] };
  const seeds = discoverKnownProjects([{ path: "/recent", trusted: true, lastOpened: "2026-09-13" }], board, { cwd: "/placeholder", name: "placeholder", requiresSelection: true });
  expect(seeds).toEqual([{ path: "/recent" }, { path: "/history", name: "历史" }]);
  expect(seeds.some((seed) => "trusted" in seed)).toBe(false);
});
