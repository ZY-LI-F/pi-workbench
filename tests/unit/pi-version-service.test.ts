// @vitest-environment node
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiVersionService } from "../../src/main/pi-version-service";
import type { CliProcessRequest } from "../../src/main/cli-process";

const prefix = join(process.cwd(), "isolated-test-prefix");
const root = join(prefix, "node_modules");
const packageDirectory = join(root, "@earendil-works", "pi-coding-agent");
const localEntry = join(packageDirectory, "dist", "cli.js");
const npmEntry = join(prefix, "node_modules", "npm", "bin", "npm-cli.js");

function setup(options: { version?: string; confirm?: boolean; missing?: boolean; wrongRoot?: boolean; failedInstall?: boolean; falseSuccess?: boolean; wrongCli?: boolean } = {}) {
  let version = options.version ?? "0.74.2";
  const confirm = vi.fn(async () => options.confirm ?? true);
  const discovery = {
    platform: "win32" as const, environment: { PATH: "initial-path" }, homeDirectory: prefix,
    find: vi.fn(async (command: string) => command === "pi" && options.missing ? undefined : join(prefix, `${command}.cmd`)),
    inspect: vi.fn(async (command: string, commandPath: string) => ({ commandPath,
      entrypoint: command === "pi" ? localEntry : npmEntry,
      packageDirectory: command === "pi" ? packageDirectory : join(root, "npm"),
      packageName: command === "pi" ? "@earendil-works/pi-coding-agent" : "npm", version: command === "pi" ? version : "11.0.0",
    })),
  };
  const run = vi.fn(async (request: CliProcessRequest) => {
    const command = request.argv[0];
    let stdoutTail = command === "prefix" ? prefix : command === "root" ? options.wrongRoot ? join(root, "different") : root : "";
    if (command === "install") {
      if (options.failedInstall) return { exitCode: 1, signal: null, stdoutTail: "", stderrTail: "EACCES: permission denied", stdoutTruncated: false, stderrTruncated: false };
      if (!options.falseSuccess) version = "0.85.1";
    }
    if (command === "--version") stdoutTail = options.wrongCli ? "0.75.0" : version;
    return { exitCode: 0, signal: null, stdoutTail, stderrTail: "", stdoutTruncated: false, stderrTruncated: false };
  });
  const service = new PiVersionService({ guiVersion: "0.7.1", bundledVersion: "0.85.1", discovery, process: { run }, canonicalPath: async (path) => path, confirm });
  const installCalls = () => run.mock.calls.filter(([request]) => request.argv[0] === "install");
  return { service, run, confirm, discovery, installCalls, setVersion: (value: string) => { version = value; } };
}

describe("Pi exact-version synchronization", () => {
  it("compares against the bundled Pi, not the GUI version; checking is read-only", async () => {
    const f = setup();
    expect(await f.service.check()).toMatchObject({ status: "mismatch", bundledVersion: "0.85.1", guiVersion: "0.7.1", localVersion: "0.74.2", canSync: true, installPrefix: prefix });
    expect(f.installCalls()).toHaveLength(0);
    expect(f.confirm).not.toHaveBeenCalled();
  });
  it("does not require global Pi or npm to run the GUI", async () => {
    const f = setup({ missing: true });
    expect(await f.service.check()).toMatchObject({ status: "missing", canSync: false });
    expect(f.run).not.toHaveBeenCalled();
  });
  it("does nothing when versions already match", async () => {
    const f = setup({ version: "0.85.1" });
    expect((await f.service.sync()).outcome).toBe("unchanged");
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });
  it("declining the native confirmation never invokes an installation", async () => {
    const f = setup({ confirm: false });
    expect((await f.service.sync()).outcome).toBe("cancelled");
    expect(f.confirm).toHaveBeenCalledOnce();
    expect(f.installCalls()).toHaveLength(0);
  });
  it.each(["0.74.2", "0.99.0"])("installs the exact GUI core version after confirmation, including from %s", async (version) => {
    const f = setup({ version });
    const result = await f.service.sync();
    expect(result).toMatchObject({ outcome: "updated", snapshot: { status: "matched", localVersion: "0.85.1" } });
    expect(f.confirm).toHaveBeenCalledWith(expect.objectContaining({ localVersion: version, bundledVersion: "0.85.1" }));
    expect(f.installCalls()).toHaveLength(1);
    expect(f.installCalls()[0]?.[0]).toMatchObject({ prefixArgv: [npmEntry], cwd: prefix,
      argv: ["install", "--global", "--prefix", prefix, "@earendil-works/pi-coding-agent@0.85.1", "--no-audit", "--no-fund"] });
    expect(f.run.mock.calls.at(-1)?.[0]).toMatchObject({ prefixArgv: [localEntry], argv: ["--version"] });
  });
  it("refuses to modify another npm prefix", async () => {
    const f = setup({ wrongRoot: true });
    expect(await f.service.check()).toMatchObject({ status: "mismatch", canSync: false, detail: expect.stringContaining("不属于同一安装") });
    await expect(f.service.sync()).rejects.toThrow("不属于同一安装");
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.installCalls()).toHaveLength(0);
  });
  it("rechecks the installation after confirmation", async () => {
    const f = setup();
    f.confirm.mockImplementation(async () => { f.setVersion("0.80.0"); return true; });
    await expect(f.service.sync()).rejects.toThrow("确认期间");
    expect(f.installCalls()).toHaveLength(0);
  });
  it.each([
    [{ failedInstall: true }, "EACCES"],
    [{ falseSuccess: true }, "版本校验未通过"],
    [{ wrongCli: true }, "命令报告版本"],
  ] as const)("does not claim success for install / verification failures: %o", async (options, error) => {
    const f = setup(options);
    await expect(f.service.sync()).rejects.toThrow(error);
    expect(f.installCalls()).toHaveLength(1);
  });
  it("coalesces concurrent updates into a single confirmation and install", async () => {
    const f = setup();
    await Promise.all([f.service.sync(), f.service.sync(), f.service.check()]);
    expect(f.confirm).toHaveBeenCalledOnce();
    expect(f.installCalls()).toHaveLength(1);
  });
  it("surfaces unreadable or unsupported installations without claiming they are absent", async () => {
    const f = setup();
    f.discovery.inspect.mockRejectedValue(new Error("invalid package metadata"));
    expect(await f.service.check()).toMatchObject({ status: "error", canSync: false, detail: "invalid package metadata" });
    expect(f.run).not.toHaveBeenCalled();
  });
});
