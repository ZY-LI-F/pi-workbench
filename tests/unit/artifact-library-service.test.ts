// @vitest-environment node
import { mkdtemp, mkdir, readFile, realpath, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactLibraryService } from "../../src/main/artifact-library-service";
import { LocalPathService } from "../../src/main/local-path-service";
import { LocalFilePreviewService } from "../../src/main/local-file-preview-service";
import { canonicalPathWithinRoots } from "../../src/main/path-security";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "stella-artifact-test-")); directories.push(root);
  const project = join(root, "project"); const external = join(root, "外部 证据");
  await mkdir(join(project, "references"), { recursive: true }); await mkdir(join(project, "assets")); await mkdir(external);
  const source = join(project, "references", "paper.md"); await writeFile(source, "# Scientific evidence");
  await writeFile(join(project, "assets", "表 #1.csv"), "id,value\n001,2"); await writeFile(join(external, "secret.md"), "not granted");
  const grants: string[] = [project];
  const paths = new LocalPathService({ allowedRoots: () => grants, canonicalizeWithinRoots: (path, roots) => canonicalPathWithinRoots(path, roots, { pinnedRootPaths: grants.slice(1) }),
    inspectPath: stat, openWithSystem: vi.fn(), revealWithSystem: vi.fn() });
  const chooser = vi.fn<() => Promise<string | undefined>>(async () => undefined);
  const library = new ArtifactLibraryService({ inspect: (path) => paths.inspect(path), readDirectory: readdir,
    realpath, isDirectory: async (path) => (await stat(path)).isDirectory(), chooseDirectory: chooser, grantReadDirectory: (path) => { grants.push(path); } });
  return { root, project, external, source, grants, paths, library, chooser };
}

describe("read-only artifact library", () => {
  it("resolves encoded Unicode, spaces, parent links and explicit fragments with real byte reads", async () => {
    const f = await fixture();
    const link = await f.library.resolveLink({ fromPath: f.source, href: "../assets/%E8%A1%A8%20%231.csv#row-2" });
    expect(link.inspection.name).toBe("表 #1.csv"); expect(link.fragment).toBe("row-2");
    const content = await new LocalFilePreviewService({ inspectLocalPath: (path) => f.paths.inspect(path), readFile }).read(link.inspection.canonicalPath);
    expect(content.kind).toBe("delimited"); expect(new TextDecoder().decode(content.bytes)).toContain("001");
    expect((await f.library.resolveLink({ fromPath: f.source, href: "#methods" })).inspection.canonicalPath).toBe(f.source);
  });
  it("does not grant access until a native choice; cancel preserves previous grants", async () => {
    const f = await fixture();
    await expect(f.library.list(f.external)).rejects.toThrow("只允许访问");
    expect(await f.library.choose()).toBeNull(); expect(f.grants).toHaveLength(1);
    f.chooser.mockResolvedValue(f.external);
    expect((await f.library.choose())?.kind).toBe("directory");
    expect((await f.library.list(f.external)).entries[0]?.inspection?.name).toBe("secret.md");
    f.chooser.mockResolvedValue(undefined); await f.library.choose(); expect(f.grants).toHaveLength(2);
  });
  it("rejects protocols, UNC, malformed encoding, invalid input and links outside grants", async () => {
    const f = await fixture();
    for (const href of ["https://example.org/file.csv", "file:///C:/secret.md", "javascript:alert(1)", "//host/share/a.md", "%00", "%xy", "../../外部 证据/secret.md"]) {
      await expect(f.library.resolveLink({ fromPath: f.source, href })).rejects.toThrow();
    }
    await expect(f.library.resolveLink(null)).rejects.toThrow("参数");
    await expect(f.library.resolveLink({ fromPath: f.project, href: "a.csv" })).rejects.toThrow("来源");
    await expect(f.library.list(f.source)).rejects.toThrow("文件夹");
  });
  it("reports symlink escape as an unavailable entry rather than silently omitting it", async () => {
    const f = await fixture();
    await symlink(f.external, join(f.project, "outside"), process.platform === "win32" ? "junction" : "dir");
    const entries = (await f.library.list(f.project)).entries;
    expect(entries.find((entry) => entry.name === "outside")?.error).toContain("只允许访问");
    expect(entries.find((entry) => entry.name === "references")?.inspection?.kind).toBe("directory");
    expect(entries.some((entry) => entry.name === "paper.md")).toBe(false);
  });
  it("resolves report artifact paths only against an explicitly associated package", async () => {
    const f = await fixture(); f.chooser.mockResolvedValue(f.external); await f.library.choose();
    const report = join(f.external, "verification.json"); await writeFile(report, "{}");
    const href = "assets/%E8%A1%A8%20%231.csv";
    await expect(f.library.resolveLink({ fromPath: report, href })).rejects.toThrow();
    expect((await f.library.resolveLink({ fromPath: report, href, artifactRoot: f.project })).inspection.name).toBe("表 #1.csv");
    await expect(f.library.resolveLink({ fromPath: report, href, artifactRoot: f.source })).rejects.toThrow("不是文件夹");
  });
  it("does not inherit a read grant when its directory is replaced by a junction", async () => {
    const f = await fixture(); f.chooser.mockResolvedValue(f.external); await f.library.choose();
    const elsewhere = join(f.root, "not-selected"); await mkdir(elsewhere); await writeFile(join(elsewhere, "private.md"), "not selected");
    await rename(f.external, join(f.root, "previous-evidence"));
    await symlink(elsewhere, f.external, process.platform === "win32" ? "junction" : "dir");
    await expect(f.library.list(f.external)).rejects.toThrow("只允许访问");
    await expect(f.library.resolveLink({ fromPath: f.source, href: join(f.external, "private.md") })).rejects.toThrow("只允许访问");
    // A fresh native choice authorizes the actual new target, not the obsolete grant.
    await f.library.choose(); expect((await f.library.list(f.external)).entries[0]?.name).toBe("private.md");
  });
});
