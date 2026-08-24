import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, StellaDesktopApi } from "../../src/shared/contracts";
import type { ExecutionBackendCatalogSnapshot } from "../../src/shared/execution-profile";
import { useExecutionBackends } from "../../src/renderer/src/hooks/use-execution-backends";

const INITIAL: ExecutionBackendCatalogSnapshot = Object.freeze({
  health: Object.freeze([{ backendId: "codex", state: "ready", authState: "ready", version: "1.0.0", updatedAt: "2026-08-24T00:00:00.000Z" }]),
  profiles: Object.freeze([]),
});
const UPDATED: ExecutionBackendCatalogSnapshot = Object.freeze({
  health: Object.freeze([{ backendId: "codex", state: "ready", authState: "ready", version: "2.0.0", updatedAt: "2026-08-24T00:01:00.000Z" }]),
  profiles: Object.freeze([]),
});

afterEach(() => cleanup());

function Harness({ api }: { readonly api: StellaDesktopApi }) {
  const controller = useExecutionBackends(api);
  const codex = controller.state.snapshot?.health.find((item) => item.backendId === "codex");
  return <div>
    <span>{codex?.version ?? "loading"}</span>
    <span>{controller.state.error ?? "ok"}</span>
    <button type="button" onClick={() => void controller.retry("codex")}>retry</button>
    <button type="button" onClick={() => void controller.configure({ backendId: "codex", executablePath: "/codex" }).catch(() => undefined)}>configure</button>
  </div>;
}

describe("useExecutionBackends", () => {
  it("initializes, consumes backend events, and runs targeted retries", async () => {
    let listener: ((event: BridgeEvent) => void) | undefined;
    const retry = vi.fn(async () => UPDATED);
    const api = {
      executionBackendsInitialize: vi.fn(async () => INITIAL),
      executionBackendRetry: retry,
      executionBackendConfigure: vi.fn(async () => UPDATED),
      onEvent: vi.fn((next: (event: BridgeEvent) => void) => { listener = next; return () => undefined; }),
    } as unknown as StellaDesktopApi;
    const user = userEvent.setup();
    render(<Harness api={api} />);
    expect(await screen.findByText("1.0.0")).toBeTruthy();

    listener?.({ source: "execution-backend", payload: UPDATED });
    expect(await screen.findByText("2.0.0")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith("codex"));
  });

  it("preserves the last good snapshot when candidate configuration fails", async () => {
    const api = {
      executionBackendsInitialize: vi.fn(async () => INITIAL),
      executionBackendRetry: vi.fn(async () => INITIAL),
      executionBackendConfigure: vi.fn(async () => { throw new Error("候选 CLI 无效"); }),
      onEvent: vi.fn(() => () => undefined),
    } as unknown as StellaDesktopApi;
    const user = userEvent.setup();
    render(<Harness api={api} />);
    expect(await screen.findByText("1.0.0")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "configure" }));
    expect(await screen.findByText("候选 CLI 无效")).toBeTruthy();
    expect(screen.getByText("1.0.0")).toBeTruthy();
  });
});
