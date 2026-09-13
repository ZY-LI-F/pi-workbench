import { expect, test } from "@playwright/test";
import { nativeFixture } from "./helpers/native-fixture";
import { e2eScreenshotPath } from "./helpers/screenshot-path";

test("settings guide works offline with illustrations, keyboard navigation and a narrow window", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo);
  try {
    const { window, app } = fixture;
    await window.getByRole("button", { name: "偏好设置", exact: true }).click();
    const settings = window.getByRole("dialog", { name: "偏好设置", exact: true });
    const entry = settings.getByRole("button", { name: /功能介绍与操作说明/ });
    await expect(entry).toBeVisible();
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "settings-guide-entry.png") });
    await window.context().setOffline(true);
    await entry.click();
    const guide = window.getByRole("dialog", { name: "功能介绍与操作说明", exact: true });
    await expect(guide).toBeVisible();
    const tabs = guide.getByRole("tab");
    await expect(tabs).toHaveCount(6);
    for (let index = 0; index < 6; index++) {
      await tabs.nth(index).click();
      await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
      await expect(guide.getByRole("tabpanel").locator("li")).toHaveCount(3);
      await expect.poll(() => guide.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    await tabs.nth(0).click();
    await tabs.nth(0).press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(guide.getByRole("heading", { name: "不选项目也能记任务", exact: true })).toBeVisible();
    await expect(guide.getByRole("tabpanel")).toContainText("不选择项目");
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "user-guide-desktop.png") });
    await app.evaluate(({ BrowserWindow }) => { const main = BrowserWindow.getAllWindows()[0]!; main.setMinimumSize(400, 400); main.setSize(720, 800); });
    await window.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await guide.getByRole("button", { name: "下一主题" }).click();
    const content = guide.getByRole("tabpanel");
    await expect.poll(() => content.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect.poll(() => guide.evaluate((element) => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await content.hover();
    await window.mouse.wheel(0, 1000);
    await expect.poll(() => content.evaluate((element) => element.scrollTop > 0)).toBe(true);
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "user-guide-narrow.png") });
    await window.keyboard.press("Escape");
    await expect(guide).toBeHidden();
    await expect(settings).toBeVisible();
    await expect(entry).toBeFocused();
    await window.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    expect(fixture.requests.filter((request) => request.body)).toHaveLength(0);
    expect(fixture.pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});
