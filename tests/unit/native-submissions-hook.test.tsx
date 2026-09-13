// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeBootstrap, StellaDesktopApi } from "../../src/shared/contracts";
import type { NativeSubmissionInput, NativeSubmissionReceipt, NativeSubmissionResult } from "../../src/shared/native-submission";
import { useNativeSubmissions } from "../../src/renderer/src/hooks/use-native-submissions";

afterEach(cleanup);
const command = { type: "prompt", message: "同一条输入" } as const;
function receipt(input: NativeSubmissionInput, status: NativeSubmissionReceipt["status"]): NativeSubmissionReceipt {
  return { id: input.id, sessionId: input.sessionId, command: input.command.type, status,
    generation: "generation", cwd: "C:/project", createdAt: "2026-09-12T12:00:00.000Z", updatedAt: "2026-09-12T12:00:00.000Z" };
}
function bootstrap(submissions: readonly NativeSubmissionReceipt[] = []): RuntimeBootstrap {
  return { state: { sessionId: "session" }, submissions } as RuntimeBootstrap;
}
function setup(send: (input: NativeSubmissionInput) => Promise<NativeSubmissionResult>, initial = bootstrap()) {
  const submitNativeTurn = vi.fn(send);
  const nativeSubmissions = vi.fn(async (): Promise<readonly NativeSubmissionReceipt[]> => []);
  const notify = vi.fn();
  const api = { submitNativeTurn, nativeSubmissions } as unknown as StellaDesktopApi;
  const hook = renderHook(({ snapshot }) => useNativeSubmissions(api, snapshot, notify), { initialProps: { snapshot: initial } });
  return { ...hook, submitNativeTurn, nativeSubmissions, notify };
}

describe("native submission UI decisions", () => {
  it("allows an explicit retry with a new ID after definitive rejection, even if input is unchanged", async () => {
    const hook = setup(async (input) => ({ receipt: receipt(input, "rejected") }));
    await act(async () => { await expect(hook.result.current.submit(command)).rejects.toThrow("Pi 拒绝"); });
    hook.submitNativeTurn.mockImplementation(async (input) => ({ receipt: receipt(input, "accepted") }));
    await act(async () => { expect(await hook.result.current.submit(command)).toBe(true); });
    const calls = hook.submitNativeTurn.mock.calls;
    expect(calls[0]![0].id).not.toBe(calls[1]![0].id);
    expect(hook.result.current.receipts.map((item) => item.status).sort()).toEqual(["accepted", "rejected"]);
  });

  it("reuses the exact ID after an IPC failure with no observable receipt", async () => {
    const hook = setup(async () => { throw new Error("IPC lost"); });
    await act(async () => { await expect(hook.result.current.submit(command)).rejects.toThrow("IPC lost"); });
    hook.submitNativeTurn.mockImplementation(async (input) => ({ receipt: receipt(input, "accepted") }));
    await act(async () => { await hook.result.current.submit(command); });
    expect(hook.submitNativeTurn.mock.calls[0]![0].id).toBe(hook.submitNativeTurn.mock.calls[1]![0].id);
  });

  it("recovers actual acceptance after a lost IPC response and exposes the interruption", async () => {
    const hook = setup(async () => { throw new Error("IPC lost"); });
    hook.nativeSubmissions.mockImplementation(async () => [receipt(hook.submitNativeTurn.mock.calls[0]![0], "accepted")]);
    await act(async () => { expect(await hook.result.current.submit(command)).toBe(true); });
    expect(hook.notify).toHaveBeenCalledWith(expect.stringContaining("发送响应中断"), "warning");
    expect(hook.submitNativeTurn).toHaveBeenCalledTimes(1);
  });

  it("replaces a local pending observation with an authoritative equal-time completed snapshot", async () => {
    const hook = setup(async () => { throw new Error("IPC lost"); });
    hook.nativeSubmissions.mockImplementation(async () => [receipt(hook.submitNativeTurn.mock.calls[0]![0], "pending")]);
    await act(async () => { await expect(hook.result.current.submit(command)).rejects.toThrow("结果未知"); });
    expect(hook.result.current.receipts[0]!.status).toBe("pending");
    hook.rerender({ snapshot: bootstrap([receipt(hook.submitNativeTurn.mock.calls[0]![0], "accepted")]) });
    expect(hook.result.current.receipts[0]!.status).toBe("accepted");
  });

  it("does not dispatch unknown input without confirmation and cancels cleanly on unmount", async () => {
    const unknown = receipt({ id: "old", sessionId: "session", command }, "unknown");
    const hook = setup(async (input) => ({ receipt: receipt(input, "accepted") }), bootstrap([unknown]));
    let sending!: Promise<boolean>;
    act(() => { sending = hook.result.current.submit(command); });
    await waitFor(() => expect(hook.result.current.confirmation?.receipt.id).toBe("old"));
    expect(hook.submitNativeTurn).not.toHaveBeenCalled();
    hook.unmount();
    expect(await sending).toBe(false);
    expect(hook.submitNativeTurn).not.toHaveBeenCalled();
  });
});
