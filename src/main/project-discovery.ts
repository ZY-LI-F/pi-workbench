import type { BoardState } from "../shared/kanban";
import type { ProjectMeta, RecentProject } from "../shared/contracts";
import type { DiscoveredProject } from "./project-registry-service";

export function discoverKnownProjects(recent: readonly RecentProject[], board?: BoardState,
  current?: Pick<ProjectMeta, "cwd" | "name" | "requiresSelection">): readonly DiscoveredProject[] {
  return Object.freeze([
    ...(current && !current.requiresSelection ? [{ path: current.cwd, name: current.name }] : []),
    ...recent.map((project) => ({ path: project.path })),
    ...(board?.tasks.flatMap((task) => task.projectPath ? [{ path: task.projectPath, name: task.projectName }] : []) ?? []),
    ...(board?.autopilots.map((autopilot) => ({ path: autopilot.projectPath, name: autopilot.projectName })) ?? []),
    ...(board?.customAgents.map((agent) => ({ path: agent.projectPath })) ?? []),
    ...(board?.squads.flatMap((squad) => squad.projectPath ? [{ path: squad.projectPath }] : []) ?? []),
  ]);
}
