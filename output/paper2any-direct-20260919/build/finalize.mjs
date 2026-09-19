import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';

const dir=path.dirname(fileURLToPath(import.meta.url));
const workspaceDir=path.dirname(dir);
const skillDir='C:/Users/qq108/.codex/plugins/cache/openai-primary-runtime/presentations/26.904.11930/skills/presentations';
const python='C:/Users/qq108/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const {finalizePresentation}=await import(pathToFileURL(path.join(skillDir,'container_tools/artifact_tool_utils.mjs')).href);
const rawPath=path.join(dir,'paper2any-native-export.pptx');
const zip=await JSZip.loadAsync(await fs.readFile(rawPath));
const notes=JSON.parse(await fs.readFile(path.join(dir,'content-and-notes.json'),'utf8'));
const xmlEscape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const slideHashes={};
for(const record of notes) {
  const slideName=`ppt/slides/slide${record.page}.xml`;
  const slideXml=await zip.file(slideName).async('string');
  slideHashes[slideName]=createHash('sha256').update(slideXml).digest('hex');
  const notesName=`ppt/notesSlides/notesSlide${record.page}.xml`;
  const original=await zip.file(notesName)?.async('string');
  if(!original||!original.includes('<a:t></a:t>'))throw new Error(`Unexpected native notes shape: ${notesName}`);
  const paragraphs=record.notes.split('\n').map(line=>`<a:p><a:r><a:rPr lang="zh-CN" sz="1200"><a:latin typeface="Noto Sans SC"/><a:ea typeface="Noto Sans SC"/></a:rPr><a:t xml:space="preserve">${xmlEscape(line)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="1200"/></a:p>`).join('');
  const body=`<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody>`;
  // Native exporter creates empty notes placeholders. Fill notes only; leave slide XML unchanged.
  zip.file(notesName,original.replace(/<p:txBody>[\s\S]*?<\/p:txBody>/,body));
}
const core=await zip.file('docProps/core.xml').async('string');
zip.file('docProps/core.xml',core
  .replace(/<dc:title>[\s\S]*?<\/dc:title>/,`<dc:title>${xmlEscape('MoleculeNet 分子性质预测局部复现')}</dc:title>`)
  .replace(/<dc:subject>[\s\S]*?<\/dc:subject>/,`<dc:subject>${xmlEscape('Current Codex authored content and Canvas layout; native Paper2Any PPTX export. No Pi or external model API in this generation.')}</dc:subject>`)
  .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/,'<dc:creator>Codex / Paper2Any</dc:creator>'));
// The upstream export declares slideMaster2..14 without creating or referencing them.
// Repair only confirmed unused declarations; preserve raw export and all slide XML.
const referencedParts=new Set();
for(const name of Object.keys(zip.files).filter(name=>name.endsWith('.rels'))){
  const xml=await zip.file(name).async('string');
  const base=path.posix.dirname(name).replace(/(^|\/)\_rels$/,'');
  for(const match of xml.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\/>/g)){
    if(/TargetMode="External"/.test(match[0]))continue;
    referencedParts.add(path.posix.normalize(path.posix.join(base,match[1])).replace(/^\//,''));
  }
}
const contentTypes=await zip.file('[Content_Types].xml').async('string');
const removedDeclarations=[];
const repairedTypes=contentTypes.replace(/<Override\b[^>]*\bPartName="([^"]+)"[^>]*\/>/g,(declaration,name)=>{
  const part=name.replace(/^\//,'');
  if(zip.file(part))return declaration;
  if(!/^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(part)||referencedParts.has(part))throw new Error(`Missing referenced part cannot be repaired by declaration cleanup: ${part}`);
  removedDeclarations.push(part);
  return '';
});
zip.file('[Content_Types].xml',repairedTypes);
await fs.writeFile(path.join(dir,'package-repair.json'),JSON.stringify({
  initial_integrity_status:'failed',error:'content_type_target_missing',removed_unreferenced_declarations:removedDeclarations,
  removed_package_parts:[],slide_content_unchanged:true,
  raw_export_preserved:rawPath,
},null,2));
const candidatePath=path.join(dir,'paper2any-with-notes-package-fixed.pptx');
await fs.writeFile(candidatePath,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
const finalPath=path.join(workspaceDir,'deliverables','MoleculeNet-Paper2Any-局部复现说明.pptx');
const tables=[3,4,6,7,8,9,11];
const result=await finalizePresentation({
  workspaceDir,candidatePath,finalPath,pythonExecutable:python,
  integrityValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu',`${Math.round(13.333*914400)},${Math.round(7.5*914400)}`,'--validate-heading-fit',...tables.flatMap(n=>['--require-native-table-slide',String(n)])],
  explicitTotalSlideCount:14,requiredNativeTableOwnerSlides:tables,
  fontPolicy:{basis:'design',families:['Noto Sans SC']},
  verifyArtifactToolImport:true,
  receiptPath:path.join(dir,'final-validation.json'),
});
const finalBytes=await fs.readFile(finalPath);
const finalZip=await JSZip.loadAsync(finalBytes);
for(const [name,hash] of Object.entries(slideHashes)){
  const actual=createHash('sha256').update(await finalZip.file(name).async('string')).digest('hex');
  if(hash!==actual)throw new Error(`Final slide differs from native Paper2Any export: ${name}`);
}
const receipt={...result,finalPath,bytes:finalBytes.length,sha256:createHash('sha256').update(finalBytes).digest('hex'),
  native_slide_xml_preserved:true,notes_added:notes.length,native_tables:tables,
  visible_slide_layout_postprocessing:false,
  postprocessing:'Fill existing notes placeholders, update document metadata, remove confirmed unused declarations for missing slide masters.',
  removed_unreferenced_master_declarations:removedDeclarations};
await fs.writeFile(path.join(dir,'final-result.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
