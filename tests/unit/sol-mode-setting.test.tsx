import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SOL_MODE } from "../../src/shared/sol-mode";
import { SolModeSetting } from "../../src/renderer/src/components/SolModeSetting";

afterEach(cleanup);
const snapshot = { config: DEFAULT_SOL_MODE, phase: "disabled" as const, features: [], auxiliaryTokens: 0, activities: [] };
it("distinguishes draft enablement from actual runtime activation and requires explicit advanced model choice", () => {
  const apply = vi.fn();
  render(<SolModeSetting state={{ snapshot, busy: false }} models={[{ id: "m", provider: "p", name: "Aux", contextWindow: 10000, reasoning: false }]} runtimeBusy={false} onApply={apply} />);
  fireEvent.click(screen.getByRole("switch", { name: "启用 Sol 模式" }));
  expect(screen.getByRole("status").textContent).toBe("已关闭 · 原生 Pi");
  fireEvent.click(screen.getByRole("switch", { name: "EPR · 辅助模型提炼" }));
  expect(screen.getByRole("alert").textContent).toContain("选择已有");
  expect((screen.getByRole("button", { name: "应用 Sol 设置" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "Sol 辅助模型" }), { target: { value: JSON.stringify(["p", "m"]) } });
  fireEvent.click(screen.getByRole("button", { name: "应用 Sol 设置" }));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, evidencePreservingReducer: true, onlineContextCompact: false, reducerProvider: "p", reducerModel: "m" }));
});
it("allows preparing settings but never applies during a live operation", () => {
  render(<SolModeSetting state={{ snapshot, busy: false }} models={[]} runtimeBusy onApply={vi.fn()} />);
  fireEvent.click(screen.getByRole("switch", { name: "启用 Sol 模式" }));
  expect((screen.getByRole("button", { name: "应用 Sol 设置" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/请等待空闲后应用/).textContent).toContain("不会打断任务");
});
