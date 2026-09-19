"""Regression test for the upstream pre-standardized FreeSolv source pitfall."""
import csv
import gzip
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parent


def test_freesolv_physical_source_and_upstream_scale_difference():
    with (ROOT/'data/freesolv/SAMPL.csv').open(encoding='utf-8', newline='') as f:
        physical = list(csv.DictReader(f))
    with gzip.open(ROOT/'data/freesolv/freesolv.csv.gz', 'rt', encoding='utf-8') as f:
        standardized = list(csv.DictReader(f))
    assert len(physical) == len(standardized) == 642
    assert [r['smiles'] for r in physical] == [r['smiles'] for r in standardized]
    assert float(physical[0]['expt']) == -11.01
    values = [float(r['expt']) for r in physical]
    mean, std = statistics.fmean(values), statistics.pstdev(values)
    assert 3.84 < std < 3.85
    assert max(abs((value-mean)/std-float(r['y'])) for value,r in zip(values,standardized)) < 1e-12

