import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {extractLocalPaths} from '../../src/renderer/src/lib/local-paths.ts';
const path=String.raw`C:\Users\qq108\Documents\PI-GUI\output\moleculenet-reproduction-20260918\gui-test\pi-stage1-report.md`;
const forms={plain:path,bold:`**${path}**`,inlineCode:'`'+path+'`',markdownLink:`[阶段报告](${path})`};
const observed=Object.fromEntries(Object.entries(forms).map(([key,value])=>[key,extractLocalPaths(value)]));
const receipt={source:'actual project extractLocalPaths implementation',inputPath:path,observed};
await fs.writeFile(fileURLToPath(new URL('./gui-test/path-extraction-diagnostic.json',import.meta.url)),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
