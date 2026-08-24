// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliBackendProbe } from "../../src/main/cli-backend-probe";

const SHIM = fileURLToPath(new URL("../fixtures/cli-process-shim.mjs", import.meta.url));
const now = () => "2026-08-24T00:00:00.000Z";

describe("CliBackendProbe", () => {
  it("probes Codex version and login without starting a model request", async () => {
    const health = await new CliBackendProbe({ now }).probe("codex", {
      backendId: "codex",
      executable: process.execPath,
      prefixArgv: [SHIM, "codex"],
      displayPath: "/fake/codex",
      executableSource: "path",
    });
    expect(health).toEqual({
      backendId: "codex",
      state: "ready",
      version: "9.8.7",
      authState: "ready",
      executableSource: "path",
      executablePath: "/fake/codex",
      error: undefined,
      updatedAt: now(),
    });
  });

  it("keeps an installed but logged-out Claude CLI visible with auth required", async () => {
    const health = await new CliBackendProbe({ now }).probe("claude", {
      backendId: "claude",
      executable: process.execPath,
      prefixArgv: [SHIM, "claude"],
      displayPath: "/fake/claude",
      executableSource: "auto",
    });
    expect(health).toMatchObject({ state: "ready", version: "4.5.6", authState: "required" });
  });

  it("reports resolver failures without attempting a child process", async () => {
    const health = await new CliBackendProbe({ now }).probe("codex", {
      backendId: "codex",
      resolutionError: "codex 不在 PATH 中",
    });
    expect(health).toMatchObject({ state: "unavailable", authState: "unknown", error: "codex 不在 PATH 中" });
  });
});
