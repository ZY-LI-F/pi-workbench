import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeBootstrap, StellaDesktopApi } from "@shared/contracts";
import type { NativeSubmissionInput, NativeSubmissionReceipt, NativeTurnCommand } from "@shared/native-submission";

interface Confirmation { readonly receipt: NativeSubmissionReceipt; readonly resolve: (confirmed: boolean) => void }

export function useNativeSubmissions(
  api: StellaDesktopApi, bootstrap: RuntimeBootstrap | undefined,
  notify: (message: string, type?: "info" | "warning" | "error" | "success") => void,
) {
  const [localReceipts, setLocalReceipts] = useState<readonly NativeSubmissionReceipt[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const confirmationRef = useRef<Confirmation | undefined>(undefined);
  const acknowledged = useRef(new Set<string>());
  const attempts = useRef(new Map<string, { readonly fingerprint: string; readonly input: NativeSubmissionInput }>());
  useEffect(() => () => { confirmationRef.current?.resolve(false); }, []);
  const latest = new Map<string, NativeSubmissionReceipt>();
  // A delayed IPC recovery may have observed pending. Do not let that local
  // observation shadow a newer Main snapshot (or its authoritative equal-time result).
  for (const receipt of [...localReceipts, ...(bootstrap?.submissions ?? [])]) {
    if (receipt.sessionId !== bootstrap?.state.sessionId) continue;
    const previous = latest.get(receipt.id);
    if (!previous || receipt.updatedAt >= previous.updatedAt) latest.set(receipt.id, receipt);
  }
  const receipts = [...latest.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const confirm = useCallback((value: boolean) => {
    const request = confirmationRef.current;
    confirmationRef.current = undefined;
    setConfirmation(undefined);
    if (value && request) acknowledged.current.add(request.receipt.id);
    request?.resolve(value);
  }, []);

  const submit = async (command: NativeTurnCommand): Promise<boolean> => {
    if (!bootstrap) throw new Error("会话尚未加载，消息未发送");
    const sessionId = bootstrap.state.sessionId;
    const previous = receipts.find((receipt) => (receipt.status === "unknown" || receipt.status === "pending") && !acknowledged.current.has(receipt.id));
    if (previous) {
      const confirmed = await new Promise<boolean>((resolve) => {
        const request = { receipt: previous, resolve };
        confirmationRef.current = request;
        setConfirmation(request);
      });
      if (!confirmed) return false;
      // This is an explicit new submission, never an implicit retry of the uncertain one.
      attempts.current.delete(sessionId);
    }
    const fingerprint = JSON.stringify(command);
    const old = attempts.current.get(sessionId);
    const input: NativeSubmissionInput = old?.fingerprint === fingerprint ? old.input
      : { id: crypto.randomUUID(), sessionId, command };
    attempts.current.set(sessionId, { fingerprint, input });
    let result;
    try { result = await api.submitNativeTurn(input); }
    catch (cause) {
      // A broken IPC response is not proof that the operation was rejected.
      const receipt = (await api.nativeSubmissions(sessionId)).find((item) => item.id === input.id);
      if (!receipt) throw cause;
      result = { receipt };
      notify(`发送响应中断，已从本机回执恢复状态：${receipt.status}。提交 ID：${input.id}`, "warning");
    }
    setLocalReceipts((current) => [...current.filter((receipt) => receipt.id !== result.receipt.id), result.receipt]);
    if (result.persistenceError) notify(result.persistenceError, "error");
    // A definitive rejection is safe to try again when the user explicitly
    // presses Send after correcting the cause. Unknown transport results keep their ID.
    if (result.receipt.status === "rejected") attempts.current.delete(sessionId);
    if (result.receipt.status !== "accepted") {
      throw new Error(result.receipt.status === "rejected"
        ? `Pi 拒绝了这次输入：${result.receipt.error ?? "未提供原因"}`
        : `发送结果未知；不会自动重发。请核对会话和提交回执 ${input.id}。${result.receipt.error ?? ""}`);
    }
    attempts.current.delete(sessionId);
    return true;
  };
  return { submit, receipts, confirmation, confirm };
}
