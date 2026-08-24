import type { ExecutionTarget, WorkspaceAccess } from "./kanban";

export const EXECUTION_BACKEND_IDS = ["pi", "codex", "claude"] as const;
export type ExecutionBackendId = (typeof EXECUTION_BACKEND_IDS)[number];

export const BUILTIN_EXECUTION_PROFILE_IDS = [
  "pi.rpc",
  "codex.exec",
  "codex.review",
  "claude.print",
] as const;
export type ExecutionProfileId = (typeof BUILTIN_EXECUTION_PROFILE_IDS)[number];

export type ExecutionCapability =
  | "direct-agent"
  | "workflow-step"
  | "worker-mention"
  | "coordinator"
  | "squad"
  | "required-skills"
  | "structured-result"
  | "open-session";

export interface ExecutionProfileDefinition {
  readonly id: ExecutionProfileId;
  readonly revision: number;
  readonly backendId: ExecutionBackendId;
  readonly label: string;
  readonly description: string;
  readonly commandMode: "rpc" | "exec" | "review" | "print";
  readonly capabilities: readonly ExecutionCapability[];
  readonly constraints?: {
    readonly requiresGitRepository?: boolean;
    readonly agentWorkspaceAccess?: readonly WorkspaceAccess[];
  };
  readonly defaultForBackend: boolean;
}

export interface ExecutionProfileSnapshot {
  readonly id: ExecutionProfileId;
  readonly revision: number;
  readonly backendId: ExecutionBackendId;
  readonly label: string;
  readonly commandMode: ExecutionProfileDefinition["commandMode"];
  readonly capabilities: readonly ExecutionCapability[];
  readonly constraints?: ExecutionProfileDefinition["constraints"];
}

export interface ExecutionBackendHealth {
  readonly backendId: ExecutionBackendId;
  readonly state: "checking" | "ready" | "unavailable" | "error";
  readonly version?: string;
  readonly authState?: "ready" | "required" | "unknown";
  readonly executableSource?: "bundled" | "path" | "auto";
  readonly error?: string;
  readonly updatedAt: string;
}

export interface ExecutionProfileAvailability {
  readonly profile: ExecutionProfileDefinition;
  readonly available: boolean;
  readonly reason?: string;
}

const profile = (definition: ExecutionProfileDefinition): ExecutionProfileDefinition => Object.freeze({
  ...definition,
  capabilities: Object.freeze([...definition.capabilities]),
  constraints: definition.constraints
    ? Object.freeze({
        ...definition.constraints,
        agentWorkspaceAccess: definition.constraints.agentWorkspaceAccess
          ? Object.freeze([...definition.constraints.agentWorkspaceAccess])
          : undefined,
      })
    : undefined,
});

export const BUILTIN_EXECUTION_PROFILES = Object.freeze([
  profile({
    id: "pi.rpc",
    revision: 1,
    backendId: "pi",
    label: "Pi RPC",
    description: "使用 Stella 内置的 Pi RPC Runtime 执行任务。",
    commandMode: "rpc",
    capabilities: ["direct-agent", "workflow-step", "worker-mention", "coordinator", "squad", "required-skills", "structured-result", "open-session"],
    defaultForBackend: true,
  }),
  profile({
    id: "codex.exec",
    revision: 1,
    backendId: "codex",
    label: "Codex CLI",
    description: "使用 codex exec 执行 Agent 或 Workflow 步骤。",
    commandMode: "exec",
    capabilities: ["direct-agent", "workflow-step", "worker-mention", "structured-result", "open-session"],
    defaultForBackend: true,
  }),
  profile({
    id: "codex.review",
    revision: 1,
    backendId: "codex",
    label: "Codex Review",
    description: "使用 codex review 执行一次直接代码审查。",
    commandMode: "review",
    capabilities: ["direct-agent", "structured-result", "open-session"],
    constraints: { requiresGitRepository: true, agentWorkspaceAccess: ["read"] },
    defaultForBackend: false,
  }),
  profile({
    id: "claude.print",
    revision: 1,
    backendId: "claude",
    label: "Claude CLI",
    description: "使用 Claude CLI print mode 执行 Agent 或 Workflow 步骤。",
    commandMode: "print",
    capabilities: ["direct-agent", "workflow-step", "worker-mention", "structured-result", "open-session"],
    defaultForBackend: true,
  }),
]);

