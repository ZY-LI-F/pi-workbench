import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { PiVersionSnapshot, PiVersionSyncResult } from "../shared/pi-version";
import { CliProcess, type CliProcessRequest } from "./cli-process";
import { NodeCliDiscovery } from "./node-cli-discovery";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";

interface SyncTarget {
  readonly npm: Pick<CliProcessRequest, "executable" | "prefixArgv" | "environment" | "cwd" | "stdout">;
  readonly prefix: string;
  readonly localEntry: string;
  readonly packageDirectory: string;
}

interface Probe {
  readonly snapshot: PiVersionSnapshot;
  readonly target?: SyncTarget;
}

interface PiVersionServiceOptions {
  readonly guiVersion: string;
  readonly bundledVersion: string;
  readonly discovery?: Pick<NodeCliDiscovery, "find" | "inspect" | "platform" | "environment" | "homeDirectory">;
  readonly process?: Pick<CliProcess, "run">;
  readonly canonicalPath?: (path: string) => Promise<string>;
  readonly confirm: (snapshot: PiVersionSnapshot) => Promise<boolean>;
}

function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }

/** Owns exact-version synchronization. No renderer-supplied command, prefix or version is accepted. */
export class PiVersionService {
  readonly #options: PiVersionServiceOptions;
  readonly #discovery: NonNullable<PiVersionServiceOptions["discovery"]>;
  readonly #process: Pick<CliProcess, "run">;
  readonly #canonical: (path: string) => Promise<string>;
  #checking?: Promise<Probe>;
  #syncing?: Promise<PiVersionSyncResult>;

