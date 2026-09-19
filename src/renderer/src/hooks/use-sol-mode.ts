import { useCallback, useEffect, useRef, useState } from "react";
import type { StellaDesktopApi } from "@shared/contracts";
import type { SolModeConfig, SolModeSnapshot } from "@shared/sol-mode";

export interface SolModeState {
  readonly snapshot?: SolModeSnapshot;
  readonly busy: boolean;
  readonly error?: string;
}

export function useSolMode(api: Pick<StellaDesktopApi, "solModeGet" | "solModeApply" | "onEvent">) {
  const [state, setState] = useState<SolModeState>({ busy: false });
  const active = useRef(true);
  const applying = useRef(false);
  useEffect(() => {
    active.current = true;
    let received = false;
    const unsubscribe = api.onEvent((event) => {
      if (event.source !== "sol") return;
      received = true;
      setState((current) => ({ ...current, snapshot: event.payload }));
    });
    void api.solModeGet().then((snapshot) => {
      if (active.current && !received) setState((current) => ({ ...current, snapshot }));
    }, (cause: unknown) => { if (active.current) setState({ busy: false, error: String(cause) }); });
    return () => { active.current = false; unsubscribe(); };
  }, [api]);
  const apply = useCallback(async (config: SolModeConfig, refresh: () => Promise<unknown>) => {
    if (applying.current) return;
    applying.current = true;
    setState((current) => ({ ...current, busy: true, error: undefined }));
    try {
      const snapshot = await api.solModeApply(config);
      if (active.current) setState({ snapshot, busy: true });
      await refresh();
    } catch (cause) {
      if (active.current) setState((current) => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      applying.current = false;
      if (active.current) setState((current) => ({ ...current, busy: false }));
    }
  }, [api]);
  return { state, apply };
}
