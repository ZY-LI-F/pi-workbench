// @vitest-environment node
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ExecutableResolver } from "../../src/main/executable-resolver";

const directories: string[] = [];

async function executable(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "stella-executable-"));
  directories.push(directory);
  const path = join(directory, name);
  await writeFile(path, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(path, 0o755);
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ExecutableResolver", () => {
  it("discovers a CLI on PATH and records the resolved display path", async () => {
    const codex = await executable("codex");
    const resolver = new ExecutableResolver({ environment: { PATH: join(codex, "..") } });
    await expect(resolver.resolve("codex")).resolves.toMatchObject({
      backendId: "codex",
      executable: codex,
      displayPath: codex,
      executableSource: "auto",
    });
  });

  it("accepts an executable absolute override and rejects relative or missing paths", async () => {
    const claude = await executable("claude-custom");
    const resolver = new ExecutableResolver({ environment: { PATH: "" } });
    await expect(resolver.resolve("claude", claude)).resolves.toMatchObject({
      executable: claude,
      executableSource: "path",
    });
    await expect(resolver.resolve("claude", "./claude")).rejects.toThrow("必须是绝对路径");
    await expect(resolver.resolve("claude", join(claude, "missing"))).rejects.toThrow("未找到可执行的 Claude CLI");
  });
});
