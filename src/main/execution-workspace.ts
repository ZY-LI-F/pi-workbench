import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  CURRENT_FOLDER_EXECUTION_WORKSPACE,
  cloneExecutionWorkspacePlacement,
  cloneExecutionWorkspacePreference,
  type ExecutionWorkspacePlacementSnapshot,
  type ExecutionWorkspacePreference,
  type ExecutionWorkspaceStrategy,
} from "../shared/kanban";
import type { WorkspaceOwner } from "./workspace-admission";
import {
  WorkspaceAdmission,
  WorkspaceAdmissionAbortError,
  agentRequiresWorkspaceLease,
  assertAgentWorkspacePolicy,
  type WorkspaceLease,
  type WorkspacePolicyAgent,
} from "./workspace-admission";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;

export interface ExecutionWorkspaceResolution {
  readonly strategy: ExecutionWorkspaceStrategy;
  /** Validation exposes the canonical project; acquired handles expose the final backend cwd. */
  readonly cwd: string;
  readonly trusted: boolean;
}

export interface ExecutionWorkspaceHandle extends ExecutionWorkspaceResolution {
  readonly admissionKey?: string;
  readonly placement: ExecutionWorkspacePlacementSnapshot;
  release(): void;
}

export interface AcquireExecutionWorkspaceInput {
  readonly projectPath: string;
  readonly preference?: ExecutionWorkspacePreference;
  readonly existingPlacement?: ExecutionWorkspacePlacementSnapshot;
  readonly executionAttempt?: number;
  readonly agent: WorkspacePolicyAgent;
  readonly owner: WorkspaceOwner;
  readonly signal?: AbortSignal;
  readonly onQueued?: (blockingOwner: WorkspaceOwner) => Promise<void>;
}

export interface ExecutionWorkspaceProvider {
  resolve(projectPath: string, preference?: ExecutionWorkspacePreference): Promise<ExecutionWorkspaceResolution>;
  acquire(input: AcquireExecutionWorkspaceInput): Promise<ExecutionWorkspaceHandle>;
  cleanup?(placement: ExecutionWorkspacePlacementSnapshot): Promise<ExecutionWorkspacePlacementSnapshot>;
}

interface ProjectResolutionOptions {
  readonly resolveProjectTrust: (projectPath: string) => Promise<boolean>;
  readonly resolveProjectPath: (projectPath: string, trusted: boolean) => Promise<string>;
  readonly now?: () => string;
}

interface CurrentFolderExecutionWorkspaceOptions extends ProjectResolutionOptions {
  readonly admission: Pick<WorkspaceAdmission, "acquireBackground">;
}

interface IsolatedWorktreeExecutionWorkspaceOptions extends ProjectResolutionOptions {
  readonly workspaceRoot: string;
  readonly id?: () => string;
  readonly git?: GitCommand;
  readonly lock?: RepositoryProvisioningLock;
}

interface OwnedWorktreeMetadata {
  readonly revision: 1;
  readonly resourceId: string;
  readonly repositoryRoot: string;
  readonly resourcePath: string;
  readonly cwd: string;
  readonly branch: string;
  readonly baseRef: string;
}

export interface GitCommand {
  run(cwd: string, argv: readonly string[], signal?: AbortSignal): Promise<string>;
}

export class ExecutionWorkspaceAbortError extends Error {
  constructor(message = "执行工作区准备已取消") {
    super(message);
    this.name = "ExecutionWorkspaceAbortError";
  }
}

export class ExecutionWorkspaceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionWorkspaceUnavailableError";
  }
}

export class SystemGitCommand implements GitCommand {
  async run(cwd: string, argv: readonly string[], signal?: AbortSignal): Promise<string> {
    try {
      const result = await execFileAsync("git", ["-C", cwd, ...argv], {
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        signal,
      });
      return String(result.stdout).trim();
    } catch (cause) {
      if (signal?.aborted) throw new ExecutionWorkspaceAbortError();
      const stderr = typeof cause === "object" && cause !== null && "stderr" in cause ? String(cause.stderr).trim() : "";
      throw new Error(stderr || (cause instanceof Error ? cause.message : String(cause)));
    }
  }
}

