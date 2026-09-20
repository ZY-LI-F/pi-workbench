import { useCallback, useState } from "react";
import { projectPathKey } from "@shared/project-path";

/** Owned by the app shell, so leaving Team does not discard its selected room. */
export function useTeamChannel(projectPath?: string) {
  const [channels, setChannels] = useState<ReadonlyMap<string, string>>(() => new Map());
  const scope = projectPath ? projectPathKey(projectPath) : "all-projects";
  const selectTask = useCallback((taskId?: string) => {
    setChannels((current) => {
      if (current.get(scope) === taskId) return current;
      const next = new Map(current);
      if (taskId) next.set(scope, taskId);
      else next.delete(scope);
      return next;
    });
  }, [scope]);
  return { selectedTaskId: channels.get(scope), selectTask };
}
