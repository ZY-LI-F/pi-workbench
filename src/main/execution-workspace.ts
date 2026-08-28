import type { WorkspaceOwner } from "./workspace-admission";
import {
  WorkspaceAdmission,
  WorkspaceAdmissionAbortError,
  agentRequiresWorkspaceLease,
  assertAgentWorkspacePolicy,
  type WorkspaceLease,
  type WorkspacePolicyAgent,
} from "./workspace-admission";

export type ExecutionWorkspaceStrategy = "current-folder";

export interface ExecutionWorkspaceResolution {
  readonly strategy: ExecutionWorkspaceStrategy;
  readonly cwd: string;
  readonly trusted: boolean;
}

export interface ExecutionWorkspaceHandle extends ExecutionWorkspaceResolution {
  readonly admissionKey?: string;
  release(): void;
}

export interface AcquireExecutionWorkspaceInput {
  readonly projectPath: string;
  readonly agent: WorkspacePolicyAgent;
  readonly owner: WorkspaceOwner;
  readonly signal?: AbortSignal;
  readonly onQueued?: (blockingOwner: WorkspaceOwner) => Promise<void>;
}

export interface ExecutionWorkspaceProvider {
  resolve(projectPath: string): Promise<ExecutionWorkspaceResolution>;
  acquire(input: AcquireExecutionWorkspaceInput): Promise<ExecutionWorkspaceHandle>;
}

interface CurrentFolderExecutionWorkspaceOptions {
  readonly admission: Pick<WorkspaceAdmission, "acquireBackground">;
  readonly resolveProjectTrust: (projectPath: string) => Promise<boolean>;
  readonly resolveProjectPath: (projectPath: string, trusted: boolean) => Promise<string>;
}

export class ExecutionWorkspaceAbortError extends Error {
  constructor(message = "执行工作区准备已取消") {
    super(message);
    this.name = "ExecutionWorkspaceAbortError";
  }
}

/**
 * The compatibility adapter for Stella's existing execution behaviour. It owns
 * path/trust resolution and writer admission; backends receive only the final cwd.
 */
export class CurrentFolderExecutionWorkspace implements ExecutionWorkspaceProvider {
  readonly #admission: Pick<WorkspaceAdmission, "acquireBackground">;
  readonly #resolveProjectTrust: (projectPath: string) => Promise<boolean>;
  readonly #resolveProjectPath: (projectPath: string, trusted: boolean) => Promise<string>;

  constructor(options: CurrentFolderExecutionWorkspaceOptions) {
    this.#admission = options.admission;
    this.#resolveProjectTrust = options.resolveProjectTrust;
    this.#resolveProjectPath = options.resolveProjectPath;
  }

  async resolve(projectPath: string): Promise<ExecutionWorkspaceResolution> {
    const trusted = await this.#resolveProjectTrust(projectPath);
    const cwd = await this.#resolveProjectPath(projectPath, trusted);
    return Object.freeze({ strategy: "current-folder", cwd, trusted });
  }

  async acquire(input: AcquireExecutionWorkspaceInput): Promise<ExecutionWorkspaceHandle> {
    assertAgentWorkspacePolicy(input.agent);
    if (input.signal?.aborted) throw new ExecutionWorkspaceAbortError();
    const resolution = await this.resolve(input.projectPath);
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
    let released = false;
    return Object.freeze({
      ...resolution,
      ...(lease ? { admissionKey: lease.key } : {}),
      release: () => {
        if (released) return;
        released = true;
        lease?.release();
      },
    });
  }
}
