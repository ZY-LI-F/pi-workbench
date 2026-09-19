// @vitest-environment node
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeCliDiscovery, windowsNodeEntrypoint } from "../../src/main/node-cli-discovery";

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture(command: "pi" | "npm", platform: "win32" | "darwin") {
  const dir = await mkdtemp(join(tmpdir(), "stella-cli-discovery-")); directories.push(dir);
  const packageName = command === "pi" ? "@earendil-works/pi-coding-agent" : "npm";
  const root = join(dir, "node_modules", packageName);
  await mkdir(join(root, "bin"), { recursive: true });
  const entry = join(root, "bin", `${command === "npm" ? "npm-cli" : "pi"}.js`);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: packageName, version: "0.85.1", bin: { [command]: `bin/${command === "npm" ? "npm-cli" : "pi"}.js` } }));
  await writeFile(entry, "#!/usr/bin/env node\n"); await chmod(entry, 0o755);
  const commandPath = join(dir, `${command}${platform === "win32" ? ".cmd" : ""}`);
  if (platform === "win32") await writeFile(commandPath, `"%dp0%\\node_modules\\${packageName.replaceAll("/", "\\")}\\bin\\${command === "npm" ? "npm-cli" : "pi"}.js" %*`);
  else await symlink(entry, commandPath);
  return { dir, root, entry, commandPath, discovery: new NodeCliDiscovery({ platform, environment: { PATH: dir }, homeDirectory: dir }) };
}
describe("Node CLI discovery", () => {
  it("selects npm-cli, not npm-prefix, from npm's Windows shim", () => {
    const dir = join(tmpdir(), "node with spaces");
    expect(windowsNodeEntrypoint(join(dir, "npm.cmd"), 'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"\nSET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"', "npm"))
      .toBe(join(dir, "node_modules", "npm", "bin", "npm-cli.js"));
  });
  it("refuses ambiguous shims instead of running arbitrary wrapper shell text", () => {
    expect(() => windowsNodeEntrypoint("pi.cmd", '"%dp0%/one.js" "%dp0%/two.js"', "pi")).toThrow("无法唯一识别");
  });
  it.each(["pi", "npm"] as const)("discovers a custom Windows %s installation", async (command) => {
    const f = await fixture(command, "win32");
    expect(await f.discovery.find(command)).toBe(f.commandPath);
    expect(await f.discovery.inspect(command, f.commandPath)).toMatchObject({ version: "0.85.1", entrypoint: f.entry, packageDirectory: f.root });
  });
  it.skipIf(process.platform === "win32")("resolves macOS-style executable symlinks", async () => {
    const f = await fixture("pi", "darwin");
    expect((await f.discovery.inspect("pi", f.commandPath)).entrypoint).toBe(f.entry);
  });
  it("reports invalid package data as an error", async () => {
    const f = await fixture("pi", "win32");
    await writeFile(join(f.root, "package.json"), "invalid json");
    await expect(f.discovery.inspect("pi", f.commandPath)).rejects.toThrow();
  });
});
