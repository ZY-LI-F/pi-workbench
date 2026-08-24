import type { RuntimeBootstrap } from "../shared/contracts";
import type { CoordinatorAction } from "../shared/coordinator-protocol";
import type {
  ExecutionBackendHealth,
  ExecutionBackendId,
  ExecutionProfileId,
  ExecutionProfileSnapshot,
} from "../shared/execution-profile";
import type { ExecutionSessionReference } from "../shared/execution-session";
import type { AgentDefinition } from "../shared/kanban";

export interface ExecutionBackendConfiguration {
  readonly backendId: ExecutionBackendId;
  readonly executable?: string;
  readonly prefixArgv?: readonly string[];
}

export interface ExecutionRequest {
  readonly executionId: string;
  readonly runtimeToken: string;
  readonly profile: ExecutionProfileSnapshot;
  readonly cwd: string;
  readonly trusted: boolean;
  readonly sessionName: string;
  readonly prompt: string;
  readonly agent: AgentDefinition;
  readonly coordinatorDelegates?: readonly AgentDefinition[];
  readonly expectedResult: "report" | "coordinator-action";
}

export type ExecutionEvent =
  | { readonly type: "session"; readonly session: ExecutionSessionReference }
  | { readonly type: "assistant-output"; readonly text: string }
  | { readonly type: "tool-start"; readonly name: string; readonly detail?: string }
  | { readonly type: "tool-end"; readonly name: string; readonly failed: boolean }
  | { readonly type: "stderr"; readonly message: string };

export interface ExecutionUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
}

export type ExecutionFinalResult =
  | { readonly kind: "report"; readonly output: string }
  | { readonly kind: "coordinator-action"; readonly action: CoordinatorAction };

export interface ExecutionOutcome {
  readonly result: ExecutionFinalResult;
  readonly session?: ExecutionSessionReference;
  readonly usage?: ExecutionUsage;
  readonly backendVersion?: string;
}

export interface OpenExecutionSessionResult {
  readonly kind: "interactive-pi" | "command-copied" | "opened-external";
  readonly runtime?: RuntimeBootstrap;
  readonly message?: string;
}

export interface ExecutionBackend {
  readonly backendId: ExecutionBackendId;
  probe(configuration: ExecutionBackendConfiguration): Promise<ExecutionBackendHealth>;
  run(request: ExecutionRequest, emit: (event: ExecutionEvent) => void, signal: AbortSignal): Promise<ExecutionOutcome>;
  openSession(session: ExecutionSessionReference): Promise<OpenExecutionSessionResult>;
}

export class ExecutionAbortedError extends Error {
  constructor(message = "执行已中止") {
    super(message);
    this.name = "ExecutionAbortedError";
  }
}

export class ExecutionProtocolError extends Error {
  readonly output: string;
  readonly session?: ExecutionSessionReference;
  readonly usage?: ExecutionUsage;
  readonly backendVersion?: string;

  constructor(input: {
    readonly message: string;
    readonly output: string;
    readonly session?: ExecutionSessionReference;
    readonly usage?: ExecutionUsage;
    readonly backendVersion?: string;
  }) {
    super(input.message);
    this.name = "ExecutionProtocolError";
    this.output = input.output;
    this.session = input.session;
    this.usage = input.usage;
    this.backendVersion = input.backendVersion;
  }
}

export interface ResolvedExecutionBackend {
  readonly profileId: ExecutionProfileId;
  readonly profile: ExecutionProfileSnapshot;
  readonly backend: ExecutionBackend;
  readonly health: ExecutionBackendHealth;
}
