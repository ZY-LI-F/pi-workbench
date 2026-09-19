import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';

const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = await ModelRuntime.create();
const provider = process.env.PAPER2ANY_PROVIDER_OVERRIDE || 'aliyun-maas';
const modelId = process.env.PAPER2ANY_MODEL_OVERRIDE || 'qwen3.8-max-preview';
if (/deepseek/i.test(modelId)) throw new Error('User explicitly excluded DeepSeek');
const model = runtime.getModel(provider, modelId);
const auth = await runtime.getAuth(provider);
// API discovery can return a current ID not yet saved in the local model list.
const savedProviders=JSON.parse(await fs.readFile('C:/Users/qq108/.pi/agent/models.json','utf8')).providers;
const providerBaseUrl=model?.baseUrl || savedProviders?.[provider]?.baseUrl;
if (!providerBaseUrl || !auth?.auth?.apiKey) throw new Error('Configured provider credential unavailable');
const secret = auth.auth.apiKey;
const baseUrl = providerBaseUrl.replace(/\/$/, '');
const safe = value => String(value).split(secret).join('[REDACTED]');
await fs.mkdir(path.join(root, 'build'), {recursive:true});

if (process.argv[2] === 'models') {
  const response=await fetch(`${baseUrl}/models`,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(60000)});
  const raw=await response.text();
  let data;
  try { data=JSON.parse(raw); } catch { data={error:{message:safe(raw.slice(0,1000))}}; }
  const receipt={provider,status:response.status,models:data.data?.map(m=>({id:m.id,owned_by:m.owned_by})),error:data.error};
  await fs.writeFile(path.join(root,'build',`models-${provider}-${Date.now()}.json`),JSON.stringify(receipt,null,2),{flag:'wx'});
  console.log(JSON.stringify(receipt));
  if(!response.ok)process.exitCode=1;
} else if ((process.argv[2] || 'probe') === 'probe') {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method:'POST', signal:AbortSignal.timeout(120000),
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},
    body:JSON.stringify({model:modelId,messages:[{role:'user',content:'Return exactly this JSON object: {"ready":true,"language":"zh"}'}],
      max_tokens:512,temperature:0,enable_thinking:false,response_format:{type:'json_object'}}),
  }).catch(async error=>{
    const receipt={provider,requested_model:modelId,status:'network_error',error:safe(error.cause?.code || error.message)};
    await fs.writeFile(path.join(root,'build',`probe-${provider}-${modelId}-${Date.now()}.json`),JSON.stringify(receipt,null,2),{flag:'wx'});
    throw new Error(JSON.stringify(receipt));
  });
  const responseText = await response.text();
  let body;
  try { body=JSON.parse(responseText); }
  catch { body={error:{type:'non_json_response',content_type:response.headers.get('content-type'),body_excerpt:safe(responseText.slice(0,2000))}}; }
  const content = body.choices?.[0]?.message?.content;
  const receipt = {provider,requested_model:modelId,response_model:body.model,
    status:response.status,finish_reason:body.choices?.[0]?.finish_reason,
    usage:body.usage,seconds:(performance.now()-started)/1000,
    enable_thinking:false,response_format:'json_object',
    ...(response.ok?{content}:{error:safe(JSON.stringify(body.error || body))})};
  await fs.writeFile(path.join(root,'build',`probe-${provider}-${modelId}-${Date.now()}.json`), JSON.stringify(receipt,null,2),{flag:'wx'});
  console.log(JSON.stringify(receipt));
  if (!response.ok || receipt.finish_reason !== 'stop' || !content || JSON.parse(content).ready !== true) process.exitCode=1;
} else {
  const script = path.resolve(root,process.argv[2]);
  if (!script.startsWith(root+path.sep)) throw new Error('Runner script must stay in this task directory');
  const python = path.resolve(root,'../moleculenet-reproduction-20260918/.venv-paper2any/Scripts/python.exe');
  const repo = 'C:/Users/qq108/AppData/Local/Temp/stella-paper2any-20260918';
  const child = spawn(python,[script,...process.argv.slice(3)],{
    cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,PYTHONUTF8:'1',PYTHONUNBUFFERED:'1',PYTHONPATH:repo,
      PAPER2ANY_REPO:repo,PAPER2ANY_API_URL:baseUrl,PAPER2ANY_MODEL:modelId,
      PAPER2ANY_API_KEY:secret,DF_API_URL:baseUrl,DF_MODEL:modelId,DF_API_KEY:secret},
  });
  child.stdout.on('data',chunk=>process.stdout.write(safe(chunk)));
  child.stderr.on('data',chunk=>process.stderr.write(safe(chunk)));
  child.on('error',err=>{console.error(safe(err.message));process.exitCode=1;});
  child.on('close',code=>{process.exitCode=code??1;});
}
