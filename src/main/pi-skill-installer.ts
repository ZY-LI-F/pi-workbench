import { dirname, join, resolve, sep } from "node:path";
import type { InstalledPiSkill, PiSkillInstallScope } from "../shared/pi-skill";

export interface PiSkillFolderInspection {
  readonly name: string;
  readonly description: string;
}

interface PiSkillPathMetadata {
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface PiSkillInstallerStorage {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<PiSkillPathMetadata>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  copyDirectory(source: string, destination: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  removeDirectory(path: string): Promise<void>;
}

interface PiSkillInstallerDependencies {
  readonly agentDir: string;
  readonly storage: PiSkillInstallerStorage;
  readonly inspectSkillFolder: (path: string) => PiSkillFolderInspection;
  readonly id: () => string;
}

interface InstallPiSkillFolderInput {
  readonly sourceFolder: string;
  readonly scope: PiSkillInstallScope;
  readonly projectPath: string;
  readonly projectTrusted: boolean;
  readonly existingSkillNames: ReadonlySet<string>;
}

const VALID_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function comparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function isInside(candidate: string, root: string): boolean {
  const left = comparablePath(candidate);
  const right = comparablePath(root);
  return left === right || left.startsWith(`${right}${sep}`);
}

function validateSkillInspection(inspection: PiSkillFolderInspection): PiSkillFolderInspection {
  const name = inspection.name.trim();
  const description = inspection.description.trim();
  if (!name) throw new Error("SKILL.md 缺少 name");
  if (name.length > 64 || !VALID_SKILL_NAME.test(name)) {
    throw new Error(`Skill 名称 ${name} 无效；只允许 1–64 位小写字母、数字和单连字符`);
  }
  if (!description) throw new Error(`Skill ${name} 的 SKILL.md 缺少 description`);
  return Object.freeze({ name, description });
}

export class PiSkillInstaller {
  readonly #agentDir: string;
  readonly #storage: PiSkillInstallerStorage;
  readonly #inspectSkillFolder: (path: string) => PiSkillFolderInspection;
  readonly #id: () => string;

  constructor(dependencies: PiSkillInstallerDependencies) {
    this.#agentDir = resolve(dependencies.agentDir);
    this.#storage = dependencies.storage;
    this.#inspectSkillFolder = dependencies.inspectSkillFolder;
    this.#id = dependencies.id;
  }

  async installFolder(input: InstallPiSkillFolderInput): Promise<InstalledPiSkill> {
    if (input.scope === "project" && !input.projectTrusted) {
      throw new Error("当前项目未受信任，Pi 不会加载项目级 Skill；请先信任项目，或改为安装到所有项目");
    }

    const sourceFolder = await this.#storage.realpath(input.sourceFolder);
    const sourceMetadata = await this.#storage.stat(sourceFolder);
    if (!sourceMetadata.isDirectory()) throw new Error("只能添加 Skill 文件夹，不能选择单个文件");

    const skillManifest = join(sourceFolder, "SKILL.md");
    if (!await this.#storage.exists(skillManifest)) {
      throw new Error("所选文件夹根目录缺少 SKILL.md；请选择一个完整的 Skill 文件夹");
    }
    const manifestMetadata = await this.#storage.stat(skillManifest);
    if (!manifestMetadata.isFile()) throw new Error("所选文件夹中的 SKILL.md 不是普通文件");

    const inspection = validateSkillInspection(this.#inspectSkillFolder(sourceFolder));
    if (input.existingSkillNames.has(inspection.name)) {
      throw new Error(`Pi 已加载同名 Skill：${inspection.name}；为避免来源碰撞，本次没有覆盖现有 Skill`);
    }

    const targetRoot = input.scope === "project"
      ? join(resolve(input.projectPath), ".pi", "skills")
      : join(this.#agentDir, "skills");
    const destination = join(targetRoot, inspection.name);
    if (isInside(targetRoot, sourceFolder)) {
      throw new Error("不能把包含目标安装目录的文件夹作为 Skill 导入；请选择具体的 Skill 子文件夹");
    }
    if (await this.#storage.exists(destination)) {
      throw new Error(`目标目录已存在：${destination}；本次没有覆盖任何文件`);
    }

    await this.#storage.mkdir(targetRoot);
    // Keep incomplete imports outside Pi's watched skills directory. On Windows,
    // a watcher reacting to SKILL.md can briefly hold the staging directory and
    // make the final atomic rename fail with EPERM.
    const staging = join(dirname(targetRoot), `.stella-skill-import-${this.#id()}`);
    try {
      await this.#storage.copyDirectory(sourceFolder, staging);
      const copiedInspection = validateSkillInspection(this.#inspectSkillFolder(staging));
      if (copiedInspection.name !== inspection.name || copiedInspection.description !== inspection.description) {
        throw new Error("Skill 复制后的 manifest 与源文件夹不一致，安装已中止");
      }
      await this.#storage.rename(staging, destination);
    } finally {
      await this.#storage.removeDirectory(staging);
    }

    return Object.freeze({
      name: inspection.name,
      description: inspection.description,
      scope: input.scope,
      destination,
    });
  }
}
