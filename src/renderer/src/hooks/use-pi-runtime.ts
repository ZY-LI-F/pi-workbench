import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  BridgeEvent,
  PiCommand,
  PiExtensionResponse,
  PiResponse,
  RuntimeBootstrap,
  StellaDesktopApi,
} from "@shared/contracts";
import type { OpenTaskSessionInput } from "@shared/kanban";
import {
  INITIAL_RUNTIME_STATE,
  runtimeReducer,
  type Notice,
  type RuntimeUiState,
} from "../lib/runtime-state";
import { OrderedEventBatch } from "../lib/ordered-event-batch";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ReportedRuntimeError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause), { cause });
    this.name = "ReportedRuntimeError";
  }
}

export function isReportedRuntimeError(error: unknown): error is ReportedRuntimeError {
  return error instanceof ReportedRuntimeError;
}

export interface PiRuntimeController {
  readonly state: RuntimeUiState;
  command(command: PiCommand, refreshAfter?: boolean): Promise<PiResponse>;
  refresh(): Promise<RuntimeBootstrap>;
  chooseProject(): ReturnType<StellaDesktopApi["chooseProject"]>;
  openProject(path: string, trusted: boolean): Promise<RuntimeBootstrap | null>;
  openTaskSession(input: OpenTaskSessionInput): Promise<RuntimeBootstrap>;
  respondToExtension(response: PiExtensionResponse): Promise<void>;
  expireExtensionRequest(id: string): void;
  consumeEditorInjection(id: string): void;
  notify(message: string, type?: Notice["type"]): void;
  dismissNotice(id: string): void;
}

