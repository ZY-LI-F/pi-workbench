import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FileBlob,PresentationFile} from '@oai/artifact-tool';
const dir=path.dirname(fileURLToPath(import.meta.url));
const result=JSON.parse(await fs.readFile(path.join(dir,'final-result.json'),'utf8'));
const deck=await PresentationFile.importPptx(await FileBlob.load(result.finalPath));
if(deck.slides.items.length!==14)throw new Error('Final slide count mismatch');
const previewDir=path.join(dir,'final-preview');
await fs.mkdir(previewDir,{recursive:true});
for(const [i,slide] of deck.slides.items.entries()){
  const png=await deck.export({slide,format:'png',scale:1.5});
  await fs.writeFile(path.join(previewDir,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));
  const layout=await slide.export({format:'layout'});
  await fs.writeFile(path.join(previewDir,`slide-${String(i+1).padStart(2,'0')}.layout.json`),await layout.text());
  console.log(`Rendered final slide ${i+1}`);
}
