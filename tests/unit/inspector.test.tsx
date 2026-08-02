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
  },
  stats: {
    contextUsage: { percent: 12, tokens: 120, contextWindow: 1_000 },
    tokens: { input: 80, output: 40, cacheRead: 0 },
    cost: 0.001,
  },
  tree: [],
  leafId: null,
} as unknown as RuntimeBootstrap;

function InspectorHarness({ onClose = vi.fn() }: { readonly onClose?: () => void }) {
  const [tab, setTab] = useState<InspectorTab>("context");
  const [width, setWidth] = useState(360);
  return (
    <Inspector
      api={{} as StellaDesktopApi}
      bootstrap={bootstrap}
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