/** Serializes mutations of one repository's shared worktree administration. */
export class RepositoryProvisioningLock {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(repositoryKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(repositoryKey) ?? Promise.resolve();
    let unlock: () => void = () => undefined;
    const hold = new Promise<void>((resolveHold) => { unlock = () => resolveHold(); });
    const tail = previous.then(() => hold);
    this.#tails.set(repositoryKey, tail);
    await previous;
    try {
      return await operation();
    } finally {
      unlock();
      if (this.#tails.get(repositoryKey) === tail) this.#tails.delete(repositoryKey);
    }
  }
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value.normalize("NFKC").replace(/[^\p{Letter}\p{Number}._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return (normalized || fallback).slice(0, 48);
}

function within(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function requiredPreference(input: AcquireExecutionWorkspaceInput): ExecutionWorkspacePreference {
  return cloneExecutionWorkspacePreference(input.preference);
}

function placementTimestamp(now: () => string): string {
  const value = now();
  if (!Number.isFinite(Date.parse(value))) throw new Error("Execution Workspace now() 必须返回 ISO 日期");
  return value;
}

/** Existing behaviour adapter: canonical current directory plus FIFO writer admission. */
export class CurrentFolderExecutionWorkspace implements ExecutionWorkspaceProvider {
  readonly #admission: Pick<WorkspaceAdmission, "acquireBackground">;
  readonly #resolveProjectTrust: (projectPath: string) => Promise<boolean>;
  readonly #resolveProjectPath: (projectPath: string, trusted: boolean) => Promise<string>;
  readonly #now: () => string;

  constructor(options: CurrentFolderExecutionWorkspaceOptions) {
    this.#admission = options.admission;
    this.#resolveProjectTrust = options.resolveProjectTrust;
    this.#resolveProjectPath = options.resolveProjectPath;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async resolve(projectPath: string, preference = CURRENT_FOLDER_EXECUTION_WORKSPACE): Promise<ExecutionWorkspaceResolution> {
    if (preference.strategy !== "current-folder") throw new ExecutionWorkspaceUnavailableError("CurrentFolder Adapter 不支持 isolated-worktree");
    const trusted = await this.#resolveProjectTrust(projectPath);
    const cwd = await this.#resolveProjectPath(projectPath, trusted);
    return Object.freeze({ strategy: "current-folder", cwd, trusted });
  }

  async acquire(input: AcquireExecutionWorkspaceInput): Promise<ExecutionWorkspaceHandle> {
    assertAgentWorkspacePolicy(input.agent);
    const preference = requiredPreference(input);
    if (preference.strategy !== "current-folder") throw new ExecutionWorkspaceUnavailableError("CurrentFolder Adapter 不支持 isolated-worktree");
    if (input.signal?.aborted) throw new ExecutionWorkspaceAbortError();
    const resolution = await this.resolve(input.projectPath, preference);
    if (input.signal?.aborted) throw new ExecutionWorkspaceAbortError();
    let lease: WorkspaceLease | undefined;
    if (agentRequiresWorkspaceLease(input.agent)) {
      try {
        lease = await this.#admission.acquireBackground(input.projectPath, input.owner, {
          signal: input.signal,
          onQueued: input.onQueued,
        });
      } catch (cause) {
        if (cause instanceof WorkspaceAdmissionAbortError) throw new ExecutionWorkspaceAbortError(cause.message);
        throw cause;
      }
    }
    const timestamp = placementTimestamp(this.#now);
    if (input.existingPlacement && (input.existingPlacement.strategy !== "current-folder"
      || input.existingPlacement.projectPath !== input.projectPath)) {
      lease?.release();
      throw new ExecutionWorkspaceUnavailableError("已有 placement 与 current-folder 项目身份不兼容");
    }
    const placement = input.existingPlacement
      ? cloneExecutionWorkspacePlacement(input.existingPlacement) as ExecutionWorkspacePlacementSnapshot
      : Object.freeze({
          revision: 1 as const,
          strategy: "current-folder" as const,
          resourceId: `current-folder:${input.owner.id}`,
          projectPath: input.projectPath,
          cwd: resolution.cwd,
          ownership: "project" as const,
          lifecycle: "retained" as const,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
    let released = false;
    return Object.freeze({
      ...resolution,
      ...(lease ? { admissionKey: lease.key } : {}),
      placement,
      release: () => {
        if (released) return;
        released = true;
        lease?.release();
      },
    });
  }
}

export class IsolatedWorktreeExecutionWorkspace implements ExecutionWorkspaceProvider {
  readonly #workspaceRoot: string;
  readonly #metadataRoot: string;
  readonly #resolveProjectTrust: (projectPath: string) => Promise<boolean>;
  readonly #resolveProjectPath: (projectPath: string, trusted: boolean) => Promise<string>;
  readonly #now: () => string;
  readonly #id: () => string;
  readonly #git: GitCommand;
  readonly #lock: RepositoryProvisioningLock;

  constructor(options: IsolatedWorktreeExecutionWorkspaceOptions) {
    this.#workspaceRoot = resolve(options.workspaceRoot);
    this.#metadataRoot = join(this.#workspaceRoot, ".stella-owned");
    this.#resolveProjectTrust = options.resolveProjectTrust;
    this.#resolveProjectPath = options.resolveProjectPath;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#id = options.id ?? randomUUID;
    this.#git = options.git ?? new SystemGitCommand();
    this.#lock = options.lock ?? new RepositoryProvisioningLock();
  }

  async resolve(projectPath: string, preference?: ExecutionWorkspacePreference): Promise<ExecutionWorkspaceResolution> {
    if (preference?.strategy !== "isolated-worktree") throw new ExecutionWorkspaceUnavailableError("IsolatedWorktree Adapter 需要 isolated-worktree preference");
    const trusted = await this.#resolveProjectTrust(projectPath);
    if (!trusted) throw new ExecutionWorkspaceUnavailableError("未受信任项目不能创建 isolated worktree");
    const cwd = await this.#resolveProjectPath(projectPath, trusted);
    try {
      await this.#git.run(cwd, ["rev-parse", "--show-toplevel"]);
      await this.#git.run(cwd, ["rev-parse", "--verify", "--end-of-options", `${preference.baseRef}^{commit}`]);
    } catch (cause) {
      throw new ExecutionWorkspaceUnavailableError(`无法使用 base ref ${preference.baseRef} 创建 worktree：${cause instanceof Error ? cause.message : String(cause)}`);
    }
    return Object.freeze({ strategy: "isolated-worktree", cwd, trusted });
  }

  async acquire(input: AcquireExecutionWorkspaceInput): Promise<ExecutionWorkspaceHandle> {
    assertAgentWorkspacePolicy(input.agent);
    const preference = requiredPreference(input);
    if (preference.strategy !== "isolated-worktree") throw new ExecutionWorkspaceUnavailableError("IsolatedWorktree Adapter 需要 isolated-worktree preference");
    if (input.signal?.aborted) throw new ExecutionWorkspaceAbortError();
    const resolution = await this.resolve(input.projectPath, preference);
    const repositoryRoot = await realpath(await this.#git.run(resolution.cwd, ["rev-parse", "--show-toplevel"]));
    const commonDirValue = await this.#git.run(repositoryRoot, ["rev-parse", "--git-common-dir"]);
    const repositoryKey = await realpath(resolve(repositoryRoot, commonDirValue));
    if (input.existingPlacement) {
      if (input.existingPlacement.projectPath !== input.projectPath || input.existingPlacement.baseRef !== preference.baseRef) {
        throw new ExecutionWorkspaceUnavailableError("已有 placement 与 isolated-worktree preference 不兼容");
      }
      const placement = await this.#reconcileExisting(input.existingPlacement, repositoryRoot, repositoryKey);
      return this.#handle(resolution.trusted, placement);
    }

    const baseCommit = await this.#git.run(repositoryRoot, ["rev-parse", "--verify", "--end-of-options", `${preference.baseRef}^{commit}`], input.signal);
    const resourceId = this.#id();
    if (!/^[A-Za-z0-9._-]+$/u.test(resourceId)) throw new Error("Execution Workspace resource ID 只能包含字母、数字、点、下划线或连字符");
    const repositoryLabel = safeSegment(basename(repositoryRoot), "repository");
    const ownerLabel = safeSegment(input.owner.id, "execution");
    const projectRelativePath = relative(repositoryRoot, resolution.cwd);
    if (projectRelativePath.startsWith("..") || isAbsolute(projectRelativePath)) {
      throw new ExecutionWorkspaceUnavailableError("项目目录不在解析出的 Git 仓库内");
    }
    const branch = `stella/${ownerLabel}/a${input.executionAttempt ?? 1}-${resourceId.slice(0, 12)}`;
    const timestamp = placementTimestamp(this.#now);

    const placement = await this.#lock.run(repositoryKey, async () => {
      if (input.signal?.aborted) throw new ExecutionWorkspaceAbortError();
      await mkdir(this.#workspaceRoot, { recursive: true });
      await mkdir(this.#metadataRoot, { recursive: true });
      const canonicalWorkspaceRoot = await realpath(this.#workspaceRoot);
      const resourcePath = join(canonicalWorkspaceRoot, `${repositoryLabel}-${ownerLabel}-${resourceId.slice(0, 12)}`);
      const finalCwd = join(resourcePath, projectRelativePath);
      try {
        await this.#git.run(repositoryRoot, ["worktree", "add", "-b", branch, resourcePath, baseCommit], input.signal);
      } catch (cause) {
        throw new ExecutionWorkspaceUnavailableError(`创建 isolated worktree 失败：${cause instanceof Error ? cause.message : String(cause)}`);
      }
      const snapshot: ExecutionWorkspacePlacementSnapshot = Object.freeze({
        revision: 1,
        strategy: "isolated-worktree",
        resourceId,
        projectPath: input.projectPath,
        cwd: finalCwd,
        resourcePath,
        baseRef: preference.baseRef,
        branch,
        ownership: "stella",
        lifecycle: "retained",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const metadata: OwnedWorktreeMetadata = Object.freeze({
        revision: 1,
        resourceId,
        repositoryRoot,
        resourcePath,
        cwd: finalCwd,
        branch,
        baseRef: preference.baseRef,
      });
      try {
        await writeFile(this.#metadataPath(resourceId), `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      } catch (cause) {
        try { await this.#git.run(repositoryRoot, ["worktree", "remove", "--force", resourcePath]); } catch { /* Preserve original setup failure. */ }
        try { await this.#git.run(repositoryRoot, ["branch", "-D", branch]); } catch { /* Preserve original setup failure. */ }
        throw new ExecutionWorkspaceUnavailableError(`记录 worktree ownership 失败：${cause instanceof Error ? cause.message : String(cause)}`);
      }
      return snapshot;
    });
    return this.#handle(resolution.trusted, placement);
  }

  async cleanup(placementInput: ExecutionWorkspacePlacementSnapshot): Promise<ExecutionWorkspacePlacementSnapshot> {
    const placement = cloneExecutionWorkspacePlacement(placementInput) as ExecutionWorkspacePlacementSnapshot;
    if (placement.strategy !== "isolated-worktree" || placement.ownership !== "stella" || !placement.resourcePath || !placement.branch || !placement.baseRef) {
      throw new Error("只允许清理完整的 Stella-owned isolated worktree placement");
    }
    const canonicalWorkspaceRoot = await realpath(this.#workspaceRoot);
    if (!within(canonicalWorkspaceRoot, placement.resourcePath) || resolve(placement.resourcePath) === canonicalWorkspaceRoot) {
      throw new Error("Worktree resourcePath 不属于 Stella workspace root");
    }
    const cleanedMetadata = `${this.#metadataPath(placement.resourceId)}.cleaned`;
    if (placement.lifecycle === "cleaned" || await this.#exists(cleanedMetadata)) {
      const now = placementTimestamp(this.#now);
      return Object.freeze({ ...placement, lifecycle: "cleaned", lifecycleError: undefined, updatedAt: now });
    }
    const metadata = await this.#readMetadata(placement.resourceId);
    this.#assertMetadata(metadata, placement);
    if (!within(canonicalWorkspaceRoot, metadata.resourcePath)) throw new Error("Ownership metadata 指向 workspace root 之外");
    const commonDirValue = await this.#git.run(metadata.repositoryRoot, ["rev-parse", "--git-common-dir"]);
    const repositoryKey = await realpath(resolve(metadata.repositoryRoot, commonDirValue));
    try {
      await this.#lock.run(repositoryKey, async () => {
        const worktrees = await this.#git.run(metadata.repositoryRoot, ["worktree", "list", "--porcelain"]);
        if (this.#listedWorktreePaths(worktrees).has(resolve(metadata.resourcePath))) {
          const activeBranch = await this.#git.run(metadata.resourcePath, ["symbolic-ref", "--short", "HEAD"]);
          if (activeBranch !== metadata.branch) throw new Error("目标 worktree 的当前 branch 与 ownership metadata 不匹配");
          await this.#git.run(metadata.repositoryRoot, ["worktree", "remove", "--force", metadata.resourcePath]);
        } else if (await this.#exists(metadata.resourcePath)) {
          throw new Error("目标目录存在，但不在 Git worktree registry 中");
        }
        try { await this.#git.run(metadata.repositoryRoot, ["branch", "-D", metadata.branch]); } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (!message.includes("not found") && !message.includes("未找到")) throw cause;
        }
        await this.#git.run(metadata.repositoryRoot, ["worktree", "prune"]);
        await rename(this.#metadataPath(placement.resourceId), cleanedMetadata);
      });
      const now = placementTimestamp(this.#now);
      return Object.freeze({ ...placement, lifecycle: "cleaned", lifecycleError: undefined, updatedAt: now });
    } catch (cause) {
      const now = placementTimestamp(this.#now);
      return Object.freeze({
        ...placement,
        lifecycle: "cleanup-failed",
        lifecycleError: cause instanceof Error ? cause.message : String(cause),
        updatedAt: now,
      });
    }
  }

  async #reconcileExisting(placementInput: ExecutionWorkspacePlacementSnapshot, repositoryRoot: string, repositoryKey: string): Promise<ExecutionWorkspacePlacementSnapshot> {
    const placement = cloneExecutionWorkspacePlacement(placementInput) as ExecutionWorkspacePlacementSnapshot;
    if (placement.strategy !== "isolated-worktree" || placement.ownership !== "stella" || !placement.resourcePath) {
      throw new ExecutionWorkspaceUnavailableError("已有 placement 与 isolated-worktree 策略不兼容");
    }
    const metadata = await this.#readMetadata(placement.resourceId);
    this.#assertMetadata(metadata, placement);
    const canonicalWorkspaceRoot = await realpath(this.#workspaceRoot);
    if (!within(canonicalWorkspaceRoot, metadata.resourcePath)) throw new Error("Ownership metadata 指向 workspace root 之外");
    if (resolve(metadata.repositoryRoot) !== resolve(repositoryRoot)) throw new Error("已有 placement 属于另一个 Git 仓库");
    await this.#lock.run(repositoryKey, async () => {
      const worktrees = await this.#git.run(repositoryRoot, ["worktree", "list", "--porcelain"]);
      if (!this.#listedWorktreePaths(worktrees).has(resolve(metadata.resourcePath))) {
        throw new ExecutionWorkspaceUnavailableError("已有 Stella worktree 未在 Git registry 中注册");
      }
      const activeBranch = await this.#git.run(metadata.resourcePath, ["symbolic-ref", "--short", "HEAD"]);
      if (activeBranch !== metadata.branch) throw new ExecutionWorkspaceUnavailableError("已有 Stella worktree branch 与 placement 不匹配");
      const info = await stat(metadata.cwd);
      if (!info.isDirectory()) throw new ExecutionWorkspaceUnavailableError("已有 Stella worktree cwd 不是目录");
    });
    return placement;
  }

  #handle(trusted: boolean, placement: ExecutionWorkspacePlacementSnapshot): ExecutionWorkspaceHandle {
    return Object.freeze({
      strategy: "isolated-worktree",
      cwd: placement.cwd,
      trusted,
      placement,
      release: () => undefined,
    });
  }

  #metadataPath(resourceId: string): string {
    if (!/^[A-Za-z0-9._-]+$/u.test(resourceId)) throw new Error("无效的 Worktree resourceId");
    return join(this.#metadataRoot, `${resourceId}.json`);
  }

  async #readMetadata(resourceId: string): Promise<OwnedWorktreeMetadata> {
    const value = JSON.parse(await readFile(this.#metadataPath(resourceId), "utf8")) as Partial<OwnedWorktreeMetadata>;
    if (value.revision !== 1 || typeof value.resourceId !== "string" || typeof value.repositoryRoot !== "string"
      || typeof value.resourcePath !== "string" || typeof value.cwd !== "string" || typeof value.branch !== "string" || typeof value.baseRef !== "string") {
      throw new Error("Stella worktree ownership metadata 无效");
    }
    return Object.freeze(value as OwnedWorktreeMetadata);
  }

  #assertMetadata(metadata: OwnedWorktreeMetadata, placement: ExecutionWorkspacePlacementSnapshot): void {
    if (metadata.resourceId !== placement.resourceId || resolve(metadata.resourcePath) !== resolve(placement.resourcePath ?? "")
      || resolve(metadata.cwd) !== resolve(placement.cwd) || metadata.branch !== placement.branch || metadata.baseRef !== placement.baseRef) {
      throw new Error("Worktree placement 与 Stella ownership metadata 不匹配");
    }
  }

  #listedWorktreePaths(value: string): ReadonlySet<string> {
    return new Set(value.split(/\r?\n/u)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => resolve(line.slice("worktree ".length))));
  }

  async #exists(path: string): Promise<boolean> {
    try { await access(path); return true; } catch { return false; }
  }
}

export class RoutedExecutionWorkspace implements ExecutionWorkspaceProvider {
  readonly #current: CurrentFolderExecutionWorkspace;
  readonly #isolated: IsolatedWorktreeExecutionWorkspace;

  constructor(current: CurrentFolderExecutionWorkspace, isolated: IsolatedWorktreeExecutionWorkspace) {
    this.#current = current;
    this.#isolated = isolated;
  }

  resolve(projectPath: string, preference = CURRENT_FOLDER_EXECUTION_WORKSPACE): Promise<ExecutionWorkspaceResolution> {
    return preference.strategy === "isolated-worktree"
      ? this.#isolated.resolve(projectPath, preference)
      : this.#current.resolve(projectPath, preference);
  }

  acquire(input: AcquireExecutionWorkspaceInput): Promise<ExecutionWorkspaceHandle> {
    return requiredPreference(input).strategy === "isolated-worktree"
      ? this.#isolated.acquire(input)
      : this.#current.acquire(input);
  }

  cleanup(placement: ExecutionWorkspacePlacementSnapshot): Promise<ExecutionWorkspacePlacementSnapshot> {
    return this.#isolated.cleanup(placement);
  }
}
