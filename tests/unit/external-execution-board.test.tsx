import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalExecutionBoard } from "../../src/renderer/src/features/kanban/ExternalExecutionBoard";
import type { ExternalExecutionCatalogSnapshot, ExternalExecutionItem } from "../../src/shared/external-execution";

const NOW = "2026-08-24T08:00:00.000Z";

function item(association?: ExternalExecutionItem["association"]): ExternalExecutionItem {
  return Object.freeze({
    sourceId: "claude",
    externalId: "session-1",
    nativeId: "agent-1",
    kind: "background",
    title: "Claude 后台修复",
    summary: "等待选择实现方案",
    projectPath: "/repo",
    session: Object.freeze({ backendId: "claude", sessionId: "session-1" }),
    state: "needs-input",
    needsInput: true,
    waitingFor: "请选择实现方案",
    terminal: false,
    process: Object.freeze({ pid: 42, status: "waiting", alive: true }),
    updatedAt: NOW,
    association,
  });
}

function snapshot(execution = item()): ExternalExecutionCatalogSnapshot {
  return Object.freeze({
    epoch: 1,
    scope: Object.freeze({ kind: "all" }),
    capturedAt: NOW,
    sources: Object.freeze([Object.freeze({
      source: Object.freeze({
        id: "claude",
        label: "Claude Agents",
        description: "fixture",
        supportsDetails: false,
        supportsImport: true,
        supportsContinue: true,
      }),
      state: "ready",
      stale: false,
      lastSuccessfulAt: NOW,
      items: Object.freeze([execution]),
    })]),
  });
}

afterEach(() => cleanup());

describe("ExternalExecutionBoard", () => {
  it("renders external cards as read-only and exposes only import/continue actions", async () => {
    const onImport = vi.fn(async () => ({ taskId: "task-imported", created: true }));
    const onContinue = vi.fn(async () => ({ kind: "command-copied" as const, message: "claude attach agent-1" }));
    const onOpenTask = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<ExternalExecutionBoard
      snapshot={snapshot()}
      loading={false}
      refreshing={false}
      busy={[]}
      query=""
      onRefresh={async () => snapshot()}
      onImport={onImport}
      onContinue={onContinue}
      onOpenTask={onOpenTask}
    />);

    expect(screen.getByText("Claude 后台修复")).toBeTruthy();
    expect(screen.getByText("请选择实现方案")).toBeTruthy();
    expect(container.querySelector("article")?.getAttribute("draggable")).toBeNull();
    expect(screen.queryByText("开始执行")).toBeNull();
    expect(screen.queryByText("评论")).toBeNull();

    await user.click(screen.getByRole("button", { name: /继续 Session/u }));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ externalId: "session-1" }));
    expect(await screen.findByText(/已复制继续命令/u)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /导入为 Task/u }));
    expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ externalId: "session-1" }));
    expect(onOpenTask).toHaveBeenCalledWith("task-imported");
  });

  it("opens an associated Task instead of offering a duplicate import", async () => {
    const onOpenTask = vi.fn();
    const user = userEvent.setup();
    render(<ExternalExecutionBoard
      snapshot={snapshot(item({ taskId: "task-managed", relation: "managed" }))}
      loading={false}
      refreshing={false}
      busy={[]}
      query=""
      onRefresh={async () => snapshot()}
      onImport={async () => ({ taskId: "unexpected", created: true })}
      onContinue={async () => ({ kind: "command-copied", message: "continue" })}
      onOpenTask={onOpenTask}
    />);

    expect(screen.queryByRole("button", { name: /导入为 Task/u })).toBeNull();
    await user.click(screen.getByRole("button", { name: "打开受管 Task" }));
    expect(onOpenTask).toHaveBeenCalledWith("task-managed");
  });
});