const BY_ID = new Map(BUILTIN_EXECUTION_PROFILES.map((definition) => [definition.id, definition] as const));
const BY_VERSION = new Map(BUILTIN_EXECUTION_PROFILES.map((definition) => [`${definition.id}@${definition.revision}`, definition] as const));

export function isExecutionBackendId(value: unknown): value is ExecutionBackendId {
  return typeof value === "string" && EXECUTION_BACKEND_IDS.includes(value as ExecutionBackendId);
}

export function isExecutionProfileId(value: unknown): value is ExecutionProfileId {
  return typeof value === "string" && BUILTIN_EXECUTION_PROFILE_IDS.includes(value as ExecutionProfileId);
}

export function executionProfile(profileId: ExecutionProfileId): ExecutionProfileDefinition {
  const definition = BY_ID.get(profileId);
  if (!definition) throw new Error(`未知执行 Profile: ${profileId}`);
  return definition;
}

export function executionProfileRevision(profileId: ExecutionProfileId, revision: number): ExecutionProfileDefinition {
  const definition = BY_VERSION.get(`${profileId}@${revision}`);
  if (!definition) throw new Error(`未知执行 Profile 版本: ${profileId}@${revision}`);
  return definition;
}

export function snapshotExecutionProfile(profileId: ExecutionProfileId, revision?: number): ExecutionProfileSnapshot {
  const definition = revision === undefined ? executionProfile(profileId) : executionProfileRevision(profileId, revision);
  return Object.freeze({
    id: definition.id,
    revision: definition.revision,
    backendId: definition.backendId,
    label: definition.label,
    commandMode: definition.commandMode,
    capabilities: Object.freeze([...definition.capabilities]),
    constraints: definition.constraints
      ? Object.freeze({
          ...definition.constraints,
          agentWorkspaceAccess: definition.constraints.agentWorkspaceAccess
            ? Object.freeze([...definition.constraints.agentWorkspaceAccess])
            : undefined,
        })
      : undefined,
  });
}

export function cloneExecutionProfileSnapshot(snapshot: ExecutionProfileSnapshot): ExecutionProfileSnapshot {
  return Object.freeze({
    ...snapshot,
    capabilities: Object.freeze([...snapshot.capabilities]),
    constraints: snapshot.constraints
      ? Object.freeze({
          ...snapshot.constraints,
          agentWorkspaceAccess: snapshot.constraints.agentWorkspaceAccess
            ? Object.freeze([...snapshot.constraints.agentWorkspaceAccess])
            : undefined,
        })
      : undefined,
  });
}

export function profileSupports(profileId: ExecutionProfileId, capability: ExecutionCapability): boolean {
  return executionProfile(profileId).capabilities.includes(capability);
}

export function profileSupportsTarget(profileId: ExecutionProfileId, target: Exclude<ExecutionTarget, { readonly kind: "manual" }>): boolean {
  if (target.kind === "workflow") return profileSupports(profileId, "workflow-step");
  if (target.kind === "squad") return profileSupports(profileId, "squad");
  return profileSupports(profileId, "direct-agent");
}

export function assertExecutionProfileTarget(
  target: ExecutionTarget,
  profileId: ExecutionProfileId | undefined,
  path = "executionProfileId",
): void {
  if (target.kind === "manual") {
    if (profileId !== undefined) throw new Error(`${path} 不允许用于手工任务`);
    return;
  }
  if (profileId === undefined) throw new Error(`${path} 是自动任务的必填字段`);
  if (!profileSupportsTarget(profileId, target)) throw new Error(`${profileId} 不支持 ${target.kind} 执行目标`);
}
