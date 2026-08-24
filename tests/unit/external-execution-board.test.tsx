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
  const codex = execution.sourceId === "codex";
  return Object.freeze({
    epoch: 1,
    scope: Object.freeze({ kind: "all" }),
    capturedAt: NOW,
    sources: Object.freeze([Object.freeze({
      source: Object.freeze({
        id: execution.sourceId,
        label: codex ? "Codex Threads" : "Claude Agents",
        description: "fixture",
        supportsDetails: codex,
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
      details={{}}
      query=""
      onRefresh={async () => snapshot()}
      onImport={onImport}
      onContinue={onContinue}
      onLoadDetails={async () => { throw new Error("not supported"); }}
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
      details={{}}
      query=""
      onRefresh={async () => snapshot()}
      onImport={async () => ({ taskId: "unexpected", created: true })}
      onContinue={async () => ({ kind: "command-copied", message: "continue" })}
      onLoadDetails={async () => { throw new Error("not supported"); }}
      onOpenTask={onOpenTask}
    />);

    expect(screen.queryByRole("button", { name: /导入为 Task/u })).toBeNull();
    await user.click(screen.getByRole("button", { name: "打开受管 Task" }));
    expect(onOpenTask).toHaveBeenCalledWith("task-managed");
  });

  it("reads Codex Turn details only after the user opens them", async () => {
    const execution = Object.freeze({
      ...item(),
      sourceId: "codex" as const,
      externalId: "thread-1",
      nativeId: "thread-1",
      kind: "exec",
      title: "Codex 外部 Thread",
      session: Object.freeze({ backendId: "codex" as const, sessionId: "thread-1" }),
      state: "idle" as const,
      needsInput: false,
      waitingFor: undefined,
      process: undefined,
    });
    const detail = Object.freeze({
      sourceId: "codex" as const,
      externalId: "thread-1",
      title: execution.title,
      projectPath: "/repo",
      fetchedAt: NOW,
      turns: Object.freeze([Object.freeze({
        id: "turn-1",
        status: "completed",
        items: Object.freeze([Object.freeze({ id: "message-1", type: "agentMessage", label: "Codex", text: "实现已完成" })]),
      })]),
    });
    const onLoadDetails = vi.fn(async () => detail);
    const user = userEvent.setup();
    const view = render(<ExternalExecutionBoard
      snapshot={snapshot(execution)}
      loading={false}
      refreshing={false}
      busy={[]}
      details={{}}
      query=""
      onRefresh={async () => snapshot(execution)}
      onImport={async () => ({ taskId: "task", created: true })}
      onContinue={async () => ({ message: "codex resume thread-1" })}
      onLoadDetails={onLoadDetails}
      onOpenTask={() => undefined}
    />);

    expect(onLoadDetails).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "查看详情" }));
    expect(onLoadDetails).toHaveBeenCalledWith(expect.objectContaining({ externalId: "thread-1" }));

    view.rerender(<ExternalExecutionBoard
      snapshot={snapshot(execution)}
      loading={false}
      refreshing={false}
      busy={[]}
      details={{ "codex:thread-1": detail }}
      query=""
      onRefresh={async () => snapshot(execution)}
      onImport={async () => ({ taskId: "task", created: true })}
      onContinue={async () => ({ message: "codex resume thread-1" })}
      onLoadDetails={onLoadDetails}
      onOpenTask={() => undefined}
    />);
    expect(screen.getByText("实现已完成")).toBeTruthy();
    expect(screen.getByRole("button", { name: "收起详情" })).toBeTruthy();
  });

  it("removes Stella-managed sessions from the compact all view", () => {
    render(<ExternalExecutionBoard
      compact
      hideManaged
      snapshot={snapshot(item({ taskId: "task-managed", relation: "managed" }))}
      loading={false}
      refreshing={false}
      busy={[]}
      details={{}}
      query=""
      onRefresh={async () => snapshot()}
      onImport={async () => ({ taskId: "task", created: false })}
      onContinue={async () => ({ message: "continue" })}
      onLoadDetails={async () => { throw new Error("not supported"); }}
      onOpenTask={() => undefined}
    />);

    expect(screen.queryByText("Claude 后台修复")).toBeNull();
    expect(screen.getByText("当前筛选没有外部任务")).toBeTruthy();
    expect(screen.getByRole("region", { name: "外部 CLI 活动" }).classList.contains("is-compact")).toBe(true);
  });
});
