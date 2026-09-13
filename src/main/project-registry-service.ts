import type { JsonFileStorage } from "./atomic-json-file";
import { SerialOperationQueue } from "./serial-operation-queue";
import { projectDirectoryName, projectPathKey, sameProjectPath } from "../shared/project-path";
import { parseAddProject, parseProjectRegistry, parseUpdateProject, projectAbsolutePath,
  type ProjectDirectoryStatus, type ProjectRegistry, type ProjectRegistrySnapshot, type RegisteredProject } from "../shared/project-registry";

export interface DiscoveredProject {
  readonly path: string;
  readonly name?: string;
}

export type InspectedProjectDirectory =
  | { readonly state: "available"; readonly canonicalPath: string }
  | { readonly state: "missing" | "unavailable"; readonly detail: string };

interface Dependencies {
  readonly storage: JsonFileStorage;
  readonly discover: () => Promise<{ readonly projects: readonly DiscoveredProject[]; readonly warning?: string }>;
  readonly inspectDirectory: (path: string) => Promise<InspectedProjectDirectory>;
  readonly now: () => string;
  readonly id: () => string;
  readonly emitChanged: () => void;
}

const EMPTY: ProjectRegistry = Object.freeze({ version: 1, revision: 0, projects: Object.freeze([]) });

/** Owns project metadata only. No trust grants, Task mutations or Runtime operations. */
export class ProjectRegistryService {
  readonly #queue = new SerialOperationQueue();
  constructor(readonly dependencies: Dependencies) {}

  initialize(): Promise<ProjectRegistrySnapshot> {
    return this.#queue.run(async () => {
      const { registry, warning } = await this.#reconcile();
      return this.#snapshot(registry, warning);
    });
  }

  add(value: unknown): Promise<ProjectRegistrySnapshot> {
    return this.#queue.run(async () => {
      const input = parseAddProject(value);
      const directory = await this.dependencies.inspectDirectory(input.path);
      if (directory.state !== "available") throw new Error(directory.detail);
      const path = projectAbsolutePath(directory.canonicalPath);
      const { registry, warning } = await this.#reconcile();
      if (registry.projects.some((project) => sameProjectPath(project.path, path))) throw new Error("该目录已经在项目清单中，可搜索目录并查看已归档项目");
      const now = this.dependencies.now();
      const project: RegisteredProject = Object.freeze({ id: this.dependencies.id(), path, name: input.name, description: input.description,
        stage: "planned", pinned: false, archived: false, createdAt: now, updatedAt: now });
      const next = await this.#commit(registry, [...registry.projects, project]);
      return this.#snapshot(next, warning);
    });
  }

  update(value: unknown): Promise<ProjectRegistrySnapshot> {
    return this.#queue.run(async () => {
      const { projectId, ...changes } = parseUpdateProject(value);
      const { registry, warning } = await this.#reconcile();
      const project = registry.projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new Error(`找不到项目：${projectId}`);
      const changed = Object.entries(changes).some(([key, value]) => project[key as keyof typeof changes] !== value);
      if (!changed) return this.#snapshot(registry, warning);
      const updated = Object.freeze({ ...project, ...changes, updatedAt: this.dependencies.now() });
      const next = await this.#commit(registry, registry.projects.map((candidate) => candidate.id === projectId ? updated : candidate));
      return this.#snapshot(next, warning);
    });
  }

  async #reconcile(): Promise<{ registry: ProjectRegistry; warning?: string }> {
    const stored = await this.dependencies.storage.read();
    const registry = stored === undefined ? EMPTY : parseProjectRegistry(stored);
    const discovered = await this.dependencies.discover();
    const identities = new Set(registry.projects.map((project) => projectPathKey(project.path)));
    const projects = [...registry.projects];
    for (const seed of discovered.projects) {
      const path = projectAbsolutePath(seed.path);
      const key = projectPathKey(path);
      if (identities.has(key)) continue;
      identities.add(key);
      const now = this.dependencies.now();
      projects.push(Object.freeze({ id: this.dependencies.id(), path, name: seed.name?.trim() || projectDirectoryName(path), description: "",
        stage: "planned", pinned: false, archived: false, createdAt: now, updatedAt: now }));
    }
    return { registry: projects.length === registry.projects.length ? registry : await this.#commit(registry, projects), warning: discovered.warning };
  }

  async #commit(current: ProjectRegistry, projects: readonly RegisteredProject[]): Promise<ProjectRegistry> {
    const next = parseProjectRegistry({ version: 1, revision: current.revision + 1, projects });
    await this.dependencies.storage.write(next);
    this.dependencies.emitChanged();
    return next;
  }

  async #snapshot(registry: ProjectRegistry, discoveryWarning?: string): Promise<ProjectRegistrySnapshot> {
    const entries = await Promise.all(registry.projects.map(async (project): Promise<readonly [string, ProjectDirectoryStatus]> => {
      const inspected = await this.dependencies.inspectDirectory(project.path);
      const status: ProjectDirectoryStatus = inspected.state === "available"
        ? sameProjectPath(project.path, inspected.canonicalPath)
          ? Object.freeze({ state: "available" })
          : Object.freeze({ state: "moved", detail: `目录的真实位置已变化：${inspected.canonicalPath}。历史项目仍保留原路径。` })
        : inspected;
      return [project.id, status];
    }));
    return Object.freeze({ ...registry, directories: Object.freeze(Object.fromEntries(entries)), checkedAt: this.dependencies.now(), discoveryWarning });
  }
}
