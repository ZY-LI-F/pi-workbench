// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  CurrentFolderExecutionWorkspace,
  ExecutionWorkspaceAbortError,
} from "../../src/main/execution-workspace";
import { WorkspaceAdmission, WorkspaceAdmissionAbortError, type WorkspaceLease } from "../../src/main/workspace-admission";
import type { AgentDefinition } from "../../src/shared/kanban";

const WRITER: AgentDefinition = Object.freeze({
  id: "writer",
  version: 1,
  name: "Writer",
  callsign: "writer",
  responsibility: "Write",
  instructions: "Write",
  workspaceAccess: "write",
  allowedTools: Object.freeze(["read", "write"]),
  thinking: "medium",
  disableExtensions: true,
  disableSkills: true,
  disablePromptTemplates: true,
  disableContextFiles: true,
});

const READER: AgentDefinition = Object.freeze({
  ...WRITER,
  id: "reader",
  name: "Reader",
  workspaceAccess: "read",
  allowedTools: Object.freeze(["read", "grep"]),
});

function owner(id: string) {
  return Object.freeze({ id, kind: "agent-task" as const, label: id, taskId: id, executionId: id });
}

describe("CurrentFolderExecutionWorkspace", () => {
  it("returns the resolved cwd and live trust while keeping strict readers lease-free", async () => {
    const acquireBackground = vi.fn<() => Promise<WorkspaceLease>>();
    const resolveProjectTrust = vi.fn(async () => false);
    const resolveProjectPath = vi.fn(async () => "/canonical/repo");
    const workspace = new CurrentFolderExecutionWorkspace({
      admission: { acquireBackground },
      resolveProjectTrust,
      resolveProjectPath,
    });

    const handle = await workspace.acquire({ projectPath: "/repo", agent: READER, owner: owner("reader") });

    expect(handle).toMatchObject({ strategy: "current-folder", cwd: "/canonical/repo", trusted: false });
    expect(handle).not.toHaveProperty("admissionKey");
    expect(resolveProjectTrust).toHaveBeenCalledWith("/repo");
    expect(resolveProjectPath).toHaveBeenCalledWith("/repo", false);
    expect(acquireBackground).not.toHaveBeenCalled();
  });

  it("delegates writer FIFO admission and releases the acquired resource exactly once", async () => {
    const release = vi.fn();
    const acquireBackground = vi.fn(async (): Promise<WorkspaceLease> => Object.freeze({
      key: "/canonical/repo",
      owner: owner("writer"),
      release,
    }));
    const workspace = new CurrentFolderExecutionWorkspace({
      admission: { acquireBackground },
      resolveProjectTrust: async () => true,
      resolveProjectPath: async () => "/canonical/repo",
    });
    const onQueued = vi.fn(async () => undefined);

    const handle = await workspace.acquire({ projectPath: "/repo", agent: WRITER, owner: owner("writer"), onQueued });
    handle.release();
    handle.release();

    expect(acquireBackground).toHaveBeenCalledWith("/repo", owner("writer"), expect.objectContaining({ onQueued }));
    expect(handle.admissionKey).toBe("/canonical/repo");
    expect(release).toHaveBeenCalledOnce();
  });

  it("preserves canonical FIFO behaviour through the interface", async () => {
    const admission = new WorkspaceAdmission({ canonicalize: async (path) => path.replaceAll("\\", "/").toLocaleLowerCase("en-US") });
    const workspace = new CurrentFolderExecutionWorkspace({
      admission,
      resolveProjectTrust: async () => true,
      resolveProjectPath: async (path) => path,
    });
    const first = await workspace.acquire({ projectPath: "C:/Repo", agent: WRITER, owner: owner("first") });
    let secondReady = false;
    const secondPromise = workspace.acquire({ projectPath: "c:\\repo", agent: WRITER, owner: owner("second") })
      .then((handle) => { secondReady = true; return handle; });
    await Promise.resolve();
    expect(secondReady).toBe(false);

    first.release();
    const second = await secondPromise;
    expect(second.admissionKey).toBe("c:/repo");
    second.release();
  });

  it("translates admission cancellation without leaking its lower-level type", async () => {
    const workspace = new CurrentFolderExecutionWorkspace({
      admission: { acquireBackground: async () => { throw new WorkspaceAdmissionAbortError(); } },
      resolveProjectTrust: async () => true,
      resolveProjectPath: async (path) => path,
    });

    await expect(workspace.acquire({ projectPath: "/repo", agent: WRITER, owner: owner("writer") }))
      .rejects.toBeInstanceOf(ExecutionWorkspaceAbortError);
  });
});
