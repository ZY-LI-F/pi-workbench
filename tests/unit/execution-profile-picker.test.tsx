import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_EXECUTION_PROFILES, type ExecutionBackendCatalogSnapshot } from "../../src/shared/execution-profile";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { ExecutionProfilePicker, executionProfileOptions } from "../../src/renderer/src/features/kanban/ExecutionProfilePicker";

afterEach(() => cleanup());

const NOW = "2026-08-24T00:00:00.000Z";
const SNAPSHOT: ExecutionBackendCatalogSnapshot = Object.freeze({
  health: Object.freeze([
    Object.freeze({ backendId: "pi", state: "ready", version: "0.53.0", authState: "ready", updatedAt: NOW }),
    Object.freeze({ backendId: "codex", state: "ready", version: "0.149.0", authState: "ready", updatedAt: NOW }),
    Object.freeze({ backendId: "claude", state: "unavailable", authState: "required", error: "Claude CLI 尚未登录", updatedAt: NOW }),
  ]),
  profiles: Object.freeze(BUILTIN_EXECUTION_PROFILES.map((profile) => Object.freeze({
    profile,
    available: profile.backendId !== "claude",
    reason: profile.backendId === "claude" ? "Claude CLI 尚未登录" : undefined,
  }))),
});

function agent(id: string) {
  const found = BUILTIN_ORCHESTRATION_CATALOG.agents.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`测试缺少 ${id}`);
  return found;
}

describe("ExecutionProfilePicker", () => {
  it("derives health, Git, and Agent workspace compatibility without hiding the reason", () => {
    const options = executionProfileOptions({
      target: { kind: "agent", agentId: "builder" },
      agents: [agent("builder")],
      gitRepository: true,
      snapshot: SNAPSHOT,
      piExecutionEnabled: true,
    });

    expect(options.find((option) => option.id === "codex.exec")).toMatchObject({ selectable: true, version: "0.149.0" });
    expect(options.find((option) => option.id === "codex.review")).toMatchObject({ selectable: false, reason: "Codex Review 不支持可写 Agent" });
    expect(options.find((option) => option.id === "claude.print")).toMatchObject({ selectable: false, reason: "Claude CLI 尚未登录" });
  });

  it("renders unavailable choices as disabled and selects a healthy Codex profile", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const options = executionProfileOptions({
      target: { kind: "agent", agentId: "reviewer" },
      agents: [agent("reviewer")],
      gitRepository: true,
      snapshot: SNAPSHOT,
      piExecutionEnabled: true,
    });
    render(<ExecutionProfilePicker options={options} value="pi.rpc" onChange={onChange} />);

    expect(screen.getByRole("radio", { name: /Claude CLI/ }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("radio", { name: /Codex Review/ }));
    expect(onChange).toHaveBeenCalledWith("codex.review");
  });

  it("makes Claude selectable when its probe is healthy and the Agent has no Pi Skill dependency", () => {
    const snapshot: ExecutionBackendCatalogSnapshot = Object.freeze({
      health: Object.freeze(SNAPSHOT.health.map((health) => health.backendId === "claude"
        ? Object.freeze({ backendId: "claude" as const, state: "ready" as const, authState: "ready" as const, version: "2.1.220", updatedAt: NOW })
        : health)),
      profiles: Object.freeze(SNAPSHOT.profiles.map((availability) => availability.profile.id === "claude.print"
        ? Object.freeze({ profile: availability.profile, available: true })
        : availability)),
    });
    const options = executionProfileOptions({
      target: { kind: "agent", agentId: "builder" },
      agents: [agent("builder")],
      gitRepository: true,
      snapshot,
      piExecutionEnabled: true,
    });

    expect(options.find((option) => option.id === "claude.print")).toMatchObject({ selectable: true, version: "2.1.220" });
    const skillBoundAgent = Object.freeze({
      ...agent("builder"),
      requiredSkills: Object.freeze(["project-specific-skill"]),
      disableSkills: false,
    });
    const incompatible = executionProfileOptions({
      target: { kind: "agent", agentId: skillBoundAgent.id },
      agents: [skillBoundAgent],
      gitRepository: true,
      snapshot,
      piExecutionEnabled: true,
    });
    expect(incompatible.find((option) => option.id === "claude.print")).toMatchObject({
      selectable: false,
      reason: "Claude CLI 不支持依赖 Pi Skills 的 Agent",
    });
  });
});
