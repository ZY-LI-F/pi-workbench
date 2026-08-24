import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RecentProject } from "../shared/contracts";
import type { ConfigurableExecutionBackendId } from "../shared/execution-profile";

export interface PersistedExecutionBackendConfiguration {
  readonly executablePath?: string;
}

export interface PersistedState {
  readonly lastProject?: string;
  readonly recentProjects: readonly RecentProject[];
  readonly executionBackends?: Readonly<Partial<Record<ConfigurableExecutionBackendId, PersistedExecutionBackendConfiguration>>>;
}
const EMPTY_STATE: PersistedState = Object.freeze({ recentProjects: [] });

function isRecentProject(value: unknown): value is RecentProject {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === "string" &&
    typeof record.trusted === "boolean" &&
    typeof record.lastOpened === "string"
  );
}

function parseState(contents: string, path: string): PersistedState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法解析 Stella 状态文件 ${path}: ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Stella 状态文件 ${path} 必须是 JSON 对象`);
  }

  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.recentProjects) || !record.recentProjects.every(isRecentProject)) {
    throw new Error(`Stella 状态文件 ${path} 的 recentProjects 无效`);
  }
  if (record.lastProject !== undefined && typeof record.lastProject !== "string") {
    throw new Error(`Stella 状态文件 ${path} 的 lastProject 无效`);
  }

  let executionBackends: PersistedState["executionBackends"];
  if (record.executionBackends !== undefined) {
    if (typeof record.executionBackends !== "object" || record.executionBackends === null || Array.isArray(record.executionBackends)) {
      throw new Error(`Stella 状态文件 ${path} 的 executionBackends 无效`);
    }
    const configured = record.executionBackends as Record<string, unknown>;
    for (const key of Object.keys(configured)) {
      if (key !== "codex" && key !== "claude") throw new Error(`Stella 状态文件 ${path} 包含未知执行后端 ${key}`);
      const value = configured[key];
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`Stella 状态文件 ${path} 的 executionBackends.${key} 无效`);
      }
      const backend = value as Record<string, unknown>;
      if (backend.executablePath !== undefined && typeof backend.executablePath !== "string") {
        throw new Error(`Stella 状态文件 ${path} 的 executionBackends.${key}.executablePath 无效`);
      }
    }
    executionBackends = Object.freeze({
      codex: configured.codex ? Object.freeze({ ...(configured.codex as PersistedExecutionBackendConfiguration) }) : undefined,
      claude: configured.claude ? Object.freeze({ ...(configured.claude as PersistedExecutionBackendConfiguration) }) : undefined,
    });
  }

  return Object.freeze({
    lastProject: record.lastProject as string | undefined,
    recentProjects: Object.freeze([...record.recentProjects]),
    executionBackends,
  });
}

export class StateStore {
  readonly #path: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async read(): Promise<PersistedState> {
    try {
      return parseState(await readFile(this.#path, "utf8"), this.#path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_STATE;
      throw error;
    }
  }

  mutate(transform: (current: PersistedState) => PersistedState): Promise<PersistedState> {
    const operation = this.#writeQueue.then(async () => {
      const next = transform(await this.read());
      await this.#write(next);
      return next;
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  recordProject(path: string, trusted: boolean): Promise<PersistedState> {
    return this.mutate((current) => {
      const opened: RecentProject = Object.freeze({ path, trusted, lastOpened: new Date().toISOString() });
      const recentProjects = Object.freeze([
        opened,
        ...current.recentProjects.filter((project) => project.path !== path),
      ].slice(0, 12));
      return Object.freeze({ ...current, lastProject: path, recentProjects });
    });
  }

  configureExecutionBackend(
    backendId: ConfigurableExecutionBackendId,
    executablePath?: string,
  ): Promise<PersistedState> {
    const normalizedPath = executablePath?.trim() || undefined;
    return this.mutate((current) => {
      const executionBackends = {
        ...current.executionBackends,
        [backendId]: normalizedPath ? Object.freeze({ executablePath: normalizedPath }) : undefined,
      };
      const hasConfiguration = Boolean(executionBackends.codex || executionBackends.claude);
      return Object.freeze({
        ...current,
        executionBackends: hasConfiguration ? Object.freeze(executionBackends) : undefined,
      });
    });
  }

  async #write(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const tempPath = `${this.#path}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.#path);
  }
}
