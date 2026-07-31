// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deriveTeamLaunchDraft } from "../../src/shared/team-launch";

const ACCEPTANCE = "报告包含可核查来源、反证与下一步实验";

describe("deriveTeamLaunchDraft", () => {
  it("derives a deterministic title and explicit defaults from one LEAD instruction", () => {
    expect(deriveTeamLaunchDraft("@LEAD 评估 NLRP3 作为帕金森病早研靶点。覆盖临床竞品和关键风险。", ACCEPTANCE))
      .toEqual({
        title: "评估 NLRP3 作为帕金森病早研靶点",
        objective: "评估 NLRP3 作为帕金森病早研靶点。覆盖临床竞品和关键风险。",
        acceptanceCriteria: ACCEPTANCE,
        priority: "medium",
      });
  });

  it("requires acceptance criteria and exactly one LEAD in the task launchpad", () => {
    expect(() => deriveTeamLaunchDraft("@LEAD 研究问题", " ")).toThrow("验收标准");
    expect(() => deriveTeamLaunchDraft("先研究一下这个问题", ACCEPTANCE)).toThrow("需要通过 @LEAD");
    expect(() => deriveTeamLaunchDraft("@LEAD", ACCEPTANCE)).toThrow("写明任务目标");
    expect(() => deriveTeamLaunchDraft("@BUILD 直接修改项目", ACCEPTANCE)).toThrow("只接受 @LEAD");
    expect(() => deriveTeamLaunchDraft("@LEAD 规划后让 @BUILD 开始", ACCEPTANCE)).toThrow("只接受 @LEAD");
    expect(() => deriveTeamLaunchDraft("@LEAD 请规划，稍后再问 @LEAD", ACCEPTANCE)).toThrow("只能包含一个 @LEAD");
  });

  it("limits long Unicode titles without splitting code points", () => {
    const draft = deriveTeamLaunchDraft(`@LEAD ${"靶点证据".repeat(14)}`, ACCEPTANCE);
    expect(Array.from(draft.title).length).toBe(43);
    expect(draft.title.endsWith("…")).toBe(true);
  });
});
