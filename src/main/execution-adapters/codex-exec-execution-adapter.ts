import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionBackendHealth } from "../../shared/execution-profile";
import { CliBackendProbe } from "../cli-backend-probe";
import { CliProcess } from "../cli-process";
import {
  ExecutionAbortedError,
  ExecutionProtocolError,
  type ExecutionBackend,
  type ExecutionBackendConfiguration,
  type ExecutionEvent,
  type ExecutionOutcome,
  type ExecutionRequest,
  type OpenExecutionSessionResult,
} from "../execution-backend";
import { CodexExecProtocolReducer } from "./codex-exec-protocol";

interface CodexExecExecutionAdapterOptions {
  readonly process?: Pick<CliProcess, "run">;
  readonly probe?: CliBackendProbe;
  readonly isGitRepository?: (cwd: string) => Promise<boolean>;
  readonly copyText?: (value: string) => void;
}

function configurationKey(configuration: ExecutionBackendConfiguration | undefined): string {
  return configuration
    ? JSON.stringify([configuration.executable, configuration.prefixArgv ?? [], configuration.displayPath])
    : "";
}

function codexModel(request: ExecutionRequest): string | undefined {
  const provider = request.agent.provider?.trim().toLocaleLowerCase("en-US");
  if (!provider || (provider !== "openai" && !provider.startsWith("openai-"))) return undefined;
  return request.agent.model?.trim() || undefined;
}

export function codexExecutionArgv(request: ExecutionRequest): readonly string[] {
  const model = codexModel(request);
  if (request.profile.id === "codex.review") {
    return Object.freeze([
      "exec",
      "review",
      "--json",
      "--uncommitted",
      ...(model ? ["--model", model] : []),
      "-",
    ]);
  }
  return Object.freeze([
    "exec",
    "--json",
    "--cd",
    request.cwd,
    "--sandbox",
    request.agent.workspaceAccess === "read" ? "read-only" : "workspace-write",
    ...(request.agent.workspaceAccess === "write" ? ["--approve-for-me"] : []),
    ...(model ? ["--model", model] : []),
    "-",
  ]);
}

export class CodexExecExecutionAdapter implements ExecutionBackend {
  readonly backendId = "codex" as const;
  readonly #process: Pick<CliProcess, "run">;
  readonly #probe: CliBackendProbe;
  readonly #isGitRepository: (cwd: string) => Promise<boolean>;
  readonly #copyText?: (value: string) => void;
  #configuration?: ExecutionBackendConfiguration;
  #backendVersion?: string;

  constructor(options: CodexExecExecutionAdapterOptions = {}) {
    this.#process = options.process ?? new CliProcess();
    this.#probe = options.probe ?? new CliBackendProbe();
    this.#isGitRepository = options.isGitRepository ?? (async (cwd) => stat(join(cwd, ".git")).then(() => true, () => false));
    this.#copyText = options.copyText;
  }

  activate(configuration: ExecutionBackendConfiguration): void {
    if (configuration.backendId !== this.backendId) throw new Error("Codex Adapter 收到其他 Backend 的配置");
    this.#configuration = Object.freeze({
      ...configuration,
      prefixArgv: configuration.prefixArgv ? Object.freeze([...configuration.prefixArgv]) : undefined,
    });
    this.#backendVersion = undefined;
  }

  async probe(configuration: ExecutionBackendConfiguration): Promise<ExecutionBackendHealth> {
    const health = await this.#probe.probe(this.backendId, configuration);
    if (configurationKey(configuration) === configurationKey(this.#configuration)) this.#backendVersion = health.version;
    return health;
  }

  async run(request: ExecutionRequest, emit: (event: ExecutionEvent) => void, signal: AbortSignal): Promise<ExecutionOutcome> {
    const configuration = this.#configuration;
    if (!configuration?.executable) throw new Error("Codex CLI 尚未配置");
    if (request.profile.backendId !== this.backendId || (request.profile.id !== "codex.exec" && request.profile.id !== "codex.review")) {
      throw new Error(`Codex Adapter 不能执行 ${request.profile.id}`);
    }
    if (request.expectedResult !== "report") throw new Error(`${request.profile.label} 不支持 Coordinator 结构化结果`);
    if (request.agent.requiredSkills?.length) throw new Error(`${request.agent.name} 依赖 Pi Skills，不能使用 Codex CLI`);
    if (request.profile.id === "codex.review") {
      if (request.agent.workspaceAccess !== "read") throw new Error("Codex Review 只支持只读 Agent");
      if (!await this.#isGitRepository(request.cwd)) throw new Error("Codex Review 只能在 Git 项目中运行");
    }

    const reducer = new CodexExecProtocolReducer();
    let result: Awaited<ReturnType<CliProcess["run"]>>;
    try {
      result = await this.#process.run({
        executable: configuration.executable,
        prefixArgv: configuration.prefixArgv,
        argv: codexExecutionArgv(request),
        cwd: request.cwd,
        stdin: request.prompt,
        stdout: "jsonl",
      }, {
        onJson: (value) => {
          for (const event of reducer.accept(value)) emit(event);
        },
        onStderr: (message) => emit({ type: "stderr", message }),
      }, signal);
    } catch (cause) {
      if (cause instanceof ExecutionAbortedError) throw cause;
      const snapshot = reducer.snapshot();
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new ExecutionProtocolError({
        message,
        output: snapshot.output ?? message,
        session: snapshot.session,
        usage: snapshot.usage,
        backendVersion: this.#backendVersion,
      });
    }
    const snapshot = reducer.snapshot();
    const failure = snapshot.error
      ?? (result.exitCode === 0 ? undefined : result.stderrTail.trim() || `Codex CLI 退出码 ${String(result.exitCode)}`)
      ?? (!snapshot.completed ? "Codex JSONL 缺少 turn.completed 终态" : undefined)
      ?? (!snapshot.output ? "Codex 没有返回最终 Agent message" : undefined)
      ?? (!snapshot.session ? "Codex 没有返回 Thread ID" : undefined);
    if (failure) {
      const partialOutput = snapshot.output || result.stderrTail.trim() || result.stdoutTail.trim() || failure;
      throw new ExecutionProtocolError({
        message: failure,
        output: partialOutput,
        session: snapshot.session,
        usage: snapshot.usage,
        backendVersion: this.#backendVersion,
      });
    }
    return Object.freeze({
      result: Object.freeze({ kind: "report" as const, output: snapshot.output as string }),
      session: snapshot.session,
      usage: snapshot.usage,
      backendVersion: this.#backendVersion,
    });
  }

  async openSession(session: Parameters<ExecutionBackend["openSession"]>[0]): Promise<OpenExecutionSessionResult> {
    if (session.backendId !== this.backendId || !session.sessionId) throw new Error("Codex session 缺少 Thread ID");
    const command = `codex resume ${session.sessionId}`;
    this.#copyText?.(command);
    return Object.freeze({ kind: "command-copied", message: command });
  }
}
