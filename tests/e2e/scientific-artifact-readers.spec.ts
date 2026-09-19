import { expect, test } from "@playwright/test";
import { access, copyFile, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { nativeFixture, protocolReply } from "./helpers/native-fixture";
import { createScientificArtifacts } from "./helpers/scientific-artifact-fixture";

test("the real inspector follows paper, table, PDF and MCP links while retaining narrow width and reading position", async ({}, testInfo) => {
  let files: Awaited<ReturnType<typeof createScientificArtifacts>>;
  const fixture = await nativeFixture(testInfo, (request, response) => protocolReply(response, request.model, `Synthetic reader fixture\n\n**${files.paper}**`), {}, async ({ projectDir }) => { files = await createScientificArtifacts(projectDir); });
  const { window } = fixture;
  try {
    await fixture.openChat(); await window.getByLabel("给 Pi 的消息").fill("显示测试产物"); await window.getByLabel("给 Pi 的消息").press("Enter");
    await window.getByRole("button", { name: `预览文件 ${files!.paper}`, exact: true }).click();
    await expect(window.locator(".katex")).toBeVisible();
    await expect.poll(() => window.getByRole("img", { name: "Saved figure" }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(560);
    await window.getByRole("separator", { name: "调整检查器宽度" }).focus(); await window.getByRole("separator", { name: "调整检查器宽度" }).press("Home");
    const width = await window.locator(".inspector").evaluate((element) => element.getBoundingClientRect().width);
    await window.getByRole("link", { name: "数据表", exact: true }).scrollIntoViewIfNeeded();
    const scroll = await window.locator(".file-preview__stage").evaluate((element) => element.scrollTop);
    expect(scroll).toBeGreaterThan(300);
    await window.getByRole("link", { name: "数据表", exact: true }).click();
    await expect(window.getByRole("cell", { name: "9007199254740993", exact: true })).toBeVisible();
    await window.getByRole("combobox", { name: "排序列", exact: true }).selectOption("0");
    await window.getByRole("combobox", { name: "表格排序方式" }).selectOption("number-desc");
    await expect(window.locator(".artifact-table-scroll tbody tr").first()).toContainText("9007199254740993");
    await window.getByRole("button", { name: "下一页数据" }).click(); await expect(window.locator(".artifact-pagination")).toContainText("2 / 2");
    await window.getByRole("textbox", { name: "搜索表格" }).fill("case-109"); await expect(window.locator(".artifact-table-scroll tbody tr")).toHaveCount(1);
    expect(await window.locator(".inspector").evaluate((element) => element.getBoundingClientRect().width)).toBe(width);
    await window.screenshot({ path: testInfo.outputPath("csv-narrow-reader.png"), animations: "disabled" });
    await window.getByRole("button", { name: "返回上一文件" }).click();
    await expect(window.getByRole("heading", { name: "Molecular evidence" })).toBeAttached();
    await expect.poll(() => window.locator(".file-preview__stage").evaluate((element) => element.scrollTop)).toBeGreaterThan(scroll - 10);
    await window.getByRole("link", { name: "原文第二页" }).click();
    await expect(window.getByRole("combobox", { name: "跳转 PDF 页" })).toHaveValue("2");
    await expect(window.locator(".textLayer").getByText("Scientific evidence page two", { exact: true })).toBeAttached();
    await window.getByRole("button", { name: "返回上一文件" }).click();
    await window.getByRole("link", { name: "无效页码" }).click(); await expect(window.getByRole("alert")).toContainText("只有 2 页");
    await window.getByRole("button", { name: "返回上一文件" }).click();
    await window.getByRole("link", { name: "缺失证据" }).click(); await expect(window.getByRole("alert")).toContainText(/ENOENT|不存在/);
    await window.getByRole("link", { name: "接口说明" }).click(); await window.getByRole("link", { name: "工具源码" }).click();
    await window.getByLabel("源码行号", { exact: true }).fill("242"); await window.getByRole("button", { name: "定位", exact: true }).click();
    await expect(window.locator(".artifact-code__source")).toContainText("DO_NOT_EXECUTE.txt");
    expect(await access(join(fixture.projectDir, "DO_NOT_EXECUTE.txt")).then(() => true, () => false)).toBe(false);
    await window.screenshot({ path: testInfo.outputPath("source-readonly.png"), animations: "disabled" });
    await window.getByRole("button", { name: "返回上一文件" }).click(); await window.getByRole("link", { name: "工具 Schema" }).click();
    await expect(window.getByRole("region", { name: "JSON 阅读器" })).toBeVisible();
    await window.getByRole("button", { name: "查看原始 JSON" }).click(); await expect(window.locator(".artifact-raw")).toContainText("inputSchema");
    await window.getByRole("button", { name: "关闭检查器" }).click(); await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
    expect(fixture.pageErrors).toEqual([]); expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("directory selection, limited verification and saved notebook outputs use the real IPC without executing scripts", async ({}, testInfo) => {
  let files: Awaited<ReturnType<typeof createScientificArtifacts>>;
  const fixture = await nativeFixture(testInfo, (request, response) => protocolReply(response, request.model, `**${files.report}**\n\n**${files.notebook}**`), {}, async ({ projectDir }) => { files = await createScientificArtifacts(projectDir); });
  const { window } = fixture; const external: string[] = [];
  window.on("request", (request) => { if (request.url().includes("unsafe.invalid")) external.push(request.url()); });
  try {
    await fixture.openChat(); await window.getByLabel("给 Pi 的消息").fill("查看验证与保存的 notebook"); await window.getByLabel("给 Pi 的消息").press("Enter");
    await window.getByRole("button", { name: `预览文件 ${files!.report}`, exact: true }).click();
    await expect(window.getByText("已复核（存在限制）", { exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "查看产物 assets/表 #1.csv" })).toBeDisabled();
    await window.getByRole("button", { name: "产物目录", exact: true }).click();
    await fixture.app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await window.getByRole("button", { name: "选择产物目录" }).click(); await expect(window.getByRole("dialog")).toContainText("verification.json");
    await fixture.app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, files!.pack);
    await window.getByRole("button", { name: "选择产物目录" }).click();
    await expect(window.getByRole("button", { name: "产物根目录", exact: true })).toBeVisible();
    await window.getByLabel("搜索当前目录").fill("results"); await expect(window.getByRole("list", { name: "目录内容" }).getByRole("button")).toHaveCount(1);
    await window.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await window.screenshot({ path: testInfo.outputPath("verification-with-limitations.png"), animations: "disabled" });
    await window.getByRole("button", { name: "查看产物 assets/表 #1.csv" }).click(); await expect(window.getByRole("cell", { name: "001", exact: true })).toBeVisible();
    await window.getByRole("combobox", { name: "切换会话文件" }).selectOption(files!.notebook.toLowerCase());
    await expect(window.getByRole("heading", { name: "Saved notebook" })).toBeVisible();
    await expect.poll(() => window.getByRole("img", { name: "cell figure" }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(200);
    await expect(window.getByText("Saved metric: 0.85", { exact: true })).toBeVisible();
    const frame = window.frameLocator('iframe[title="Notebook 静态 HTML 输出"]');
    await expect(frame.getByRole("cell", { name: "0.85", exact: true })).toBeVisible();
    await expect(window.locator('iframe[title="Notebook 静态 HTML 输出"]')).toHaveAttribute("sandbox", "");
    expect(await frame.locator("body").evaluate(() => (window as Window & { unsafe?: number }).unsafe)).toBeUndefined();
    await expect(window.getByText("未保存输出；不会自动执行此单元。", { exact: true })).toBeAttached();
    await window.screenshot({ path: testInfo.outputPath("notebook-saved-outputs.png"), animations: "disabled" });
    expect(external).toEqual([]); expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test("actual local Paper2Skill reading package, report, image and original PDF remain navigable", async ({}, testInfo) => {
  const source = process.env.STELLA_REAL_PAPER_BUNDLE;
  test.skip(!source, "Set STELLA_REAL_PAPER_BUNDLE to an existing Paper2Skill directory; private papers are not committed as fixtures.");
  let pack = ""; let report = "";
  const fixture = await nativeFixture(testInfo, (request, response) => protocolReply(response, request.model, `**${join(pack, "references", "paper.md")}**\n\n**${report}**`), {}, async ({ projectDir }) => {
    pack = join(projectDir, "paper-package"); await cp(source!, pack, { recursive: true });
    const review = join(projectDir, "evidence"); await mkdir(join(review, "originals"), { recursive: true });
    const original = join(dirname(source!), "moleculenet-review"); report = join(review, "verification.json");
    await copyFile(join(original, "verification.json"), report);
    await copyFile(join(original, "originals", "s001-moleculenet-author-manuscript.pdf"), join(review, "originals", "source.pdf"));
  });
  const { window } = fixture;
  try {
    await fixture.openChat(); await window.getByLabel("给 Pi 的消息").fill("打开已有真实论文阅读包；不运行复现"); await window.getByLabel("给 Pi 的消息").press("Enter");
    await window.getByRole("button", { name: `预览文件 ${join(pack, "references", "paper.md")}`, exact: true }).click();
    await expect(window.locator(".file-preview__markdown")).toContainText("MoleculeNet");
    await window.locator('.file-preview__markdown a[href$=".csv"]').first().click();
    await expect(window.locator(".artifact-table-scroll tbody tr").first()).toBeVisible();
    await window.screenshot({ path: testInfo.outputPath("real-paper-table.png"), animations: "disabled" });
    await window.getByRole("combobox", { name: "切换会话文件" }).selectOption(report.toLowerCase());
    await expect(window.getByText("已复核（存在限制）", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "产物目录", exact: true }).click();
    await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, pack);
    await window.getByRole("button", { name: "选择产物目录", exact: true }).click(); await window.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await window.getByRole("button", { name: "查看产物 assets/figure/figure-p0006-003.jpg", exact: true }).click();
    await expect.poll(() => window.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(100);
    await window.screenshot({ path: testInfo.outputPath("real-paper-figure.png"), animations: "disabled" });
    await window.getByRole("button", { name: "产物目录", exact: true }).click();
    await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(fixture.projectDir, "evidence", "originals"));
    await window.getByRole("button", { name: "关联证据目录", exact: true }).click();
    await window.getByRole("list", { name: "目录内容" }).getByRole("button").filter({ hasText: "source.pdf" }).click();
    await expect(window.getByRole("combobox", { name: "跳转 PDF 页" })).toContainText("65");
    await window.getByRole("combobox", { name: "跳转 PDF 页" }).selectOption("6");
    await expect(window.locator('.file-preview__pdf-page[data-page="6"] canvas')).toBeVisible();
    await window.screenshot({ path: testInfo.outputPath("real-paper-original-pdf.png"), animations: "disabled" });
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});
