import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

export interface NodeCliInstallation {
  readonly commandPath: string;
  readonly entrypoint: string;
  readonly packageDirectory: string;
  readonly packageName: string;
  readonly version: string;
}

export interface NodeCliDiscoveryOptions {
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string;
  readonly excludedDirectories?: readonly string[];
}

/** Resolve npm-generated shims without executing shell text, including paths with spaces. */
export function windowsNodeEntrypoint(shimPath: string, contents: string, command: "pi" | "npm"): string {
  const entries = [...contents.matchAll(/%~?dp0%?[\\/]([^"'\r\n]+?\.m?js)/gi)]
    .map((match) => match[1]!).filter((entry) => command !== "npm" || /(?:^|[\\/])npm-cli\.js$/i.test(entry));
  if (new Set(entries).size !== 1) throw new Error(`无法唯一识别 ${command} 的 Node 入口：${shimPath}`);
  return resolve(dirname(shimPath), entries[0]!.replaceAll("\\", "/"));
}

export class NodeCliDiscovery {
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly homeDirectory: string;
  readonly #excludedDirectories: readonly string[];

  constructor(options: NodeCliDiscoveryOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.environment = options.environment ?? process.env;
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.#excludedDirectories = options.excludedDirectories ?? [];
  }

  async find(command: "pi" | "npm" | "node", preferredDirectory?: string): Promise<string | undefined> {
    const pathValue = this.environment.PATH ?? this.environment.Path ?? this.environment.path ?? "";
    const commonDirectories = this.platform === "win32"
      ? [this.environment.APPDATA ? join(this.environment.APPDATA, "npm") : "", this.environment.ProgramFiles ? join(this.environment.ProgramFiles, "nodejs") : ""]
      : [join(this.homeDirectory, ".local/bin"), join(this.homeDirectory, ".npm-global/bin"), join(this.homeDirectory, ".volta/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
    const directories = [...new Set([preferredDirectory ?? "", ...pathValue.split(this.platform === "win32" ? ";" : ":"), ...commonDirectories])];
    const names = this.platform === "win32" ? (command === "node" ? ["node.exe"] : [`${command}.exe`, `${command}.cmd`, `${command}.bat`]) : [command];
    for (const directory of directories) {
      // Never discover an executable in the current, potentially untrusted project.
      if (!isAbsolute(directory)) continue;
      if (this.#excludedDirectories.some((excluded) => this.platform === "win32"
        ? resolve(excluded).toLowerCase() === resolve(directory).toLowerCase() : resolve(excluded) === resolve(directory))) continue;
      for (const name of names) {
        const path = join(directory, name);
        try {
          await access(path, this.platform === "win32" ? constants.F_OK : constants.X_OK);
          if ((await stat(path)).isFile()) return path;
        } catch (cause) {
          if (!isAbsent(cause) && (cause as NodeJS.ErrnoException).code !== "EACCES") throw cause;
        }
      }
    }
    return undefined;
  }

  async inspect(command: "pi" | "npm", commandPath: string): Promise<NodeCliInstallation> {
    const extension = extname(commandPath).toLowerCase();
    const entrypoint = await realpath(this.platform === "win32" && [".cmd", ".bat"].includes(extension)
      ? windowsNodeEntrypoint(commandPath, await readFile(commandPath, "utf8"), command) : commandPath);
    const names = command === "pi" ? ["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent", "@badlogic/pi-coding-agent"] : ["npm"];
    for (let directory = dirname(entrypoint); dirname(directory) !== directory; directory = dirname(directory)) {
      let source: string;
      try { source = await readFile(join(directory, "package.json"), "utf8"); }
      catch (cause) { if (isAbsent(cause)) continue; throw cause; }
      const metadata = JSON.parse(source) as { name?: unknown; version?: unknown; bin?: unknown };
      if (typeof metadata.name !== "string" || !names.includes(metadata.name)) continue;
      if (typeof metadata.version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(metadata.version)) {
        throw new Error(`${command} 安装包版本无效：${directory}`);
      }
      const bin = typeof metadata.bin === "string" ? metadata.bin
        : metadata.bin && typeof metadata.bin === "object" ? (metadata.bin as Record<string, unknown>)[command] : undefined;
      if (typeof bin !== "string" || await realpath(resolve(directory, bin)) !== entrypoint) {
        throw new Error(`${command} 启动入口与安装包声明不一致：${commandPath}`);
      }
      return Object.freeze({ commandPath, entrypoint, packageDirectory: directory, packageName: metadata.name, version: metadata.version });
    }
    throw new Error(`无法识别 ${command} 的 npm 安装来源：${commandPath}。二进制或自定义包装脚本请通过原安装方式管理。`);
  }
}

function isAbsent(cause: unknown): boolean {
  return ["ENOENT", "ENOTDIR"].includes((cause as NodeJS.ErrnoException).code ?? "");
}
