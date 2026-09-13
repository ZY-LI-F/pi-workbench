// @vitest-environment node
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExecutionWorkspaceUnavailableError,
  IsolatedWorktreeExecutionWorkspace,
  RepositoryProvisioningLock,
} from "../../src/main/execution-workspace";
import type { AgentDefinition, ExecutionWorkspacePlacementSnapshot } from "../../src/shared/kanban";

const WRITER: AgentDefinition = Object.freeze({
  id: "writer",
  version: 1,
  name: "Writer",
  callsign: "writer",
  responsibility: "Write",
  instructions: "Write",
  workspaceAccess: "write",
  allowedTools: Object.freeze(["read", "write"]),
  thinking: "medium",
  disableExtensions: true,
  disableSkills: true,
  disablePromptTemplates: true,
  disableContextFiles: true,
});

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function git(cwd: string, ...argv: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...argv], { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout.trim());
    });
  });
}

async function repositoryFixture(): Promise<{ readonly root: string; readonly repository: string; readonly project: string; readonly workspaceRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "stella-worktree-测试 "));
  temporaryRoots.push(root);
  const repository = join(root, "源 项目");
  const project = join(repository, "应用 子目录");
  const workspaceRoot = join(root, "执行 工作区");
  await mkdir(project, { recursive: true });
  await git(repository, "init", "--initial-branch=main");
  await git(repository, "config", "user.name", "Stella Test");
  await git(repository, "config", "user.email", "stella@example.invalid");
  await writeFile(join(repository, "README.md"), "fixture\n", "utf8");
  await writeFile(join(project, "input.txt"), "input\n", "utf8");
  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "fixture");
  return { root, repository, project, workspaceRoot };
}

function provider(workspaceRoot: string, id = "resource-001") {
  return new IsolatedWorktreeExecutionWorkspace({
    workspaceRoot,
    resolveProjectTrust: async () => true,
    resolveProjectPath: async (path) => realpath(path),
    id: () => id,
    now: () => "2026-08-28T12:00:00.000Z",
  });
}

function owner(id = "execution-1") {
  return Object.freeze({ id, kind: "agent-task" as const, label: id, taskId: "task-1", executionId: id });
}

describe("IsolatedWorktreeExecutionWorkspace", () => {
  it("creates a real retained worktree, reconciles it after restart, and cleans it idempotently", async () => {
    const fixture = await repositoryFixture();
    const firstProvider = provider(fixture.workspaceRoot);
    const first = await firstProvider.acquire({
      projectPath: fixture.project,
      preference: { strategy: "isolated-worktree", baseRef: "HEAD" },
      executionAttempt: 2,
      agent: WRITER,
      owner: owner(),
    });

    expect(first).toMatchObject({ strategy: "isolated-worktree", trusted: true });
    expect(first.placement).toMatchObject({
      revision: 1,
      strategy: "isolated-worktree",
      resourceId: "resource-001",
      projectPath: fixture.project,
      cwd: first.cwd,
      resourcePath: expect.stringContaining("源-项目-execution-1-resource-001"),
      baseRef: "HEAD",
      branch: "stella/execution-1/a2-resource-001",
      ownership: "stella",
      lifecycle: "retained",
    });
    const worktreeRegistry = (await git(fixture.repository, "worktree", "list", "--porcelain")).replaceAll("\\", "/");
    expect(worktreeRegistry).toContain(`worktree ${first.placement.resourcePath?.replaceAll("\\", "/")}`);
    await writeFile(join(first.cwd, "result.txt"), "backend wrote here\n", "utf8");
    first.release();
    expect((await stat(first.cwd)).isDirectory()).toBe(true);

    const restartedProvider = provider(fixture.workspaceRoot, "must-not-be-used");
    const reconciled = await restartedProvider.acquire({
      projectPath: fixture.project,
      preference: { strategy: "isolated-worktree", baseRef: "HEAD" },
      existingPlacement: first.placement,
      executionAttempt: 2,
      agent: WRITER,
      owner: owner(),
    });
    expect(reconciled.placement).toEqual(first.placement);
    expect(await access(join(reconciled.cwd, "result.txt")).then(() => true)).toBe(true);
    reconciled.release();

    await expect(restartedProvider.cleanup({
      ...first.placement,
      resourcePath: join(fixture.root, "不是 Stella 的目录"),
    })).rejects.toThrow("不属于 Stella workspace root");

    const cleaned = await restartedProvider.cleanup(first.placement);
    expect(cleaned).toMatchObject({ lifecycle: "cleaned", resourceId: "resource-001" });
    await expect(access(first.placement.resourcePath ?? "")).rejects.toThrow();
    expect(await git(fixture.repository, "branch", "--list", first.placement.branch ?? "")).toBe("");
    await expect(restartedProvider.cleanup(first.placement)).resolves.toMatchObject({ lifecycle: "cleaned" });
  });

  it("reports non-Git projects and invalid base refs before provisioning", async () => {
    const fixture = await repositoryFixture();
    const isolated = provider(fixture.workspaceRoot);
    const nonGit = join(fixture.root, "普通 目录");
    await mkdir(nonGit);

    await expect(isolated.acquire({
      projectPath: nonGit,
      preference: { strategy: "isolated-worktree", baseRef: "HEAD" },
      agent: WRITER,
      owner: owner("non-git"),
    })).rejects.toBeInstanceOf(ExecutionWorkspaceUnavailableError);

    await expect(isolated.acquire({
      projectPath: fixture.project,
      preference: { strategy: "isolated-worktree", baseRef: "missing-ref" },
      agent: WRITER,
      owner: owner("missing-ref"),
    })).rejects.toThrow("missing-ref");
    expect(await git(fixture.repository, "worktree", "list", "--porcelain")).not.toContain(fixture.workspaceRoot);
  });

  it("never cleans project-owned or incomplete placement snapshots", async () => {
    const fixture = await repositoryFixture();
    const isolated = provider(fixture.workspaceRoot);
    const placement: ExecutionWorkspacePlacementSnapshot = Object.freeze({
      revision: 1,
      strategy: "current-folder",
      resourceId: "project-owned",
      projectPath: fixture.project,
      cwd: fixture.project,
      ownership: "project",
      lifecycle: "retained",
      createdAt: "2026-08-28T12:00:00.000Z",
      updatedAt: "2026-08-28T12:00:00.000Z",
    });

    await expect(isolated.cleanup(placement)).rejects.toThrow("Stella-owned");
    expect((await stat(fixture.project)).isDirectory()).toBe(true);
  });
});

describe("RepositoryProvisioningLock", () => {
  it("serializes mutations for one repository while allowing a stable handoff", async () => {
    const lock = new RepositoryProvisioningLock();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = lock.run("repo", async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    });
    const second = lock.run("repo", async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});
