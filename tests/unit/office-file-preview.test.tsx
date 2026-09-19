import React from "react";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { StellaDesktopApi } from "../../src/shared/contracts";
import type { LocalFilePreviewData, LocalFilePreviewKind } from "../../src/shared/file-preview";
import type { LocalPathInspection } from "../../src/shared/local-path";
import { FilePreviewPanel } from "../../src/renderer/src/components/FilePreviewPanel";

afterEach(cleanup);

const MIME_BY_KIND: Readonly<Record<LocalFilePreviewKind, string>> = Object.freeze({
  image: "image/png",
  html: "text/html",
  markdown: "text/markdown",
  text: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  spreadsheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

function inspection(path: string, kind: LocalFilePreviewKind): LocalPathInspection {
  return Object.freeze({
    canonicalPath: path,
    name: path.split(/[\\/]/).at(-1) ?? path,
    kind: "file",
    directOpenAllowed: true,
    preview: Object.freeze({ kind, mimeType: MIME_BY_KIND[kind] }),
  });
}

function renderPreview(path: string, kind: LocalFilePreviewKind, bytes: Uint8Array): void {
  const target = inspection(path, kind);
  const data: LocalFilePreviewData = Object.freeze({
    ...target.preview!,
    canonicalPath: path,
    name: target.name,
    sizeBytes: bytes.byteLength,
    bytes,
  });
  const api = {
    inspectLocalPath: vi.fn(async () => target),
    readLocalFilePreview: vi.fn(async () => data),
    openPath: vi.fn(async () => undefined),
    revealPath: vi.fn(async () => undefined),
    copyText: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
  } as unknown as StellaDesktopApi;
  render(<FilePreviewPanel api={api} inspection={target} references={[]} onSelect={vi.fn()} />);
}

async function minimalDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>CDK2 靶点评估报告</w:t></w:r></w:p>
        <w:p><w:r><w:t>Word 右侧栏样式预览验证</w:t></w:r></w:p>
        <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
      </w:body>
    </w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

async function minimalXlsx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    </Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="靶点评分" sheetId="1" r:id="rId1"/><sheet name="风险清单" sheetId="2" r:id="rId2"/></sheets>
    </workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
    </Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <dimension ref="A1:B2"/>
      <sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>靶点</t></is></c><c r="B1" t="inlineStr"><is><t>综合评分</t></is></c></row>
        <row r="2"><c r="A2" t="inlineStr"><is><t>CDK2</t></is></c><c r="B2"><v>92</v></c></row>
      </sheetData>
    </worksheet>`);
  zip.file("xl/worksheets/sheet2.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <dimension ref="A1:A2"/>
      <sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>风险项</t></is></c></row>
        <row r="2"><c r="A2" t="inlineStr"><is><t>选择性</t></is></c></row>
      </sheetData>
    </worksheet>`);
  return zip.generateAsync({ type: "uint8array" });
}

describe("right inspector Office and Markdown preview", () => {
  it("renders GFM Markdown content and table structure", async () => {
    const source = new TextEncoder().encode("# CDK2 结论\n\n| 维度 | 评分 |\n| --- | ---: |\n| 遗传学 | 8.5 |\n");
    renderPreview("C:\\workspace\\target-report.md", "markdown", source);

    expect(await screen.findByRole("heading", { name: "CDK2 结论" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "8.5" })).toBeTruthy();
  });

  it("renders Word document text and page styling without Office", async () => {
    renderPreview("C:\\workspace\\target-report.docx", "docx", await minimalDocx());

    expect(await screen.findByText("CDK2 靶点评估报告", {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByText("Word 右侧栏样式预览验证")).toBeTruthy();
    expect(document.querySelector(".file-preview__docx-pages .docx-wrapper section.docx")).toBeTruthy();
  }, 20_000);

  it("renders Excel sheets, cells, row headers and column headers", async () => {
    const user = userEvent.setup();
    renderPreview("C:\\workspace\\target-score.xlsx", "spreadsheet", await minimalXlsx());

    expect(await screen.findByRole("tab", { name: "靶点评分" }, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByText("CDK2")).toBeTruthy();
    expect(screen.getByText("92")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "A" })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "2" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "风险清单" }));
    expect(screen.getByText("选择性")).toBeTruthy();
  }, 20_000);

  it("parses the real project PPTX into navigable slides", async () => {
    const user = userEvent.setup();
    const bytes = new Uint8Array(await readFile(join(process.cwd(), "docs", "PI-GUI_产品能力与交互说明.pptx")));
    renderPreview("C:\\workspace\\PI-GUI_产品能力与交互说明.pptx", "pptx", bytes);

    const picker = await screen.findByRole("combobox", { name: "跳转幻灯片" }, { timeout: 30_000 });
    expect((picker as HTMLSelectElement).value).toBe("0");
    expect(screen.getByTitle("PI-GUI_产品能力与交互说明.pptx 第 1 张")).toBeTruthy();
    expect(screen.getByTitle("PI-GUI_产品能力与交互说明.pptx 第 1 张").getAttribute("sandbox")).toBe("");
    expect(screen.getByRole("button", { name: "适应整页" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "放大预览" })).toBeNull();
    expect((screen.getByRole("button", { name: "上一张幻灯片" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "下一张幻灯片" }) as HTMLButtonElement).disabled).toBe(false);
    await user.selectOptions(picker, "9");
    expect(screen.getByTitle("PI-GUI_产品能力与交互说明.pptx 第 10 张")).toBeTruthy();
    expect((screen.getByRole("button", { name: "下一张幻灯片" }) as HTMLButtonElement).disabled).toBe(true);
    screen.getByRole("region", { name: "PowerPoint 幻灯片预览" }).focus();
    await user.keyboard("{Home}{ArrowRight}");
    expect((picker as HTMLSelectElement).value).toBe("1");
    await user.click(screen.getByRole("button", { name: "按原始尺寸预览" }));
    expect(screen.getByRole("button", { name: "适应整页" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByRole("button", { name: "适应整页" }));
    expect(screen.getByRole("button", { name: "适应整页" }).getAttribute("aria-pressed")).toBe("true");
  }, 35_000);
});
