// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("native chat layout contract", () => {
  it("keeps the composer inside a single bounded application row", async () => {
    const css = await readFile(join(process.cwd(), "src", "renderer", "src", "styles", "app.css"), "utf8");
    const appShell = css.match(/\.app-shell\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const workspace = css.match(/\.workspace\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const emptyConversation = css.match(/\.empty-conversation\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";

    expect(appShell).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(appShell).toContain("min-height: 0");
    expect(workspace).toContain("grid-template-rows: var(--topbar-height) minmax(0, 1fr) auto");
    expect(workspace).toContain("min-height: 0");
    expect(emptyConversation).toContain("min-height: 100%");
    expect(emptyConversation).not.toContain("100vh");
  });

  it("hosts session file previews inside the resizable inspector column", async () => {
    const css = await readFile(join(process.cwd(), "src", "renderer", "src", "styles", "app.css"), "utf8");
    const inspectorLayout = css.match(/\.app-shell\.has-inspector\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const inspectorFilePanel = css.match(/\.inspector-file-panel\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const previewPanel = css.match(/\.file-preview-panel\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const previewBody = css.match(/\.file-preview-panel__body\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const previewReader = css.match(/\.file-preview__reader\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const previewToolbar = css.match(/(?:^|\n)\.file-preview__toolbar\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const previewError = css.match(/\.file-preview__action-error\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const previewStage = css.match(/\.file-preview__stage\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";

    expect(inspectorLayout).toContain("var(--inspector-width)");
    expect(inspectorFilePanel).toContain("flex: 1");
    expect(inspectorFilePanel).toContain("overflow: hidden");
    expect(previewPanel).toContain("container-type: inline-size");
    expect(previewPanel).toContain("height: 100%");
    expect(previewBody).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(previewReader).toContain("height: 100%");
    expect(previewReader).toContain("grid-template-rows: auto auto minmax(0, 1fr)");
    expect(previewToolbar).toContain("grid-row: 1");
    expect(previewError).toContain("grid-row: 2");
    expect(previewStage).toContain("grid-row: 3");
    expect(previewStage).toContain("height: 100%");
    expect(previewStage).toContain("overflow: auto");
  });

  it("collapses topbar actions from the actual middle-column width", async () => {
    const css = await readFile(join(process.cwd(), "src", "renderer", "src", "styles", "app.css"), "utf8");
    const workspace = css.match(/\.workspace\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const topbar = css.match(/\.topbar\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const composer = css.match(/\.composer-wrap\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body ?? "";
    const topbarLayer = Number(topbar.match(/z-index:\s*(\d+)/u)?.[1]);
    const composerLayer = Number(composer.match(/z-index:\s*(\d+)/u)?.[1]);

    expect(workspace).toContain("container-name: workspace-pane");
    expect(workspace).toContain("container-type: inline-size");
    expect(topbarLayer).toBeGreaterThan(composerLayer);
    expect(css).toMatch(/@container workspace-pane \(max-width: 900px\)[\s\S]*?\.topbar__more\s*\{[\s\S]*?display: block/u);
    expect(css).toMatch(/@container workspace-pane \(max-width: 760px\)[\s\S]*?\.topbar \.thinking-control\s*\{[\s\S]*?display: none/u);
    expect(css).toMatch(/@container workspace-pane \(max-width: 760px\)[\s\S]*?\.topbar__session-track button:not\(\.is-current\)\s*\{[\s\S]*?display: none/u);
  });
});
