export const CUSTOM_MODEL_APIS = Object.freeze([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const);

export type CustomModelApi = (typeof CUSTOM_MODEL_APIS)[number];

export interface PiModelConfigurationModel {
  readonly id: string;
  readonly name?: string;
  readonly reasoning: boolean;
  readonly imageInput: boolean;
  readonly contextWindow: number;
  readonly maxTokens: number;
}

export interface PiCustomProviderConfiguration {
  readonly id: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly api?: CustomModelApi;
  readonly authHeader: boolean;
  readonly models: readonly PiModelConfigurationModel[];
  readonly hasInlineApiKey: boolean;
  readonly hasAdvancedConfiguration: boolean;
}

export interface PiModelProviderSummary {
  readonly id: string;
  readonly name: string;
  readonly builtIn: boolean;
  readonly hasCustomConfiguration: boolean;
  readonly configured: boolean;
  readonly authSource?: string;
  readonly authLabel?: string;
  readonly credentialType?: "api_key" | "oauth";
  readonly supportsApiKey: boolean;
  readonly supportsOAuth: boolean;
  readonly catalogModelCount: number;
}

export interface PiModelConfigurationSnapshot {
  readonly agentDir: string;
  readonly modelsPath: string;
  readonly authPath: string;
  readonly providers: readonly PiModelProviderSummary[];
  readonly customProviders: readonly PiCustomProviderConfiguration[];
  readonly configurationError?: string;
}

export interface SavePiApiKeyInput {
  readonly providerId: string;
  readonly apiKey: string;
}

export interface PiApiKeyRevealResult {
  readonly providerId: string;
  readonly apiKey: string;
  readonly source?: string;
}

export interface TestPiModelConnectionInput {
  readonly providerId: string;
  readonly modelId?: string;
  /** Tests this key in memory without saving it. Empty/omitted uses Pi's current credential. */
  readonly apiKey?: string;
}

export interface DiscoverPiModelsInput {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly api: CustomModelApi;
  /** Uses this key in memory without saving it. Empty/omitted resolves the current Pi credential. */
  readonly apiKey?: string;
  readonly authHeader: boolean;
}

export interface PiDiscoveredModel {
  readonly id: string;
  readonly name?: string;
  readonly owner?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly reasoning?: boolean;
  readonly imageInput?: boolean;
}

export type PiModelDiscoveryCredentialSource = "draft" | "configured" | "none";

export interface PiModelDiscoveryResult {
  readonly providerId: string;
  readonly endpoint: string;
  readonly models: readonly PiDiscoveredModel[];
  readonly credentialSource: PiModelDiscoveryCredentialSource;
  readonly latencyMs: number;
  readonly checkedAt: number;
}

export type PiModelConnectionTestCode =
  | "success"
  | "authentication"
  | "permission"
  | "model"
  | "quota"
  | "network"
  | "timeout"
  | "provider"
  | "unknown";

export interface PiModelConnectionTestResult {
  readonly ok: boolean;
  readonly code: PiModelConnectionTestCode;
  readonly providerId: string;
  readonly modelId?: string;
  readonly responseModel?: string;
  readonly latencyMs: number;
  readonly checkedAt: number;
  /** Human-readable and secret-redacted; never contains response content or request headers. */
  readonly message: string;
}

export interface PiModelConfigurationProviderInput {
  readonly id: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly api?: CustomModelApi;
  readonly authHeader: boolean;
  readonly models: readonly PiModelConfigurationModel[];
}

export interface SavePiProviderSetupInput {
  readonly provider: PiModelConfigurationProviderInput;
  /** Saves this key to auth.json together with the Provider update. Empty/omitted preserves existing auth. */
  readonly apiKey?: string;
}

export function isCustomModelApi(value: unknown): value is CustomModelApi {
  return typeof value === "string" && CUSTOM_MODEL_APIS.includes(value as CustomModelApi);
}
