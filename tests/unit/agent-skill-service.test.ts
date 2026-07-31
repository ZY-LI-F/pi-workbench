// @vitest-environment node
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentSkillService } from "../../src/main/agent-skill-service";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

const PROJECT = resolve("C:/research-project");
const USER_SKILL = resolve("C:/Users/test/.pi/agent/skills/target-evidence/SKILL.md");
const PROJECT_SKILL = resolve(PROJECT, ".pi/skills/project-only/SKILL.md");

function serviceWith(skills: readonly { readonly name: string; readonly filePath: string }[]) {
  const reload = vi.fn(async () => undefined);
  const service = new AgentSkillService({
    createLoader: () => ({ reload, getSkills: () => ({ skills }) }) as never,
  });
  return { reload, service };
}

describe("AgentSkillService", () => {
  it("discovers user and project Skills only inside the live trust boundary", async () => {
    const { reload, service } = serviceWith([
      { name: "target-evidence", filePath: USER_SKILL },
      { name: "project-only", filePath: PROJECT_SKILL },
    ]);

    expect([...(await service.discover(PROJECT, true)).names]).toEqual(["target-evidence", "project-only"]);
    expect([...(await service.discover(PROJECT, false)).names]).toEqual(["target-evidence"]);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("fails before execution with the exact Agent and missing Skill", async () => {
    const researcher = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "target-biologist");
    if (!researcher) throw new Error("测试目录缺少 target-biologist");
    const { service } = serviceWith([]);

    await expect(service.assertAgentsReady(PROJECT, true, [researcher]))
      .rejects.toThrow(`Agent ${researcher.name} 缺少必需 Pi Skills：target-evidence`);
  });

  it("rejects an Agent that both requires and disables Skills", async () => {
    const base = BUILTIN_ORCHESTRATION_CATALOG.agents[0];
    if (!base) throw new Error("测试目录为空");
    const agent = Object.freeze({ ...base, requiredSkills: Object.freeze(["required"]), disableSkills: true });
    const { service } = serviceWith([{ name: "required", filePath: USER_SKILL }]);

    await expect(service.assertAgentsReady(PROJECT, true, [agent]))
      .rejects.toThrow("配置了必需 Skills，但 disableSkills=true");
  });
});
