import { useCallback, useEffect, useRef, useState } from "react";
import type { StellaDesktopApi } from "@shared/contracts";
import type { PiVersionSnapshot } from "@shared/pi-version";

export interface PiVersionState {
  readonly snapshot?: PiVersionSnapshot;
  readonly busy: "checking" | "syncing" | null;
  readonly error?: string;
  readonly result?: string;
}

export function usePiVersion(api: Pick<StellaDesktopApi, "piVersionCheck" | "piVersionSync">) {
  const [state, setState] = useState<PiVersionState>({ busy: "checking" });
  const [dismissed, setDismissed] = useState(false);
  const operation = useRef(0);
  const active = useRef(true);

  const check = useCallback(async () => {
    const id = ++operation.current;
    setState((current) => ({ ...current, busy: "checking", error: undefined, result: undefined }));
    try {
      const snapshot = await api.piVersionCheck();
      if (active.current && id === operation.current) setState({ snapshot, busy: null });
    } catch (cause) {
      if (active.current && id === operation.current) setState((current) => ({ ...current, busy: null, error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }, [api]);

  useEffect(() => { active.current = true; void check(); return () => { active.current = false; }; }, [check]);

  const sync = useCallback(async () => {
    if (state.busy) return;
    const id = ++operation.current;
    setState((current) => ({ ...current, busy: "syncing", error: undefined, result: undefined }));
    try {
      const { outcome, snapshot } = await api.piVersionSync();
      if (!active.current || id !== operation.current) return;
      setState({ snapshot, busy: null, result: outcome === "updated" ? `本机 Pi 已同步到 ${snapshot.bundledVersion}，命令版本校验通过。`
        : outcome === "cancelled" ? "已取消，本机 Pi 未作更改。" : "版本已一致，无需更新。" });
      setDismissed(true);
    } catch (cause) {
      if (!active.current || id !== operation.current) return;
      const error = cause instanceof Error ? cause.message : String(cause);
      // An installer can fail after changing files. Refresh what is actually on disk, retaining the failure.
      try {
        const snapshot = await api.piVersionCheck();
        if (active.current && id === operation.current) setState({ snapshot, busy: null, error });
      } catch (refreshError) {
        if (active.current && id === operation.current) setState((current) => ({ ...current, busy: null, error: `${error}\n重新检查失败：${String(refreshError)}` }));
      }
    }
  }, [api, state.busy]);

  return { state, check, sync, notice: !dismissed && state.snapshot?.status === "mismatch", dismiss: () => setDismissed(true) };
}
