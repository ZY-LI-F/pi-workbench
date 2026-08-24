// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AutopilotService } from "../../src/main/autopilot-service";
import type { BoardRepository } from "../../src/main/board-repository";
import {
  EMPTY_BOARD_STATE,
  parseBoardState,
  type BoardBootstrap,
  type BoardState,
  type CreateAutopilotInput,
} from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

class MemoryRepository implements BoardRepository {
  state: BoardState = EMPTY_BOARD_STATE;
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

function idFactory(): () => string {
  let value = 0;
  return () => `auto-id-${String(++value).padStart(3, "0")}`;
}

const MANUAL_INPUT: CreateAutopilotInput = Object.freeze({
  name: "发布前复核",
  enabled: true,
  trigger: Object.freeze({ kind: "manual" }),
  taskTemplate: Object.freeze({
    title: "检查发布候选版本",
    description: "检查当前工作区变更",
    acceptanceCriteria: "测试通过并给出报告",
    priority: "high",
  }),
  projectPath: "C:/project",
  projectName: "project",
  trusted: true,
  executionTarget: Object.freeze({ kind: "agent", agentId: "tester" }),
  executionProfileId: "pi.rpc",
});

function setup(
  dispatchTask?: (taskId: string) => Promise<BoardBootstrap>,
  prepareExecution?: ConstructorParameters<typeof AutopilotService>[0]["prepareExecution"],
) {
  const repository = new MemoryRepository();
  const changed: BoardBootstrap[] = [];
  const service = new AutopilotService({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    dispatchTask: dispatchTask ?? (async () => Object.freeze({ board: repository.state, catalog: BUILTIN_ORCHESTRATION_CATALOG })),
    prepareExecution,
    emitChanged: (bootstrap) => changed.push(bootstrap),
    id: idFactory(),
    token: () => "webhook-token",
    now: () => "2026-07-18T08:00:00.000Z",
  });
  return { repository, service, changed };
}

describe("AutopilotService", () => {
  it("creates, updates, and deletes a strictly validated Manual rule", async () => {
    const { repository, service } = setup();
    await service.create(MANUAL_INPUT);
    const created = repository.state.autopilots[0];
    expect(created).toMatchObject({ name: "发布前复核", trigger: { kind: "manual" }, projectPath: "C:/project" });

    if (!created) throw new Error("测试 Autopilot 未创建");
    await service.update({ ...MANUAL_INPUT, autopilotId: created.id, name: "发布复核 v2", trigger: { kind: "manual" } });
    expect(repository.state.autopilots[0]?.name).toBe("发布复核 v2");

    await service.delete(created.id);
    expect(repository.state.autopilots).toHaveLength(0);
    await expect(service.create({ ...MANUAL_INPUT, name: "", taskTemplate: { ...MANUAL_INPUT.taskTemplate, title: "" } })).rejects.toThrow("Autopilot 名称不能为空");
  });

  it("creates a fresh Task and successful audit on every Manual trigger", async () => {
    const dispatched: string[] = [];
    let repository: MemoryRepository;
    const setupResult = setup(async (taskId) => {
      dispatched.push(taskId);
      return Object.freeze({ board: repository.state, catalog: BUILTIN_ORCHESTRATION_CATALOG });
    });
    repository = setupResult.repository;
    await setupResult.service.create(MANUAL_INPUT);
    const autopilotId = repository.state.autopilots[0]?.id;
    if (!autopilotId) throw new Error("测试 Autopilot 未创建");

    await setupResult.service.trigger({ autopilotId, triggerKind: "manual" });
    await setupResult.service.trigger({ autopilotId, triggerKind: "manual" });

    expect(repository.state.tasks).toHaveLength(2);
    expect(new Set(repository.state.tasks.map((task) => task.id)).size).toBe(2);
    expect(dispatched).toEqual(repository.state.tasks.map((task) => task.id).reverse());
    expect(repository.state.autopilotRuns).toHaveLength(2);
    expect(repository.state.autopilotRuns.every((run) => run.status === "succeeded" && Boolean(run.taskId))).toBe(true);
    expect(repository.state.activities.filter((activity) => activity.kind === "automation")).toHaveLength(2);
  });

  it("rejects disabled rules before creating a Task or audit", async () => {
    const dispatchTask = vi.fn(async () => {
      throw new Error("不应分发");
    });
    const { repository, service } = setup(dispatchTask);
    await service.create({ ...MANUAL_INPUT, enabled: false });
    const autopilotId = repository.state.autopilots[0]?.id;
    if (!autopilotId) throw new Error("测试 Autopilot 未创建");

    await expect(service.trigger({ autopilotId, triggerKind: "manual" })).rejects.toThrow("已禁用");
    expect(repository.state.tasks).toHaveLength(0);
    expect(repository.state.autopilotRuns).toHaveLength(0);
    expect(dispatchTask).not.toHaveBeenCalled();
  });

  it("persists the exact dispatch failure in the audit and still rejects the trigger", async () => {
    const { repository, service } = setup(async () => {
      throw new Error("Pi Agent 启动失败：ENOENT");
    });
    await service.create(MANUAL_INPUT);
    const autopilotId = repository.state.autopilots[0]?.id;
    if (!autopilotId) throw new Error("测试 Autopilot 未创建");

    await expect(service.trigger({ autopilotId, triggerKind: "manual" })).rejects.toThrow("Autopilot 触发失败: Pi Agent 启动失败：ENOENT");
    expect(repository.state.tasks).toHaveLength(1);
    expect(repository.state.autopilotRuns[0]).toMatchObject({
      status: "failed",
      error: "Pi Agent 启动失败：ENOENT",
      taskId: repository.state.tasks[0]?.id,
    });
    expect(repository.state.activities.at(-1)).toMatchObject({ kind: "error", detail: "Pi Agent 启动失败：ENOENT" });
  });

  it("copies external Direct Agent and Workflow profiles and re-probes before every dispatch", async () => {
    const prepareExecution = vi.fn(async () => undefined);
    const dispatchTask = vi.fn(async () => Object.freeze({ board: EMPTY_BOARD_STATE, catalog: BUILTIN_ORCHESTRATION_CATALOG }));
    const { repository, service } = setup(dispatchTask, prepareExecution);
    await service.create({ ...MANUAL_INPUT, executionProfileId: "codex.exec" });
    const direct = repository.state.autopilots[0];
    if (!direct) throw new Error("测试缺少 Direct Autopilot");
    await service.trigger({ autopilotId: direct.id, triggerKind: "manual" });
    await service.trigger({ autopilotId: direct.id, triggerKind: "manual" });

    await service.create({
      ...MANUAL_INPUT,
      name: "Claude 固定流程",
      executionTarget: { kind: "workflow", workflowId: "feature-delivery" },
      executionProfileId: "claude.print",
    });
    const workflow = repository.state.autopilots.find((candidate) => candidate.name === "Claude 固定流程");
    if (!workflow) throw new Error("测试缺少 Workflow Autopilot");
    await service.trigger({ autopilotId: workflow.id, triggerKind: "manual" });

    expect(repository.state.tasks.filter((task) => task.executionProfileId === "codex.exec")).toHaveLength(2);
    expect(repository.state.tasks.find((task) => task.executionProfileId === "claude.print")?.executionTarget)
      .toEqual({ kind: "workflow", workflowId: "feature-delivery" });
    expect(prepareExecution).toHaveBeenNthCalledWith(1, "codex.exec", { kind: "agent", agentId: "tester" });
    expect(prepareExecution).toHaveBeenNthCalledWith(2, "codex.exec", { kind: "agent", agentId: "tester" });
    expect(prepareExecution).toHaveBeenNthCalledWith(3, "claude.print", { kind: "workflow", workflowId: "feature-delivery" });
    expect(dispatchTask).toHaveBeenCalledTimes(3);
  });

  it("keeps generated Task profile history immutable when the Autopilot profile changes", async () => {
    const { repository, service } = setup();
    await service.create(MANUAL_INPUT);
    const created = repository.state.autopilots[0];
    if (!created) throw new Error("测试缺少 Autopilot");
    await service.trigger({ autopilotId: created.id, triggerKind: "manual" });
    const originalTaskId = repository.state.tasks[0]?.id;

    await service.update({
      ...MANUAL_INPUT,
      autopilotId: created.id,
      trigger: { kind: "manual" },
      executionProfileId: "claude.print",
    });
    await service.trigger({ autopilotId: created.id, triggerKind: "manual" });

    expect(repository.state.tasks.find((task) => task.id === originalTaskId)?.executionProfileId).toBe("pi.rpc");
    expect(repository.state.tasks[0]?.executionProfileId).toBe("claude.print");
    expect(repository.state.autopilots[0]?.executionProfileId).toBe("claude.print");
  });

  it("audits a fresh probe failure and never calls dispatch", async () => {
    const dispatchTask = vi.fn(async () => Object.freeze({ board: EMPTY_BOARD_STATE, catalog: BUILTIN_ORCHESTRATION_CATALOG }));
    const prepareExecution = vi.fn(async () => { throw new Error("Codex CLI 登录已失效"); });
    const { repository, service } = setup(dispatchTask, prepareExecution);
    await service.create({ ...MANUAL_INPUT, executionProfileId: "codex.exec" });
    const autopilot = repository.state.autopilots[0];
    if (!autopilot) throw new Error("测试缺少 Autopilot");

    await expect(service.trigger({ autopilotId: autopilot.id, triggerKind: "manual" }))
      .rejects.toThrow("Autopilot 触发失败: Codex CLI 登录已失效");

    expect(dispatchTask).not.toHaveBeenCalled();
    expect(repository.state.tasks[0]).toMatchObject({ executionProfileId: "codex.exec", stage: "blocked" });
    expect(repository.state.autopilotRuns[0]).toMatchObject({ status: "failed", error: "Codex CLI 登录已失效" });
  });

  it("rejects external LEAD and Pi Skill-bound Autopilots at save time", async () => {
    const { repository, service } = setup();
    await expect(service.create({
      ...MANUAL_INPUT,
      executionTarget: { kind: "agent", agentId: "lead" },
      executionProfileId: "codex.exec",
    })).rejects.toThrow("LEAD、Squad 与 Coordinator 仅支持 Pi RPC");
    await expect(service.create({
      ...MANUAL_INPUT,
      executionTarget: { kind: "agent", agentId: "target-biologist" },
      executionProfileId: "claude.print",
    })).rejects.toThrow("Claude CLI 不支持依赖 Pi Skills 的 Agent");
    expect(repository.state.autopilots).toHaveLength(0);
  });
});
