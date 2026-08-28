// @vitest-environment node
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTaskRunner } from "../../src/main/agent-task-runner";
import { AgentTaskService } from "../../src/main/agent-task-service";
import { BoardService } from "../../src/main/board-service";
import type { BoardRepository } from "../../src/main/board-repository";
import { ExecutionBackendRegistry } from "../../src/main/execution-backend-registry";
import { ExecutionAbortedError, type ExecutionBackend, type ExecutionOutcome, type ExecutionRequest } from "../../src/main/execution-backend";
import { ExecutionCapacity } from "../../src/main/execution-capacity";
import { IsolatedWorktreeExecutionWorkspace } from "../../src/main/execution-workspace";
import { EMPTY_BOARD_STATE, parseBoardState, type BoardState } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import type { ExecutionBackendHealth } from "../../src/shared/execution-profile";
import { READY_AGENT_SKILLS } from "./test-doubles";

const NOW = "2026-08-28T13:00:00.000Z";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

class MemoryRepository implements BoardRepository {
  state: BoardState = EMPTY_BOARD_STATE;
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

interface HeldExecution {
  readonly request: ExecutionRequest;
  settle(output: string): void;
}

class HoldingPiBackend implements ExecutionBackend {
  readonly backendId = "pi" as const;
  readonly executions: HeldExecution[] = [];

  async probe(): Promise<ExecutionBackendHealth> {
    return Object.freeze({
      backendId: "pi",
      state: "ready",
      authState: "ready",
      version: "holding-pi-1.0",
      updatedAt: NOW,
    });
  }

  run(request: ExecutionRequest, _emit: () => void, signal: AbortSignal): Promise<ExecutionOutcome> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new ExecutionAbortedError());
      signal.addEventListener("abort", abort, { once: true });
      this.executions.push(Object.freeze({
        request,
        settle: (output: string) => {
          signal.removeEventListener("abort", abort);
          resolve(Object.freeze({ result: Object.freeze({ kind: "report" as const, output }), backendVersion: "holding-pi-1.0" }));
        },
      }));
    });
  }

  async openSession() {
    return Object.freeze({ kind: "opened-external" as const });
  }
}

function git(cwd: string, ...argv: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...argv], { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout.trim());
    });
  });
}

async function gitFixture() {
  const root = await mkdtemp(join(tmpdir(), "stella-concurrency-并发 "));
  temporaryRoots.push(root);
  const repository = join(root, "真实 项目");
  const workspaceRoot = join(root, "Stella Worktrees");
  await mkdir(repository, { recursive: true });
  await git(repository, "init", "--initial-branch=main");
  await git(repository, "config", "user.name", "Stella Test");
  await git(repository, "config", "user.email", "stella@example.invalid");
  await writeFile(join(repository, "README.md"), "fixture\n", "utf8");
  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "fixture");
  return { repository, workspaceRoot };
}

function idFactory(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

describe("worktree-aware execution concurrency", () => {
  it("runs two writable AgentTasks concurrently in distinct real Stella worktrees", async () => {
    const fixture = await gitFixture();
    const repository = new MemoryRepository();
    const id = idFactory("domain");
    const boardService = new BoardService({
      repository,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      emitChanged: () => undefined,
      projectIdentity: (path) => path,
      id,
      now: () => NOW,
    });
    const agentTaskService = new AgentTaskService({
      repository,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      emitChanged: () => undefined,
      skills: READY_AGENT_SKILLS,
      id,
      now: () => NOW,
    });
    const backend = new HoldingPiBackend();
    const capacity = new ExecutionCapacity(2);
    const workspace = new IsolatedWorktreeExecutionWorkspace({
      workspaceRoot: fixture.workspaceRoot,
      resolveProjectTrust: async () => true,
      resolveProjectPath: async (path) => realpath(path),
      id: idFactory("worktree"),
      now: () => NOW,
    });
    const runner = new AgentTaskRunner({
      service: agentTaskService,
      backendRegistry: new ExecutionBackendRegistry({ backends: [backend], now: () => NOW }),
      emitBoardEvent: () => undefined,
      workspace,
      capacity,
    });
    for (const title of ["真实并发一", "真实并发二"]) {
      await boardService.createTask({
        title,
        description: "写入真实 worktree",
        acceptanceCriteria: "两个执行重叠",
        priority: "high",
        projectPath: fixture.repository,
        projectName: "真实项目",
        trusted: true,
        executionTarget: { kind: "agent", agentId: "builder" },
        executionWorkspace: { strategy: "isolated-worktree", baseRef: "main" },
      });
    }
    for (const task of repository.state.tasks) await agentTaskService.dispatchDirect(task.id);

    runner.start();
    await vi.waitFor(() => expect(backend.executions).toHaveLength(2));

    const running = repository.state.agentTasks.filter((task) => task.status === "running");
    expect(running).toHaveLength(2);
    expect(new Set(backend.executions.map((execution) => execution.request.cwd)).size).toBe(2);
    expect(new Set(running.map((task) => task.workspacePlacement?.resourceId)).size).toBe(2);
    expect(capacity.activeCount).toBe(2);
    for (const execution of backend.executions) {
      await expect(access(execution.request.cwd)).resolves.toBeUndefined();
      await writeFile(join(execution.request.cwd, `output-${execution.request.executionId}.txt`), "overlap\n", "utf8");
    }
    const worktreeRegistry = await git(fixture.repository, "worktree", "list", "--porcelain");
    for (const execution of backend.executions) expect(worktreeRegistry).toContain(await realpath(execution.request.cwd));

    backend.executions[0]?.settle("first complete");
    backend.executions[1]?.settle("second complete");
    await vi.waitFor(() => expect(repository.state.agentTasks.filter((task) => task.status === "reported")).toHaveLength(2));
    expect(capacity.activeCount).toBe(0);
    for (const task of repository.state.agentTasks) {
      expect(task.workspacePlacement).toMatchObject({ strategy: "isolated-worktree", lifecycle: "retained", ownership: "stella" });
      await expect(access(task.workspacePlacement?.cwd ?? "")).resolves.toBeUndefined();
    }
    await runner.shutdown();
  });
});
