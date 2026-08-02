import type {
  CustomModelApi,
  PiDiscoveredModel,
} from "../shared/model-configuration";

const MODEL_CATALOG_TIMEOUT_MS = 15_000;

type JsonRecord = Readonly<Record<string, unknown>>;

export interface RemoteModelCatalogInput {
  readonly baseUrl: string;
  readonly api: CustomModelApi;
  readonly apiKey?: string;
  readonly authHeader: boolean;
}

export interface RemoteModelCatalogResult {
  readonly endpoint: string;
  readonly models: readonly PiDiscoveredModel[];
  readonly latencyMs: number;
  readonly checkedAt: number;
}

export type ModelCatalogHttpRequest = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export type RemoteModelCatalogDiscovery = (
  input: RemoteModelCatalogInput,
) => Promise<RemoteModelCatalogResult>;

class ModelCatalogResponseError extends Error {}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function stringField(source: JsonRecord, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function positiveIntegerField(source: JsonRecord, names: readonly string[]): number | undefined {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  }
  return undefined;
}

function booleanField(source: JsonRecord, names: readonly string[]): boolean | undefined {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function stringArrayField(source: JsonRecord, names: readonly string[]): readonly string[] | undefined {
  for (const name of names) {
    const value = source[name];
    if (!Array.isArray(value)) continue;
    const strings = value.filter((candidate): candidate is string => typeof candidate === "string");
    return Object.freeze(strings);
  }
  return undefined;
}

function nestedCapabilitySupported(source: JsonRecord, capabilityName: string): boolean | undefined {
  const capabilities = record(source.capabilities);
  const capability = capabilities ? record(capabilities[capabilityName]) : undefined;
  return capability && typeof capability.supported === "boolean" ? capability.supported : undefined;
}

function catalogEndpoint(baseUrl: string, api: CustomModelApi): string {
  const endpoint = new URL(baseUrl);
  const path = endpoint.pathname.replace(/\/+$/u, "");
  if (/\/models$/u.test(path)) {
    endpoint.pathname = path;
    return endpoint.toString();
  }

  const hasVersionSuffix = /\/v\d+(?:beta\d*)?$/u.test(path);
  const suffix = api === "anthropic-messages" && !hasVersionSuffix ? "/v1/models" : "/models";
  endpoint.pathname = `${path}${suffix}`.replace(/\/{2,}/gu, "/");
  return endpoint.toString();
}

function requestHeaders(input: RemoteModelCatalogInput): Readonly<Record<string, string>> {
  const apiKey = input.apiKey;
  if (input.api === "anthropic-messages") {
    return Object.freeze({
      accept: "application/json",
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(apiKey && input.authHeader ? { authorization: `Bearer ${apiKey}` } : {}),
    });
  }
  if (input.api === "google-generative-ai") {
    return Object.freeze({
      accept: "application/json",
      ...(apiKey ? { "x-goog-api-key": apiKey } : {}),
      ...(apiKey && input.authHeader ? { authorization: `Bearer ${apiKey}` } : {}),
    });
  }
  return Object.freeze({
    accept: "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  });
}

function responseFailure(status: number): ModelCatalogResponseError {
  if (status === 401) return new ModelCatalogResponseError("模型目录鉴权失败（401）：请检查 API Key。");
  if (status === 403) return new ModelCatalogResponseError("模型目录拒绝访问（403）：当前 Key 没有列出模型的权限。");
  if (status === 404) return new ModelCatalogResponseError("该 Base URL 没有提供模型目录（404）；可继续手工添加模型 ID。");
  if (status === 429) return new ModelCatalogResponseError("模型目录请求被限流或额度不足（429），请稍后重试。");
  return new ModelCatalogResponseError(`模型目录请求失败（HTTP ${status}）。`);
}

function responseRows(payload: unknown): readonly unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = record(payload);
  if (!root) throw new ModelCatalogResponseError("模型目录响应不是 JSON 对象。");
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.models)) return root.models;
  throw new ModelCatalogResponseError("模型目录响应格式不受支持：需要 data[] 或 models[]。");
}

