import type {
  ModelConfigurationCheckpoint,
} from "./model-configuration-service";

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface ModelConfigurationTransactionDependencies<TSnapshot> {
  readonly createCheckpoint: () => Promise<ModelConfigurationCheckpoint>;
  readonly restoreCheckpoint: (
    checkpoint: ModelConfigurationCheckpoint,
    expectedCurrent: ModelConfigurationCheckpoint,
  ) => Promise<void>;
  readonly captureSessionPath: () => Promise<string | undefined>;
  readonly restartRuntime: (sessionPath: string | undefined) => Promise<void>;
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
  const sessionPath = await dependencies.captureSessionPath();
  await mutation();
  const appliedCheckpoint = await dependencies.createCheckpoint();

  try {
    await dependencies.restartRuntime(sessionPath);
    return await dependencies.snapshot();
  } catch (activationCause) {
    try {
      await dependencies.restoreCheckpoint(checkpoint, appliedCheckpoint);
    } catch (rollbackCause) {
      throw new AggregateError(
        [activationCause, rollbackCause],
        `模型配置加载失败，且安全回滚失败：${errorMessage(rollbackCause)}`,
      );
    }

    try {
      await dependencies.restartRuntime(sessionPath);
    } catch (recoveryCause) {
      throw new AggregateError(
        [activationCause, recoveryCause],
        `模型配置已回滚，但旧 Pi Runtime 恢复失败：${errorMessage(recoveryCause)}`,
      );
    }

    throw new Error(`模型配置未生效，已回滚：${errorMessage(activationCause)}`, { cause: activationCause });
  }
}
