import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalPathArtifacts } from "../../src/renderer/src/components/LocalPathArtifacts";
import { MessageCard } from "../../src/renderer/src/components/MessageCard";
import type { StellaDesktopApi } from "../../src/shared/contracts";

afterEach(cleanup);

const directoryPath = "C:\\Users\\qq108\\Documents\\PI-GUI\\test-results\\pi-gui-pptx\\";
const presentationPath = `${directoryPath}PI-GUI_产品能力与交互说明.pptx`;

function desktopApi(overrides: Partial<StellaDesktopApi> = {}): StellaDesktopApi {
  return {
    inspectLocalPath: vi.fn(async (path: string) => ({
      canonicalPath: path,
      name: path.endsWith("\\") ? "pi-gui-pptx" : "PI-GUI_产品能力与交互说明.pptx",
      kind: path.endsWith("\\") ? "directory" : "file",
      directOpenAllowed: true,
    })),
    openPath: vi.fn(async () => undefined),
    revealPath: vi.fn(async () => undefined),
    copyText: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as StellaDesktopApi;
}

describe("LocalPathArtifacts", () => {
  it("opens and copies a verified output directory", async () => {
    const user = userEvent.setup();
    const api = desktopApi();
    render(<LocalPathArtifacts api={api} text={`中间文件位置：\`${directoryPath}\``} onPreviewFile={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: `打开文件夹 ${directoryPath}` }));
    expect(api.openPath).toHaveBeenCalledWith(directoryPath);
    await user.click(screen.getByRole("button", { name: `复制路径 ${directoryPath}` }));
    expect(api.copyText).toHaveBeenCalledWith(directoryPath);
    expect(await screen.findByText("路径已复制")).toBeTruthy();
  });

  it("opens a document or reveals its containing folder", async () => {
    const user = userEvent.setup();
    const api = desktopApi();
    render(<LocalPathArtifacts api={api} text={`成品：\`${presentationPath}\``} onPreviewFile={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: `打开文件 ${presentationPath}` }));
    expect(api.openPath).toHaveBeenCalledWith(presentationPath);
    await user.click(screen.getByRole("button", { name: `打开所在位置 ${presentationPath}` }));
    expect(api.revealPath).toHaveBeenCalledWith(presentationPath);
  });

  it("shows inspection failures instead of presenting a false open action", async () => {
    const api = desktopApi({ inspectLocalPath: vi.fn(async () => { throw new Error("路径不存在"); }) });
    render(<LocalPathArtifacts api={api} text={`成品：\`${presentationPath}\``} onPreviewFile={vi.fn()} />);

    expect((await screen.findByRole("alert")).textContent).toContain("路径不可用：路径不存在");
    expect(screen.queryByRole("button", { name: `打开文件 ${presentationPath}` })).toBeNull();
    expect(screen.getByRole("button", { name: `复制路径 ${presentationPath}` })).toBeTruthy();
  });

  it("renders the output path affordance only for assistant results", async () => {
    const api = desktopApi();
    const assistant = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: `结果目录：\`${directoryPath}\`` }],
      provider: "aliyun-maas",
      model: "qwen",
      stopReason: "stop",
      timestamp: Date.now(),
    };
    const view = render(<MessageCard api={api} message={assistant} toolExecutions={{}} onFork={vi.fn()} onPreviewFile={vi.fn()} />);
    expect(await screen.findByRole("region", { name: "输出文件与路径" })).toBeTruthy();

    view.rerender(<MessageCard api={api} message={{ role: "user", content: directoryPath, timestamp: Date.now() }} toolExecutions={{}} onFork={vi.fn()} onPreviewFile={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("region", { name: "输出文件与路径" })).toBeNull());
  });

  it("hands a previewable file to the session-level right panel", async () => {
    const user = userEvent.setup();
    const inspection = {
      canonicalPath: presentationPath,
      name: "PI-GUI_产品能力与交互说明.pptx",
      kind: "file" as const,
      directOpenAllowed: true,
      preview: {
        kind: "pptx" as const,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
    };
    const api = desktopApi({ inspectLocalPath: vi.fn(async () => inspection) });
    const onPreviewFile = vi.fn();
    render(<LocalPathArtifacts api={api} text={`成品：\`${presentationPath}\``} onPreviewFile={onPreviewFile} />);

    await user.click(await screen.findByRole("button", { name: `预览文件 ${presentationPath}` }));
    expect(onPreviewFile).toHaveBeenCalledWith(inspection);
  });
});
