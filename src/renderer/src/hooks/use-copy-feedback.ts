import { useCallback, useEffect, useRef, useState } from "react";
import type { StellaDesktopApi } from "@shared/contracts";

export function useCopyFeedback(api: Pick<StellaDesktopApi, "copyText">) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); };
  }, []);
  const copy = useCallback(async (text: string) => {
    clearTimeout(timer.current);
    setCopied(false);
    setCopyError(undefined);
    try {
      await api.copyText(text);
      if (!mounted.current) return;
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch (cause) {
      if (mounted.current) setCopyError(`复制失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [api]);
  return { copied, copyError, copy };
}
