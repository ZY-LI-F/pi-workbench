import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeBootstrap, StellaDesktopApi } from "../../src/shared/contracts";
import { Inspector, type InspectorTab } from "../../src/renderer/src/components/Inspector";

afterEach(cleanup);

const bootstrap = {
  state: {
    sessionId: "session-inspector",
    sessionName: "检查器测试",
    autoCompactionEnabled: true,
  },
  stats: {
    contextUsage: { percent: 12, tokens: 120, contextWindow: 1_000 },
    tokens: { input: 80, output: 40, cacheRead: 0 },
    cost: 0.001,
  },
  tree: [],
  entries: [
    { id: "compact-1", parentId: null, type: "compaction", timestamp: "2026-08-19T00:00:00.000Z" },
    { id: "compact-2", parentId: "compact-1", type: "compaction", timestamp: "2026-08-19T01:00:00.000Z" },
  ],
  leafId: "compact-2",
} as unknown as RuntimeBootstrap;

function InspectorHarness({ onClose = vi.fn(), source = bootstrap }: { readonly onClose?: () => void; readonly source?: RuntimeBootstrap }) {
  const [tab, setTab] = useState<InspectorTab>("context");
  const [width, setWidth] = useState(360);
  return (
    <Inspector
      api={{} as StellaDesktopApi}
      bootstrap={source}
      open
      tab={tab}
      width={width}
      tools={{}}
      queue={{ steering: [], followUp: [] }}
      extensionStatuses={{}}
      extensionWidgets={{}}
      fileReferences={[]}
      onTabChange={setTab}
      onWidthChange={setWidth}
      onSelectFile={vi.fn()}
      onClose={onClose}
      onCompact={vi.fn()}
      onExport={vi.fn()}
      onClone={vi.fn()}
      onRename={vi.fn()}
      onFork={vi.fn()}
    />
  );
}

describe("Inspector", () => {
  it("explains Pi's intentionally unknown usage after compaction instead of implying zero tokens", () => {
    render(<InspectorHarness source={{ ...bootstrap, stats: { ...bootstrap.stats, contextUsage: { tokens: null, percent: null, contextWindow: 131072 } } }} />);
    expect(screen.getByText("压缩后用量待更新；下一次模型响应后显示")).toBeTruthy();
    expect(screen.getByText("— / 0.131M tokens")).toBeTruthy();
  });

  it("hosts file inspection as a first-class tab and closes from the shared header", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<InspectorHarness onClose={onClose} />);

    await user.click(screen.getByRole("tab", { name: "文件" }));
    expect(screen.getByRole("tabpanel", { name: "文件" })).toBeTruthy();
    expect(screen.getByText("选择一个会话文件")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "关闭检查器" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("separates active context from append-only session totals and reports compactions", () => {
    render(<InspectorHarness />);

    expect(screen.getByText("0.00012M / 0.001M tokens")).toBeTruthy();
    expect(screen.getByTitle("120 / 1000 tokens")).toBeTruthy();
    expect(screen.getByText("当前活动上下文，不是 Session 历史累计值")).toBeTruthy();
    expect(screen.getByText("自动压缩已开启")).toBeTruthy();
    expect(screen.getByText("已压缩 2 次")).toBeTruthy();
    expect(screen.getByText(/Session JSONL 是追加式历史/)).toBeTruthy();
    expect(screen.getByText("累计输入")).toBeTruthy();
  });

  it("resizes from the left separator with pointer drag and keyboard", () => {
    render(<InspectorHarness />);
    const separator = screen.getByRole("separator", { name: "调整检查器宽度" });

    fireEvent.pointerDown(separator, { button: 0, clientX: 700 });
    fireEvent.pointerMove(window, { clientX: 620 });
    expect(separator.getAttribute("aria-valuenow")).toBe("440");
    fireEvent.pointerUp(window);

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator.getAttribute("aria-valuenow")).toBe("424");
    fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
    expect(separator.getAttribute("aria-valuenow")).toBe("472");
  });
});
