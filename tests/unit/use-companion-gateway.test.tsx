import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, StellaDesktopApi } from "../../src/shared/contracts";
import type { CompanionGatewayStatus, CompanionPairingOffer } from "../../src/shared/companion-protocol";
import { useCompanionGateway } from "../../src/renderer/src/hooks/use-companion-gateway";

const STATUS: CompanionGatewayStatus = Object.freeze({
  state: "listening",
  host: Object.freeze({ id: "host-1", name: "Studio Mac", version: "0.5.0" }),
  port: 43_821,
  connectionUrls: Object.freeze(["ws://127.0.0.1:43821/companion"]),
  devices: Object.freeze([]),
});

const OFFER: CompanionPairingOffer = Object.freeze({
  id: "offer-1",
  host: STATUS.host,
  pairingUri: "stella://pair?offerId=offer-1",
  connectionUrls: STATUS.connectionUrls,
  expiresAt: "2026-08-28T10:05:00.000Z",
});

afterEach(() => cleanup());

function Harness({ api }: { readonly api: StellaDesktopApi }) {
  const companion = useCompanionGateway(api);
  return <div>
    <span>{companion.state.status?.state ?? "loading"}</span>
    <span>{companion.state.offer?.id ?? "no-offer"}</span>
    <button type="button" onClick={() => void companion.createOffer()}>offer</button>
    <button type="button" onClick={() => void companion.revoke("device-1")}>revoke</button>
  </div>;
}

describe("useCompanionGateway", () => {
  it("initializes, consumes live status, creates offers, and revokes devices", async () => {
    let listener: ((event: BridgeEvent) => void) | undefined;
    const revoked: CompanionGatewayStatus = Object.freeze({ ...STATUS, devices: Object.freeze([Object.freeze({
      id: "device-1", name: "Pixel", createdAt: "2026-08-28T10:00:00.000Z", revokedAt: "2026-08-28T10:01:00.000Z", connected: false,
    })]) });
    const api = {
      companionGatewayStatus: vi.fn(async () => STATUS),
      companionCreatePairingOffer: vi.fn(async () => OFFER),
      companionRevokeDevice: vi.fn(async () => revoked),
      onEvent: vi.fn((next: (event: BridgeEvent) => void) => { listener = next; return () => undefined; }),
    } as unknown as StellaDesktopApi;
    const user = userEvent.setup();
    render(<Harness api={api} />);
    expect(await screen.findByText("listening")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "offer" }));
    expect(await screen.findByText("offer-1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "revoke" }));
    await waitFor(() => expect(api.companionRevokeDevice).toHaveBeenCalledWith("device-1"));

    listener?.({ source: "companion", payload: { type: "gateway-status", status: STATUS } });
    expect(screen.getByText("listening")).toBeTruthy();
  });
});
