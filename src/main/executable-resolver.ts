import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { ConfigurableExecutionBackendId } from "../shared/execution-profile";
import type { ExecutionBackendConfiguration } from "./execution-backend";

interface ExecutableResolverOptions {
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly canExecute?: (path: string) => Promise<void>;
  readonly readText?: (path: string) => Promise<string>;
  readonly homeDirectory?: string;
  readonly extraSearchDirectories?: readonly string[];
}

const COMMAND_NAMES: Readonly<Record<ConfigurableExecutionBackendId, string>> = Object.freeze({
  codex: "codex",
  claude: "claude",
});

function candidateNames(command: string, platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): readonly string[] {
  if (platform !== "win32") return Object.freeze([command]);
  const extensions = (environment.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean);
  return Object.freeze(extensions.map((extension) => `${command}${extension.toLocaleLowerCase("en-US")}`));
}

function executableError(backendId: ConfigurableExecutionBackendId, cause?: unknown): Error {
  const label = backendId === "codex" ? "Codex CLI" : "Claude CLI";
  const detail = cause instanceof Error ? `：${cause.message}` : "";
  return new Error(`未找到可执行的 ${label}${detail}`);
}

export class ExecutableResolver {
  readonly #platform: NodeJS.Platform;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #canExecute: (path: string) => Promise<void>;
  readonly #readText: (path: string) => Promise<string>;
  readonly #homeDirectory: string;
  readonly #extraSearchDirectories: readonly string[];

  constructor(options: ExecutableResolverOptions = {}) {
    this.#platform = options.platform ?? process.platform;
    this.#environment = options.environment ?? process.env;
    this.#canExecute = options.canExecute ?? (async (path) => access(path, this.#platform === "win32" ? constants.F_OK : constants.X_OK));
    this.#readText = options.readText ?? ((path) => readFile(path, "utf8"));
    this.#homeDirectory = options.homeDirectory ?? homedir();
    this.#extraSearchDirectories = Object.freeze([...(options.extraSearchDirectories ?? [])]);
  }

  async resolve(
    backendId: ConfigurableExecutionBackendId,
    configuredPath?: string,
  ): Promise<ExecutionBackendConfiguration> {
    const requested = configuredPath?.trim();
    let displayPath: string;
    let source: "path" | "auto";
    if (requested) {
      if (!isAbsolute(requested)) throw new Error(`${backendId} executablePath 必须是绝对路径`);
      displayPath = resolve(requested);
      source = "path";
      try {
        await this.#canExecute(displayPath);
      } catch (cause) {
        throw executableError(backendId, cause);
      }
    } else {
      displayPath = await this.#findOnPath(COMMAND_NAMES[backendId], backendId).catch((cause) => { throw executableError(backendId, cause); });
      source = "auto";
    }

    const extension = extname(displayPath).toLocaleLowerCase("en-US");
    if (this.#platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
      const parsed = await this.#resolveWindowsNodeShim(displayPath);
      return Object.freeze({
        backendId,
        executable: parsed.nodeExecutable,
        prefixArgv: Object.freeze([parsed.entrypoint]),
        displayPath,
        executableSource: source,
      });
    }
    return Object.freeze({ backendId, executable: displayPath, displayPath, executableSource: source });
  }

  async #findOnPath(command: string, backendId?: ConfigurableExecutionBackendId): Promise<string> {
    const searchPath = this.#environment.PATH ?? this.#environment.Path ?? this.#environment.path ?? "";
    const pathDirectories = searchPath.split(this.#platform === "win32" ? ";" : ":").filter((path) => path.trim().length > 0);
    const commonDirectories = this.#platform === "win32"
      ? [this.#environment.APPDATA ? join(this.#environment.APPDATA, "npm") : undefined]
      : [
          join(this.#homeDirectory, ".local", "bin"),
          join(this.#homeDirectory, ".npm-global", "bin"),
          join(this.#homeDirectory, ".volta", "bin"),
          "/opt/homebrew/bin",
          "/usr/local/bin",
        ];
    const directories = [...new Set([...pathDirectories, ...this.#extraSearchDirectories, ...commonDirectories.filter((path): path is string => Boolean(path))])];
    if (backendId === "codex" && this.#platform === "darwin") {
      directories.push("/Applications/ChatGPT.app/Contents/Resources");
    }
    for (const directory of directories) {
      for (const name of candidateNames(command, this.#platform, this.#environment)) {
        const candidate = resolve(directory, name);
        try {
          await this.#canExecute(candidate);
          return candidate;
        } catch {
          // Try the next PATH entry.
        }
      }
    }
    throw new Error(`${command} 不在 PATH 中`);
  }

  async #resolveWindowsNodeShim(path: string): Promise<{ readonly nodeExecutable: string; readonly entrypoint: string }> {
    const contents = await this.#readText(path);
    const entryMatch = contents.match(/%~?dp0%?[\\/]([^"'\r\n]+?\.m?js)/i)
      ?? contents.match(/["']([^"']+?\.m?js)["']/i);
    if (!entryMatch?.[1]) throw new Error(`无法从 Windows CLI shim 解析 Node entrypoint: ${path}`);
    const relativeEntry = entryMatch[1].replaceAll("\\", "/");
    const entrypoint = isAbsolute(relativeEntry) ? relativeEntry : resolve(dirname(path), relativeEntry);
    await this.#canExecute(entrypoint).catch((cause) => { throw new Error(`CLI entrypoint 不可访问：${cause instanceof Error ? cause.message : String(cause)}`); });

    const siblingNode = join(dirname(path), "node.exe");
    try {
      await this.#canExecute(siblingNode);
      return Object.freeze({ nodeExecutable: siblingNode, entrypoint });
    } catch {
      const nodeExecutable = await this.#findOnPath("node").catch((cause) => {
        throw new Error(`Windows CLI shim 需要 node.exe：${cause instanceof Error ? cause.message : String(cause)}`);
      });
      return Object.freeze({ nodeExecutable, entrypoint });
    }
  }
}

export function unresolvedExecutionBackendConfiguration(
  backendId: ConfigurableExecutionBackendId,
  cause: unknown,
): ExecutionBackendConfiguration {
  return Object.freeze({
    backendId,
    resolutionError: cause instanceof Error ? cause.message : String(cause),
  });
}