function discoveredModel(value: unknown, api: CustomModelApi): PiDiscoveredModel | undefined {
  const source = record(value);
  if (!source) return undefined;
  const explicitId = stringField(source, ["id", "model"]);
  const rawId = explicitId ?? stringField(source, ["name"]);
  if (!rawId) return undefined;
  const generationMethods = stringArrayField(source, ["supportedGenerationMethods", "supported_generation_methods"]);
  if (
    api === "google-generative-ai"
    && generationMethods
    && !generationMethods.some((method) => method === "generateContent" || method === "streamGenerateContent")
  ) return undefined;

  const id = api === "google-generative-ai" ? rawId.replace(/^models\//u, "") : rawId;
  if (!id) return undefined;
  const name = stringField(source, ["displayName", "display_name", "title"])
    ?? (explicitId ? stringField(source, ["name"]) : undefined);
  const owner = stringField(source, ["owned_by", "ownedBy", "owner", "provider"]);
  const contextWindow = positiveIntegerField(source, ["inputTokenLimit", "max_input_tokens", "contextWindow", "context_window"]);
  const maxTokens = positiveIntegerField(source, ["outputTokenLimit", "maxTokens", "max_tokens"]);
  const reasoning = booleanField(source, ["reasoning", "supportsReasoning", "supports_reasoning"])
    ?? nestedCapabilitySupported(source, "thinking");
  const inputModalities = stringArrayField(source, ["supportedInputModalities", "supported_input_modalities", "input_modalities"]);
  const explicitImageInput = booleanField(source, ["imageInput", "image_input"])
    ?? nestedCapabilitySupported(source, "image_input");
  return Object.freeze({
    id,
    ...(name && name !== id ? { name } : {}),
    ...(owner ? { owner } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(explicitImageInput !== undefined || inputModalities ? {
      imageInput: explicitImageInput ?? inputModalities?.some((modality) => modality.toLocaleLowerCase() === "image") ?? false,
    } : {}),
  });
}

function nextPageUrl(
  currentUrl: string,
  payload: unknown,
  lastModelId: string | undefined,
): string | undefined {
  const root = record(payload);
  if (!root) return undefined;
  const pageToken = stringField(root, ["nextPageToken", "next_page_token"]);
  if (pageToken) {
    const next = new URL(currentUrl);
    next.searchParams.set("pageToken", pageToken);
    return next.toString();
  }
  if (root.has_more === true) {
    const afterId = stringField(root, ["last_id", "lastId"]) ?? lastModelId;
    if (!afterId) throw new ModelCatalogResponseError("模型目录声明还有下一页，但没有返回分页标记。");
    const next = new URL(currentUrl);
    next.searchParams.set("after_id", afterId);
    return next.toString();
  }
  return undefined;
}

export function createRemoteModelCatalogDiscovery(
  request: ModelCatalogHttpRequest,
): RemoteModelCatalogDiscovery {
  return async (input) => {
    const startedAt = Date.now();
    const endpoint = catalogEndpoint(input.baseUrl, input.api);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_CATALOG_TIMEOUT_MS);
    timeout.unref();
    const visited = new Set<string>();
    const models = new Map<string, PiDiscoveredModel>();

    try {
      let pageUrl: string | undefined = endpoint;
      while (pageUrl) {
        if (visited.has(pageUrl)) throw new ModelCatalogResponseError("模型目录返回了重复分页标记，已停止读取。");
        visited.add(pageUrl);
        const response = await request(pageUrl, Object.freeze({
          method: "GET",
          headers: requestHeaders(input),
          redirect: "error",
          signal: controller.signal,
        }));
        if (!response.ok) throw responseFailure(response.status);

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new ModelCatalogResponseError("模型目录没有返回有效 JSON。");
        }
        const pageModels = responseRows(payload)
          .map((candidate) => discoveredModel(candidate, input.api))
          .filter((candidate): candidate is PiDiscoveredModel => Boolean(candidate));
        for (const model of pageModels) {
          if (!models.has(model.id)) models.set(model.id, model);
        }
        pageUrl = nextPageUrl(pageUrl, payload, pageModels.at(-1)?.id);
      }

      return Object.freeze({
        endpoint,
        models: Object.freeze([...models.values()].sort((left, right) =>
          (left.name ?? left.id).localeCompare(right.name ?? right.id, "zh-CN"))),
        latencyMs: Math.max(0, Date.now() - startedAt),
        checkedAt: Date.now(),
      });
    } catch (cause) {
      if (cause instanceof ModelCatalogResponseError) throw cause;
      if (controller.signal.aborted) {
        throw new Error(`模型目录请求超过 ${MODEL_CATALOG_TIMEOUT_MS / 1000} 秒，请检查网络、代理或端点响应速度。`);
      }
      throw new Error("无法请求模型目录，请检查 Base URL、网络、代理、DNS 与 TLS 配置。");
    } finally {
      clearTimeout(timeout);
    }
  };
}
