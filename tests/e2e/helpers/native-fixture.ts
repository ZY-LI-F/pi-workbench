import { expect, _electron as electron, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";

export interface ProtocolRequest {
  readonly model: string;
  readonly messages: readonly { readonly role: string; readonly content?: unknown; readonly tool_call_id?: string }[];
  readonly tools?: readonly { readonly type: string; readonly function: { readonly name: string } }[];
}

export function protocolReply(response: ServerResponse, model: string, text: string, tool?: { readonly id: string; readonly name: string; readonly args: unknown }, promptTokens: number | null = 400) {
  const base = { id: "chatcmpl-test-fixture", object: "chat.completion.chunk", created: 1, model };
  const delta = tool ? { role: "assistant", tool_calls: [{ index: 0, id: tool.id, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { role: "assistant", content: text };
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end([
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}`, "",
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }], ...(promptTokens === null ? {} : { usage: { prompt_tokens: promptTokens, completion_tokens: 100, total_tokens: promptTokens + 100 } }) })}`, "",
    "data: [DONE]", "", "",
  ].join("\n"));
}

export async function availableLoopbackPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback port allocated");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

/** Deterministic protocol fixture, NOT a real model or production fallback.
 * Every test launches the real Electron app and unmodified Pi with isolated
 * auth, settings, session, draft and project directories; file tools run for real.
 */
export async function nativeFixture(testInfo: TestInfo, respond = (request: ProtocolRequest, response: ServerResponse) => {
  protocolReply(response, request.model, "OK");
}, settings: Readonly<Record<string, unknown>> = {}, prepare?: (paths: { agentDir: string; projectDir: string; userDataDir: string }) => Promise<void>) {
  const requests: { readonly authorization: string; readonly path: string; readonly body?: ProtocolRequest }[] = [];
  const providerErrors: string[] = [];
  const pageErrors: string[] = [];
  const providerServer = createServer(async (request, response) => {
    try {
      const authorization = request.headers.authorization ?? "";
      if (request.method === "GET" && request.url === "/v1/models") {
        requests.push({ authorization, path: request.url });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ object: "list", data: [
          { id: "stella-e2e-model", name: "Local Validation Model", owned_by: "stella-e2e" },
          { id: "stella-e2e-model-2", name: "Discovered Validation Model", owned_by: "stella-e2e" },
        ] }));
        return;
      }
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") throw new Error(`Unexpected protocol request: ${request.method} ${request.url}`);
      let contents = "";
      for await (const chunk of request) contents += chunk.toString();
      const body = JSON.parse(contents) as ProtocolRequest;
      requests.push({ authorization, path: request.url, body });
      await respond(body, response);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      providerErrors.push(message);
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message } }));
    }
  });
  await new Promise<void>((resolve, reject) => { providerServer.once("error", reject); providerServer.listen(0, "127.0.0.1", resolve); });
  const address = providerServer.address();
  if (!address || typeof address === "string") throw new Error("No provider address");
  const closeServer = async () => {
    providerServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => providerServer.close((error) => error ? reject(error) : resolve()));
  };

  const agentDir = testInfo.outputPath("pi-agent");
  const projectDir = testInfo.outputPath("project");
  const userDataDir = testInfo.outputPath("electron-user-data");
  try {
    await Promise.all([agentDir, projectDir, userDataDir].map((directory) => mkdir(directory, { recursive: true })));
    await writeFile(join(projectDir, "README.md"), "# Isolated native GUI test\n\nThis is verifiable source evidence.\n");
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "stella-e2e": {
      name: "OpenAI-Compatible Local", baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
      models: [{ id: "stella-e2e-model", name: "Local Validation Model", reasoning: false, input: ["text", "image"], contextWindow: 131_072, maxTokens: 4096 }],
    } } }));
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ "stella-e2e": { type: "api_key", key: "stella-e2e-secret" } }));
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "stella-e2e", defaultModel: "stella-e2e-model", ...settings }));
    await writeFile(join(userDataDir, "stella-state.json"), JSON.stringify({ lastProject: projectDir, recentProjects: [{ path: projectDir, trusted: false, lastOpened: "2026-09-12T00:00:00.000Z" }] }));
    const skillDir = join(agentDir, "skills", "e2e-enter-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: e2e-enter-skill\ndescription: Test Skill selection and collapsed rendering.\n---\n\n# E2E Enter Skill\n\nE2E_SKILL_BODY_SHOULD_STAY_COLLAPSED\n");
    await prepare?.({ agentDir, projectDir, userDataDir });
    const appRoot = process.cwd();
    const executablePath = process.env.STELLA_PACKAGED_EXECUTABLE;
    const app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : [appRoot]), `--user-data-dir=${userDataDir}`], cwd: projectDir,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, STELLA_WEBHOOK_PORT: String(await availableLoopbackPort()), STELLA_COMPANION_PORT: String(await availableLoopbackPort()) },
    });
    try {
      const window = await app.firstWindow();
      window.on("pageerror", (error) => pageErrors.push(error.message));
      await window.waitForLoadState("domcontentloaded");
      await expect(window.locator(".app-shell, .startup-screen--error")).toBeVisible({ timeout: 45_000 });
      if (await window.locator(".startup-screen--error").isVisible()) throw new Error(await window.locator(".startup-screen--error").innerText());
      // Detection is read-only. Do not update the developer's global Pi during E2E.
      await window.evaluate(() => window.stella.piVersionCheck());
      const versionNotice = window.getByRole("status", { name: "Pi 版本不一致" });
      if (await versionNotice.isVisible()) await versionNotice.getByRole("button", { name: "暂不更新", exact: true }).click();
      const openChat = async () => {
        await window.locator(".sidebar").getByRole("tab", { name: "PI 原生工作台", exact: true }).click();
        await window.getByRole("button", { name: "当前会话", exact: true }).click();
        await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
      };
      return { app, window, agentDir, projectDir, userDataDir, requests, providerErrors, pageErrors, openChat,
        close: async () => { try { await app.close(); } finally { await closeServer(); } },
      };
    } catch (cause) { await app.close(); throw cause; }
  } catch (cause) { await closeServer(); throw cause; }
}
