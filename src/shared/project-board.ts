import { TASK_STAGES, type BoardState, type KanbanTask, type TaskStage } from "./kanban";
import { deriveBoardTaskAttention, type TeamTaskAttention } from "./team-task-attention";
import { projectPathKey } from "./project-path";
import type { RegisteredProject } from "./project-registry";

export interface ProjectTaskSummary {
  readonly tasks: readonly KanbanTask[];
  readonly stages: Readonly<Record<TaskStage, number>>;
  readonly attention: readonly TeamTaskAttention[];
  readonly completed: number;
  readonly total: number;
  readonly completionPercent?: number;
}

export interface ProjectBoardCard {
  readonly project: RegisteredProject;
  /** Absent means unavailable; it never means an empty project. */
  readonly summary?: ProjectTaskSummary;
  readonly lastActivityAt: string;
}

export interface ProjectBoardFilter {
  readonly query: string;
  readonly archived: boolean;
  readonly activity: "all" | "attention" | "executing";
  readonly sort: "activity" | "name";
}

const PRIORITY = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

export function projectBoardCards(projects: readonly RegisteredProject[], board?: BoardState): readonly ProjectBoardCard[] {
  const attention = board ? deriveBoardTaskAttention(board) : undefined;
  const byPath = new Map<string, KanbanTask[]>();
  for (const task of board?.tasks ?? []) {
    if (!task.projectPath) continue;
    const key = projectPathKey(task.projectPath);
    const tasks = byPath.get(key) ?? [];
    tasks.push(task);
    byPath.set(key, tasks);
  }
  return Object.freeze(projects.map((project) => {
    if (!board) return Object.freeze({ project, lastActivityAt: project.updatedAt });
    const tasks = (byPath.get(projectPathKey(project.path)) ?? []).sort((left, right) =>
      Number(attention?.get(right.id)?.requiresHuman) - Number(attention?.get(left.id)?.requiresHuman)
      || PRIORITY[left.priority] - PRIORITY[right.priority] || Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id));
    const stages = Object.fromEntries(TASK_STAGES.map((stage) => [stage, 0])) as Record<TaskStage, number>;
    const needsAttention: TeamTaskAttention[] = [];
    let lastActivityAt = project.updatedAt;
    for (const task of tasks) {
      stages[task.stage] += 1;
      const item = attention?.get(task.id);
      if (item?.requiresHuman) needsAttention.push(item);
      if (Date.parse(task.updatedAt) > Date.parse(lastActivityAt)) lastActivityAt = task.updatedAt;
    }
    return Object.freeze({ project, lastActivityAt, summary: Object.freeze({ tasks: Object.freeze(tasks), stages: Object.freeze(stages),
      attention: Object.freeze(needsAttention), completed: stages.completed, total: tasks.length,
      completionPercent: tasks.length ? Math.round(stages.completed / tasks.length * 100) : undefined }) });
  }));
}

export function filterProjectBoard(cards: readonly ProjectBoardCard[], filter: ProjectBoardFilter): readonly ProjectBoardCard[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return Object.freeze(cards.filter(({ project, summary }) => project.archived === filter.archived
    && (filter.activity === "all" || (filter.activity === "attention" ? Boolean(summary?.attention.length) : Boolean(summary && summary.stages.running + summary.stages.queued)))
    && (!query || `${project.name} ${project.description} ${project.path} ${summary?.tasks.map((task) => `${task.title} ${task.description} ${task.acceptanceCriteria}`).join(" ") ?? ""}`.toLocaleLowerCase().includes(query)))
    .sort((left, right) => Number(right.project.pinned) - Number(left.project.pinned)
      || (filter.sort === "activity" ? Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt) : 0)
      || left.project.name.localeCompare(right.project.name, "zh-CN") || left.project.id.localeCompare(right.project.id)));
}
