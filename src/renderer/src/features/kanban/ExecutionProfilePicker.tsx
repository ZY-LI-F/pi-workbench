import { Check, CircleAlert, TerminalSquare } from "lucide-react";
import type { AgentDefinition, ExecutionTarget } from "@shared/kanban";
import {
  BUILTIN_EXECUTION_PROFILES,
  executionProfileAgentIncompatibility,
  profileSupportsTarget,
  type ExecutionBackendCatalogSnapshot,
  type ExecutionProfileId,
} from "@shared/execution-profile";

export interface ExecutionProfileOption {
  readonly id: ExecutionProfileId;
  readonly label: string;
  readonly description: string;
  readonly version?: string;
  readonly selectable: boolean;
  readonly reason?: string;
}

export function executionProfileOptions(input: {
  readonly target: Exclude<ExecutionTarget, { readonly kind: "manual" }>;
  readonly agents: readonly AgentDefinition[];
  readonly gitRepository: boolean;
  readonly snapshot?: ExecutionBackendCatalogSnapshot;
  readonly piExecutionEnabled: boolean;
}): readonly ExecutionProfileOption[] {
  return Object.freeze(BUILTIN_EXECUTION_PROFILES.map((profile) => {
    const availability = input.snapshot?.profiles.find((item) => item.profile.id === profile.id);
    const health = input.snapshot?.health.find((item) => item.backendId === profile.backendId);
    const reason = !profileSupportsTarget(profile.id, input.target)
      ? `${profile.label} 不支持${input.target.kind === "workflow" ? "固定流程" : input.target.kind === "squad" ? "动态 Squad" : "单 Agent"}`
      : executionProfileAgentIncompatibility(profile.id, input.agents)
        ?? (profile.constraints?.requiresGitRepository && !input.gitRepository ? `${profile.label} 需要 Git 项目` : undefined)
        ?? (profile.backendId === "pi" && !input.piExecutionEnabled ? "Pi Runtime 当前不可用" : undefined)
        ?? (availability && !availability.available ? availability.reason ?? `${profile.label} 当前不可用` : undefined)
        ?? (!availability && profile.backendId !== "pi" ? `${profile.label} 尚未完成探测` : undefined);
    return Object.freeze({
      id: profile.id,
      label: profile.label,
      description: profile.description,
      version: health?.version,
      selectable: reason === undefined,
      reason,
    });
  }));
}

export function ExecutionProfilePicker({
  options,
  value,
  onChange,
}: {
  readonly options: readonly ExecutionProfileOption[];
  readonly value: ExecutionProfileId;
  readonly onChange: (profileId: ExecutionProfileId) => void;
}) {
  return (
    <div className="execution-profile-picker" role="radiogroup" aria-label="执行环境">
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={!option.selectable}
            disabled={!option.selectable}
            className={`${selected ? "is-selected" : ""} ${option.selectable ? "" : "is-unavailable"}`}
            key={option.id}
            onClick={() => { if (option.selectable) onChange(option.id); }}
          >
            <span><TerminalSquare size={14} /><strong>{option.label}</strong>{option.version && <em>v{option.version}</em>}</span>
            <small>{option.reason ?? option.description}</small>
            {selected ? <Check size={14} /> : !option.selectable ? <CircleAlert size={13} /> : null}
          </button>
        );
      })}
    </div>
  );
}
