"""Read-only scientific/session diagnostics; export only non-secret summaries."""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def main():
    path = next((ROOT/'gui-test/pi-agent/sessions').rglob('*.jsonl'))
    events = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
    depths = {}
    missing_parents = []
    for event in events:
        if 'parentId' not in event:
            continue
        parent = event['parentId']
        if parent and parent not in depths:
            missing_parents.append(parent)
        depths[event['id']] = depths.get(parent, 0) + 1
    repeats = {}
    for model in ['mean','rf','krr','gc']:
        files = [ROOT/location/'esol/random/123'/model/'predictions.csv' for location in ['initial-esol-run','results']]
        rows = []
        for file in files:
            with file.open(encoding='utf-8', newline='') as stream:
                rows.append(list(csv.DictReader(stream)))
        assert len(rows[0]) == len(rows[1]) == 1128
        for a,b in zip(*rows):
            assert all(a[key] == b[key] for key in ['row','partition','smiles','actual'])
        differences = [abs(float(a['predicted'])-float(b['predicted'])) for a,b in zip(*rows)]
        repeats[model] = {'rows':len(rows[0]),'max_absolute_prediction_difference':max(differences),
                          'changed_prediction_rows':sum(v != 0 for v in differences)}
    result = {'session_event_count':len(events),'tree_node_count':len(depths),
              'longest_parent_chain_nodes':max(depths.values()),'unresolved_parent_count':len(missing_parents),
              'inference':'Each nested GUI tree node adds an object and children array. This measured chain is consistent with the observed Electron bridge >1000 nesting error; no IPC mutation or patched GUI used.',
              'repeatability_esol_seed123':repeats}
    (ROOT/'verification/diagnostics.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))

if __name__ == '__main__':
    main()
