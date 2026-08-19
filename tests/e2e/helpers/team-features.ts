import { expect, type Page } from "@playwright/test";

export async function enableTeamFeatures(window: Page): Promise<void> {
  const sidebar = window.locator(".sidebar");
  await expect(sidebar.getByRole("tab", { name: "任务栏", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(window.getByRole("button", { name: "团队协作", exact: true })).toHaveCount(0);
  await expect(window.getByRole("button", { name: "任务看板", exact: true })).toBeVisible();

  await sidebar.getByRole("tab", { name: "PI 原生工作台", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: "当前会话", exact: true })).toBeVisible();

  await window.keyboard.press("Control+K");
  const palette = window.getByRole("dialog", { name: "搜索与命令" });
  await expect(palette.getByRole("option", { name: /打开团队协作/ })).toHaveCount(0);
  await expect(palette.getByRole("option", { name: /打开任务看板/ })).toBeVisible();
  await window.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  await window.getByRole("button", { name: "偏好设置", exact: true }).click();
  const settings = window.getByRole("dialog", { name: "偏好设置" });
  const teamFeatures = settings.getByRole("switch", { name: "显示团队功能" });
  await expect(teamFeatures).toHaveAttribute("aria-checked", "false");
  await teamFeatures.click();
  await expect(teamFeatures).toHaveAttribute("aria-checked", "true");
  await window.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  const openSidebar = window.getByRole("button", { name: "打开侧栏", exact: true });
  if (await openSidebar.isVisible()) {
    await openSidebar.click();
    await expect(window.locator(".sidebar")).toHaveClass(/is-open/);
  }
  await sidebar.getByRole("tab", { name: "任务栏", exact: true }).click();
  await expect(window.getByRole("button", { name: "团队协作", exact: true })).toBeVisible();
  await expect(window.getByRole("button", { name: "任务看板", exact: true })).toBeVisible();
}
