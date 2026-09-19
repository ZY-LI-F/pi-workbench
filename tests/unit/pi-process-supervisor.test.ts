// @vitest-environment node
import { fork } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { supervisePiProcess } from "../../src/main/pi-process-supervisor";

it("stops reparented background computation without killing Pi or an unrelated process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stella-process-scope-"));
  const worker = join(dir, "worker.cjs");
  const rootFile = join(dir, "root.cjs");
  const output = join(dir, "heartbeat.txt");
  await writeFile(worker, `require('fs').appendFileSync(process.argv[2], 'tick\n'); setInterval(() => require('fs').appendFileSync(process.argv[2], 'tick\n'), 100);` .replaceAll("'tick\n'", "'tick\\n'"));
  await writeFile(rootFile, `process.on('message', () => { const shell = require('child_process').spawn(process.execPath, ['-e', "const c=require('child_process').spawn(process.execPath,[process.argv[1],process.argv[2]],{detached:true,stdio:'ignore'});c.unref();", process.argv[2], process.argv[3]], {stdio:'ignore'}); shell.on('exit', () => process.send('parent-exited')); });`);
  const marker = randomUUID();
  const root = fork(rootFile, [worker, output], { env: { ...process.env, STELLA_PI_PROCESS_SCOPE: marker }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const other = fork(rootFile, [worker, join(dir, "unrelated.txt")], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let supervisor;
  try {
    supervisor = await supervisePiProcess(root.pid!, marker, join(process.cwd(), "resources", "runtime"));
    const parentExited = new Promise<void>((resolve) => root.once("message", () => resolve()));
    root.send("start"); await parentExited;
    await expect.poll(async () => (await readFile(output, "utf8").catch(() => "")).length).toBeGreaterThan(0);
    expect(await supervisor.stopChildren()).toBeGreaterThanOrEqual(1);
    const stopped = await readFile(output, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(await readFile(output, "utf8")).toBe(stopped);
    expect(root.exitCode).toBeNull();
    expect(other.exitCode).toBeNull();
  } finally {
    const closeRoot = new Promise<void>((resolve) => root.once("close", () => resolve()));
    const closeOther = new Promise<void>((resolve) => other.once("close", () => resolve()));
    root.kill(); other.kill(); await Promise.all([closeRoot, closeOther]);
    await supervisor?.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
