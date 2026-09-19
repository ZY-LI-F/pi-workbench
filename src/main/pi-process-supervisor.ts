import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

export interface PiProcessSupervisor {
  stopChildren(): Promise<number>;
  close(): Promise<void>;
}

/** Windows Job membership survives exited shell parents and nohup/detached children. */
export class WindowsPiJob implements PiProcessSupervisor {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, { resolve: (count: number) => void; reject: (error: Error) => void }>();
  #next = 0;
  #failure?: Error;
  readonly #closed: Promise<void>;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.#child = child;
    this.#closed = new Promise((resolve) => child.once("close", resolve));
  }

  static async attach(pid: number, scriptPath: string): Promise<WindowsPiJob> {
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Pi 进程 PID 无效");
    const script = await readFile(scriptPath, "utf8");
    const child = spawn(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { env: { ...process.env, STELLA_SUPERVISED_PID: String(pid) }, windowsHide: true, shell: false, stdio: "pipe" });
    const job = new WindowsPiJob(child);
    await new Promise<void>((resolve, reject) => {
      const fail = (cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        job.#failure = error; reject(error);
        for (const request of job.#pending.values()) request.reject(error);
        job.#pending.clear();
      };
      child.on("error", fail);
      child.stdin.on("error", fail);
      child.once("exit", (code) => fail(new Error(`Pi 后台进程监管已退出（${code}）`)));
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once("close", () => { if (stderr) fail(new Error(`Pi 进程监管失败：${stderr}`)); });
      createInterface({ input: child.stdout }).on("line", (line) => {
        try {
          const result = JSON.parse(line) as { ready?: boolean; id?: number; count?: number; error?: string };
          if (result.ready) { resolve(); return; }
          const pending = result.id === undefined ? undefined : job.#pending.get(result.id);
          if (!pending) { fail(new Error(result.error ?? "Pi 进程监管返回了无效响应")); return; }
          job.#pending.delete(result.id!);
          if (result.error) pending.reject(new Error(result.error));
          else if (typeof result.count === "number") pending.resolve(result.count);
          else pending.reject(new Error("Pi 进程监管没有返回已停止进程数"));
        } catch (cause) { fail(cause); }
      });
    }).catch(async (cause) => { child.stdin.end(); await job.#closed; throw cause; });
    return job;
  }

  stopChildren(): Promise<number> {
    if (this.#failure) return Promise.reject(this.#failure);
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child.stdin.write(`${JSON.stringify({ id, action: "stop" })}\n`, (error) => {
        if (error) { this.#pending.delete(id); reject(error); }
      });
    });
  }

  async close(): Promise<void> { this.#child.stdin.end(); await this.#closed; }
}

/** On POSIX, descendants retain this unguessable runtime marker even after nohup reparenting.
 * ps environment output stays in this process, is never logged or sent to the renderer.
 * A child that deliberately clears its environment or escapes to SSH/containers is outside this scope.
 */
export class PosixPiProcesses implements PiProcessSupervisor {
  constructor(readonly pid: number, readonly marker: string) {
    if (!/^[a-f0-9-]{36}$/.test(marker)) throw new Error("Invalid Pi process scope");
  }

  async #members(): Promise<readonly number[]> {
    return new Promise((resolve, reject) => {
      execFile("/bin/ps", ["eww", "-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
        if (error) { reject(new Error(`无法读取本机 Pi 子进程：${error.code ?? "ps failed"}`)); return; }
        const token = `STELLA_PI_PROCESS_SCOPE=${this.marker}`;
        resolve(stdout.split("\n").filter((line) => line.split(/\s+/).includes(token))
          .map((line) => Number(line.trim().match(/^\d+/)?.[0])).filter((pid) => Number.isSafeInteger(pid) && pid > 0 && pid !== this.pid));
      });
    });
  }

  async stopChildren(): Promise<number> {
    const stopped = new Set<number>();
    const started = Date.now();
    while (true) {
      const members = await this.#members();
      if (!members.length) return stopped.size;
      for (const pid of members) {
        // Recheck inherited scope immediately before signalling; never kill by command name.
        if (!(await this.#members()).includes(pid)) continue;
        try { process.kill(pid, "SIGKILL"); stopped.add(pid); }
        catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause; }
      }
      if (Date.now() - started > 10_000) throw new Error("仍检测到本机 Pi 子进程，无法确认后台计算已停止。");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async close(): Promise<void> { await this.stopChildren(); }
}

export function supervisePiProcess(pid: number, marker: string, resourcesPath: string): Promise<PiProcessSupervisor> {
  return process.platform === "win32" ? WindowsPiJob.attach(pid, join(resourcesPath, "windows-job.ps1"))
    : Promise.resolve(new PosixPiProcesses(pid, marker));
}
