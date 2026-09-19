"""Independent result audit: raw rows -> saved predictions -> recomputed metrics.

Does not import benchmark.py, TensorFlow or DeepChem. Missing runs fail visibly.
"""
from __future__ import annotations
import csv
import gzip
import hashlib
import json
import math
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parent
SOURCES = {"esol": "results", "freesolv": "results-corrected", "lipophilicity": "results-corrected"}
EXPECTED_N = {"esol": 1128, "freesolv": 642, "lipophilicity": 4200}
EXPECTED_UNITS = {"esol": "log10(mol/L)", "freesolv": "kcal/mol", "lipophilicity": "logD"}
PAPER = {
    "esol": {"rf": [1.07, .19], "krr": [1.53, .06], "gc": [.97, .01]},
    "freesolv": {"rf": [2.03, .22], "krr": [2.11, .07], "gc": [1.40, .16]},
    "lipophilicity": {"rf": [.876, .040], "krr": [.899, .043], "gc": [.655, .036]},
}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def close(a, b, context):
    if not math.isfinite(a) or not math.isfinite(b) or not math.isclose(a, b, rel_tol=1e-7, abs_tol=1e-8):
        raise AssertionError(f"{context}: {a} != {b}")


def calculate_metrics(rows):
    if not rows:
        raise ValueError("Empty prediction partition")
    truth = [float(row["actual"]) for row in rows]
    predicted = [float(row["predicted"]) for row in rows]
    if not all(math.isfinite(x) for x in truth + predicted):
        raise ValueError("Nonfinite prediction or target")
    errors = [p-y for p, y in zip(predicted, truth)]
    sse = math.fsum(x*x for x in errors)
    average = statistics.fmean(truth)
    sst = math.fsum((y-average)**2 for y in truth)
    if sst == 0:
        raise ValueError("R2 requires nonconstant targets for this protocol")
    return {"n": len(rows), "rmse": math.sqrt(sse/len(rows)),
            "mae": math.fsum(abs(x) for x in errors)/len(rows), "r2": 1-sse/sst}


def source_rows(metadata):
    if metadata["unit"] != EXPECTED_UNITS[metadata["dataset"]]:
        raise AssertionError("Data unit differs from the source's physical target")
    path = ROOT/metadata["data_file"]
    if metadata["dataset"] == "freesolv" and (path.name != "SAMPL.csv" or metadata["tasks"] != ["expt"]):
        raise AssertionError("FreeSolv requires raw physical expt labels; pre-scaled y is invalid in kcal/mol")
    if digest(path) != metadata["sha256"]:
        raise AssertionError(f"Raw data hash changed: {path}")
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    if len(rows) != metadata["n"] or len(rows) != EXPECTED_N[metadata["dataset"]]:
        raise AssertionError("Source row count changed")
    return rows


