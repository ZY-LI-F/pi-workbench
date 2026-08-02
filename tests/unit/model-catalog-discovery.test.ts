// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRemoteModelCatalogDiscovery } from "../../src/main/model-catalog-discovery";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("remote model catalog discovery", () => {
  it("lists and de-duplicates OpenAI-compatible models with Bearer authentication", async () => {
    const request = vi.fn(async () => jsonResponse({
      object: "list",
      data: [
        { id: "qwen-plus", owned_by: "aliyun" },
        { id: "qwen-max", name: "Qwen Max", context_window: 131_072 },
        { id: "qwen-plus", owned_by: "duplicate" },
      ],
    }));
    const discover = createRemoteModelCatalogDiscovery(request);

    const result = await discover({
      baseUrl: "https://example.test/compatible-mode/v1",
      api: "openai-completions",
      apiKey: "catalog-secret",
      authHeader: false,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe("https://example.test/compatible-mode/v1/models");
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({ authorization: "Bearer catalog-secret" }),
    });
    expect(result.endpoint).toBe("https://example.test/compatible-mode/v1/models");
    expect(result.models).toEqual([
      expect.objectContaining({ id: "qwen-max", name: "Qwen Max", contextWindow: 131_072 }),
      expect.objectContaining({ id: "qwen-plus", owner: "aliyun" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("catalog-secret");
  });

  it("reads every Gemini catalog page, filters non-generative entries, and preserves returned limits", async () => {
    const request = vi.fn(async (url: string) => {
      const pageToken = new URL(url).searchParams.get("pageToken");
      return pageToken
        ? jsonResponse({
            models: [{
              name: "models/gemini-pro-vision",
              displayName: "Gemini Pro Vision",
              inputTokenLimit: 1_048_576,
              outputTokenLimit: 65_536,
              supportedGenerationMethods: ["generateContent"],
              supportedInputModalities: ["TEXT", "IMAGE"],
            }],
          })
        : jsonResponse({
            models: [
              { name: "models/gemini-flash", displayName: "Gemini Flash", supportedGenerationMethods: ["generateContent"] },
              { name: "models/text-embedding", supportedGenerationMethods: ["embedContent"] },
            ],
            nextPageToken: "next-page",
          });
    });
    const discover = createRemoteModelCatalogDiscovery(request);

    const result = await discover({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      api: "google-generative-ai",
      apiKey: "gemini-secret",
      authHeader: false,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(new URL(request.mock.calls[1]?.[0] ?? "").searchParams.get("pageToken")).toBe("next-page");
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "x-goog-api-key": "gemini-secret" }),
    });
    expect(result.models).toEqual([
      expect.objectContaining({ id: "gemini-flash", name: "Gemini Flash" }),
      expect.objectContaining({
        id: "gemini-pro-vision",
        name: "Gemini Pro Vision",
        contextWindow: 1_048_576,
        maxTokens: 65_536,
        imageInput: true,
      }),
    ]);
    expect(result.models.some((model) => model.id === "text-embedding")).toBe(false);
  });

  it("uses the Anthropic model endpoint and never exposes Provider response bodies", async () => {
    const request = vi.fn(async () => jsonResponse({
      error: { message: "invalid key anthropic-secret" },
    }, 401));
    const discover = createRemoteModelCatalogDiscovery(request);

    await expect(discover({
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      apiKey: "anthropic-secret",
      authHeader: false,
    })).rejects.toThrow("鉴权失败（401）");

    expect(request.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/models");
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "x-api-key": "anthropic-secret",
        "anthropic-version": "2023-06-01",
      }),
    });
    try {
      await discover({
        baseUrl: "https://api.anthropic.com",
        api: "anthropic-messages",
        apiKey: "anthropic-secret",
        authHeader: false,
      });
    } catch (cause) {
      expect(String(cause)).not.toContain("anthropic-secret");
    }
  });

  it("maps Anthropic display names, limits, and declared capabilities", async () => {
    const discover = createRemoteModelCatalogDiscovery(vi.fn(async () => jsonResponse({
      data: [{
        id: "claude-sonnet-test",
        display_name: "Claude Sonnet Test",
        max_input_tokens: 200_000,
        max_tokens: 64_000,
        capabilities: {
          thinking: { supported: true },
          image_input: { supported: true },
        },
      }],
      has_more: false,
    })));

    const result = await discover({
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      apiKey: "anthropic-secret",
      authHeader: false,
    });

    expect(result.models).toEqual([expect.objectContaining({
      id: "claude-sonnet-test",
      name: "Claude Sonnet Test",
      contextWindow: 200_000,
      maxTokens: 64_000,
      reasoning: true,
      imageInput: true,
    })]);
  });

  it("reports an unsupported model directory shape instead of treating it as an empty success", async () => {
    const discover = createRemoteModelCatalogDiscovery(vi.fn(async () => jsonResponse({ result: "ok" })));

    await expect(discover({
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      authHeader: false,
    })).rejects.toThrow("需要 data[] 或 models[]");
  });
});
