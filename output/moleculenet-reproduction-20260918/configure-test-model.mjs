import fs from 'node:fs/promises'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
const rt = await ModelRuntime.create()
const m = rt.getModel('deepseek', 'deepseek-flash')
if (m?.name !== 'DeepSeek V4.1 Flash') throw new Error('Exact requested model missing')
await fs.writeFile(new URL('./gui-test/pi-agent/models.json', import.meta.url), JSON.stringify({
  providers: { deepseek: { baseUrl: 'https://api.deepseek.com', api: 'openai-completions',
    apiKey: '${DEEPSEEK_API_KEY}', models: [{ id: m.id, name: m.name, reasoning: m.reasoning,
      input: m.input, contextWindow: m.contextWindow, maxTokens: m.maxTokens, cost: m.cost }] } },
}, null, 2))
console.log(JSON.stringify({ model: m.id, name: m.name, configuration: 'isolated GUI test profile only' }))
