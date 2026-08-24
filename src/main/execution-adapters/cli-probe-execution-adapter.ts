import type { ConfigurableExecutionBackendId } from "../../shared/execution-profile";
import { CliBackendProbe } from "../cli-backend-probe";
import type {
  ExecutionBackend,
  ExecutionBackendConfiguration,
  ExecutionEvent,
  ExecutionOutcome,
  ExecutionRequest,
  OpenExecutionSessionResult,
} from "../execution-backend";

interface CliProbeExecutionAdapterOptions {
  readonly backendId: ConfigurableExecutionBackendId;
  readonly probe?: CliBackendProbe;
}

export class CliProbeExecutionAdapter implements ExecutionBackend {
  readonly backendId: ConfigurableExecutionBackendId;
  readonly #probe: CliBackendProbe;

  constructor(options: CliProbeExecutionAdapterOptions) {
    this.backendId = options.backendId;
    this.#probe = options.probe ?? new CliBackendProbe();
  }

  probe(configuration: ExecutionBackendConfiguration) {
    return this.#probe.probe(this.backendId, configuration);
  }

  async run(_request: ExecutionRequest, _emit: (event: ExecutionEvent) => void, _signal: AbortSignal): Promise<ExecutionOutcome> {
    throw new Error(`${this.backendId} 受管执行 Adapter 尚未初始化`);
  }

  async openSession(): Promise<OpenExecutionSessionResult> {
    throw new Error(`${this.backendId} 会话打开功能尚未初始化`);
  }
}
