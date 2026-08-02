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
        targetToken: "lead",
      });
  });

  it("requires acceptance criteria and exactly one explicit owner", () => {
    expect(() => deriveTeamLaunchDraft("@LEAD 研究问题", " ")).toThrow("验收标准");
    expect(() => deriveTeamLaunchDraft("先研究一下这个问题", ACCEPTANCE)).toThrow("指定负责人");
    expect(() => deriveTeamLaunchDraft("@LEAD", ACCEPTANCE)).toThrow("写明任务目标");
    expect(() => deriveTeamLaunchDraft("@LEAD 规划后让 @BUILD 开始", ACCEPTANCE)).toThrow("只能指定一个负责人");
    expect(() => deriveTeamLaunchDraft("@LEAD 请规划，稍后再问 @LEAD", ACCEPTANCE)).toThrow("只能指定一个负责人");
  });

  it("supports direct Worker ownership for a clear task", () => {
    expect(deriveTeamLaunchDraft("@BUILD 实现并验证模型选择器", ACCEPTANCE)).toMatchObject({
      targetToken: "build",
      title: "实现并验证模型选择器",
      objective: "实现并验证模型选择器",
    });
  });

  it("limits long Unicode titles without splitting code points", () => {
    const draft = deriveTeamLaunchDraft(`@LEAD ${"靶点证据".repeat(14)}`, ACCEPTANCE);
    expect(Array.from(draft.title).length).toBe(43);
    expect(draft.title.endsWith("…")).toBe(true);
  });
});
