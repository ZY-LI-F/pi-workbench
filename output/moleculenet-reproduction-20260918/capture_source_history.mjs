import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const current=await fs.readFile(path.join(root,'benchmark.py'),'utf8');
const normalize=s=>s.replace(/\r\n/g,'\n');
const hash=s=>createHash('sha256').update(s).digest('hex');
const oldHash=JSON.parse(await fs.readFile(path.join(root,'results/provenance.json'),'utf8')).script_sha256;
const source=normalize(current);
const start=source.indexOf('    if dataset_name == "freesolv":');
const end=source.indexOf('    raw = pd.read_csv',start);
if(start<0||end<0)throw new Error('Expected loader block not found');
let previous=source.slice(0,start)+`    tasks, datasets, transforms = loader(
        featurizer=dc.feat.RawFeaturizer(smiles=True), splitter=None,
        transformers=[], reload=False, data_dir=str(data_dir), save_dir=str(data_dir))
    full = datasets[0]
`+source.slice(end);
const metaStart=previous.indexOf('                "unique_scaffolds":');
const metaEnd=previous.indexOf('    save_json(data_dir / "metadata.json"',metaStart);
previous=previous.slice(0,metaStart)+'                "unique_scaffolds": len(set(scaffolds)), "invalid_smiles": invalid}\n'+previous.slice(metaEnd);
let match;
for(const filename of ['SAMPL.csv','freesolv.csv.gz']){
 const candidate=previous.replace('"freesolv": (None, "SAMPL.csv", "kcal/mol")',`"freesolv": (dc.molnet.load_freesolv, "${filename}", "kcal/mol")`);
 for(const eol of ['\n','\r\n']){
  const variant=candidate.replace(/\n/g,eol);
  if(hash(variant)===oldHash)match=variant;
 }
}
if(!match)throw new Error('Cannot reconstruct exact historical ESOL runner; do not claim hash match');
const out=path.join(root,'verification/source-history');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'benchmark-esol-original.py'),match);
await fs.writeFile(path.join(out,'benchmark-physical-units.py'),current);
const receipt={esolScriptSha256:hash(match),currentScriptSha256:hash(current),
 historicalRecovery:'Reversed only the documented FreeSolv source correction and matched the original saved SHA-256 exactly',
 changes:'FreeSolv physical source loader; additional raw-label provenance. ESOL numerical implementation unchanged.'};
await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