export function usePiRuntime(api: StellaDesktopApi): PiRuntimeController {
  const [state, dispatch] = useReducer(runtimeReducer, INITIAL_RUNTIME_STATE);
  const settledRefreshPending = useRef(false);
  const settledRefreshRequested = useRef(false);
  const navigationPending = useRef(0);
  const activeRef = useRef(true);
  const liveRevision = useRef(0);
  const bootstrapRequestEpoch = useRef(0);
  const flushEvents = useRef<() => void>(() => undefined);

  const refresh = useCallback(async () => {
    const epoch = ++bootstrapRequestEpoch.current;
    const revision = liveRevision.current;
    const bootstrap = await api.refresh();
    if (activeRef.current && bootstrapRequestEpoch.current === epoch) {
      flushEvents.current();
      dispatch({ type: "BOOTSTRAP", payload: bootstrap, preserveLiveState: liveRevision.current !== revision });
    }
    return bootstrap;
  }, [api]);

  const drainSettledRefresh = useCallback(async () => {
    if (settledRefreshPending.current || navigationPending.current > 0) return;
    settledRefreshPending.current = true;
    try {
      while (activeRef.current && settledRefreshRequested.current && navigationPending.current === 0) {
        settledRefreshRequested.current = false;
        try {
          await refresh();
        } catch (error) {
          if (activeRef.current) dispatch({ type: "SYNC_FAILED", error: errorMessage(error) });
        }
      }
    } finally {
      settledRefreshPending.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    let active = true;
    activeRef.current = true;
    const batch = new OrderedEventBatch<BridgeEvent>((events) => {
      if (!active) return;
      dispatch({ type: "BRIDGE_EVENTS", events });
      if (events.some((event) => event.source === "pi" && event.payload.type === "agent_settled")) {
        settledRefreshRequested.current = true;
        void drainSettledRefresh();
      }
    }, (flush) => {
      // A timer also delivers in hidden windows where requestAnimationFrame is suspended.
      const timer = window.setTimeout(flush, 16);
      return () => window.clearTimeout(timer);
    });
    flushEvents.current = () => batch.flush();
    const unsubscribe = api.onEvent((event: BridgeEvent) => {
      if (!active) return;
      if (event.source === "pi") liveRevision.current += 1;
      batch.push(event);
      if (event.source === "runtime" || (event.source === "pi" && (event.payload.type === "extension_ui_request" || event.payload.type === "agent_settled"))) batch.flush();
    });

    const initializeEpoch = ++bootstrapRequestEpoch.current;
    void api
      .initialize()
      .then((bootstrap) => {
        if (active && bootstrapRequestEpoch.current === initializeEpoch) {
          batch.flush();
          dispatch({ type: "BOOTSTRAP", payload: bootstrap });
        }
      })
      .catch((error: unknown) => {
        if (active && bootstrapRequestEpoch.current === initializeEpoch) dispatch({ type: "INITIALIZE_FAILED", error: errorMessage(error) });
      });

    return () => {
      active = false;
      activeRef.current = false;
      batch.dispose();
      flushEvents.current = () => undefined;
      unsubscribe();
    };
  }, [api, drainSettledRefresh]);

  useEffect(() => {
    document.title = state.windowTitle ? `${state.windowTitle} · Stella` : "Stella · Pi Workbench";
  }, [state.windowTitle]);

  const command = useCallback(
    async (piCommand: PiCommand, refreshAfter = false) => {
      let response: PiResponse;
      try {
        response = await api.command(piCommand);
        // success:false 与传输失败同样记录为可见通知；调用方仍负责处理命令后的本地步骤。
        if (!response.success) throw new Error(response.error);
      } catch (error) {
        const message = errorMessage(error);
        dispatch({ type: "SYNC_FAILED", error: message });
        throw new ReportedRuntimeError(error);
      }

      if (refreshAfter) {
        try {
          await refresh();
        } catch (error) {
          const detail = errorMessage(error);
          const completed = piCommand.type === "prompt" ? "消息已发送" : "命令已执行";
          const message = `${completed}，但状态刷新失败：${detail}`;
          dispatch({ type: "SYNC_WARNING", error: message });
        }
      }
      return response;
    },
    [api, refresh],
  );

  const openProject = useCallback(
    async (path: string, trusted: boolean) => {
      const epoch = ++bootstrapRequestEpoch.current;
      navigationPending.current += 1;
      try {
        const bootstrap = await api.openProject(path, trusted);
        if (!bootstrap) return null;
        if (bootstrapRequestEpoch.current === epoch) {
          flushEvents.current();
          dispatch({ type: "BOOTSTRAP", payload: bootstrap });
        }
        return bootstrap;
      } catch (error) {
        dispatch({ type: "SYNC_FAILED", error: errorMessage(error) });
        throw new ReportedRuntimeError(error);
      } finally {
        navigationPending.current -= 1;
        void drainSettledRefresh();
      }
    },
    [api, drainSettledRefresh],
  );

  const openTaskSession = useCallback(
    async (input: OpenTaskSessionInput) => {
      const epoch = ++bootstrapRequestEpoch.current;
      navigationPending.current += 1;
      try {
        const bootstrap = await api.openTaskSession(input);
        if (bootstrapRequestEpoch.current === epoch) {
          flushEvents.current();
          dispatch({ type: "BOOTSTRAP", payload: bootstrap });
        }
        return bootstrap;
      } catch (error) {
        dispatch({ type: "SYNC_FAILED", error: errorMessage(error) });
        throw new ReportedRuntimeError(error);
      } finally {
        navigationPending.current -= 1;
        void drainSettledRefresh();
      }
    },
    [api, drainSettledRefresh],
  );

  const respondToExtension = useCallback(
    async (response: PiExtensionResponse) => {
      await api.respondToExtension(response);
      dispatch({ type: "EXTENSION_RESOLVED", response });
    },
    [api],
  );

  const notify = useCallback((message: string, type: Notice["type"] = "info") => {
    dispatch({
      type: "NOTICE",
      notice: Object.freeze({ id: crypto.randomUUID(), message, type }),
    });
  }, []);

  const dismissNotice = useCallback((id: string) => dispatch({ type: "DISMISS_NOTICE", id }), []);
  const expireExtensionRequest = useCallback(
    (id: string) => dispatch({ type: "EXTENSION_EXPIRED", id }),
    [],
  );
  const consumeEditorInjection = useCallback((id: string) => dispatch({ type: "EDITOR_INJECTION_APPLIED", id }), []);

  return useMemo(
    () => ({
      state,
      command,
      refresh,
      chooseProject: () => api.chooseProject(),
      openProject,
      openTaskSession,
      respondToExtension,
      expireExtensionRequest,
      consumeEditorInjection,
      notify,
      dismissNotice,
    }),
    [api, command, consumeEditorInjection, dismissNotice, expireExtensionRequest, notify, openProject, openTaskSession, refresh, respondToExtension, state],
  );
}
