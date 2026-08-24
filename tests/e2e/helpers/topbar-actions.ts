import { expect, type Page } from "@playwright/test";

async function visibleTopbarAction(window: Page, name: string) {
  const topbar = window.locator(".topbar");
  const direct = topbar.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) return direct;

  const trigger = topbar.getByRole("button", { name: "更多会话操作", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const overflow = topbar.getByRole("menu", { name: "更多会话操作" }).getByRole("menuitem", { name });
  await expect(overflow).toBeVisible();
  return overflow;
}

export async function expectTopbarActionReachable(window: Page, name: string): Promise<void> {
  const action = await visibleTopbarAction(window, name);
  await expect(action).toBeVisible();
  if (await window.getByRole("menu", { name: "更多会话操作" }).isVisible()) {
    await window.keyboard.press("Escape");
  }
}

export async function clickTopbarAction(window: Page, name: string): Promise<void> {
  await (await visibleTopbarAction(window, name)).click();
}
