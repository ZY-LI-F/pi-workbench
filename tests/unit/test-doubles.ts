import type { AgentDefinition } from "../../src/shared/kanban";

/** Explicit test double: individual skill-discovery failure paths use their own rejecting implementation. */
export const READY_AGENT_SKILLS = Object.freeze({
  async assertAgentsReady(_projectPath: string, _trusted: boolean, _agents: readonly AgentDefinition[]): Promise<void> {
    return undefined;
  },
});

export const TEST_COORDINATOR_EXTENSION = "C:/stella-test/resources/extensions/coordinator-action.ts";
