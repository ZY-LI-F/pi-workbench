import { expect, test } from "@playwright/test";
import { e2eScreenshotPath } from "./helpers/screenshot-path";
import { nativeFixture } from "./helpers/native-fixture";

test("discovers, adds, removes and tests models without coupling configuration to a chat task", async ({}, testInfo) => {
  const fixture = await nativeFixture(testInfo);
  const { window, requests } = fixture;
  try {
    await fixture.openChat();
    await window.getByRole("button", { name: "模型配置", exact: true }).click();
    await expect(window.getByRole("heading", { name: "模型配置", exact: true })).toBeVisible({ timeout: 30_000 });
    await window.getByLabel("Provider 列表").getByRole("button", { name: /OpenAI-Compatible Local/ }).click();

    const currentKey = window.getByLabel("OpenAI-Compatible Local 当前 API key");
    await expect(currentKey).toHaveValue("");
    await expect(currentKey).toHaveAttribute("placeholder", /点击查看/);
    await window.getByRole("button", { name: "查看当前 API key" }).click();
    await expect(currentKey).toHaveValue("stella-e2e-secret");
    await window.getByRole("button", { name: "隐藏当前 API key" }).click();
    await expect(currentKey).toHaveValue("");

    await window.getByRole("button", { name: "编辑配置" }).click();
    const providerDialog = window.getByRole("dialog", { name: "配置 OpenAI-Compatible Local" });
    await expect(providerDialog).toBeVisible();
    await providerDialog.getByRole("button", { name: "发现远端模型" }).click();
    await expect(providerDialog.getByText("Discovered Validation Model")).toBeVisible();
    await providerDialog.screenshot({ path: testInfo.outputPath("model-discovery-dialog.png"), animations: "disabled" });
    await providerDialog.getByLabel("移除模型 stella-e2e-model").click();
    await providerDialog.getByLabel("添加模型 stella-e2e-model-2").click();
    await providerDialog.getByRole("button", { name: "保存并应用" }).click();
    await expect(providerDialog).toBeHidden({ timeout: 30_000 });
    expect(requests.find((request) => request.path === "/v1/models")?.authorization).toBe("Bearer stella-e2e-secret");

    await expect(window.getByLabel("连接测试模型")).toHaveValue("stella-e2e-model-2", { timeout: 30_000 });
    await window.getByRole("button", { name: "测试 OpenAI-Compatible Local 连通性" }).click();
    await expect(window.getByText("连通已验证")).toBeVisible({ timeout: 30_000 });
    await expect(window.getByLabel("OpenAI-Compatible Local 连通测试")).toContainText("stella-e2e-model-2");
    expect(requests.findLast((request) => request.body)?.authorization).toBe("Bearer stella-e2e-secret");

    for (const notice of await window.getByRole("button", { name: "关闭通知" }).all()) {
      if (await notice.isVisible()) await notice.click();
    }
    await window.setViewportSize({ width: 1850, height: 1178 });
    await window.screenshot({ path: e2eScreenshotPath(testInfo, "model-configuration-stella.png"), fullPage: true, animations: "disabled" });
    await window.setViewportSize({ width: 600, height: 900 });
    const providerConsole = window.locator(".provider-console");
    await expect.poll(() => window.locator(".provider-saved-key").evaluate((element) => getComputedStyle(element).display)).toBe("grid");
    await expect.poll(() => providerConsole.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await window.screenshot({ path: testInfo.outputPath("model-configuration.png"), fullPage: true, animations: "disabled" });
    await providerConsole.screenshot({ path: testInfo.outputPath("model-configuration-console.png"), animations: "disabled" });
    expect(fixture.pageErrors).toEqual([]);
    expect(fixture.providerErrors).toEqual([]);
  } finally { await fixture.close(); }
});
