// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareNumericText, parseDelimited, tableRowIndices, type TableQuery } from "../../src/renderer/src/lib/delimited-data";
import { parseNotebook } from "../../src/renderer/src/lib/notebook-data";
import { reviewStatus, searchJson, verificationReport } from "../../src/renderer/src/lib/verification-report";
import { pdfFragmentPage, previewParent, previewText } from "../../src/renderer/src/lib/artifact-preview";
import { localFilePreviewDescriptor } from "../../src/shared/file-preview";

const bytes = (source: string) => new TextEncoder().encode(source);
const base: TableQuery = { header: true, search: "", filterColumn: 0, filter: "", sortColumn: 0, sort: "original" };
describe("scientific delimited data", () => {
  it("preserves identifiers, formulas, empty rows, quoted multiline cells and BOM", () => {
    const table = parseDelimited(bytes('\uFEFFid,note,value\r\n001,"a,b\nsecond ""quote""",9007199254740993\r\n002,=SUM(A1:A2),0.0000000001\r\n\r\n'), ",");
    expect(table.rows).toEqual([["id", "note", "value"], ["001", 'a,b\nsecond "quote"', "9007199254740993"], ["002", "=SUM(A1:A2)", "0.0000000001"], [""], [""]]);
    expect(table.columns).toBe(3);
    expect(parseDelimited(bytes("a\tb\n001\t  spaced  "), "\t").rows[1]).toEqual(["001", "  spaced  "]);
  });
  it("reports malformed quotes and encoding, with explicit selectable legacy encodings", () => {
    expect(() => parseDelimited(bytes('a,b\n1,"unterminated'), ",")).toThrow("记录");
    expect(() => parseDelimited(new Uint8Array([0xd6, 0xd0]), ",")).toThrow("utf-8");
    expect(parseDelimited(new Uint8Array([0xd6, 0xd0]), ",", "gb18030").rows).toEqual([["中"]]);
    expect(previewText(new Uint8Array([0xff, 0xfe, 0x41, 0]))).toBe("A");
    expect(previewText(new Uint8Array([0xfe, 0xff, 0, 0x41]))).toBe("A");
    expect(parseDelimited(bytes(""), ",").rows).toEqual([]);
  });
  it.each([
    ["9007199254740993", "9007199254740992", 1], [".01", "0.0100", 0], ["-1e9", "-1e8", -1], ["-0", "0e300", 0],
    ["1e100000", "99e99998", 1], ["0.001", "1e-3", 0], ["-0.1", "0", -1], ["001", "2", -1], ["NaN", "1", 1],
  ])("sorts decimal text %s versus %s without numeric coercion", (a, b, order) => {
    expect(Math.sign(compareNumericText(a, b))).toBe(order);
  });
  it("sorts, searches and filters full data without mutating or truncating it", () => {
    const rows = [["id", "value"], ...Array.from({ length: 12001 }, (_, index) => [`ID-${index}`, String(index)]), ["missing", "NA"]];
    expect(tableRowIndices(rows, { ...base, search: "ID-12000" })).toEqual([12001]);
    expect(tableRowIndices(rows, { ...base, filterColumn: 0, filter: "ID-2", sortColumn: 1, sort: "number-desc" })[0]).toBe(3000);
    const sorted = tableRowIndices(rows, { ...base, sortColumn: 1, sort: "number-desc" });
    expect(sorted[0]).toBe(12001); expect(sorted.at(-1)).toBe(12002); expect(sorted).toHaveLength(12002);
    expect(rows[1]).toEqual(["ID-0", "0"]);
    expect(tableRowIndices(rows, { ...base, header: false })).toHaveLength(12003);
  });
});

describe("saved notebooks and report semantics", () => {
  const notebook = (cells: unknown[], version = 4) => JSON.stringify({ nbformat: version, nbformat_minor: 5, metadata: { language_info: { name: "python" } }, cells });
  it("reads saved markdown, attachments, source, errors and unsupported MIME without interpreting them", () => {
    const result = parseNotebook(notebook([
      { cell_type: "markdown", source: ["# Results\n", "![plot](attachment:plot.png)"], attachments: { "plot.png": { "image/png": "YWJj" }, "__proto__": {} } },
      { cell_type: "code", source: "print('saved')", execution_count: 7, outputs: [
        { output_type: "stream", name: "stdout", text: ["one\n", "two"] },
        { output_type: "display_data", data: { "application/vnd.jupyter.widget-view+json": { model_id: "not-executed" } } },
        { output_type: "error", ename: "ValueError", evalue: "saved", traceback: ["line one", "line two"] },
      ] }, { cell_type: "raw", source: "raw" }, { cell_type: "code", source: "", execution_count: null, outputs: [] },
    ]));
    expect(result.language).toBe("python"); expect(result.cells).toHaveLength(4);
    expect(result.cells[0]!.source).toContain("\n!"); expect(Object.getPrototypeOf(result.cells[0]!.attachments)).toBeNull();
    expect(result.cells[1]!.outputs[0]!.text).toBe("one\ntwo");
    expect(result.cells[1]!.outputs[2]!.text).toBe("ValueError: saved\nline one\nline two");
    expect(result.cells[3]!.outputs).toEqual([]);
  });
  it("rejects broken structure, old formats and invented stream types", () => {
    expect(() => parseNotebook("bad")).toThrow(); expect(() => parseNotebook(notebook([], 3))).toThrow("nbformat 4");
    for (const cell of [{ cell_type: "alien", source: "" }, { cell_type: "markdown", source: 4 }, { cell_type: "code", source: "", execution_count: 1 }, { cell_type: "code", source: "", execution_count: null, outputs: [{ output_type: "stream", name: "fake", text: "" }] }]) expect(() => parseNotebook(notebook([cell]))).toThrow();
  });
  it("never promotes limitations or missing fields to verified scientific success", () => {
    const report = verificationReport({ status: "reviewed_with_limitations", issues: [], limitations: ["pages not reviewed"], mechanical_ok: true });
    expect(report?.status.tone).toBe("warning"); expect(report?.mechanical).toBe("通过"); expect(report?.reviewed).toBe("未声明全部复核");
    expect(verificationReport({ status: "reviewed" })?.mechanical).toBe("未记录");
    expect(verificationReport({ status: "reviewed" })?.issues).toBeUndefined();
    expect(verificationReport({ status: "completed" })).toBeUndefined(); expect(reviewStatus("toString")).toBeUndefined();
    expect(searchJson({ documents: [{ evidence: "page-004.json" }] }, "004")).toEqual([{ path: "$.documents[0].evidence", value: "page-004.json" }]);
  });
  it("handles native root paths, explicit PDF page links and registered source formats", () => {
    expect(previewParent("C:\\file.md")).toBe("C:\\"); expect(previewParent("/file.md")).toBe("/"); expect(previewParent("C:\\")).toBe("C:\\");
    expect(pdfFragmentPage("page=65")).toBe(65); for (const fragment of ["page=0", "page=-1", "page=1.5", "Chapter 3"]) expect(pdfFragmentPage(fragment)).toBeUndefined();
    for (const ext of ["py", "r", "sh", "ps1", "js", "ts", "mjs", "jsx", "tsx"]) expect(localFilePreviewDescriptor(`source.${ext}`)?.kind).toBe("code");
    expect(localFilePreviewDescriptor("result.ipynb")?.kind).toBe("notebook");
  });
});
