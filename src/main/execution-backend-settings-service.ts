import {
  type ConfigurableExecutionBackendId,
  type ConfigureExecutionBackendInput,
  type ExecutionBackendId,
} from "../shared/execution-profile";
import type { ExecutionBackendCatalogSnapshot, ExecutionBackendRegistryContract } from "./execution-backend-registry";
import { ExecutableResolver, unresolvedExecutionBackendConfiguration } from "./executable-resolver";
import type { ExecutionBackendConfiguration } from "./execution-backend";
import type { StateStore } from "./state-store";

interface ExecutionBackendSettingsServiceOptions {
  readonly stateStore: StateStore;
  readonly registry: ExecutionBackendRegistryContract;
  readonly resolver?: Pick<ExecutableResolver, "resolve">;
}

const CONFIGURABLE_BACKENDS = Object.freeze(["codex", "claude"] as const);

export class ExecutionBackendSettingsService {
  readonly #stateStore: StateStore;
  readonly #registry: ExecutionBackendRegistryContract;
  readonly #resolver: Pick<ExecutableResolver, "resolve">;
  readonly #configurations = new Map<ConfigurableExecutionBackendId, ExecutionBackendConfiguration>();

  constructor(options: ExecutionBackendSettingsServiceOptions) {
    this.#stateStore = options.stateStore;
    this.#registry = options.registry;
    this.#resolver = options.resolver ?? new ExecutableResolver();
  }

  async initialize(): Promise<ExecutionBackendCatalogSnapshot> {
    const persisted = await this.#stateStore.read();
    const configurations = await Promise.all(CONFIGURABLE_BACKENDS.map(async (backendId) => {
      try {
        return await this.#resolver.resolve(backendId, persisted.executionBackends?.[backendId]?.executablePath);
      } catch (cause) {
        return unresolvedExecutionBackendConfiguration(backendId, cause);
      }
    }));
    for (const configuration of configurations) this.#activate(configuration);
    return this.#registry.initialize();
  }

  async configure(input: ConfigureExecutionBackendInput): Promise<ExecutionBackendCatalogSnapshot> {
    const executablePath = input.executablePath?.trim() || undefined;
    const candidate = await this.#resolver.resolve(input.backendId, executablePath);
    const candidateHealth = await this.#registry.probeConfiguration(candidate);
    if (candidateHealth.state !== "ready") {
      throw new Error(candidateHealth.error ?? `${input.backendId} CLI 探测失败`);
    }
    await this.#stateStore.configureExecutionBackend(input.backendId, executablePath);
    this.#activate(candidate);
    return this.#registry.refresh(input.backendId);
  }

  async retry(backendId: ExecutionBackendId): Promise<ExecutionBackendCatalogSnapshot> {
    if (backendId === "pi") return this.#registry.refresh("pi");
    const persisted = await this.#stateStore.read();
    const configuration = await this.#resolveOrUnavailable(backendId, persisted.executionBackends?.[backendId]?.executablePath);
    this.#activate(configuration);
    return this.#registry.refresh(backendId);
  }

  snapshot(): ExecutionBackendCatalogSnapshot {
    return this.#registry.snapshot();
  }

  configuration(backendId: ConfigurableExecutionBackendId): ExecutionBackendConfiguration {
    const configuration = this.#configurations.get(backendId);
    if (!configuration) throw new Error(`${backendId} CLI 尚未初始化`);
    if (!configuration.executable) throw new Error(configuration.resolutionError ?? `${backendId} CLI 当前不可用`);
    return Object.freeze({
      ...configuration,
      prefixArgv: configuration.prefixArgv ? Object.freeze([...configuration.prefixArgv]) : undefined,
    });
  }

  #activate(configuration: ExecutionBackendConfiguration): void {
    this.#registry.activateConfiguration(configuration);
    this.#configurations.set(configuration.backendId as ConfigurableExecutionBackendId, Object.freeze({
      ...configuration,
      prefixArgv: configuration.prefixArgv ? Object.freeze([...configuration.prefixArgv]) : undefined,
    }));
  }

  async #resolveOrUnavailable(backendId: ConfigurableExecutionBackendId, executablePath?: string) {
    try {
      return await this.#resolver.resolve(backendId, executablePath);
    } catch (cause) {
      return unresolvedExecutionBackendConfiguration(backendId, cause);
    }
  }
}
