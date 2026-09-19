import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityHealthSnapshot } from "@shared/capabilities";
import type { RuntimeBootstrap, StellaDesktopApi } from "@shared/contracts";
import { EMPTY_BOARD_STATE, type KanbanTask } from "@shared/kanban";
import { DEFAULT_SOL_MODE } from "@shared/sol-mode";
import { BUILTIN_ORCHESTRATION_CATALOG } from "@shared/orchestration-catalog";
import { CapabilityHealthStore } from "../../src/main/capability-health";
import { App } from "../../src/renderer/src/App";
import { DEFAULT_PREFERENCES, PREFERENCES_STORAGE_KEY } from "../../src/renderer/src/hooks/use-preferences";

const UPDATED_AT = "2026-07-18T00:00:00.000Z";

function healthSnapshot(piState: "ready" | "error", piError?: string): CapabilityHealthSnapshot {
  return Object.freeze({
    pi: Object.freeze({ state: piState, error: piError, updatedAt: UPDATED_AT }),
    task: Object.freeze({ state: "ready", updatedAt: UPDATED_AT }),
    schedule: Object.freeze({ state: "error", error: "schedule injection", updatedAt: UPDATED_AT }),
    webhook: Object.freeze({ state: "error", error: "EADDRINUSE", updatedAt: UPDATED_AT }),
  });
}

const TASK: KanbanTask = Object.freeze({
  id: "task-history",
  title: "保留的任务历史",
  description: "Pi 失败时仍应可见",
  acceptanceCriteria: "执行按钮禁用",
  priority: "high",
  projectPath: "C:/project",
  projectName: "project",
  trusted: true,
  executionTarget: Object.freeze({ kind: "agent", agentId: "builder" }),
  stage: "planned",
  specRevision: 1,
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
});

const PI_BOOTSTRAP = {
  project: { cwd: "C:/project", name: "project", trusted: false, requiresTrust: false, requiresSelection: false },
  recentProjects: [],
  state: {
    thinkingLevel: "off",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    sessionId: "session-offline-draft",
    autoCompactionEnabled: true,
    messageCount: 0,
    pendingMessageCount: 0,
  },
  messages: [],
  models: [],
  thinkingLevels: ["off"],
  commands: [],
  sessions: [],
  stats: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 },
  entries: [],
  tree: [],
  leafId: null,
  piVersion: "0.82.1",
} as unknown as RuntimeBootstrap;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
});

afterEach(() => cleanup());