def verify_run(path, metadata, raw, split_audit):
    metrics = read_json(path/"metrics.json")
    if metrics["unit"] != EXPECTED_UNITS[metadata["dataset"]]:
        raise AssertionError("Metric unit differs from the source's physical target")
    normalizer = read_json(path/"normalization.json")
    with (path/"predictions.csv").open(encoding="utf-8", newline="") as f:
        predictions = list(csv.DictReader(f))
    if len(predictions) != len(raw) or sorted(int(p["row"]) for p in predictions) != list(range(len(raw))):
        raise AssertionError(f"Missing or repeated source row: {path}")
    target = metadata["tasks"][0]
    groups = {label: [p for p in predictions if p["partition"] == label] for label in ["train", "valid", "test"]}
    if sum(map(len, groups.values())) != len(predictions):
        raise AssertionError("Unknown prediction partition")
    for label, rows in groups.items():
        if [int(p["row"]) for p in rows] != split_audit["indices"][label]:
            raise AssertionError(f"Prediction rows differ from recorded {label} split")
        for row in rows:
            original = raw[int(row["row"])]
            close(float(row["actual"]), float(original[target]), "Raw target roundtrip")
            close(float(row["residual"]), float(row["predicted"])-float(row["actual"]), "Residual identity")
            if row["smiles"].strip() != original["smiles"].strip():
                raise AssertionError("Prediction row SMILES misalignment")
        calculated = calculate_metrics(rows)
        for name, value in calculated.items():
            close(value, metrics[label][name], f"{path}: {label}/{name}")
    train_y = [float(p["actual"]) for p in groups["train"]]
    mean, std = statistics.fmean(train_y), statistics.pstdev(train_y)
    if normalizer["fit_partition"] != "train" or normalizer["n"] != len(train_y):
        raise AssertionError("Normalizer was not fitted to training rows")
    close(normalizer["mean"][0], mean, "Train-only normalization mean")
    close(normalizer["std"][0], std, "Train-only normalization std")
    if metrics["model"] == "mean":
        for row in predictions:
            close(float(row["predicted"]), mean, "Mean baseline")
    curve = read_json(path/"learning-curve.json")
    if metrics["model"] == "gc":
        if [p["epoch"] for p in curve] != list(range(10, 101, 10)):
            raise AssertionError("GraphConv training did not complete 100 epochs")
        close(curve[-1]["validation_rmse"], metrics["valid"]["rmse"], "Final GC validation")
    elif curve:
        raise AssertionError("Non-GC unexpectedly contains epoch curve")
    if not math.isfinite(metrics["fit_seconds"]) or metrics["fit_seconds"] <= 0:
        raise AssertionError("Invalid fit duration")
    return {"run": str(path.relative_to(ROOT)).replace("\\", "/"), "status": "passed",
            "predictions_sha256": digest(path/"predictions.csv"), "metrics_sha256": digest(path/"metrics.json"),
            "rows": len(predictions), "metrics": metrics}


def structure_audit(raw, split):
    from rdkit import Chem
    from rdkit.Chem.Scaffolds import MurckoScaffold
    molecules = [Chem.MolFromSmiles(r["smiles"]) for r in raw]
    if any(m is None for m in molecules):
        raise AssertionError("Invalid raw molecule")
    canonical = [Chem.MolToSmiles(m, isomericSmiles=True) for m in molecules]
    scaffolds = [MurckoScaffold.MurckoScaffoldSmiles(mol=m, includeChirality=False) for m in molecules]
    for kind, values in [("canonical", canonical), ("scaffold", scaffolds)]:
        sets = {p: {values[i] for i in indices} for p, indices in split["indices"].items()}
        observed = {f"{a}_{b}": len(sets[a] & sets[b]) for a,b in [("train","valid"),("train","test"),("valid","test")]}
        if observed != split[f"{kind}_overlap"]:
            raise AssertionError(f"{kind} overlap report mismatch")
        if split["split"] == "scaffold" and kind == "scaffold" and any(observed.values()):
            raise AssertionError("Scaffold leakage")


