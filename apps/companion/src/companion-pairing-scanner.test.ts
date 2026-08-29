import { describe, expect, it } from "vitest";
import {
  COMPANION_MINIMUM_PROTOCOL_VERSION,
  COMPANION_PROTOCOL_VERSION,
  formatCompanionPairingUri,
} from "../../../src/shared/companion-protocol";
import {
  CompanionPairingScanner,
  type CompanionPairingCodeReader,
} from "./companion-pairing-scanner";

const PAIRING_URI = formatCompanionPairingUri({
  endpoint: "ws://desktop.tailnet.ts.net:43821/companion",
  offerId: "offer-1",
  offerSecret: "secret-1",
  hostId: "host-1",
  protocolVersion: COMPANION_PROTOCOL_VERSION,
  minimumProtocolVersion: COMPANION_MINIMUM_PROTOCOL_VERSION,
});

function reader(result: string | Error): CompanionPairingCodeReader {
  return Object.freeze({
    async scanQrCode() {
      if (result instanceof Error) throw result;
      return result;
    },
  });
}

describe("CompanionPairingScanner", () => {
  it("accepts and trims a valid Stella pairing QR code", async () => {
    const scanner = new CompanionPairingScanner(reader(`  ${PAIRING_URI}\n`));
    await expect(scanner.scan()).resolves.toBe(PAIRING_URI);
  });

  it("rejects a readable QR code that is not a Stella pairing offer", async () => {
    const scanner = new CompanionPairingScanner(reader("https://example.com/not-stella"));
    await expect(scanner.scan()).rejects.toThrow("二维码已读取，但不是有效的 Stella Companion 配对码");
  });

  it("treats native scanner cancellation as a quiet no-op", async () => {
    const cancelled = Object.assign(new Error("Scanning cancelled"), { code: "OS-PLUG-BARC-0006" });
    const scanner = new CompanionPairingScanner(reader(cancelled));
    await expect(scanner.scan()).resolves.toBeUndefined();
  });

  it("turns camera denial into an actionable Android setting message", async () => {
    const denied = Object.assign(new Error("Camera access wasn't provided"), { code: "OS-PLUG-BARC-0007" });
    const scanner = new CompanionPairingScanner(reader(denied));
    await expect(scanner.scan()).rejects.toThrow("Android 系统设置");
  });
});
