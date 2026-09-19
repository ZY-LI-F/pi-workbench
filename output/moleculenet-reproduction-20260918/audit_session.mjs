import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
async function walk(dir){
 const output=[];
 for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const p=path.join(dir,entry.name);
  if(entry.isDirectory())output.push(...await walk(p));
  else if(entry.name.endsWith('.jsonl'))output.push(p);
 }
 return output;
}
const paths=await walk(path.join(root,'gui-test/pi-agent/sessions'));
if(paths.length!==1)throw new Error(`Expected the isolated test session; found ${paths.length}`);
const bytes=await fs.readFile(paths[0]);
const events=bytes.toString('utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));
const messages=events.filter(e=>e.type==='message').map(e=>e.message);
const assistants=messages.filter(m=>m.role==='assistant');
const totals={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0};
const models=new Set();const tools={};const stopReasons={};
for(const m of assistants){
 models.add(`${m.provider}/${m.model}`);
 stopReasons[m.stopReason??'unspecified']=(stopReasons[m.stopReason??'unspecified']??0)+1;
 for(const k of Object.keys(totals))totals[k]+=Number(m.usage?.[k]??0);
 for(const c of m.content??[])if(c.type==='toolCall')tools[c.name]=(tools[c.name]??0)+1;
}
const result={sessionPath:paths[0],sessionSha256:createHash('sha256').update(bytes).digest('hex'),
 sessionId:events[0].id,eventCount:events.length,userMessages:messages.filter(m=>m.role==='user').length,
 assistantMessages:assistants.length,assistantModels:[...models],stopReasons,toolCalls:tools,
 toolResults:messages.filter(m=>m.role==='toolResult').length,
 toolErrors:messages.filter(m=>m.role==='toolResult'&&m.isError).length,usage:totals,
 firstTimestamp:events[0].timestamp,lastTimestamp:events.at(-1).timestamp,
 scope:'Metadata only; omits message bodies, commands, environment and secrets. Token usage from saved Pi messages, not a billing statement.'};
await fs.writeFile(path.join(root,'gui-test/session-audit.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