def main():
    cfg = read_json(ROOT/"experiment.json")
    config_hash = digest(ROOT/"experiment.json")
    expected = []
    for ds, location in SOURCES.items():
        for split in ["random", "scaffold"] if ds == "esol" else ["random"]:
            for seed in cfg["seeds"]:
                for model in cfg["models"]:
                    expected.append(ROOT/location/ds/split/str(seed)/model)
    missing = [str(p.relative_to(ROOT)) for p in expected if not (p/"metrics.json").exists()]
    if missing:
        raise FileNotFoundError(f"Incomplete experiment: {len(missing)}/48 missing runs: {missing}")
    verified, audits, metadata_by_ds = [], [], {}
    for ds, location in SOURCES.items():
        provenance = read_json(ROOT/location/"provenance.json")
        if provenance["config_sha256"] != config_hash:
            raise AssertionError("Protocol changed between runs")
        script = ROOT/"verification/source-history"/(
            "benchmark-esol-original.py" if ds == "esol" else "benchmark-physical-units.py")
        if digest(script) != provenance["script_sha256"]:
            raise AssertionError("Scientific runner snapshot differs from saved provenance")
        metadata = read_json(ROOT/location/ds/"data-audit.json")
        metadata_by_ds[ds] = metadata
        raw = source_rows(metadata)
        for split in ["random", "scaffold"] if ds == "esol" else ["random"]:
            for seed in cfg["seeds"]:
                parent = ROOT/location/ds/split/str(seed)
                audit = read_json(parent/"split-audit.json")
                values = [i for indices in audit["indices"].values() for i in indices]
                if sorted(values) != list(range(len(raw))):
                    raise AssertionError("Source split does not form a disjoint cover")
                structure_audit(raw, audit)
                audits.append({k: v for k,v in audit.items() if k != "indices"})
                for model in cfg["models"]:
                    result = verify_run(parent/model, metadata, raw, audit)
                    m = result["metrics"]
                    if (m["dataset"],m["split"],m["seed"],m["model"]) != (ds,split,seed,model):
                        raise AssertionError("Run identity mismatch")
                    verified.append(result)
    aggregate = []
    for ds in SOURCES:
        for split in ["random", "scaffold"] if ds == "esol" else ["random"]:
            for model in cfg["models"]:
                rows = [v["metrics"] for v in verified if all(v["metrics"][k] == value for k,value in
                        [("dataset",ds),("split",split),("model",model)])]
                values = [r["test"]["rmse"] for r in rows]
                aggregate.append({"dataset":ds,"split":split,"model":model,"n_runs":len(rows),
                    "unit":metadata_by_ds[ds]["unit"], "test_rmse_mean":statistics.fmean(values),
                    "test_rmse_sample_sd":statistics.stdev(values),"per_seed_test_rmse":dict(zip(cfg["seeds"],values)),
                    "test_mae_mean":statistics.fmean(r["test"]["mae"] for r in rows),
                    "test_r2_mean":statistics.fmean(r["test"]["r2"] for r in rows),
                    "fit_seconds_total":sum(r["fit_seconds"] for r in rows),
                    "paper_test_rmse":PAPER[ds].get(model) if split == "random" else None})
    initial_checks = {}
    for model in cfg["models"]:
        paths = [ROOT/location/"esol/random/123"/model/"predictions.csv" for location in ["initial-esol-run", "results"]]
        initial_checks[model] = {"byte_identical_predictions":digest(paths[0]) == digest(paths[1])}
    summary = {"status":"verified", "total_runs":len(verified), "config_sha256":config_hash,
        "verification":"Independent raw-data alignment, split cover, train-only normalization, finite metrics, residual identities, and 100-epoch GC checks",
        "model":"DeepSeek V4.1 Flash (Pi orchestration; numerical training by upstream DeepChem on CPU)",
        "datasets":metadata_by_ds, "aggregate":aggregate, "fit_seconds_total":sum(v["metrics"]["fit_seconds"] for v in verified),
        "repeatability_esol_seed123":initial_checks, "deviations":cfg["deviations"],
        "sd_definition":"This replication: sample standard deviation ddof=1 across 3 runs; paper SD definition not independently recovered",
        "paper_reference":"MoleculeNet arXiv:1703.00564v3 Table 8, p.51; author manuscript Fig.13 corresponds to published Fig.12"}
    out = ROOT/"verification"
    write_json(out/"runs.json", verified)
    write_json(out/"split-audits.json", audits)
    write_json(out/"summary.json", summary)
    fields = ["dataset","split","model","n_runs","unit","test_rmse_mean","test_rmse_sample_sd","test_mae_mean","test_r2_mean","fit_seconds_total"]
    with (out/"summary.csv").open("w",newline="",encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(aggregate)
    print(json.dumps({"status":"verified","runs":len(verified),"aggregate":aggregate},ensure_ascii=False),flush=True)


if __name__ == "__main__":
    main()
