import { useCallback, useEffect, useRef, useState } from "react";
import type { StellaDesktopApi } from "@shared/contracts";
import type { AddProjectInput, ProjectRegistrySnapshot, UpdateProjectInput } from "@shared/project-registry";
import { projectPathKey } from "@shared/project-path";

export function useProjectRegistry(api: StellaDesktopApi, currentPath?: string) {
  const [snapshot, setSnapshot] = useState<ProjectRegistrySnapshot>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const generation = useRef(0);
  const mounted = useRef(false);
  const knownPaths = useRef(new Set<string>());

  const apply = useCallback((value: ProjectRegistrySnapshot) => {
    knownPaths.current = new Set(value.projects.map((project) => projectPathKey(project.path)));
    setSnapshot(value);
    setError(undefined);
  }, []);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const next = await api.projectsInitialize();
      if (mounted.current && request === generation.current) apply(next);
    } catch (cause) {
      if (mounted.current && request === generation.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, [api, apply]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  useEffect(() => { void refresh(); }, [currentPath, refresh]);

  useEffect(() => api.onEvent((event) => {
    if (event.source === "project" || (event.source === "capability" && event.payload.snapshot.task.state === "ready")) void refresh();
    if (event.source === "board" && event.payload.type === "snapshot") {
      const board = event.payload.bootstrap.board;
      const paths = [...board.tasks, ...board.autopilots, ...board.customAgents, ...board.squads].flatMap((item) => item.projectPath ? [item.projectPath] : []);
      if (paths.some((path) => !knownPaths.current.has(projectPathKey(path)))) void refresh();
    }
  }), [api, refresh]);

  const perform = useCallback(async (operation: () => Promise<ProjectRegistrySnapshot>) => {
    const request = ++generation.current;
    setPending((count) => count + 1);
    try {
      const next = await operation();
      if (mounted.current && request === generation.current) { apply(next); setLoading(false); }
      return next;
    } catch (cause) {
      if (mounted.current) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); }
      throw cause;
    } finally { if (mounted.current) setPending((count) => count - 1); }
  }, [apply]);

  const add = useCallback((input: AddProjectInput) => perform(() => api.projectsAdd(input)), [api, perform]);
  const update = useCallback((input: UpdateProjectInput) => perform(() => api.projectsUpdate(input)), [api, perform]);
  return { snapshot, error, loading, busy: pending > 0, refresh, add, update };
}

export type ProjectRegistryController = ReturnType<typeof useProjectRegistry>;
