import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'

const work = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(work, '../..')
const profile = path.join(work, 'gui-test/profile')
const agentDir = path.join(work, 'gui-test/pi-agent')
const rt = await ModelRuntime.create()
const model = rt.getModel('deepseek', 'deepseek-flash')
const auth = await rt.getAuth('deepseek')
if (model?.name !== 'DeepSeek V4.1 Flash' || !auth?.auth?.apiKey) {
  throw new Error('Exact DeepSeek V4.1 Flash configuration is unavailable')
}
async function port() {
  const server = createServer()
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res) })
  const address = server.address()
  await new Promise((res, rej) => server.close(e => e ? rej(e) : res()))
  return String(address.port)
}
await fs.mkdir(profile, { recursive: true })
await fs.mkdir(agentDir, { recursive: true })
await fs.writeFile(path.join(profile, 'stella-state.json'), JSON.stringify({
  lastProject: work,
  recentProjects: [{ path: work, trusted: true, lastOpened: new Date().toISOString() }],
}, null, 2), { flag: 'wx' })
await fs.writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
  defaultProvider: 'deepseek', defaultModel: 'deepseek-flash', defaultThinkingLevel: 'off',
}, null, 2), { flag: 'wx' })
await fs.cp('C:/Users/qq108/AppData/Local/Temp/stella-paper2agent-20260918/skills/paper2agent',
  path.join(agentDir, 'skills/paper2agent'), { recursive: true, force: false, errorOnExist: true })
const child = spawn(path.join(appRoot, 'node_modules/electron/dist/electron.exe'),
  [appRoot, `--user-data-dir=${profile}`], {
    cwd: work, detached: true, stdio: 'ignore', windowsHide: false,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, DEEPSEEK_API_KEY: auth.auth.apiKey,
      STELLA_WEBHOOK_PORT: await port(), STELLA_COMPANION_PORT: await port() },
  })
child.on('error', error => { throw error })
child.unref()
await fs.writeFile(path.join(work, 'gui-test/launch.json'), JSON.stringify({
  appRoot, project: work, profile, agentDir, pid: child.pid,
  model: model.id, modelName: model.name, launchedAt: new Date().toISOString(),
  credentials: 'Resolved from existing Pi storage into child process environment only; not written to disk',
}, null, 2))
console.log(JSON.stringify({ pid: child.pid, project: work, model: model.name }))
