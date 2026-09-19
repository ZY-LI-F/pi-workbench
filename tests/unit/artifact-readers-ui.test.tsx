import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StellaDesktopApi } from "../../src/shared/contracts";
import type { LocalFilePreviewData } from "../../src/shared/file-preview";
import AcademicMarkdown from "../../src/renderer/src/components/AcademicMarkdown";
import JsonPreview from "../../src/renderer/src/components/JsonPreview";
import NotebookPreview from "../../src/renderer/src/components/NotebookPreview";
import CodePreview from "../../src/renderer/src/components/CodePreview";
import { ArtifactLibraryPicker } from "../../src/renderer/src/components/ArtifactLibraryPicker";
import { sanitizedSvg } from "../../src/renderer/src/components/ArtifactMedia";

afterEach(cleanup);
const data = (name: string, source: string): LocalFilePreviewData => ({ name, canonicalPath: `C:\\paper\\${name}`, kind: name.endsWith("ipynb") ? "notebook" : "json", mimeType: "application/json", sizeBytes: source.length, bytes: new TextEncoder().encode(source) });
describe("artifact readers UI", () => {
  it("renders math, distinct duplicate heading anchors, footnotes and real link actions without raw HTML", async () => {
    const user = userEvent.setup(); const navigate = vi.fn(async () => undefined); const external = vi.fn(async () => undefined);
    const { container } = render(<AcademicMarkdown api={{ openExternal: external } as unknown as StellaDesktopApi} source={'# Methods\n\n$x^2$\n\n## Methods\n\n[table](../assets/table.csv) [doi](https://doi.org/10.1/test) text[^1]\n\n[^1]: evidence note\n\n<script>window.unsafe=1</script>'} fromPath="C:\\paper\\references\\paper.md" onNavigate={navigate} />);
    expect(container.querySelector(".katex")).toBeTruthy();
    expect(container.querySelector("h1")?.id).toBe("methods"); expect(container.querySelector("h2")?.id).toBe("methods-1");
    expect(container.querySelector("script")).toBeNull(); expect(screen.getByText("evidence note")).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "table" })); expect(navigate).toHaveBeenCalledWith("../assets/table.csv");
    await user.click(screen.getByRole("link", { name: "doi" })); expect(external).toHaveBeenCalledWith("https://doi.org/10.1/test");
  });
  it("presents restricted report status, requires artifact-root association and retains original JSON", async () => {
    const user = userEvent.setup(); const navigate = vi.fn(async () => undefined);
    const report = data("verification.json", '{"status":"reviewed_with_limitations","artifact_checks":[{"file":"assets/a.csv"}],"limit":9007199254740993}');
    const view = render(<JsonPreview data={report} onNavigate={navigate} />);
    expect(screen.getByText("已复核（存在限制）")).toBeTruthy(); expect(screen.getByText(/机械检查：未记录/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "查看产物 assets/a.csv" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<JsonPreview data={report} onNavigate={navigate} artifactRoot={"C:\\package"} />);
    await user.click(screen.getByRole("button", { name: "查看产物 assets/a.csv" })); expect(navigate).toHaveBeenCalledWith("assets/a.csv", "C:\\package");
    await user.click(screen.getByRole("button", { name: "查看原始 JSON" })); expect(screen.getByText(/9007199254740993/)).toBeTruthy();
  });
  it("shows saved notebook outputs, static sandbox and unsupported widgets without claiming execution", async () => {
    const document = data("saved.ipynb", JSON.stringify({ nbformat: 4, cells: [
      { cell_type: "markdown", source: "# Saved analysis" },
      { cell_type: "code", source: "do_not_execute()", execution_count: 2, outputs: [
        { output_type: "display_data", data: { "text/html": '<table><tr><td>Saved metric</td></tr></table><script>window.unsafe=1</script>' } },
        { output_type: "display_data", data: { "application/vnd.jupyter.widget-view+json": { model_id: "none" } } },
        { output_type: "error", ename: "Error", evalue: "saved problem", traceback: [] },
      ] }, { cell_type: "code", source: "no_saved_result", execution_count: null, outputs: [] },
    ] }));
    const { container } = render(<NotebookPreview data={document} api={{ copyText: vi.fn() } as unknown as StellaDesktopApi} onNavigate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Saved analysis" })).toBeTruthy();
    const frame = container.querySelector("iframe")!; expect(frame.getAttribute("sandbox")).toBe(""); expect(frame.srcdoc).toContain("default-src 'none'");
    expect(screen.getByText(/不支持可视化此输出格式/)).toBeTruthy(); expect(screen.getByText("未保存输出；不会自动执行此单元。")).toBeTruthy();
    expect(screen.getByText("文件保存的错误输出")).toBeTruthy(); expect(container.querySelector("script")).toBeNull();
  });
  it("paginates all source lines, escapes HTML and copies the complete original", async () => {
    const user = userEvent.setup(); const copy = vi.fn(async () => undefined);
    const source = Array.from({ length: 405 }, (_, index) => `print('${index} <script>never()</script>')`).join("\n");
    const { container } = render(<CodePreview name="analysis.py" source={source} onCopy={copy} />);
    expect(container.querySelector("script")).toBeNull(); expect(container.querySelectorAll(".artifact-code__numbers span")).toHaveLength(200);
    await user.type(screen.getByLabelText("源码行号"), "405"); await user.click(screen.getByRole("button", { name: "定位" }));
    expect(screen.getByText("401–405 / 405 行")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "复制完整源码" })); expect(copy).toHaveBeenCalledWith(source);
  });
  it("keeps the directory after a cancelled chooser, supports local search and visible unavailable entries", async () => {
    const user = userEvent.setup(); const root = vi.fn(); const select = vi.fn();
    const directory = { name: "paper", kind: "directory", canonicalPath: "C:\\paper", directOpenAllowed: true } as const;
    const file = { name: "paper.md", kind: "file", canonicalPath: "C:\\paper\\paper.md", preview: { kind: "markdown", mimeType: "text/markdown" }, directOpenAllowed: true } as const;
    const api = { chooseArtifactDirectory: vi.fn(async () => null), listArtifactDirectory: vi.fn(async () => ({ directory, entries: [{ name: "paper.md", path: file.canonicalPath, inspection: file }, { name: "missing.md", path: "missing", error: "file missing" }] })) } as unknown as StellaDesktopApi;
    render(<ArtifactLibraryPicker api={api} initialPath={directory.canonicalPath} onRoot={root} onSelect={select} onClose={vi.fn()} />);
    await screen.findByText("file missing"); await user.click(screen.getByRole("button", { name: "选择产物目录" }));
    expect(root).not.toHaveBeenCalled(); await user.type(screen.getByLabelText("搜索当前目录"), "paper");
    await waitFor(() => expect(within(screen.getByRole("list", { name: "目录内容" })).getAllByRole("button")).toHaveLength(1));
    await user.click(within(screen.getByRole("list", { name: "目录内容" })).getByRole("button")); expect(select).toHaveBeenCalledWith(file);
  });
  it("removes SVG scripts, foreign content, style resources and event handlers", () => {
    const safe = sanitizedSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="unsafe()"><style>@import "https://example.com";</style><script>bad()</script><foreignObject/><image href="https://example.com/x"/><rect fill="url(https://example.com/x)"/></svg>');
    expect(safe).not.toMatch(/onload|script|foreignObject|https:|<style/); expect(() => sanitizedSvg("not xml")).toThrow();
    const scientific = sanitizedSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>.axis { stroke: #555; fill: none; }</style><rect class="axis" style="fill: url(#local-gradient); stroke-width: 2"/><image href="data:image/png;base64,aGVhdG1hcA=="/></svg>');
    expect(scientific).toContain(".axis"); expect(scientific).toContain("url(#local-gradient)"); expect(scientific).toContain("data:image/png;base64,");
  });
  it("does not remount document links when callbacks or runtime metrics refresh", () => {
    const api = {} as StellaDesktopApi;
    const view = render(<AcademicMarkdown api={api} source="[read table](table.csv)" fromPath="/paper.md" onNavigate={vi.fn()} />);
    const before = screen.getByRole("link", { name: "read table" });
    view.rerender(<AcademicMarkdown api={api} source="[read table](table.csv)" fromPath="/paper.md" onNavigate={vi.fn()} />);
    expect(screen.getByRole("link", { name: "read table" })).toBe(before);
  });
  it("keeps a directory permission failure visible after native chooser cancellation", async () => {
    const user = userEvent.setup();
    const api = { listArtifactDirectory: vi.fn(async () => { throw new Error("directory no longer authorized"); }), chooseArtifactDirectory: vi.fn(async () => null) } as unknown as StellaDesktopApi;
    render(<ArtifactLibraryPicker api={api} initialPath="/missing" onRoot={vi.fn()} onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("alert"); await user.click(screen.getByRole("button", { name: "选择产物目录" }));
    expect(screen.getByRole("alert").textContent).toContain("directory no longer authorized");
  });
  it("does not mistake a generic status for paper verification or malformed JSON for an empty object", () => {
    const view = render(<JsonPreview data={data("task.json", '{"status":"reviewed"}')} onNavigate={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "验证报告摘要" })).toBeNull();
    view.rerender(<JsonPreview data={data("broken.json", '{"missing":')} onNavigate={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("JSON 解析失败"); expect(screen.getByText('{"missing":')).toBeTruthy();
  });
  it.each([
    ["analysis.r", "function(x) { mean(x) }"], ["run.sh", "if true; then echo safe; fi"], ["run.ps1", "function Safe { return 1 }"],
    ["module.js", "const value = '<script>never()</script>';"], ["types.ts", "interface Result { value: number }"],
  ])("renders registered source grammar %s without interpreting source markup", (name, source) => {
    const { container } = render(<CodePreview name={name} source={source} />);
    expect(container.querySelector('[class^="hljs-"]')).toBeTruthy();
    expect(container.querySelector(".artifact-code__source code")?.textContent).toBe(source);
    expect(container.querySelector("script")).toBeNull();
  });
});
