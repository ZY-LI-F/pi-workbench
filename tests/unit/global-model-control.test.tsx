import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelSummary } from "../../src/shared/contracts";
import { GlobalModelControl } from "../../src/renderer/src/components/GlobalModelControl";

const MODELS: readonly ModelSummary[] = Object.freeze([
  Object.freeze({ provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet", contextWindow: 200_000, reasoning: true }),
  Object.freeze({ provider: "openai", id: "gpt-global", name: "GPT Global", contextWindow: 128_000, reasoning: true }),
]);

afterEach(() => cleanup());

describe("GlobalModelControl", () => {
  it("shows the current provider and model and emits the selected shared model", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <GlobalModelControl
        models={MODELS}
        selectedModel={MODELS[0]}
        teamFeaturesEnabled
        online
        busy={false}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("当前模型 · anthropic")).toBeTruthy();
    expect(screen.getByText("Claude Sonnet")).toBeTruthy();
    expect(screen.getByText(/会话、团队与看板共用/)).toBeTruthy();
    const selector = screen.getByRole("combobox", { name: "全局模型" });
    expect((selector as HTMLSelectElement).value).toBe("anthropic/claude-sonnet");

    await user.selectOptions(selector, "openai/gpt-global");
    expect(onChange).toHaveBeenCalledWith(MODELS[1]);
  });

  it("exposes the offline state and prevents model changes while Pi is unavailable", () => {
    render(
      <GlobalModelControl
        models={MODELS}
        selectedModel={MODELS[0]}
        teamFeaturesEnabled={false}
        online={false}
        busy={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Pi 离线")).toBeTruthy();
    expect(screen.getByText(/当前 Pi 会话使用/)).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "全局模型" }) as HTMLSelectElement).disabled).toBe(true);
  });
});
