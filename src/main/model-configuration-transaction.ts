import type {
  ModelConfigurationCheckpoint,
} from "./model-configuration-service";

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function sameCheckpoint(left: ModelConfigurationCheckpoint, right: ModelConfigurationCheckpoint): boolean {
  return left.authContents === right.authContents && left.modelsContents === right.modelsContents;
}

export interface RuntimeSessionResumeTarget {
  readonly sessionPath?: string;
  readonly sessionId?: string;
}

export interface ModelConfigurationTransactionDependencies<TSnapshot> {
  readonly createCheckpoint: () => Promise<ModelConfigurationCheckpoint>;
  readonly restoreCheckpoint: (
    checkpoint: ModelConfigurationCheckpoint,
    expectedCurrent: ModelConfigurationCheckpoint,
  ) => Promise<void>;
  readonly captureSession: () => Promise<RuntimeSessionResumeTarget | undefined>;
  readonly restartRuntime: (session: RuntimeSessionResumeTarget | undefined) => Promise<void>;
  readonly snapshot: () => Promise<TSnapshot>;
}

/**
 * Applies a model configuration change as one user-visible transaction.
 * A failed runtime reload restores only the exact file versions written by this
 * transaction, so an external edit is surfaced as a rollback conflict instead
 * of being overwritten.
 */
export async function executeModelConfigurationTransaction<TSnapshot>(
  dependencies: ModelConfigurationTransactionDependencies<TSnapshot>,
  mutation: () => Promise<void>,
): Promise<TSnapshot> {
  const checkpoint = await dependencies.createCheckpoint();
  const session = await dependencies.captureSession();
  let appliedCheckpoint: ModelConfigurationCheckpoint | undefined;
  let phase: "mutation" | "activation" | "snapshot" = "mutation";

  try {
    await mutation();
    appliedCheckpoint = await dependencies.createCheckpoint();
    phase = "activation";
    await dependencies.restartRuntime(session);
    phase = "snapshot";
    return await dependencies.snapshot();
  } catch (transactionCause) {
    let currentCheckpoint: ModelConfigurationCheckpoint;
    try {
      currentCheckpoint = appliedCheckpoint ?? await dependencies.createCheckpoint();
    } catch (checkpointCause) {
      throw new AggregateError(
        [transactionCause, checkpointCause],
        `模型配置失败，且无法读取变更后的文件以执行安全回滚：${errorMessage(checkpointCause)}`,
      );
    }

    if (sameCheckpoint(checkpoint, currentCheckpoint)) {
      throw new Error(`模型配置未生效：${errorMessage(transactionCause)}`, { cause: transactionCause });
    }

    try {
      await dependencies.restoreCheckpoint(checkpoint, currentCheckpoint);
    } catch (rollbackCause) {
      throw new AggregateError(
        [transactionCause, rollbackCause],
        `模型配置加载失败，且安全回滚失败：${errorMessage(rollbackCause)}`,
      );
    }

    try {
      await dependencies.restartRuntime(session);
    } catch (recoveryCause) {
      throw new AggregateError(
        [transactionCause, recoveryCause],
        `模型配置已回滚，但旧 Pi Runtime 恢复失败：${errorMessage(recoveryCause)}`,
      );
    }

    const label = phase === "mutation" ? "保存" : phase === "snapshot" ? "刷新" : "加载";
    throw new Error(`模型配置${label}失败，已回滚：${errorMessage(transactionCause)}`, { cause: transactionCause });
  }
}
