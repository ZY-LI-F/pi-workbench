import type { PiCommand, PiResponse, RuntimeBootstrap, RuntimeSignal } from "../../shared/contracts";
import { parseCoordinatorAction } from "../../shared/coordinator-protocol";
import type { ExecutionBackendHealth } from "../../shared/execution-profile";
import { piExecutionSession } from "../../shared/execution-session";
import { requiredSkillsPrompt, assertRequiredAgentSkills } from "../required-agent-skills";
import { coordinatorActionResult, finalAssistantResult } from "../pi-execution-result";
import { resolveAgentRuntimeModel, type RuntimeModelSelection } from "../../shared/runtime-model";
import type { PiRuntimeStartOptions } from "../pi-rpc-runtime";
import {
  ExecutionAbortedError,
  ExecutionProtocolError,
  type ExecutionBackend,
  type ExecutionBackendConfiguration,
  type ExecutionEvent,
  type ExecutionOutcome,
  type ExecutionRequest,
  type ExecutionUsage,
  type OpenExecutionSessionResult,
} from "../execution-backend";

export interface PiRpcExecutionRuntime {
  readonly running: boolean;
  start(options: PiRuntimeStartOptions): Promise<void>;
  send(command: PiCommand): Promise<PiResponse>;
  abortAndStop(): Promise<void>;
  stop(): Promise<void>;
}

export interface PiRpcExecutionRuntimeFactory {
  create(callbacks: {
    readonly emitPiEvent: (event: unknown) => void;
    readonly emitRuntimeSignal: (signal: RuntimeSignal) => void;
  }): PiRpcExecutionRuntime;
}

interface PiRpcExecutionAdapterOptions {
  readonly runtimeFactory: PiRpcExecutionRuntimeFactory;
  readonly globalModel: () => RuntimeModelSelection | undefined;
  readonly coordinatorExtensionPath: string;
  readonly skills: {
    assertAgentsReady(projectPath: string, trusted: boolean, agents: readonly ExecutionRequest["agent"][]): Promise<void>;
  };
  readonly backendVersion?: () => string | undefined;
  readonly openSession?: (session: NonNullable<Parameters<ExecutionBackend["openSession"]>[0]>) => Promise<RuntimeBootstrap>;
  readonly now?: () => string;
}

interface RpcStateData {
  readonly sessionFile?: string;
  readonly sessionId?: string;
}

interface RpcStatsData {
  readonly tokens?: { readonly input?: number; readonly output?: number };
  readonly cost?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const field = record(value)?.[key];
  return typeof field === "string" ? field : undefined;
}

function responseData<T>(response: PiResponse, command: string): T {
  if (!response.success) throw new Error(response.error);
  if (!("data" in response)) throw new Error(`Pi RPC 命令 ${command} 没有返回 data`);
  return response.data as T;
}

export class PiRpcExecutionAdapter implements ExecutionBackend {
  readonly backendId = "pi" as const;
  readonly #runtimeFactory: PiRpcExecutionRuntimeFactory;
  readonly #globalModel: () => RuntimeModelSelection | undefined;
  readonly #coordinatorExtensionPath: string;
  readonly #skills: PiRpcExecutionAdapterOptions["skills"];
  readonly #backendVersion: () => string | undefined;
  readonly #openSession?: PiRpcExecutionAdapterOptions["openSession"];
  readonly #now: () => string;

  constructor(options: PiRpcExecutionAdapterOptions) {
    this.#runtimeFactory = options.runtimeFactory;
    this.#globalModel = options.globalModel;
    this.#coordinatorExtensionPath = options.coordinatorExtensionPath;
    this.#skills = options.skills;
    this.#backendVersion = options.backendVersion ?? (() => undefined);
    this.#openSession = options.openSession;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async probe(_configuration: ExecutionBackendConfiguration): Promise<ExecutionBackendHealth> {
    return Object.freeze({
      backendId: this.backendId,
      state: "ready",
      version: this.#backendVersion(),
      authState: "ready",
      executableSource: "bundled",
      updatedAt: this.#now(),
    });
  }

