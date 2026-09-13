import type { KanbanTask } from "./kanban";

export const UNASSIGNED_PROJECT_NAME = "未归属项目";

/** Execution needs a real binding; an absent project must never become cwd. */
export function requireTaskProject(task: Pick<KanbanTask, "projectPath">): string {
  if (!task.projectPath) throw new Error("任务尚未归属项目，请先绑定工作区再执行");
  return task.projectPath;
}
