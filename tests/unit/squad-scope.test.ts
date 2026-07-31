// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BoardRepository } from "../../src/main/board-repository";
import { BoardService } from "../../src/main/board-service";
import { SquadService } from "../../src/main/squad-service";
import { EMPTY_BOARD_STATE, parseBoardState, type BoardState } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

class MemoryRepository implements BoardRepository {
  state: BoardState = EMPTY_BOARD_STATE;
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

describe("Squad project scope", () => {
  it("binds a Squad containing a project Agent and rejects cross-project targets", async () => {
    const repository = new MemoryRepository();
    let sequence = 0;
    const dependencies = {
      repository,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      emitChanged: () => undefined,
      projectIdentity: (path: string) => path.replaceAll("\\", "/").toLocaleLowerCase(),
      id: () => `scope-${++sequence}`,
      now: () => "2026-07-26T00:00:00.000Z",
    };
    const board = new BoardService(dependencies);
    const squads = new SquadService(dependencies);
    await board.createProjectAgent({
      name: "项目研究员", callsign: "LOCAL", responsibility: "项目研究", instructions: "只读并报告来源",
      workspaceAccess: "read", allowedTools: ["read"], thinking: "medium", disableExtensions: true,
      disableSkills: true, disablePromptTemplates: true, disableContextFiles: true, projectPath: "C:/project",
    });
    const customId = repository.state.customAgents[0]?.id;
    if (!customId) throw new Error("项目 Agent 未创建");

    const created = await squads.create({
      name: "本项目小队", description: "", leaderAgentId: "planner", memberAgentIds: [customId], leaderInstructions: "只在本项目委派",
    }, "C:/project");
    const squad = created.board.squads[0];
    expect(squad).toMatchObject({ version: 1, scope: "project", projectPath: "C:/project" });

    await expect(board.createTask({
      title: "越权任务", description: "", acceptanceCriteria: "", priority: "medium",
      projectPath: "C:/other", projectName: "other", trusted: true,
      executionTarget: { kind: "squad", squadId: squad!.id },
    })).rejects.toThrow("属于其他项目");
  });
});
