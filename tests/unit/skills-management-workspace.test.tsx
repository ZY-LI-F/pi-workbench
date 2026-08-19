import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeBootstrap, StellaDesktopApi } from "@shared/contracts";
import { SkillsManagementWorkspace } from "@renderer/features/skills/SkillsManagementWorkspace";

afterEach(cleanup);

function bootstrap(trusted = true): RuntimeBootstrap {
  return {
    project: { cwd: "C:/research", name: "research", trusted, requiresTrust: !trusted, requiresSelection: false },
    commands: [
      { name: "skill:target-evidence", description: "Evaluate target biology", source: "skill", location: "project", path: "C:/research/.pi/skills/target-evidence/SKILL.md" },
      { name: "skill:report-writing", description: "Write evidence reports", source: "skill", location: "user", path: "C:/Users/test/.pi/agent/skills/report-writing/SKILL.md" },
      { name: "review", description: "Review changes", source: "prompt", location: "project", path: "C:/research/.pi/prompts/review.md" },
    ],
  } as unknown as RuntimeBootstrap;
}

function renderWorkspace(options: { readonly trusted?: boolean; readonly runtimeBusy?: boolean } = {}) {
  const source = bootstrap(options.trusted ?? true);
  const installPiSkillFolder = vi.fn(async () => ({
    cancelled: false as const,
    skill: { name: "clinical-landscape", description: "Analyze clinical programs", scope: "user" as const, destination: "C:/Users/test/.pi/agent/skills/clinical-landscape" },
    reloadedAt: "2026-08-18T00:00:00.000Z",
  }));
  const api = {
    installPiSkillFolder,
    revealPath: vi.fn(async () => undefined),
    copyText: vi.fn(async () => undefined),
  } as unknown as StellaDesktopApi;
  const onRuntimeRefresh = vi.fn(async () => source);
  const onNotify = vi.fn();
  render(
    <SkillsManagementWorkspace
      api={api}
      bootstrap={source}
      online
      runtimeBusy={options.runtimeBusy ?? false}
      onOpenSidebar={vi.fn()}
      onRuntimeRefresh={onRuntimeRefresh}
      onNotify={onNotify}
    />,
  );
  return { installPiSkillFolder, onNotify, onRuntimeRefresh };
}

describe("SkillsManagementWorkspace", () => {
  it("shows only the live Pi Skill catalog with source and invocation metadata", () => {
    renderWorkspace();

    expect(screen.getByRole("heading", { name: "当前 Pi 支持的 Skills" })).toBeTruthy();
    expect(screen.getByText("target-evidence")).toBeTruthy();
    expect(screen.getByText("report-writing")).toBeTruthy();
    expect(screen.queryByText("review")).toBeNull();
    expect(screen.getByText("/skill:target-evidence")).toBeTruthy();
    expect(screen.getAllByText("当前项目").length).toBeGreaterThan(0);
    expect(screen.getAllByText("所有项目").length).toBeGreaterThan(0);
  });

  it("selects a folder-only user install and refreshes the live Pi catalog after hot reload", async () => {
    const user = userEvent.setup();
    const { installPiSkillFolder, onNotify, onRuntimeRefresh } = renderWorkspace();

    await user.click(screen.getByRole("radio", { name: /所有项目/ }));
    await user.click(screen.getByRole("button", { name: /选择文件夹并热加载/ }));

    await waitFor(() => expect(installPiSkillFolder).toHaveBeenCalledWith("user"));
    expect(onRuntimeRefresh).toHaveBeenCalledOnce();
    expect(onNotify).toHaveBeenCalledWith("Skill clinical-landscape 已安装并热加载", "success");
    expect(screen.getByText("clinical-landscape 已热加载")).toBeTruthy();
  });

  it("forces user scope for an untrusted project and disables imports while Pi is busy", () => {
    const { installPiSkillFolder } = renderWorkspace({ trusted: false, runtimeBusy: true });

    expect(screen.getByRole("radio", { name: /当前项目/ }).getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("radio", { name: /当前项目/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("radio", { name: /所有项目/ }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("button", { name: /选择文件夹并热加载/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("当前任务结束后可添加")).toBeTruthy();
    expect(installPiSkillFolder).not.toHaveBeenCalled();
  });
});
