// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiSkillInstaller, type PiSkillInstallerStorage } from "../../src/main/pi-skill-installer";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "stella-pi-skill-"));
  temporaryRoots.push(root);
  return root;
}

const storage: PiSkillInstallerStorage = Object.freeze({
  realpath,
  stat,
  exists: async (path) => {
    try {
      await stat(path);
      return true;
    } catch (cause) {
      if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") return false;
      throw cause;
    }
  },
  mkdir: async (path) => { await mkdir(path, { recursive: true }); },
  copyDirectory: async (source, destination) => { await cp(source, destination, { recursive: true }); },
  rename,
  removeDirectory: async (path) => { await rm(path, { recursive: true, force: true }); },
});

function installer(agentDir: string, inspectSkillFolder = () => ({ name: "target-evidence", description: "Evaluate target evidence" })) {
  return new PiSkillInstaller({ agentDir, storage, inspectSkillFolder, id: () => "test-import" });
}

describe("PiSkillInstaller", () => {
  it("copies a validated Skill folder atomically into the project scope", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source-skill");
    const project = join(root, "project");
    await mkdir(source, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "---\nname: target-evidence\ndescription: Evaluate target evidence\n---\n", "utf8");
    await mkdir(join(source, "scripts"));
    await writeFile(join(source, "scripts", "score.js"), "export {};\n", "utf8");

    const result = await installer(join(root, "agent")).installFolder({
      sourceFolder: source,
      scope: "project",
      projectPath: project,
      projectTrusted: true,
      existingSkillNames: new Set(),
    });

    expect(result.name).toBe("target-evidence");
    expect(result.destination).toBe(join(project, ".pi", "skills", "target-evidence"));
    expect(await readFile(join(result.destination, "SKILL.md"), "utf8")).toContain("Evaluate target evidence");
    expect(await readdir(join(project, ".pi", "skills"))).toEqual(["target-evidence"]);
  });

  it("rejects files, missing manifests, untrusted project installs, and loaded name collisions", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source-skill");
    const project = join(root, "project");
    const singleFile = join(root, "single.md");
    await mkdir(source, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(singleFile, "not a folder", "utf8");
    const service = installer(join(root, "agent"));

    await expect(service.installFolder({ sourceFolder: singleFile, scope: "user", projectPath: project, projectTrusted: true, existingSkillNames: new Set() }))
      .rejects.toThrow("只能添加 Skill 文件夹");
    await expect(service.installFolder({ sourceFolder: source, scope: "user", projectPath: project, projectTrusted: true, existingSkillNames: new Set() }))
      .rejects.toThrow("根目录缺少 SKILL.md");

    await writeFile(join(source, "SKILL.md"), "manifest", "utf8");
    await expect(service.installFolder({ sourceFolder: source, scope: "project", projectPath: project, projectTrusted: false, existingSkillNames: new Set() }))
      .rejects.toThrow("当前项目未受信任");
    await expect(service.installFolder({ sourceFolder: source, scope: "user", projectPath: project, projectTrusted: true, existingSkillNames: new Set(["target-evidence"]) }))
      .rejects.toThrow("Pi 已加载同名 Skill");
  });

  it("removes staging files when copied manifest verification fails", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source-skill");
    const project = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(source, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "manifest", "utf8");
    let inspections = 0;
    const service = installer(agentDir, () => {
      inspections += 1;
      return inspections === 1
        ? { name: "target-evidence", description: "Evaluate target evidence" }
        : { name: "changed-after-copy", description: "Unexpected" };
    });

    await expect(service.installFolder({ sourceFolder: source, scope: "user", projectPath: project, projectTrusted: true, existingSkillNames: new Set() }))
      .rejects.toThrow("复制后的 manifest 与源文件夹不一致");
    expect(await readdir(join(agentDir, "skills"))).toEqual([]);
    expect(await readdir(agentDir)).toEqual(["skills"]);
  });
});
