import { sep, resolve } from "node:path";
import { DefaultResourceLoader, getAgentDir, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "../shared/kanban";

interface AgentSkillServiceDependencies {
  readonly createLoader?: (projectPath: string) => ResourceLoader;
}

export interface AgentSkillSnapshot {
  readonly names: ReadonlySet<string>;
  readonly discoveredAt: string;
}

function insidePath(candidate: string, root: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const left = process.platform === "win32" ? normalizedCandidate.toLocaleLowerCase("en-US") : normalizedCandidate;
  const right = process.platform === "win32" ? normalizedRoot.toLocaleLowerCase("en-US") : normalizedRoot;
  return left === right || left.startsWith(`${right}${sep}`);
}

export class AgentSkillService {
  readonly #createLoader: (projectPath: string) => ResourceLoader;

  constructor(dependencies: AgentSkillServiceDependencies = {}) {
    this.#createLoader = dependencies.createLoader ?? ((projectPath) => new DefaultResourceLoader({
      cwd: projectPath,
      agentDir: getAgentDir(),
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    }));
  }

  async discover(projectPath: string, trusted: boolean): Promise<AgentSkillSnapshot> {
    const loader = this.#createLoader(projectPath);
    await loader.reload();
    const skills = loader.getSkills();
    const names = new Set(skills.skills
      .filter((skill) => trusted || !insidePath(skill.filePath, projectPath))
      .map((skill) => skill.name));
    return Object.freeze({ names, discoveredAt: new Date().toISOString() });
  }

  async assertAgentsReady(projectPath: string, trusted: boolean, agents: readonly AgentDefinition[]): Promise<void> {
    const requiredAgents = agents.filter((agent) => (agent.requiredSkills?.length ?? 0) > 0);
    if (requiredAgents.length === 0) return;
    const disabled = requiredAgents.find((agent) => agent.disableSkills);
    if (disabled) throw new Error(`Agent ${disabled.name} 配置了必需 Skills，但 disableSkills=true`);
    const snapshot = await this.discover(projectPath, trusted);
    for (const agent of requiredAgents) {
      const missing = (agent.requiredSkills ?? []).filter((skill) => !snapshot.names.has(skill));
      if (missing.length > 0) {
        throw new Error(
          `Agent ${agent.name} 缺少必需 Pi Skills：${missing.join("、")}。`
          + "请把 Skill 安装到受信任项目的 .pi/skills，或用户目录 ~/.pi/agent/skills 后重试。",
        );
      }
    }
  }
}
