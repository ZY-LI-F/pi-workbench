import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { BridgeEvent, StellaDesktopApi } from "@shared/contracts";
import type {
  ConfigureExecutionBackendInput,
  ExecutionBackendCatalogSnapshot,
  ExecutionBackendId,
} from "@shared/execution-profile";

interface ExecutionBackendUiState {
  readonly snapshot?: ExecutionBackendCatalogSnapshot;
  readonly loading: boolean;
  readonly busy: readonly ExecutionBackendId[];
  readonly error?: string;
}

type Action =
  | { readonly type: "SNAPSHOT"; readonly snapshot: ExecutionBackendCatalogSnapshot }
  | { readonly type: "FAILED"; readonly error: string }
  | { readonly type: "BUSY"; readonly backendId: ExecutionBackendId; readonly active: boolean };

const INITIAL_STATE: ExecutionBackendUiState = Object.freeze({ loading: true, busy: Object.freeze([]) });

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function reducer(state: ExecutionBackendUiState, action: Action): ExecutionBackendUiState {
  if (action.type === "SNAPSHOT") return Object.freeze({ ...state, snapshot: action.snapshot, loading: false, error: undefined });
  if (action.type === "FAILED") return Object.freeze({ ...state, loading: false, error: action.error });
  const busy = action.active
    ? state.busy.includes(action.backendId) ? state.busy : [...state.busy, action.backendId]
    : state.busy.filter((backendId) => backendId !== action.backendId);
  return Object.freeze({ ...state, busy: Object.freeze(busy) });
}

export interface ExecutionBackendController {
  readonly state: ExecutionBackendUiState;
  configure(input: ConfigureExecutionBackendInput): Promise<ExecutionBackendCatalogSnapshot>;
  retry(backendId: ExecutionBackendId): Promise<ExecutionBackendCatalogSnapshot>;
}

export function useExecutionBackends(api: StellaDesktopApi): ExecutionBackendController {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  useEffect(() => {
    let active = true;
    const unsubscribe = api.onEvent((event: BridgeEvent) => {
      if (active && event.source === "execution-backend") dispatch({ type: "SNAPSHOT", snapshot: event.payload });
    });
    void api.executionBackendsInitialize()
      .then((snapshot) => { if (active) dispatch({ type: "SNAPSHOT", snapshot }); })
      .catch((cause: unknown) => { if (active) dispatch({ type: "FAILED", error: errorMessage(cause) }); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  const run = useCallback(async (
    backendId: ExecutionBackendId,
    operation: () => Promise<ExecutionBackendCatalogSnapshot>,
  ) => {
    dispatch({ type: "BUSY", backendId, active: true });
    try {
      const snapshot = await operation();
      dispatch({ type: "SNAPSHOT", snapshot });
      return snapshot;
    } catch (cause) {
      dispatch({ type: "FAILED", error: errorMessage(cause) });
      throw cause;
    } finally {
      dispatch({ type: "BUSY", backendId, active: false });
    }
  }, []);

  const configure = useCallback((input: ConfigureExecutionBackendInput) => (
    run(input.backendId, () => api.executionBackendConfigure(input))
  ), [api, run]);
  const retry = useCallback((backendId: ExecutionBackendId) => (
    run(backendId, () => api.executionBackendRetry(backendId))
  ), [api, run]);

  return useMemo(() => ({ state, configure, retry }), [configure, retry, state]);
}
