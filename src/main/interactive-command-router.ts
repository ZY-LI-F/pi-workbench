import { randomUUID } from "node:crypto";
import type { PiCommand, PiResponse, RuntimeSignal } from "../shared/contracts";
import { WorkspaceAdmission, type WorkspaceLease } from "./workspace-admission";

interface InteractiveRuntime {
  send(command: PiCommand, requestId?: string): Promise<PiResponse>;
}

interface InteractiveCommandRouterDependencies {
  readonly runtime: InteractiveRuntime;
  readonly admission: WorkspaceAdmission;
  readonly id?: () => string;
}

interface InteractiveLeaseState {
  readonly workspacePath: string;
  readonly lease: WorkspaceLease;
}

const TURN_COMMANDS = new Set<PiCommand["type"]>(["prompt", "steer", "follow_up"]);

function eventType(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const type = (value as Record<string, unknown>).type;
  return typeof type === "string" ? type : undefined;
}

export class InteractiveCommandRouter {
  readonly #runtime: InteractiveRuntime;
  readonly #admission: WorkspaceAdmission;
  readonly #id: () => string;
  #active?: InteractiveLeaseState;
  #compacting = false;
  #runtimeMaintenance = false;
  #bashOperations = 0;
  #turnAdmissions = 0;

  constructor(dependencies: InteractiveCommandRouterDependencies) {
    this.#runtime = dependencies.runtime;
    this.#admission = dependencies.admission;
    this.#id = dependencies.id ?? randomUUID;
  }

  async send(command: PiCommand, workspacePath: string, requestId?: string): Promise<PiResponse> {
    if (this.#runtimeMaintenance) {
      throw new Error("Pi Runtime 正在重载模型配置；请等待重载完成后再发送命令");
    }
    if (TURN_COMMANDS.has(command.type)) {
      this.#turnAdmissions += 1;
      try { return await this.#sendTurn(command, workspacePath, requestId); }
      finally { this.#turnAdmissions -= 1; }
    }
    if (command.type === "bash") {
      this.#bashOperations += 1;
      try { return await this.#sendBash(command, workspacePath); }
      finally { this.#bashOperations -= 1; }
    }
    if (command.type === "compact") return this.#sendCompaction(command);
    return this.#runtime.send(command);
  }

  assertMaintenanceAvailable(): void {
    if (this.#runtimeMaintenance) throw new Error("Pi Runtime 模型配置重载已在进行中");
    if (this.#active || this.#compacting || this.#bashOperations > 0 || this.#turnAdmissions > 0) {
      throw new Error("Pi 正在生成、执行命令、压缩上下文或处理队列消息；请等待当前操作完成后再修改运行配置");
    }
  }

  async runRuntimeMaintenance<T>(operation: () => Promise<T>): Promise<T> {
    this.assertMaintenanceAvailable();
    this.#runtimeMaintenance = true;
    try {
      return await operation();
    } finally {
      this.#runtimeMaintenance = false;
    }
  }

  handlePiEvent(event: unknown): void {
    if (eventType(event) === "agent_settled") this.release();
  }

  handleRuntimeSignal(signal: RuntimeSignal): void {
    if (signal.type === "runtime_exit" || signal.type === "protocol_error") this.release();
  }

  release(): void {
    const active = this.#active;
    this.#active = undefined;
    active?.lease.release();
  }

  async #sendTurn(command: PiCommand, workspacePath: string, requestId?: string): Promise<PiResponse> {
    const existing = this.#active;
    if (existing && existing.workspacePath !== workspacePath) {
      throw new Error(`Interactive Pi 已占用另一工作区: ${existing.workspacePath}`);
    }
    const newlyAcquired = !existing;
    if (newlyAcquired) {
      const lease = await this.#admission.acquireInteractive(workspacePath, {
        id: this.#id(),
        kind: "interactive",
        label: "Interactive Pi",
      });
      if (this.#runtimeMaintenance) {
        lease.release();
        throw new Error("Pi Runtime 正在重载模型配置；请等待重载完成后再发送命令");
      }
      this.#active = Object.freeze({ workspacePath, lease });
    }
    try {
      return await this.#runtime.send(command, requestId);
    } catch (cause) {
      if (newlyAcquired) this.release();
      throw cause;
    }
  }

  async #sendBash(command: PiCommand, workspacePath: string): Promise<PiResponse> {
    if (this.#active) return this.#runtime.send(command);
    const lease = await this.#admission.acquireInteractive(workspacePath, {
      id: this.#id(),
      kind: "interactive",
      label: "Interactive Pi Bash",
    });
    try {
      if (this.#runtimeMaintenance) {
        throw new Error("Pi Runtime 正在重载模型配置；请等待重载完成后再发送命令");
      }
      return await this.#runtime.send(command);
    } finally {
      lease.release();
    }
  }

  async #sendCompaction(command: PiCommand): Promise<PiResponse> {
    if (this.#active) throw new Error("Pi 正在生成或处理队列消息；请等待当前回合完成后再压缩上下文");
    if (this.#compacting) throw new Error("上下文压缩已在进行中");
    this.#compacting = true;
    try {
      return await this.#runtime.send(command);
    } finally {
      this.#compacting = false;
    }
  }
}
