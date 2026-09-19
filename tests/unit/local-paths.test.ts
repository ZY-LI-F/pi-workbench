import { describe, expect, it } from "vitest";
import { extractLocalPaths, normalizeLocalPathCandidate } from "../../src/renderer/src/lib/local-paths";

describe("local path extraction", () => {
  it("recognizes bold generated PPTX paths with spaces and Chinese names", () => {
    const path = "C:\\研究 资料\\报告_审定版.pptx";
    expect(extractLocalPaths(`已生成 **${path}**，请查看。`)).toEqual([path]);
    expect(extractLocalPaths(`**https://example.com/report.pptx**`)).toEqual([]);
  });
  it("recognizes descriptive labels without mistaking the label for part of the path", () => {
    expect(extractLocalPaths("参考文件：C:\\project\\README.md\nReport: /Users/stella/report.docx\n交付物：C:\\研究 资料\\报告.md"))
      .toEqual(["C:\\project\\README.md", "/Users/stella/report.docx", "C:\\研究 资料\\报告.md"]);
    expect(extractLocalPaths("链接：https://example.com/report.md\nhttps://example.com")).toEqual([]);
  });
  it("recognizes the Windows output directory shown by Pi", () => {
    const path = "C:\\Users\\qq108\\Documents\\PI-GUI\\test-results\\pi-gui-pptx\\";
    expect(extractLocalPaths(`中间文件位置\n\n\`${path}\``)).toEqual([path]);
  });

  it("keeps Chinese names and spaces in complete code or quoted paths", () => {
    const presentation = "C:\\Users\\Stella\\Documents\\研究 输出\\PI-GUI_产品能力与交互说明.pptx";
    expect(extractLocalPaths(`输出文件：\`${presentation}\`\n\"${presentation}\"`)).toEqual([presentation]);
  });

  it("extracts fenced and labelled absolute paths without duplicating Windows casing", () => {
    const output = extractLocalPaths([
      "```text",
      "C:\\Work\\Result.pptx",
      "C:\\work\\result.pptx",
      "```",
      "目录：/Users/stella/work/results",
    ].join("\n"));
    expect(output).toEqual(["C:\\Work\\Result.pptx", "/Users/stella/work/results"]);
  });

  it("ignores URLs, relative paths and code fragments", () => {
    expect(extractLocalPaths("https://example.com/report\n./report.pptx\n`@oai/artifact-tool`\n`npm run build`")).toEqual([]);
    expect(normalizeLocalPathCandidate("路径：C:\\Work\\report.pptx。"))
      .toBe("C:\\Work\\report.pptx");
  });
});
