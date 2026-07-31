import { expect, test } from "@playwright/test";
import { launchPharmaApp } from "./helpers/pharma-app";

interface ModelOption {
  readonly value: string;
  readonly label: string;
}

test("runs a real Pi conversation through Alibaba Bailian Qwen", async ({}, testInfo) => {
  const { electronApp, window } = await launchPharmaApp(testInfo, { teamFeatures: false });
  const pageErrors: string[] = [];
  window.on("pageerror", (error) => pageErrors.push(error.message));
  const expectedLabel = process.env.STELLA_QWEN_MODEL_LABEL ?? "Qwen 3.6 Flash (Aliyun MaaS)";
  const nonce = `STELLA_QWEN_LIVE_${Date.now()}`;
  const startedAt = Date.now();

  try {
    const globalModel = window.getByRole("combobox", { name: "全局模型" });
    const modelOptions = await globalModel.locator("option").evaluateAll((options): ModelOption[] =>
      options.map((option) => ({
        value: (option as HTMLOptionElement).value,
        label: option.textContent?.trim() ?? "",
      })),
    );
    const qwen = modelOptions.find((option) => option.value.startsWith("aliyun-maas/") && option.label.includes(expectedLabel));
    if (!qwen) {
      throw new Error(`Pi 模型目录没有已配置的阿里百炼模型“${expectedLabel}”；实际选项：${modelOptions.map((option) => option.label).join("、")}`);
    }

    await globalModel.selectOption(qwen.value);
    await expect(globalModel).toHaveValue(qwen.value);
    await expect(window.getByLabel("全局运行模型")).toContainText(expectedLabel);

    await window.getByRole("button", { name: "当前会话", exact: true }).click();
    await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
    await window.getByLabel("思考级别").selectOption("off");

    const prompt = `这是 Stella 的阿里百炼真实连通验证。不要调用任何工具，只回复一行：${nonce}`;
    await window.getByLabel("给 Pi 的消息").fill(prompt);
    await window.getByRole("button", { name: "发送", exact: true }).click();

    await expect(window.locator(".message--user", { hasText: nonce }).last()).toBeVisible({ timeout: 10_000 });
    const assistant = window.locator(".message--assistant").last();
    await expect(assistant).toBeVisible({ timeout: 180_000 });
    await expect(assistant).toContainText(nonce);
    await expect(assistant).toContainText("aliyun-maas /");
    await expect(assistant.locator(".assistant-error")).toHaveCount(0);
    await expect(assistant.locator(".assistant-actions")).toContainText(/\d[\d,]* tokens/);

    const stats = await window.evaluate(() => window.stella.command({ type: "get_session_stats" }));
    if (!stats.success) throw new Error(`读取 Qwen 会话统计失败：${stats.error}`);
    const evidence = Object.freeze({
      provider: "aliyun-maas",
      modelOption: qwen,
      nonce,
      durationMs: Date.now() - startedAt,
      stats: "data" in stats ? stats.data : undefined,
    });
    await testInfo.attach("aliyun-qwen-live-result.json", {
      body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8"),
      contentType: "application/json",
    });
    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});