describe("Capability Health", () => {
  it("keeps immutable independent states and rejects ambiguous errors", () => {
    const emitted = vi.fn();
    const store = new CapabilityHealthStore({ now: () => UPDATED_AT, emitChanged: emitted });
    const initial = store.snapshot();

    store.set("pi", "error", "Pi injection");
    const result = store.set("task", "ready");

    expect(initial.pi.state).toBe("loading");
    expect(initial.task.state).toBe("loading");
    expect(result.pi).toMatchObject({ state: "error", error: "Pi injection" });
    expect(result.task).toMatchObject({ state: "ready", error: undefined });
    expect(Object.isFrozen(result)).toBe(true);
    expect(emitted).toHaveBeenCalledTimes(2);
    expect(() => store.set("webhook", "error")).toThrow("必须提供错误原因");
    expect(() => store.set("schedule", "ready", "stale error")).toThrow("不能携带错误原因");
  });

  it("contains injected optional-service failures to their own capabilities", async () => {
    const store = new CapabilityHealthStore({ now: () => UPDATED_AT, emitChanged: () => undefined });
    store.set("pi", "ready");
    store.set("task", "ready");

    const [scheduleStarted, webhookStarted] = await Promise.all([
      store.run("schedule", async () => { throw new Error("invalid schedule state"); }),
      store.run("webhook", async () => undefined),
    ]);

    expect(scheduleStarted).toBe(false);
    expect(webhookStarted).toBe(true);
    expect(store.snapshot().schedule).toMatchObject({ state: "error", error: "invalid schedule state" });
    expect(store.snapshot().webhook.state).toBe("ready");
    expect(store.snapshot().pi.state).toBe("ready");
    expect(store.snapshot().task.state).toBe("ready");
  });

  it("shows Task history while Pi failed and disables execution", async () => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ ...DEFAULT_PREFERENCES, teamFeaturesEnabled: true }));
    const snapshot = healthSnapshot("error", "Pi startup injection");
    const api = {
      solModeGet: vi.fn(async () => ({ config: DEFAULT_SOL_MODE, phase: "disabled", features: [], auxiliaryTokens: 0, activities: [] })),
      capabilities: vi.fn(async () => snapshot),
      retryCapability: vi.fn(async () => snapshot),
      executionBackendsInitialize: vi.fn(async () => ({ health: [], profiles: [] })),
      initialize: vi.fn(async () => { throw new Error("Pi startup injection"); }),
      boardInitialize: vi.fn(async () => ({
        board: Object.freeze({ ...EMPTY_BOARD_STATE, tasks: Object.freeze([TASK]) }),
        catalog: BUILTIN_ORCHESTRATION_CATALOG,
      })),
      onEvent: vi.fn(() => () => undefined),
      chooseProject: vi.fn(async () => null),
      skinArtworkInitialize: vi.fn(async () => Object.freeze([])),
      windowAction: vi.fn(async () => undefined),
    } as unknown as StellaDesktopApi;

    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: "任务看板" }));
    expect(await screen.findByRole("heading", { name: "任务星图" })).toBeTruthy();
    expect(screen.getByText("保留的任务历史")).toBeTruthy();
    expect((screen.getByRole("button", { name: "分发任务 保留的任务历史" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("tab", { name: "PI 原生工作台" }));
    await user.click(screen.getByRole("button", { name: "当前会话" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Pi 工作区暂不可用" })).toBeTruthy());
    expect(screen.getByText("Pi startup injection")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看任务看板" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "重试 Pi" }));
    await waitFor(() => expect(api.retryCapability).toHaveBeenCalledWith("pi"));
  });

  it("keeps the real chat composer mounted when Pi health is temporarily unavailable", async () => {
    const snapshot = healthSnapshot("error", "provider connection interrupted");
    const drafts = new Map<string, { readonly key: string; readonly text: string; readonly images: readonly never[]; readonly updatedAt: number }>();
    const api = {
      solModeGet: vi.fn(async () => ({ config: DEFAULT_SOL_MODE, phase: "disabled", features: [], auxiliaryTokens: 0, activities: [] })),
      capabilities: vi.fn(async () => snapshot),
      retryCapability: vi.fn(async () => snapshot),
      executionBackendsInitialize: vi.fn(async () => ({ health: [], profiles: [] })),
      initialize: vi.fn(async () => PI_BOOTSTRAP),
      refresh: vi.fn(async () => PI_BOOTSTRAP),
      command: vi.fn(async () => ({ success: true, command: "set_auto_retry", data: {} })),
      boardInitialize: vi.fn(async () => ({
        board: EMPTY_BOARD_STATE,
        catalog: BUILTIN_ORCHESTRATION_CATALOG,
      })),
      onEvent: vi.fn(() => () => undefined),
      chooseProject: vi.fn(async () => null),
      skinArtworkInitialize: vi.fn(async () => Object.freeze([])),
      composerDraftLoad: vi.fn(async (key: string) => drafts.get(key)),
      composerDraftSave: vi.fn(async (input: { readonly key: string; readonly text: string; readonly images: readonly never[] }) => {
        if (input.text.length === 0 && input.images.length === 0) drafts.delete(input.key);
        else drafts.set(input.key, Object.freeze({ ...input, updatedAt: Date.now() }));
      }),
      windowAction: vi.fn(async () => undefined),
    } as unknown as StellaDesktopApi;

    const user = userEvent.setup();
    render(<App api={api} />);
    const composer = await screen.findByLabelText("给 Pi 的消息");

    expect(screen.getByText("Pi 暂不可用，当前草稿已保留")).toBeTruthy();
    await user.type(composer, "连接恢复前继续整理附件说明");
    expect((composer as HTMLTextAreaElement).value).toBe("连接恢复前继续整理附件说明");
    expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
