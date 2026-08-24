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
import { ClaudePrintProtocolReducer } from "./claude-print-protocol";

interface ClaudePrintExecutionAdapterOptions {
  readonly process?: Pick<CliProcess, "run">;
  readonly probe?: CliBackendProbe;
  readonly copyText?: (value: string) => void;
}

const CLAUDE_TOOL_BY_STELLA_TOOL = Object.freeze({
  read: "Read",
  grep: "Grep",
  find: "Glob",
  ls: "Glob",
  bash: "Bash",
  edit: "Edit",
  write: "Write",
} as const);

function configurationKey(configuration: ExecutionBackendConfiguration | undefined): string {
  return configuration
    ? JSON.stringify([configuration.executable, configuration.prefixArgv ?? [], configuration.displayPath])
    : "";
}

function claudeModel(request: ExecutionRequest): string | undefined {
  const provider = request.agent.provider?.trim().toLocaleLowerCase("en-US");
  if (!provider || (!["anthropic", "claude"].includes(provider) && !provider.startsWith("anthropic-"))) return undefined;
  return request.agent.model?.trim() || undefined;
}

export function claudeEffort(request: ExecutionRequest): "low" | "medium" | "high" | "xhigh" | "max" {
  if (request.agent.thinking === "max") return "max";
  if (request.agent.thinking === "xhigh") return "xhigh";
  if (request.agent.thinking === "high") return "high";
  if (request.agent.thinking === "medium") return "medium";
  return "low";
}

export function claudeAllowedTools(request: ExecutionRequest): readonly string[] {
  const tools = request.agent.allowedTools.map((tool) => {
    const mapped = CLAUDE_TOOL_BY_STELLA_TOOL[tool as keyof typeof CLAUDE_TOOL_BY_STELLA_TOOL];
    if (!mapped) throw new Error(`Claude CLI 不支持 Stella 工具：${tool}`);
    return mapped;
  });
  return Object.freeze([...new Set(tools)]);
}

export function claudePrintArgv(request: ExecutionRequest): readonly string[] {
  const tools = claudeAllowedTools(request).join(",");
  const model = claudeModel(request);
  const safeMode = request.agent.disableExtensions
    && request.agent.disableSkills
    && request.agent.disablePromptTemplates
    && request.agent.disableContextFiles;
  return Object.freeze([
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", request.agent.workspaceAccess === "read" ? "plan" : "acceptEdits",
    "--effort", claudeEffort(request),
    "--tools", tools,
    "--allowedTools", tools,
    "--name", request.sessionName,
    ...(safeMode ? ["--safe-mode"] : []),
    ...(model ? ["--model", model] : []),
  ]);
}

export class ClaudePrintExecutionAdapter implements ExecutionBackend {
  readonly backendId = "claude" as const;
  readonly #process: Pick<CliProcess, "run">;
  readonly #probe: CliBackendProbe;
  readonly #copyText?: (value: string) => void;
  #configuration?: ExecutionBackendConfiguration;
  #backendVersion?: string;

  constructor(options: ClaudePrintExecutionAdapterOptions = {}) {
    this.#process = options.process ?? new CliProcess();
    this.#probe = options.probe ?? new CliBackendProbe();
    this.#copyText = options.copyText;
  }

  activate(configuration: ExecutionBackendConfiguration): void {
    if (configuration.backendId !== this.backendId) throw new Error("Claude Adapter 收到其他 Backend 的配置");
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
    if (!configuration?.executable) throw new Error("Claude CLI 尚未配置");
    if (request.profile.backendId !== this.backendId || request.profile.id !== "claude.print") {
      throw new Error(`Claude Adapter 不能执行 ${request.profile.id}`);
    }
    if (request.expectedResult !== "report") throw new Error("Claude CLI 不支持 Coordinator 结构化结果");
    if (request.agent.requiredSkills?.length) throw new Error(`${request.agent.name} 依赖 Pi Skills，不能使用 Claude CLI`);

    const reducer = new ClaudePrintProtocolReducer();
    let result: Awaited<ReturnType<CliProcess["run"]>>;
    try {
      result = await this.#process.run({
        executable: configuration.executable,
        prefixArgv: configuration.prefixArgv,
        argv: claudePrintArgv(request),
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
      ?? (result.exitCode === 0 ? undefined : result.stderrTail.trim() || `Claude CLI 退出码 ${String(result.exitCode)}`)
      ?? (!snapshot.completed ? "Claude stream-json 缺少 result 终态" : undefined)
      ?? (!snapshot.output ? "Claude CLI 没有返回最终结果" : undefined)
      ?? (!snapshot.session ? "Claude CLI 没有返回 Session ID" : undefined);
    if (failure) {
      throw new ExecutionProtocolError({
        message: failure,
        output: snapshot.output || result.stderrTail.trim() || result.stdoutTail.trim() || failure,
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
    if (session.backendId !== this.backendId || !session.sessionId) throw new Error("Claude session 缺少 Session ID");
    const command = `claude --resume ${session.sessionId}`;
    this.#copyText?.(command);
    return Object.freeze({ kind: "command-copied", message: command });
  }
}
