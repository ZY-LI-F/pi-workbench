import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { BridgeEvent, StellaDesktopApi } from "@shared/contracts";
import type { CompanionGatewayStatus, CompanionPairingOffer } from "@shared/companion-protocol";

interface CompanionGatewayUiState {
  readonly status?: CompanionGatewayStatus;
  readonly offer?: CompanionPairingOffer;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error?: string;
}

type Action =
  | { readonly type: "STATUS"; readonly status: CompanionGatewayStatus }
  | { readonly type: "OFFER"; readonly offer: CompanionPairingOffer }
  | { readonly type: "BUSY"; readonly active: boolean }
  | { readonly type: "FAILED"; readonly error: string };

const INITIAL_STATE: CompanionGatewayUiState = Object.freeze({ loading: true, busy: false });

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function reducer(state: CompanionGatewayUiState, action: Action): CompanionGatewayUiState {
  if (action.type === "STATUS") return Object.freeze({ ...state, status: action.status, loading: false, error: undefined });
  if (action.type === "OFFER") return Object.freeze({ ...state, offer: action.offer, error: undefined });
  if (action.type === "BUSY") return Object.freeze({ ...state, busy: action.active });
  return Object.freeze({ ...state, loading: false, error: action.error });
}

export interface CompanionGatewayController {
  readonly state: CompanionGatewayUiState;
  refresh(): Promise<CompanionGatewayStatus>;
  createOffer(): Promise<CompanionPairingOffer>;
  revoke(deviceId: string): Promise<CompanionGatewayStatus>;
}

export function useCompanionGateway(api: StellaDesktopApi): CompanionGatewayController {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  useEffect(() => {
    let active = true;
    const unsubscribe = api.onEvent((event: BridgeEvent) => {
      if (active && event.source === "companion") dispatch({ type: "STATUS", status: event.payload.status });
    });
    if (typeof api.companionGatewayStatus !== "function") {
      dispatch({ type: "FAILED", error: "当前 Desktop Bridge 不支持 Android Companion" });
      return () => { active = false; unsubscribe(); };
    }
    void api.companionGatewayStatus()
      .then((status) => { if (active) dispatch({ type: "STATUS", status }); })
      .catch((cause: unknown) => { if (active) dispatch({ type: "FAILED", error: errorMessage(cause) }); });
    return () => { active = false; unsubscribe(); };
  }, [api]);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    dispatch({ type: "BUSY", active: true });
    try {
      return await operation();
    } catch (cause) {
      dispatch({ type: "FAILED", error: errorMessage(cause) });
      throw cause;
    } finally {
      dispatch({ type: "BUSY", active: false });
    }
  }, []);

  const refresh = useCallback(() => run(async () => {
    if (typeof api.companionGatewayStatus !== "function") throw new Error("当前 Desktop Bridge 不支持 Android Companion");
    const status = await api.companionGatewayStatus();
    dispatch({ type: "STATUS", status });
    return status;
  }), [api, run]);

  const createOffer = useCallback(() => run(async () => {
    if (typeof api.companionCreatePairingOffer !== "function") throw new Error("当前 Desktop Bridge 不支持生成 Companion 配对码");
    const offer = await api.companionCreatePairingOffer();
    dispatch({ type: "OFFER", offer });
    return offer;
  }), [api, run]);

  const revoke = useCallback((deviceId: string) => run(async () => {
    if (typeof api.companionRevokeDevice !== "function") throw new Error("当前 Desktop Bridge 不支持撤销 Companion 设备");
    const status = await api.companionRevokeDevice(deviceId);
    dispatch({ type: "STATUS", status });
    return status;
  }), [api, run]);

  return useMemo(() => ({ state, refresh, createOffer, revoke }), [createOffer, refresh, revoke, state]);
}
