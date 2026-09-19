// Isolated visual QA fixture. Seeded messages only label existing artifacts; no model execution is simulated.
import { mkdir, copyFile, writeFile, open } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return String(port);
}
const workspace = process.cwd();
const base = join(workspace, "output", "native-reliability-20260919", "manual");
const project = join(base, "project");
const profile = join(base, "profile");
const agent = join(base, "pi-agent");
await Promise.all([project, profile, agent, join(base, "evidence")].map((path) => mkdir(path, { recursive: true })));
const source = join(workspace, "output", "moleculenet-reproduction-20260918");
const pptx = join(project, "MoleculeNet-复现与Pi工具实测-审定版.pptx");
const pdf = join(project, "MoleculeNet-作者稿-65页.pdf");
await copyFile(join(source, "deliverables", "MoleculeNet-复现与Pi工具实测-审定版.pptx"), pptx);
await copyFile(join(source, "gui-test", "paper2agent", "moleculenet-review", "originals", "s001-moleculenet-author-manuscript.pdf"), pdf);
await writeFile(join(profile, "stella-state.json"), JSON.stringify({ lastProject: project, recentProjects: [{ path: project, trusted: false, lastOpened: new Date().toISOString() }] }));
await writeFile(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "visual-fixture", defaultModel: "preview-only", compaction: { enabled: false } }));
await writeFile(join(agent, "models.json"), JSON.stringify({ providers: { "visual-fixture": { baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions", models: [{ id: "preview-only", name: "视觉验收夹具（不运行模型）", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 4096 }] } } }));
process.env.PI_CODING_AGENT_DIR = agent;
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const manager = SessionManager.create(project);
manager.appendMessage({ role: "user", content: "手动视觉验收夹具：仅查看之前真实任务生成的 PPTX 和论文 PDF，不请求模型。", timestamp: Date.now() });
manager.appendMessage({ role: "assistant", api: "openai-completions", provider: "visual-fixture", model: "preview-only", timestamp: Date.now(), stopReason: "stop",
  content: [{ type: "text", text: `人工视觉验收文件（本条为测试夹具，并非模型回复）：\n\n**${pptx}**\n\n**${pdf}**` }],
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
manager.appendSessionInfo("文档视觉验收 · 隔离夹具");
const log = await open(join(base, "electron.log"), "a");
const child = spawn(join(workspace, "node_modules", "electron", "dist", "electron.exe"), [workspace, `--user-data-dir=${profile}`],
  { cwd: project, env: { ...process.env, PI_CODING_AGENT_DIR: agent, STELLA_WEBHOOK_PORT: await availablePort(), STELLA_COMPANION_PORT: await availablePort() }, windowsHide: false, detached: true, stdio: ["ignore", log.fd, log.fd] });
child.unref();
console.log(JSON.stringify({ pid: child.pid, profile, project, session: manager.getSessionFile() }));
await log.close();
