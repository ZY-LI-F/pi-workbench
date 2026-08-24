import { useCallback, useEffect, useRef, useState } from "react";
import type { StellaDesktopApi } from "@shared/contracts";
import {
  externalExecutionScopeKey,
  type ContinueExternalExecutionInput,
  type ContinueExternalExecutionResult,
  type ExternalExecutionCatalogSnapshot,
  type ExternalExecutionScope,
  type ImportExternalExecutionInput,
  type ImportExternalExecutionResult,
} from "@shared/external-execution";

const POLL_INTERVAL_MS = 10_000;

export interface ExternalExecutionsController {
  readonly snapshot?: ExternalExecutionCatalogSnapshot;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error?: string;
  readonly busy: readonly string[];
  refresh(): Promise<ExternalExecutionCatalogSnapshot>;
  importExecution(input: ImportExternalExecutionInput): Promise<ImportExternalExecutionResult>;
  continueExecution(input: ContinueExternalExecutionInput): Promise<ContinueExternalExecutionResult>;
}

export function useExternalExecutions(
  api: StellaDesktopApi,
  scope: ExternalExecutionScope,
  enabled: boolean,
): ExternalExecutionsController {
  const [snapshot, setSnapshot] = useState<ExternalExecutionCatalogSnapshot>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<readonly string[]>(Object.freeze([]));
  const requestSequence = useRef(0);
  const scopeKey = externalExecutionScopeKey(scope);

  const refresh = useCallback(async (): Promise<ExternalExecutionCatalogSnapshot> => {
    const request = ++requestSequence.current;
    setRefreshing(true);
    setError(undefined);
    try {
      const next = await api.externalExecutionsRefresh(scope);
      if (request === requestSequence.current && externalExecutionScopeKey(next.scope) === scopeKey) setSnapshot(next);
      return next;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (request === requestSequence.current) setError(message);
      throw cause;
    } finally {
      if (request === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [api, scope, scopeKey]);

  useEffect(() => {
    requestSequence.current += 1;
    setSnapshot(undefined);
    setError(undefined);
    if (!enabled) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setLoading(true);
    void refresh().catch(() => undefined);
    const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, POLL_INTERVAL_MS);
    return () => {
      requestSequence.current += 1;
      window.clearInterval(timer);
    };
  }, [enabled, refresh, scopeKey]);

  const runBusy = useCallback(async <T,>(key: string, action: () => Promise<T>): Promise<T> => {
    setBusy((current) => Object.freeze([...current, key]));
    setError(undefined);
    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      setBusy((current) => Object.freeze(current.filter((candidate) => candidate !== key)));
    }
  }, []);

  const importExecution = useCallback((input: ImportExternalExecutionInput) => runBusy(
    `import:${input.sourceId}:${input.externalId}`,
    async () => {
      const result = await api.externalExecutionImport(input);
      await refresh();
      return result;
    },
  ), [api, refresh, runBusy]);

  const continueExecution = useCallback((input: ContinueExternalExecutionInput) => runBusy(
    `continue:${input.sourceId}:${input.externalId}`,
    () => api.externalExecutionContinue(input),
  ), [api, runBusy]);

  return Object.freeze({ snapshot, loading, refreshing, error, busy, refresh, importExecution, continueExecution });
}
