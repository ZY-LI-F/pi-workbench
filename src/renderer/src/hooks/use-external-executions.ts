import { useCallback, useEffect, useRef, useState } from "react";
import type { StellaDesktopApi } from "@shared/contracts";
import {
  externalExecutionScopeKey,
  type ContinueExternalExecutionInput,
  type ContinueExternalExecutionResult,
  type ExternalExecutionCatalogSnapshot,
  type ExternalExecutionDetails,
  type ExternalExecutionScope,
  type ImportExternalExecutionInput,
  type ImportExternalExecutionResult,
  type ReadExternalExecutionDetailsInput,
} from "@shared/external-execution";

const POLL_INTERVAL_MS = 10_000;

export interface ExternalExecutionsController {
  readonly snapshot?: ExternalExecutionCatalogSnapshot;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error?: string;
  readonly busy: readonly string[];
  readonly details: Readonly<Record<string, ExternalExecutionDetails>>;
  refresh(): Promise<ExternalExecutionCatalogSnapshot>;
  importExecution(input: ImportExternalExecutionInput): Promise<ImportExternalExecutionResult>;
  continueExecution(input: ContinueExternalExecutionInput): Promise<ContinueExternalExecutionResult>;
  loadDetails(input: ReadExternalExecutionDetailsInput): Promise<ExternalExecutionDetails>;
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
  const [details, setDetails] = useState<Readonly<Record<string, ExternalExecutionDetails>>>(Object.freeze({}));
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
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
    const updateVisibility = () => setDocumentVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    requestSequence.current += 1;
    setSnapshot(undefined);
    setDetails(Object.freeze({}));
    setError(undefined);
  }, [scopeKey]);

  useEffect(() => {
    requestSequence.current += 1;
    if (!enabled || !documentVisible) {
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
  }, [documentVisible, enabled, refresh, scopeKey]);

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

  const loadDetails = useCallback((input: ReadExternalExecutionDetailsInput) => runBusy(
    `details:${input.sourceId}:${input.externalId}`,
    async () => {
      const result = await api.externalExecutionDetails(input);
      setDetails((current) => Object.freeze({ ...current, [`${input.sourceId}:${input.externalId}`]: result }));
      return result;
    },
  ), [api, runBusy]);

  return Object.freeze({ snapshot, loading, refreshing, error, busy, details, refresh, importExecution, continueExecution, loadDetails });
}