  constructor(options: PiVersionServiceOptions) {
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(options.bundledVersion)) throw new Error("GUI 内置 Pi 必须使用精确版本");
    this.#options = options;
    this.#discovery = options.discovery ?? new NodeCliDiscovery();
    this.#process = options.process ?? new CliProcess();
    this.#canonical = options.canonicalPath ?? realpath;
  }

  async check(): Promise<PiVersionSnapshot> {
    if (this.#syncing) return (await this.#syncing).snapshot;
    return (await this.#probeOnce()).snapshot;
  }

  sync(): Promise<PiVersionSyncResult> {
    if (!this.#syncing) this.#syncing = this.#sync().finally(() => { this.#syncing = undefined; });
    return this.#syncing;
  }

  #probeOnce(): Promise<Probe> {
    if (!this.#checking) this.#checking = this.#probe().finally(() => { this.#checking = undefined; });
    return this.#checking;
  }

  async #probe(): Promise<Probe> {
    const base = { guiVersion: this.#options.guiVersion, bundledVersion: this.#options.bundledVersion, checkedAt: new Date().toISOString(), canSync: false };
    let localPath: string | undefined;
    let localVersion: string | undefined;
    try {
      localPath = await this.#discovery.find("pi");
      if (!localPath) return { snapshot: { ...base, status: "missing", detail: "未发现本机命令行 Pi。GUI 使用内置 Pi，无需另行安装即可工作。" } };
      const local = await this.#discovery.inspect("pi", localPath);
      localVersion = local.version;
      if (local.packageName !== PI_PACKAGE) throw new Error(`检测到旧命名空间 ${local.packageName}。请按 Pi 官方迁移说明处理；不会覆盖另一个包的 pi 命令。`);
      if (localVersion === base.bundledVersion) return { snapshot: { ...base, localPath, localVersion, status: "matched", detail: "本机命令行 Pi 与 GUI 内置 Pi 版本一致。" } };

      const mismatch = { ...base, localPath, localVersion, status: "mismatch" as const };
      try {
        const npmPath = await this.#discovery.find("npm");
        if (!npmPath) throw new Error("未找到 npm，无法自动同步。请使用原安装方式安装 GUI 对应的 Pi 版本。");
        const npm = await this.#discovery.inspect("npm", npmPath);
        const node = await this.#discovery.find("node", dirname(npm.commandPath));
        if (!node) throw new Error("未找到系统 Node.js，无法执行 npm。GUI 的内置运行时不会用于更改系统安装。");
        const environmentPath = this.#discovery.environment.PATH ?? this.#discovery.environment.Path ?? this.#discovery.environment.path ?? "";
        const npmCommand = { executable: node, prefixArgv: [npm.entrypoint], cwd: this.#discovery.homeDirectory, stdout: "text" as const,
          environment: { PATH: `${dirname(node)}${this.#discovery.platform === "win32" ? ";" : ":"}${environmentPath}` } };
        const prefix = await this.#run({ ...npmCommand, argv: ["prefix", "--global"], timeoutMs: 30_000 });
        const root = await this.#run({ ...npmCommand, argv: ["root", "--global"], timeoutMs: 30_000 });
        if (!isAbsolute(prefix) || !isAbsolute(root) || /[\r\n]/.test(prefix + root)) throw new Error("npm 返回了无效的全局安装位置");
        const expectedRoot = this.#discovery.platform === "win32" ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules");
        if (await this.#canonical(root) !== await this.#canonical(expectedRoot)
          || await this.#canonical(join(root, PI_PACKAGE)) !== await this.#canonical(local.packageDirectory)) {
          throw new Error("PATH 中的 Pi 与当前 npm 全局目录不属于同一安装。请切换对应 Node/npm 环境后重新检查，避免更新错误位置。");
        }
        return { snapshot: { ...mismatch, canSync: true, installPrefix: prefix, detail: "版本不一致。可在确认后同步到 GUI 对应的精确版本；不会改变 GUI 内置 Pi、模型配置或会话。" },
          target: { npm: npmCommand, prefix, localEntry: local.entrypoint, packageDirectory: local.packageDirectory } };
      } catch (cause) {
        return { snapshot: { ...mismatch, detail: message(cause) } };
      }
    } catch (cause) {
      return { snapshot: { ...base, localPath, localVersion, status: "error", detail: message(cause) } };
    }
  }

  async #sync(): Promise<PiVersionSyncResult> {
    const before = await this.#probeOnce();
    if (before.snapshot.status === "matched") return { outcome: "unchanged", snapshot: before.snapshot };
    if (!before.target || !before.snapshot.canSync) throw new Error(before.snapshot.detail);
    if (!await this.#options.confirm(before.snapshot)) return { outcome: "cancelled", snapshot: before.snapshot };
    // Recheck after the native dialog: another installer / Node version manager may have changed PATH or files.
    const fresh = await this.#probeOnce();
    if (!fresh.target || fresh.snapshot.localVersion !== before.snapshot.localVersion
      || JSON.stringify(fresh.target) !== JSON.stringify(before.target)) {
      throw new Error("确认期间本机 Pi 或 npm 安装位置发生变化，未执行更新。请重新检查版本。");
    }
    const { target } = fresh;
    await this.#run({ ...target.npm, argv: ["install", "--global", "--prefix", target.prefix,
      `${PI_PACKAGE}@${this.#options.bundledVersion}`, "--no-audit", "--no-fund"] });
    const after = await this.#probeOnce();
    if (after.snapshot.status !== "matched") throw new Error(`npm 已结束，但 Pi 版本校验未通过：${after.snapshot.detail}`);
    const versionOutput = await this.#run({ ...target.npm, prefixArgv: [target.localEntry], argv: ["--version"], timeoutMs: 30_000 });
    if (versionOutput.replace(/^v/, "") !== this.#options.bundledVersion) {
      throw new Error(`安装后的 Pi 命令报告版本 ${versionOutput}，与目标 ${this.#options.bundledVersion} 不一致。`);
    }
    return { outcome: "updated", snapshot: after.snapshot };
  }

  async #run(request: CliProcessRequest): Promise<string> {
    const result = await this.#process.run(request);
    if (result.exitCode !== 0 || result.signal) {
      throw new Error(`Pi 版本操作失败（退出码 ${result.exitCode ?? result.signal}）：${result.stderrTail.trim() || result.stdoutTail.trim() || "没有命令输出"}`);
    }
    if (result.stdoutTruncated && request.argv[0] !== "install") throw new Error("Pi 版本操作输出过长，无法可靠确认结果。");
    return result.stdoutTail.trim();
  }
}
