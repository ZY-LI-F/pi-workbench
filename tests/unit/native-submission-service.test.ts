// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NativeSubmissionService } from "../../src/main/native-submission-service";
import { PiCommandRejectedError } from "../../src/main/pi-rpc-runtime";
import type { NativeSubmissionInput } from "../../src/shared/native-submission";
import type { RuntimeScope } from "../../src/shared/runtime-scope";
import type { PiResponse } from "../../src/shared/contracts";

const INPUT: NativeSubmissionInput = { id: "submit-1", sessionId: "session-1", command: { type: "prompt", message: "真实执行意图" } };
const SCOPE: RuntimeScope = { generation: "generation-1", scope: 0, sequence: 1, cwd: "C:/project", sessionId: "session-1" };
function setup() {
  let saved: unknown;
  let scope: RuntimeScope | undefined = SCOPE;
  const storage = { read: vi.fn(async () => saved), write: vi.fn(async (value: unknown) => { saved = structuredClone(value); }) };
  const send = vi.fn(async (): Promise<PiResponse> => ({ type: "response", command: "prompt", success: true }));
  const deps = { storage, send, scope: () => scope, now: () => "2026-09-12T05:00:00.000Z" };
  return { storage, send, service: new NativeSubmissionService(deps), restart: () => new NativeSubmissionService(deps),
    saved: () => saved, seed: (value: unknown) => { saved = value; }, scope: (value: RuntimeScope | undefined) => { scope = value; } };
}

describe("native submission journal", () => {
  it("commits pending before Pi and accepted after its acknowledgement, without storing content", async () => {
    const env = setup();
    env.send.mockImplementation(async () => {
      expect(env.saved()).toMatchObject({ version: 1, receipts: [{ id: INPUT.id, status: "pending" }] });
      return { type: "response", command: "prompt", success: true };
    });
    const result = await env.service.submit(INPUT);
    expect(result.receipt.status).toBe("accepted");
    expect(env.send).toHaveBeenCalledWith(INPUT.command, SCOPE.cwd, INPUT.id);
    expect(JSON.stringify(env.saved())).not.toContain(INPUT.command.message);
    expect(JSON.stringify(result)).not.toContain("digest");
  });
  it("deduplicates concurrent and restarted IPCs but rejects different content under the same ID", async () => {
    const env = setup();
    const results = await Promise.all([env.service.submit(INPUT), env.service.submit(INPUT)]);
    expect(results[0]).toEqual(results[1]);
    expect((await env.restart().submit(INPUT)).receipt.status).toBe("accepted");
    expect(env.send).toHaveBeenCalledTimes(1);
    await expect(env.service.submit({ ...INPUT, command: { type: "prompt", message: "不同内容" } })).rejects.toThrow("同一提交 ID");
    expect(env.send).toHaveBeenCalledTimes(1);
  });
  it("does not execute anything if writing pending fails", async () => {
    const env = setup(); env.storage.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(env.service.submit(INPUT)).rejects.toThrow("disk full");
    expect(env.send).not.toHaveBeenCalled();
  });
  it("preserves a known acceptance with an explicit durability error, then recovers unknown on restart without replay", async () => {
    const env = setup();
    env.send.mockImplementation(async () => {
      env.storage.write.mockRejectedValueOnce(new Error("receipt write lost"));
      return { type: "response", command: "prompt", success: true };
    });
    const result = await env.service.submit(INPUT);
    expect(result).toMatchObject({ receipt: { status: "accepted" }, persistenceError: expect.stringContaining("未能落盘") });
    const restarted = env.restart();
    expect((await restarted.list("session-1"))[0]?.status).toBe("unknown");
    expect((await restarted.submit(INPUT)).receipt.status).toBe("unknown");
    expect(env.send).toHaveBeenCalledTimes(1);
  });
  it.each(["transport", "rejected"])("distinguishes %s failure without replay", async (kind) => {
    const env = setup();
    env.send.mockRejectedValueOnce(kind === "transport" ? new Error("connection gone") : new PiCommandRejectedError("invalid model"));
    const result = await env.service.submit(INPUT);
    expect(result.receipt.status).toBe(kind === "transport" ? "unknown" : "rejected");
    await env.service.submit(INPUT);
    expect(env.send).toHaveBeenCalledTimes(1);
  });
  it("checks session ownership again after disk I/O", async () => {
    const env = setup();
    env.storage.write.mockImplementationOnce(async () => { env.scope({ ...SCOPE, scope: 2, sessionId: "another" }); });
    expect((await env.service.submit(INPUT)).receipt.status).toBe("rejected");
    expect(env.send).not.toHaveBeenCalled();
  });
  it("preserves unsupported future schema without writing or sending", async () => {
    const env = setup(); env.seed({ version: 999, future: "keep me" });
    await expect(env.service.submit(INPUT)).rejects.toThrow("版本不兼容");
    expect(env.saved()).toEqual({ version: 999, future: "keep me" });
    expect(env.storage.write).not.toHaveBeenCalled(); expect(env.send).not.toHaveBeenCalled();
  });
});
