import React, { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalPathInspection } from "../../src/shared/local-path";
import type { StellaDesktopApi } from "../../src/shared/contracts";
import { FilePreviewPanel } from "../../src/renderer/src/components/FilePreviewPanel";

afterEach(cleanup);

const newestPath = "C:\\workspace\\newest.md";
const olderPath = "C:\\workspace\\older.txt";

function inspection(path: string): LocalPathInspection {
  const markdown = path.endsWith(".md");
  return {
    canonicalPath: path,
    name: path.split("\\").at(-1) ?? path,
    kind: "file",
    directOpenAllowed: true,
    preview: markdown
      ? { kind: "markdown", mimeType: "text/markdown" }
      : { kind: "text", mimeType: "text/plain" },
  };
}

function PreviewHarness({ api }: { readonly api: StellaDesktopApi }) {
  const [active, setActive] = useState(() => inspection(newestPath));
  return (
    <FilePreviewPanel
      api={api}
      inspection={active}
      references={[
        { path: newestPath, timestamp: 300 },
        { path: olderPath, timestamp: 100 },
      ]}
      onSelect={setActive}
    />
  );
}

describe("FilePreviewPanel", () => {
  it("quotes only the current file version and refuses stale references without changing the draft", async () => {
    const user = userEvent.setup();
    const target = inspection(newestPath);
    let version = "initial-hash";
    const api = { inspectLocalPath: vi.fn(async () => target), readLocalFilePreview: vi.fn(async () => ({ ...target.preview!, canonicalPath: newestPath,
      name: target.name, sizeBytes: 20, bytes: new TextEncoder().encode("# source evidence"), version })) } as unknown as StellaDesktopApi;
    const onReference = vi.fn();
    render(<FilePreviewPanel api={api} inspection={target} references={[]} onSelect={vi.fn()} onReference={onReference} />);
    await screen.findByRole("heading", { name: "source evidence" });
    await user.click(screen.getByRole("button", { name: "引用文件到对话" }));
    await waitFor(() => expect(onReference).toHaveBeenCalledTimes(1));
    expect(onReference.mock.calls[0]?.[0]).toContain("sha256:initial-hash");
    expect(onReference.mock.calls[0]?.[0]).not.toContain("source evidence");
    version = "changed-hash";
    await user.click(screen.getByRole("button", { name: "引用文件到对话" }));
    await screen.findByRole("alert"); expect(screen.getByRole("alert").textContent).toContain("文件版本已变化");
    expect(onReference).toHaveBeenCalledTimes(1);
  });

  it("switches newest-first session files from a compact picker and groups secondary actions", async () => {
    const user = userEvent.setup();
    const api = {
      inspectLocalPath: vi.fn(async (path: string) => inspection(path)),
      readLocalFilePreview: vi.fn(async (path: string) => {
        const target = inspection(path);
        const source = path === newestPath ? "# 最新报告" : "较早的明细内容";
        return {
          canonicalPath: path,
          name: target.name,
          kind: target.preview?.kind ?? "text",
          mimeType: target.preview?.mimeType ?? "text/plain",
          sizeBytes: source.length,
          bytes: new TextEncoder().encode(source),
        };
      }),
      openPath: vi.fn(async () => undefined),
      revealPath: vi.fn(async () => undefined),
      copyText: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
    } as unknown as StellaDesktopApi;

    render(<PreviewHarness api={api} />);

    expect(await screen.findByRole("heading", { name: "最新报告" })).toBeTruthy();
    const picker = screen.getByRole("combobox", { name: "切换会话文件" });
    await screen.findByRole("option", { name: /older\.txt · 文本/ });
    const options = within(picker).getAllByRole("option");
    expect(options[0]?.textContent).toContain("newest.md");
    expect(options[1]?.textContent).toContain("older.txt");

    await user.selectOptions(picker, olderPath.toLocaleLowerCase("en-US"));
    expect(await screen.findByText("较早的明细内容")).toBeTruthy();
    await waitFor(() => expect(api.readLocalFilePreview).toHaveBeenLastCalledWith(olderPath));

    await user.click(screen.getByRole("button", { name: "更多文件操作" }));
    await user.click(screen.getByRole("menuitem", { name: /所在位置/ }));
    expect(api.revealPath).toHaveBeenCalledWith(olderPath);
  });
});
