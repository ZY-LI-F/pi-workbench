import type {
  ContinueExternalExecutionResult,
  ExternalExecutionDetails,
  ExternalExecutionItem,
  ExternalExecutionScope,
  ExternalExecutionSourceDefinition,
} from "../shared/external-execution";

export interface ExternalExecutionSource {
  readonly definition: ExternalExecutionSourceDefinition;
  refresh(scope: ExternalExecutionScope): Promise<readonly ExternalExecutionItem[]>;
  details?(item: ExternalExecutionItem): Promise<ExternalExecutionDetails>;
  continue?(item: ExternalExecutionItem): Promise<ContinueExternalExecutionResult>;
  shutdown?(): Promise<void>;
}

export class ExternalExecutionSourceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalExecutionSourceUnavailableError";
  }
}
