import { describe, expect, it } from "vitest";
import { fileReferenceText } from "../../src/renderer/src/lib/file-reference";
import type { LocalFilePreviewData } from "../../src/shared/file-preview";

const data: LocalFilePreviewData = { canonicalPath: "C:/report.md", name: "report.md", kind: "markdown", mimeType: "text/markdown", sizeBytes: 0,
  bytes: new TextEncoder().encode("标题\n证据一\n证据二\nPRIVATE-WHOLE-FILE"), version: "abcd1234" };
describe("preview references", () => {
  it("references only the path and exact version unless text was selected", () => {
    const ref = fileReferenceText(data);
    expect(ref).toContain("sha256:abcd1234"); expect(ref).toContain('"C:/report.md"'); expect(ref).not.toContain("PRIVATE-WHOLE-FILE");
  });
  it("preserves selected text as quoted source evidence and locates unique source lines", () => {
    const ref = fileReferenceText(data, "证据一\n证据二");
    expect(ref).toContain("第 2–3 行"); expect(ref).toContain("> 证据一\n> 证据二"); expect(ref).not.toContain("PRIVATE-WHOLE-FILE");
  });
  it("does not fabricate source lines for transformed rendered text", () => {
    expect(fileReferenceText(data, "rendered selection")).toContain("未映射到源文件行号");
    expect(() => fileReferenceText({ ...data, version: undefined })).toThrow("缺少版本");
  });
});
