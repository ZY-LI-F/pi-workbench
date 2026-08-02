// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { LocalFilePreviewService } from "../../src/main/local-file-preview-service";
import { localFilePreviewDescriptor } from "../../src/shared/file-preview";

describe("local file preview", () => {
  it("maps supported document types without claiming legacy xls support", () => {
    expect(localFilePreviewDescriptor("report.DOCX")?.kind).toBe("docx");
    expect(localFilePreviewDescriptor("deck.pptx")?.kind).toBe("pptx");
    expect(localFilePreviewDescriptor("book.xlsx")?.kind).toBe("spreadsheet");
    expect(localFilePreviewDescriptor("book.xlsm")?.kind).toBe("spreadsheet");
    expect(localFilePreviewDescriptor("legacy.xls")).toBeUndefined();
    expect(localFilePreviewDescriptor("page.html")?.kind).toBe("html");
    expect(localFilePreviewDescriptor("notes.md")?.kind).toBe("markdown");
  });

  it("re-inspects the path and returns an immutable copy of its bytes", async () => {
    const source = new Uint8Array([1, 2, 3]);
    const readFile = vi.fn(async () => source);
    const service = new LocalFilePreviewService({
      inspectLocalPath: vi.fn(async () => ({
        canonicalPath: "C:\\workspace\\notes.md",
        name: "notes.md",
        kind: "file",
        directOpenAllowed: true,
        preview: { kind: "markdown", mimeType: "text/markdown" },
      })),
      readFile,
    });

    const preview = await service.read("C:\\workspace\\notes.md");
    source[0] = 99;
    expect([...preview.bytes]).toEqual([1, 2, 3]);
    expect(preview).toMatchObject({ kind: "markdown", sizeBytes: 3, name: "notes.md" });
    expect(readFile).toHaveBeenCalledWith("C:\\workspace\\notes.md");
  });

  it("surfaces directories and unsupported files as explicit errors", async () => {
    const directory = new LocalFilePreviewService({
      inspectLocalPath: vi.fn(async () => ({
        canonicalPath: "C:\\workspace\\output",
        name: "output",
        kind: "directory",
        directOpenAllowed: true,
      })),
      readFile: vi.fn(),
    });
    await expect(directory.read("C:\\workspace\\output")).rejects.toThrow("只有普通文件可以预览");

    const unsupported = new LocalFilePreviewService({
      inspectLocalPath: vi.fn(async () => ({
        canonicalPath: "C:\\workspace\\script.ps1",
        name: "script.ps1",
        kind: "file",
        directOpenAllowed: false,
      })),
      readFile: vi.fn(),
    });
    await expect(unsupported.read("C:\\workspace\\script.ps1")).rejects.toThrow("暂不支持预览该文件类型");
  });
});