  async run(request: ExecutionRequest, emit: (event: ExecutionEvent) => void, signal: AbortSignal): Promise<ExecutionOutcome> {
    if (request.profile.backendId !== this.backendId) throw new Error(`Pi Adapter 不能执行 ${request.profile.id}`);
    if (signal.aborted) throw new ExecutionAbortedError();

    let settledResolve: (() => void) | undefined;
    let settled = false;
    let terminalError: unknown;
    const settledPromise = new Promise<void>((resolve) => {
      settledResolve = resolve;
    });
    const settleOnce = (cause?: unknown): void => {
      if (settled) return;
      settled = true;
      terminalError = cause;
      settledResolve?.();
    };

    const runtime = this.#runtimeFactory.create({
      emitPiEvent: (event) => {
        const eventType = stringField(event, "type") ?? "unknown";
        const toolName = stringField(event, "toolName") ?? stringField(event, "name") ?? "工具";
        if (eventType === "agent_settled") settleOnce();
        else if (eventType === "tool_execution_start") emit({ type: "tool-start", name: toolName });
        else if (eventType === "tool_execution_end") emit({ type: "tool-end", name: toolName, failed: record(event)?.isError === true });
      },
      emitRuntimeSignal: (runtimeSignal) => {
        if (runtimeSignal.type === "runtime_stderr") emit({ type: "stderr", message: runtimeSignal.message });
        if (runtimeSignal.type === "protocol_error") emit({ type: "stderr", message: runtimeSignal.message });
        if (runtimeSignal.type === "runtime_exit") {
          settleOnce(new Error(`Pi RPC 意外退出 (code=${String(runtimeSignal.code)}, signal=${String(runtimeSignal.signal)})`));
        }
      },
    });

    const abort = (): void => {
      void runtime.abortAndStop().finally(() => settleOnce(new ExecutionAbortedError()));
    };
    signal.addEventListener("abort", abort, { once: true });
    const structuredCoordinator = request.expectedResult === "coordinator-action";
    const allowedTools = structuredCoordinator
      ? Object.freeze([...new Set([...request.agent.allowedTools, "coordinator_action"])])
      : request.agent.allowedTools;
    const selectedModel = resolveAgentRuntimeModel(request.agent, this.#globalModel());
    try {
      await this.#skills.assertAgentsReady(request.cwd, request.trusted, Object.freeze([request.agent]));
      await runtime.start({
        cwd: request.cwd,
        trusted: request.trusted,
        sessionName: request.sessionName,
        provider: selectedModel.provider,
        model: selectedModel.model,
        thinking: request.agent.thinking,
        allowedTools,
        appendSystemPrompt: requiredSkillsPrompt(request.agent),
        disableExtensions: request.agent.disableExtensions,
        disableSkills: request.agent.disableSkills,
        disablePromptTemplates: request.agent.disablePromptTemplates,
        disableContextFiles: request.agent.disableContextFiles,
        extensions: structuredCoordinator ? Object.freeze([this.#coordinatorExtensionPath]) : undefined,
      });
      if (signal.aborted) throw new ExecutionAbortedError();
      await assertRequiredAgentSkills(runtime, request.agent);
      if (signal.aborted) throw new ExecutionAbortedError();
      await runtime.send({ type: "prompt", message: request.prompt });
      await settledPromise;
      if (terminalError !== undefined) throw terminalError;
      if (signal.aborted) throw new ExecutionAbortedError();

      const [textResponse, stateResponse, statsResponse, messagesResponse] = await Promise.all([
        runtime.send({ type: "get_last_assistant_text" }),
        runtime.send({ type: "get_state" }),
        runtime.send({ type: "get_session_stats" }),
        runtime.send({ type: "get_messages" }),
      ]);
      const state = responseData<RpcStateData>(stateResponse, "get_state");
      const stats = responseData<RpcStatsData>(statsResponse, "get_session_stats");
      const session = piExecutionSession({ sessionId: state.sessionId, sessionPath: state.sessionFile });
      const usage: ExecutionUsage = Object.freeze({
        inputTokens: stats.tokens?.input,
        outputTokens: stats.tokens?.output,
        cost: stats.cost,
      });
      if (session) emit({ type: "session", session });
      const backendVersion = this.#backendVersion();
      if (structuredCoordinator) {
        try {
          const actionResult = coordinatorActionResult(messagesResponse);
          const action = parseCoordinatorAction(actionResult.output, request.coordinatorDelegates ?? []);
          return Object.freeze({ result: Object.freeze({ kind: "coordinator-action", action }), session, usage, backendVersion });
        } catch (cause) {
          let output: string;
          try {
            output = finalAssistantResult(textResponse, messagesResponse).output;
          } catch {
            output = cause instanceof Error ? cause.message : String(cause);
          }
          throw new ExecutionProtocolError({
            message: cause instanceof Error ? cause.message : String(cause),
            output,
            session,
            usage,
            backendVersion,
          });
        }
      }
      const output = finalAssistantResult(textResponse, messagesResponse).output;
      emit({ type: "assistant-output", text: output });
      return Object.freeze({ result: Object.freeze({ kind: "report", output }), session, usage, backendVersion });
    } finally {
      signal.removeEventListener("abort", abort);
      if (runtime.running) await runtime.stop();
    }
  }

  async openSession(session: Parameters<ExecutionBackend["openSession"]>[0]): Promise<OpenExecutionSessionResult> {
    if (session.backendId !== this.backendId) throw new Error("Pi Adapter 不能打开其他 Backend 的 session");
    if (!this.#openSession) throw new Error("当前 Pi Adapter 没有配置交互式 session 打开器");
    const runtime = await this.#openSession(session);
    return Object.freeze({ kind: "interactive-pi", runtime });
  }
}
