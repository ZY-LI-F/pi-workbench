import { projectPathKey } from "./project-path";

export const PROJECT_STAGES = ["planned", "active", "paused", "completed"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];
export const PROJECT_STAGE_LABEL: Readonly<Record<ProjectStage, string>> = Object.freeze({ planned: "待安排", active: "进行中", paused: "暂缓", completed: "已收尾" });

export interface RegisteredProject {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly description: string;
  /** User planning stage; never controls execution, task acceptance or automation. */
  readonly stage: ProjectStage;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectRegistry {
  readonly version: 1;
  readonly revision: number;
  readonly projects: readonly RegisteredProject[];
}

export interface ProjectDirectoryStatus {
  readonly state: "available" | "missing" | "moved" | "unavailable";
  readonly detail?: string;
}

export interface ProjectRegistrySnapshot extends ProjectRegistry {
  readonly directories: Readonly<Record<string, ProjectDirectoryStatus>>;
  readonly checkedAt: string;
  readonly discoveryWarning?: string;
}

export interface AddProjectInput {
  readonly path: string;
  readonly name: string;
  readonly description: string;
}

export interface UpdateProjectInput {
  readonly projectId: string;
  readonly name?: string;
  readonly description?: string;
  readonly stage?: ProjectStage;
  readonly pinned?: boolean;
  readonly archived?: boolean;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}必须是对象`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.includes("\0")) throw new Error(`${label}必须是${empty ? "有效" : "非空"}文本`);
  return value.trim();
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}必须是布尔值`);
  return value;
}

function date(value: unknown, label: string): string {
  const result = text(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label}不是有效时间`);
  return result;
}

function stage(value: unknown): ProjectStage {
  if (!PROJECT_STAGES.includes(value as ProjectStage)) throw new Error("项目阶段无效");
  return value as ProjectStage;
}

export function projectAbsolutePath(value: unknown): string {
  const path = text(value, "项目路径");
  if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\[^\\]+\\[^\\]+)/u.test(path)) throw new Error("项目路径必须是绝对路径");
  return path;
}

export function parseAddProject(value: unknown): AddProjectInput {
  const input = record(value, "添加项目参数");
  return Object.freeze({ path: projectAbsolutePath(input.path), name: text(input.name, "项目名称"), description: text(input.description, "项目说明", true) });
}

export function parseUpdateProject(value: unknown): UpdateProjectInput {
  const input = record(value, "更新项目参数");
  const result: UpdateProjectInput = Object.freeze({
    projectId: text(input.projectId, "项目 ID"),
    ...(input.name !== undefined ? { name: text(input.name, "项目名称") } : {}),
    ...(input.description !== undefined ? { description: text(input.description, "项目说明", true) } : {}),
    ...(input.stage !== undefined ? { stage: stage(input.stage) } : {}),
    ...(input.pinned !== undefined ? { pinned: boolean(input.pinned, "置顶") } : {}),
    ...(input.archived !== undefined ? { archived: boolean(input.archived, "归档") } : {}),
  });
  if (Object.keys(result).length === 1) throw new Error("没有需要更新的项目字段");
  return result;
}

export function parseProjectRegistry(value: unknown): ProjectRegistry {
  const input = record(value, "项目清单");
  if (input.version !== 1) throw new Error(`不支持项目清单版本 ${String(input.version)}，原文件已保留`);
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0) throw new Error("项目清单 revision 无效");
  if (!Array.isArray(input.projects)) throw new Error("项目清单 projects 必须是数组");
  const ids = new Set<string>();
  const paths = new Set<string>();
  const projects = input.projects.map((value) => {
    const item = record(value, "项目记录");
    const project: RegisteredProject = Object.freeze({
      id: text(item.id, "项目 ID"), path: projectAbsolutePath(item.path), name: text(item.name, "项目名称"),
      description: text(item.description, "项目说明", true), pinned: boolean(item.pinned, "置顶"), archived: boolean(item.archived, "归档"),
      stage: stage(item.stage),
      createdAt: date(item.createdAt, "项目创建时间"), updatedAt: date(item.updatedAt, "项目更新时间"),
    });
    const key = projectPathKey(project.path);
    if (ids.has(project.id) || paths.has(key)) throw new Error(`项目清单存在重复项目：${project.path}`);
    ids.add(project.id);
    paths.add(key);
    return project;
  });
  return Object.freeze({ version: 1, revision: input.revision as number, projects: Object.freeze(projects) });
}
