import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { e2eScreenshotPath } from "./helpers/screenshot-path";

let server: Server;
let origin: string;
test.beforeAll(async () => {
  const root = resolve("apps/companion/dist");
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const path = resolve(root, `.${pathname === "/" ? "/index.html" : decodeURIComponent(pathname)}`);
      if (!path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
      const content = await readFile(path);
      response.writeHead(200, { "content-type": ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" } as Record<string, string>)[extname(path)] ?? "application/octet-stream" });
      response.end(content);
    } catch (cause) { response.writeHead(500); response.end(cause instanceof Error ? cause.message : String(cause)); }
  });
  await new Promise<void>((resolveStart) => server.listen(0, "127.0.0.1", resolveStart));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Companion preview server has no port");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { server?.closeAllConnections(); await new Promise<void>((resolveClose) => server?.close(() => resolveClose())); });

test("Companion settings offers an offline illustrated guide before pairing", async ({ page }, testInfo) => {
  // Production Web assets only; no synthetic host or successful command path.
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog");
  await expect(settings.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await settings.getByRole("button", { name: /功能介绍与操作说明/ }).click();
  const topics = settings.getByRole("navigation", { name: "操作说明主题" }).getByRole("button");
  await expect(topics).toHaveCount(4);
  for (let index = 0; index < 4; index++) {
    await topics.nth(index).click();
    await expect(settings.locator("li")).toHaveCount(3);
    await expect.poll(() => settings.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect.poll(() => settings.getByRole("article").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await topics.nth(0).click();
  await page.screenshot({ path: e2eScreenshotPath(testInfo, "user-guide-android-web.png") });
  await settings.getByRole("article").hover();
  await page.mouse.wheel(0, 1000);
  await expect(settings.getByRole("button", { name: "下一主题 →" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
