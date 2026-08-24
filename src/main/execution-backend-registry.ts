import {
  BUILTIN_EXECUTION_PROFILES,
  executionProfile,
  profileSupports,
  snapshotExecutionProfile,
  type ExecutionBackendHealth,
  type ExecutionBackendId,
  type ExecutionCapability,
  type ExecutionProfileAvailability,
  type ExecutionProfileId,
} from "../shared/execution-profile";
import type {
  ExecutionBackend,
  ExecutionBackendConfiguration,
  ResolvedExecutionBackend,
} from "./execution-backend";

export type ExecutionUseCase = ExecutionCapability | "autopilot";

export interface ExecutionBackendCatalogSnapshot {
  readonly health: readonly ExecutionBackendHealth[];
  readonly profiles: readonly ExecutionProfileAvailability[];
}

export interface ExecutionBackendRegistryContract {
  initialize(): Promise<ExecutionBackendCatalogSnapshot>;
  refresh(backendId?: ExecutionBackendId): Promise<ExecutionBackendCatalogSnapshot>;
  resolve(profileId: ExecutionProfileId): ResolvedExecutionBackend;
  assertCompatible(profileId: ExecutionProfileId, useCase: ExecutionUseCase): void;
  snapshot(): ExecutionBackendCatalogSnapshot;
}

interface ExecutionBackendRegistryOptions {
  readonly backends: readonly ExecutionBackend[];
  readonly configurations?: readonly ExecutionBackendConfiguration[];
  readonly now?: () => string;
}

function unavailableHealth(backendId: ExecutionBackendId, updatedAt: string, error: string): ExecutionBackendHealth {
  return Object.freeze({ backendId, state: "unavailable", error, updatedAt });
}

function capabilityFor(useCase: ExecutionUseCase): ExecutionCapability {
  return useCase === "autopilot" ? "direct-agent" : useCase;
}

export class ExecutionBackendRegistry implements ExecutionBackendRegistryContract {
  readonly #backends: ReadonlyMap<ExecutionBackendId, ExecutionBackend>;
  readonly #configurations: ReadonlyMap<ExecutionBackendId, ExecutionBackendConfiguration>;
  readonly #now: () => string;
  #health = new Map<ExecutionBackendId, ExecutionBackendHealth>();

  constructor(options: ExecutionBackendRegistryOptions) {
    const entries = options.backends.map((backend) => [backend.backendId, backend] as const);
    if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error("ExecutionBackend Registry 包含重复 backendId");
    this.#backends = new Map(entries);
    this.#configurations = new Map((options.configurations ?? []).map((configuration) => [configuration.backendId, configuration] as const));
    this.#now = options.now ?? (() => new Date().toISOString());
    for (const backend of options.backends) {
      this.#health.set(backend.backendId, Object.freeze({ backendId: backend.backendId, state: "checking", updatedAt: this.#now() }));
    }
  }

  async initialize(): Promise<ExecutionBackendCatalogSnapshot> {
    return this.refresh();
  }

  async refresh(backendId?: ExecutionBackendId): Promise<ExecutionBackendCatalogSnapshot> {
    const targets = backendId ? [backendId] : [...this.#backends.keys()];
    await Promise.all(targets.map(async (id) => {
      const backend = this.#backends.get(id);
      if (!backend) {
        this.#health.set(id, unavailableHealth(id, this.#now(), `未注册执行 Backend: ${id}`));
        return;
      }
      try {
        const configuration = this.#configurations.get(id) ?? Object.freeze({ backendId: id });
        const health = await backend.probe(configuration);
        if (health.backendId !== id) throw new Error(`Backend probe 返回了错误 ID: ${health.backendId}`);
        this.#health.set(id, Object.freeze({ ...health }));
      } catch (cause) {
        this.#health.set(id, unavailableHealth(id, this.#now(), cause instanceof Error ? cause.message : String(cause)));
      }
    }));
    return this.snapshot();
  }

  resolve(profileId: ExecutionProfileId): ResolvedExecutionBackend {
    const definition = executionProfile(profileId);
    const backend = this.#backends.get(definition.backendId);
    if (!backend) throw new Error(`执行环境 ${definition.label} 未注册 Backend`);
    const health = this.#health.get(definition.backendId)
      ?? unavailableHealth(definition.backendId, this.#now(), "执行环境尚未初始化");
    if (health.state !== "ready") throw new Error(health.error ?? `执行环境 ${definition.label} 当前不可用`);
    return Object.freeze({ profileId, profile: snapshotExecutionProfile(profileId), backend, health });
  }

  assertCompatible(profileId: ExecutionProfileId, useCase: ExecutionUseCase): void {
    if (useCase === "autopilot" && profileId === "codex.review") throw new Error("codex.review 不支持 Autopilot");
    const capability = capabilityFor(useCase);
    if (!profileSupports(profileId, capability)) {
      throw new Error(`${executionProfile(profileId).label} 不支持 ${useCase}`);
    }
  }

  snapshot(): ExecutionBackendCatalogSnapshot {
    const health = Object.freeze([...this.#health.values()].map((item) => Object.freeze({ ...item })));
    const profiles = Object.freeze(BUILTIN_EXECUTION_PROFILES.map((profile) => {
      const backendHealth = this.#health.get(profile.backendId);
      const available = backendHealth?.state === "ready";
      return Object.freeze({
        profile,
        available,
        reason: available ? undefined : backendHealth?.error ?? "执行环境尚未初始化",
      });
    }));
    return Object.freeze({ health, profiles });
  }
}
