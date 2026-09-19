"""Package an allowlisted, reviewable evidence set; exclude credentials and envs."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import zipfile

ROOT=Path(__file__).resolve().parent


def main():
    summary=json.loads((ROOT/'verification/summary.json').read_text(encoding='utf-8'))
    if summary['status']!='verified' or summary['total_runs']!=48:
        raise RuntimeError('Incomplete scientific results cannot be packaged as final')
    build=json.loads((ROOT/'build/build-result.json').read_text(encoding='utf-8'))
    deck=Path(build['finalPath'])
    if not deck.is_file() or ROOT.resolve() not in deck.resolve().parents:
        raise RuntimeError('Missing or out-of-workspace final deck')
    files=[ROOT/n for n in ['benchmark.py','experiment.json','verify_results.py','assemble_report.py','package_evidence.py',
       'audit_session.mjs','diagnose_evidence.py','test_benchmark.py','test_verify_results.py','test_source_data.py','test_outline_validation.py',
       'test_paper2any_live.py','test_paper2any_frontend.py','diagnose-path-extraction.mjs','requirements.txt','README.md','REPORT.zh-CN.md',
       'data/freesolv/SOURCE-CORRECTION.md','gui-test/acceptance.json','gui-test/session-audit.json','gui-test/path-extraction-diagnostic.json',
       'gui-test/pi-stage1-report.md','gui-test/pi-stage2-report.md','gui-test/ISSUES.md','build/build_deck.mjs','build/render_final.mjs']]
    dirs=['data','sources','verification','results/esol','results-corrected','upstream-patches',
          'gui-test/paper2agent/moleculenet-paper','gui-test/paper2any','gui-test/evidence']
    for directory in dirs:
        files.extend(p for p in (ROOT/directory).rglob('*') if p.is_file() and p.suffix!='.log')
    # The independent verifier also reads the initial repeatability predictions.
    files.extend((ROOT/'initial-esol-run/esol/random/123').glob('*/predictions.csv'))
    # Keep review decisions and adjudications without duplicating PDF/render caches.
    review=ROOT/'gui-test/paper2agent/moleculenet-review'
    files.extend(review.glob('*.json'))
    files.extend((review/'documents').rglob('*.json'))
    files.extend((ROOT/'gui-test/review').rglob('*.md'))
    # Preserve the historical first build referenced by Pi's stage-2 receipt.
    files.extend([deck, ROOT/'deliverables/MoleculeNet-复现与Pi工具实测.pptx', ROOT/'gui-test/paper2agent/moleculenet-review/verification.json',
        ROOT/'gui-test/paper2agent/moleculenet-review/review-import.json',ROOT/'results/provenance.json'])
    for env,name in [(ROOT/'.venv/Scripts/python.exe','scientific'),(ROOT/'.venv-paper2any/Scripts/python.exe','paper2any')]:
        inventory="import importlib.metadata as m; print('\\n'.join(sorted(d.metadata['Name']+'=='+d.version for d in m.distributions())))"
        freeze=subprocess.run([str(env),'-c',inventory],capture_output=True,text=True,check=True,encoding='utf-8')
        dest=ROOT/'verification'/f'{name}-environment.txt'
        dest.write_text(freeze.stdout,encoding='utf-8');files.append(dest)
    files=sorted(set(files))
    for p in files:
        if not p.is_file():
            raise FileNotFoundError(p)
        relative=p.relative_to(ROOT).as_posix()
        if any(s in relative for s in ['.venv','pi-agent','profile/','auth.json','models.json','settings.json']):
            raise RuntimeError(f'Excluded private/runtime path selected: {relative}')
    manifest={p.relative_to(ROOT).as_posix():{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files}
    target=ROOT/'deliverables/MoleculeNet-reproduction-evidence.zip'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for p in files:
            archive.write(p,p.relative_to(ROOT).as_posix())
        archive.writestr('MANIFEST.sha256.json',json.dumps(manifest,indent=2,ensure_ascii=False))
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('ZIP CRC validation failed')
    receipt={'file':str(target),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'files':len(files),
      'excluded':['venvs','Pi profile and auth configuration','full conversational logs','model checkpoints','excluded wrong-unit experiment','private build previews']}
    (ROOT/'deliverables/package-receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps(receipt,indent=2))


if __name__=='__main__':
    main()
