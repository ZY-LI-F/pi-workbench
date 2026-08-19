import { UserRound, UsersRound } from "lucide-react";
import type { KanbanTask } from "@shared/kanban";

export type TaskCollaborationScope = "personal" | "team";

export function taskCollaborationScope(
  task: Pick<KanbanTask, "executionTarget">,
  hasTeamExecutionHistory: boolean,
): TaskCollaborationScope {
  return task.executionTarget.kind !== "manual" || hasTeamExecutionHistory ? "team" : "personal";
}

interface TaskCollaborationBadgeProps {
  readonly scope: TaskCollaborationScope;
}

export function TaskCollaborationBadge({ scope }: TaskCollaborationBadgeProps) {
  const team = scope === "team";
  const label = team ? "TEAM" : "个人";
  const description = team
    ? "Team 任务：使用或曾使用 Agent、Squad、Workflow 协作"
    : "个人任务：由你自行推进，尚未使用 Team 协作";

  return (
    <span
      className={`task-scope-badge task-scope-badge--${scope}`}
      aria-label={`任务归属：${label}`}
      title={description}
    >
      {team ? <UsersRound size={10} aria-hidden="true" /> : <UserRound size={10} aria-hidden="true" />}
      {label}
    </span>
  );
}
