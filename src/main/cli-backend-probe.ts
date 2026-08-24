import type { ConfigurableExecutionBackendId, ExecutionBackendHealth } from "../shared/execution-profile";
import type { ExecutionBackendConfiguration } from "./execution-backend";
import { CliProcess } from "./cli-process";

interface CliBackendProbeOptions {
  readonly process?: CliProcess;
  readonly cwd?: string;
  readonly now?: () => string;
}

function compactFailure(stdout: string, stderr: string, fallback: string): string {
  return stderr.trim() || stdout.trim() || fallback;
}

function parsedVersion(output: string): string | undefined {
  return output.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0];
}

export class CliBackendProbe {
  readonly #process: CliProcess;
  readonly #cwd: string;
  readonly #now: () => string;

  constructor(options: CliBackendProbeOptions = {}) {
    this.#process = options.process ?? new CliProcess();
    this.#cwd = options.cwd ?? process.cwd();
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async probe(
    backendId: ConfigurableExecutionBackendId,
    configuration: ExecutionBackendConfiguration,
  ): Promise<ExecutionBackendHealth> {
    if (configuration.backendId !== backendId) throw new Error(`CLI Probe 配置 ID 不匹配：${configuration.backendId}`);
    if (configuration.resolutionError) return this.#health(configuration, "unavailable", "unknown", undefined, configuration.resolutionError);
    if (!configuration.executable) return this.#health(configuration, "unavailable", "unknown", undefined, `未配置 ${backendId} executable`);
    try {
      const versionResult = await this.#process.run({
        executable: configuration.executable,
        prefixArgv: configuration.prefixArgv,
        argv: ["--version"],
        cwd: this.#cwd,
        stdout: "text",
        timeoutMs: 10_000,
      });
      if (versionResult.exitCode !== 0) {
        return this.#health(configuration, "unavailable", "unknown", undefined, compactFailure(versionResult.stdoutTail, versionResult.stderrTail, `${backendId} --version 失败`));
      }
      const version = parsedVersion(`${versionResult.stdoutTail}\n${versionResult.stderrTail}`);
      if (!version) return this.#health(configuration, "error", "unknown", undefined, `${backendId} --version 未返回可识别版本`);
      let authState: "ready" | "required";
      try {
        authState = backendId === "codex"
          ? await this.#probeCodexAuth(configuration)
          : await this.#probeClaudeAuth(configuration);
      } catch (cause) {
        return this.#health(configuration, "error", "unknown", version, cause instanceof Error ? cause.message : String(cause));
      }
      return this.#health(configuration, "ready", authState, version);
    } catch (cause) {
      return this.#health(configuration, "unavailable", "unknown", undefined, cause instanceof Error ? cause.message : String(cause));
    }
  }

  async #probeCodexAuth(configuration: ExecutionBackendConfiguration): Promise<"ready" | "required"> {
    const result = await this.#process.run({
      executable: configuration.executable as string,
      prefixArgv: configuration.prefixArgv,
      argv: ["login", "status"],
      cwd: this.#cwd,
      stdout: "text",
      timeoutMs: 10_000,
    });
    const output = `${result.stdoutTail}\n${result.stderrTail}`.trim();
    if (result.exitCode === 0 && /logged in|authenticated/i.test(output)) return "ready";
    if (/not logged|login required|unauthenticated|sign in/i.test(output)) return "required";
    if (result.exitCode !== 0) throw new Error(compactFailure(result.stdoutTail, result.stderrTail, "codex login status 失败"));
    throw new Error("codex login status 未返回可识别的登录状态");
  }

  async #probeClaudeAuth(configuration: ExecutionBackendConfiguration): Promise<"ready" | "required"> {
    let payload: unknown;
    const result = await this.#process.run({
      executable: configuration.executable as string,
      prefixArgv: configuration.prefixArgv,
      argv: ["auth", "status", "--json"],
      cwd: this.#cwd,
      stdout: "json",
      timeoutMs: 10_000,
    }, { onJson: (value) => { payload = value; } });
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).loggedIn === "boolean") {
      return (payload as Record<string, unknown>).loggedIn ? "ready" : "required";
    }
    if (result.exitCode !== 0) throw new Error(compactFailure(result.stdoutTail, result.stderrTail, "claude auth status 失败"));
    throw new Error("claude auth status --json 未返回 loggedIn");
  }

  #health(
    configuration: ExecutionBackendConfiguration,
    state: ExecutionBackendHealth["state"],
    authState: NonNullable<ExecutionBackendHealth["authState"]>,
    version?: string,
    error?: string,
  ): ExecutionBackendHealth {
    return Object.freeze({
      backendId: configuration.backendId,
      state,
      version,
      authState,
      executableSource: configuration.executableSource,
      executablePath: configuration.displayPath,
      error,
      updatedAt: this.#now(),
    });
  }
}
