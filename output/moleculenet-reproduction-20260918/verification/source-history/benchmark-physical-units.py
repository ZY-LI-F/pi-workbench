"""Execute the registered MoleculeNet subset using upstream DeepChem models.

Never replace failed experiments with synthetic observations. Raw data, split
indices, per-molecule predictions, metrics and training histories are retained.
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import random
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parent


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def check_partition(partitions, total):
    values = [int(i) for indices in partitions for i in indices]
    if len(values) != total or sorted(values) != list(range(total)):
        raise ValueError("Split indices must cover each source row exactly once")
    if any(len(indices) == 0 for indices in partitions):
        raise ValueError("Training, validation and test partitions must be nonempty")


def regression_metrics(truth, prediction):
    import numpy as np
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    y = np.asarray(truth, dtype=float).reshape(-1)
    p = np.asarray(prediction, dtype=float).reshape(-1)
    if y.shape != p.shape or not np.isfinite(y).all() or not np.isfinite(p).all():
        raise ValueError("Predictions must be finite and match the target shape")
    return {"rmse": float(np.sqrt(mean_squared_error(y, p))),
            "mae": float(mean_absolute_error(y, p)), "r2": float(r2_score(y, p)), "n": len(y)}


def overlap_report(canonical, partitions):
    groups = [{canonical[int(i)] for i in indices} for indices in partitions]
    return {"train_valid": len(groups[0] & groups[1]),
            "train_test": len(groups[0] & groups[2]),
            "valid_test": len(groups[1] & groups[2])}


def get_data(dc, np, pd, dataset_name, cfg):
    from rdkit import Chem
    from rdkit.Chem.Scaffolds import MurckoScaffold
    loaders = {"esol": (dc.molnet.load_delaney, "delaney-processed.csv", "log10(mol/L)"),
               "freesolv": (None, "SAMPL.csv", "kcal/mol"),
               "lipophilicity": (dc.molnet.load_lipo, "Lipophilicity.csv", "logD")}
    loader, filename, unit = loaders[dataset_name]
    data_dir = ROOT / "data" / dataset_name
    data_dir.mkdir(parents=True, exist_ok=True)
    if dataset_name == "freesolv":
        # DeepChem 2.8's freesolv.csv.gz already contains global z-scores.
        # Use its original MoleculeNet SAMPL file to retain physical units and
        # fit normalization exclusively on training data, as registered.
        if not (data_dir / filename).exists():
            dc.utils.data_utils.download_url(
                url="https://deepchemdata.s3-us-west-1.amazonaws.com/datasets/SAMPL.csv",
                dest_dir=str(data_dir))
        tasks, transforms = ["expt"], []
        full = dc.data.CSVLoader(tasks=tasks, feature_field="smiles",
                                featurizer=dc.feat.RawFeaturizer(smiles=True)).create_dataset(str(data_dir / filename))
    else:
        tasks, datasets, transforms = loader(
            featurizer=dc.feat.RawFeaturizer(smiles=True), splitter=None,
            transformers=[], reload=False, data_dir=str(data_dir), save_dir=str(data_dir))
        full = datasets[0]
    raw = pd.read_csv(data_dir / filename)
    if len(full) != len(raw) or transforms or len(tasks) != 1:
        raise ValueError(f"Unexpected source row loss, transformation, or task count for {dataset_name}")
    if not np.isfinite(full.y).all() or not np.all(full.w > 0):
        raise ValueError("Missing/nonfinite targets are not supported by this registered protocol")
    smiles = full.ids.astype(str)
    molecules = [Chem.MolFromSmiles(s) for s in smiles]
    invalid = [i for i, mol in enumerate(molecules) if mol is None]
    if invalid:
        raise ValueError(f"Invalid SMILES at source rows {invalid}")
    canonical = [Chem.MolToSmiles(mol, isomericSmiles=True) for mol in molecules]
    scaffolds = [MurckoScaffold.MurckoScaffoldSmiles(mol=mol, includeChirality=False) for mol in molecules]
    ecfp = dc.feat.CircularFingerprint(radius=cfg["featurization"]["ecfp_radius"],
                                     size=cfg["featurization"]["ecfp_bits"]).featurize(molecules)
    graphs = dc.feat.ConvMolFeaturizer().featurize(molecules)
    if ecfp.shape != (len(full), cfg["featurization"]["ecfp_bits"]) or len(graphs) != len(full):
        raise ValueError("Featurization changed the registered row set")
    for graph in graphs:
        if not hasattr(graph, "get_atom_features") or graph.get_atom_features().shape[1] != 75:
            raise ValueError("Graph featurization failed or changed feature count")
    metadata = {"dataset": dataset_name, "n": len(full), "tasks": tasks, "unit": unit,
                "data_file": str((data_dir / filename).relative_to(ROOT)),
                "sha256": sha256(data_dir / filename),
                "unique_canonical_smiles": len(set(canonical)),
                "duplicate_structure_rows": len(canonical) - len(set(canonical)),
                "unique_scaffolds": len(set(scaffolds)), "invalid_smiles": invalid,
                "source_label_mean": float(full.y.mean()), "source_label_std": float(full.y.std()),
                "source_note": ("Original MoleculeNet SAMPL.csv expt in kcal/mol; not pre-standardized freesolv.csv.gz"
                                if dataset_name == "freesolv" else "Native MoleculeNet source, no loader transforms")}
    save_json(data_dir / "metadata.json", metadata)
    return full, ecfp, graphs, canonical, scaffolds, metadata


def execute_model(dc, tf, np, pd, cfg, dataset_name, split_name, seed, model_name,
                  full, features, partitions, unit, out):
    from sklearn.dummy import DummyRegressor
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.kernel_ridge import KernelRidge
    tf.keras.backend.clear_session()
    random.seed(seed)
    np.random.seed(seed)
    tf.keras.utils.set_random_seed(seed)
    unscaled = [dc.data.NumpyDataset(features[ix], full.y[ix], full.w[ix], full.ids[ix])
                for ix in partitions]
    normalizer = dc.trans.NormalizationTransformer(transform_y=True, dataset=unscaled[0])
    normalized = [normalizer.transform(ds) for ds in unscaled]
    train, valid, test = normalized
    save_json(out / "normalization.json", {"fit_partition": "train", "n": len(train),
              "mean": normalizer.y_means.tolist(), "std": normalizer.y_stds.tolist(),
              "normalized_partition_statistics": {
                  label: {"mean": float(ds.y.mean()), "std": float(ds.y.std()),
                          "min": float(ds.y.min()), "max": float(ds.y.max())}
                  for label, ds in zip(["train", "valid", "test"], normalized)}})
    if not np.allclose(normalizer.untransform(train.y), unscaled[0].y, atol=1e-8):
        raise ValueError("Target normalization is not invertible")
    model_dir = ROOT / "models" / out.relative_to(ROOT)
    if model_name == "gc":
        settings = {k: v for k, v in cfg["gc"].items() if k != "epochs"}
        model = dc.models.GraphConvModel(1, mode="regression", model_dir=str(model_dir), **settings)
    else:
        if model_name == "mean":
            estimator = DummyRegressor(strategy="mean")
        elif model_name == "rf":
            estimator = RandomForestRegressor(n_estimators=cfg["rf"]["n_estimators"],
                                              n_jobs=cfg["cpu_threads"], random_state=seed)
        elif model_name == "krr":
            estimator = KernelRidge(**cfg["krr"])
        else:
            raise ValueError(f"Unknown model: {model_name}")
        model = dc.models.SklearnModel(estimator, model_dir=str(model_dir))
    started = time.perf_counter()
    history = []
    if model_name == "gc":
        epochs = cfg["gc"]["epochs"]
        for epoch in range(1, epochs + 1):
            loss = float(model.fit(train, nb_epoch=1, checkpoint_interval=0))
            if not np.isfinite(loss):
                raise ValueError(f"Nonfinite GC loss at epoch {epoch}")
            if epoch % 10 == 0 or epoch == epochs:
                val_pred = model.predict(valid, transformers=[normalizer])
                point = {"epoch": epoch, "training_loss_normalized": loss,
                         "validation_rmse": regression_metrics(unscaled[1].y, val_pred)["rmse"]}
                history.append(point)
                print(json.dumps({"progress": [dataset_name, split_name, seed, model_name], **point}), flush=True)
        model.save_checkpoint()
    else:
        model.fit(train)
        model.save()
    fit_seconds = time.perf_counter() - started
    metrics = {"dataset": dataset_name, "split": split_name, "seed": seed,
               "model": model_name, "unit": unit, "fit_seconds": fit_seconds}
    predictions = []
    for split_label, original, normalized_part, indices in zip(
            ["train", "valid", "test"], unscaled, normalized, partitions):
        predicted = np.asarray(model.predict(normalized_part, transformers=[normalizer])).reshape(-1)
        metrics[split_label] = regression_metrics(original.y, predicted)
        predictions.extend({"row": int(ix), "partition": split_label, "smiles": str(full.ids[ix]),
                            "actual": float(actual), "predicted": float(pred), "residual": float(pred - actual)}
                           for ix, actual, pred in zip(indices, original.y.reshape(-1), predicted))
    out.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(predictions).to_csv(out / "predictions.csv", index=False)
    save_json(out / "metrics.json", metrics)
    save_json(out / "learning-curve.json", history)
    print(json.dumps({"complete": [dataset_name, split_name, seed, model_name],
                      "test_rmse": metrics["test"]["rmse"], "fit_seconds": fit_seconds}), flush=True)
    del model
    tf.keras.backend.clear_session()
    gc.collect()
    return metrics


def run(args):
    cfg_path = ROOT / "experiment.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
    os.environ["TF_DETERMINISTIC_OPS"] = "1"
    os.environ["OMP_NUM_THREADS"] = str(cfg["cpu_threads"])
    import numpy as np
    import pandas as pd
    import tensorflow as tf
    import deepchem as dc
    tf.config.threading.set_intra_op_parallelism_threads(cfg["cpu_threads"])
    tf.config.threading.set_inter_op_parallelism_threads(1)
    tf.config.experimental.enable_op_determinism()
    results_root = ROOT / args.output
    results_root.mkdir(parents=True, exist_ok=True)
    provenance = {"started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                  "python": sys.version, "platform": platform.platform(),
                  "config_sha256": sha256(cfg_path), "script_sha256": sha256(__file__),
                  "dependencies": {p: importlib.metadata.version(p) for p in [
                      "deepchem", "tensorflow", "keras", "rdkit", "scikit-learn", "numpy", "pandas", "scipy"]},
                  "tensorflow_devices": [d.name for d in tf.config.list_physical_devices()],
                  "subset_arguments": vars(args), "scientific_core": "upstream DeepChem APIs"}
    save_json(results_root / "provenance.json", provenance)
    all_metrics = []
    started = time.perf_counter()
    for dataset_name in args.datasets or cfg["datasets"]:
        full, fingerprints, graphs, canonical, scaffolds, metadata = get_data(dc, np, pd, dataset_name, cfg)
        save_json(results_root / dataset_name / "data-audit.json", metadata)
        splits = args.splits or (["random", "scaffold"] if dataset_name in cfg["scaffold_extension_datasets"] else ["random"])
        for split_name in splits:
            for seed in args.seeds or cfg["seeds"]:
                splitter = dc.splits.RandomSplitter() if split_name == "random" else dc.splits.ScaffoldSplitter()
                partitions = tuple(np.asarray(ix, dtype=int) for ix in splitter.split(
                    full, frac_train=cfg["fractions"]["train"],
                    frac_valid=cfg["fractions"]["valid"], frac_test=cfg["fractions"]["test"], seed=seed))
                check_partition(partitions, len(full))
                split_root = results_root / dataset_name / split_name / str(seed)
                audit = {"dataset": dataset_name, "split": split_name, "seed": seed,
                         "indices": {k: ix.tolist() for k, ix in zip(["train", "valid", "test"], partitions)},
                         "canonical_overlap": overlap_report(canonical, partitions),
                         "scaffold_overlap": overlap_report(scaffolds, partitions),
                         "label_summary": {k: {"n": len(ix), "mean": float(full.y[ix].mean()),
                                                   "std": float(full.y[ix].std()),
                                                   "min": float(full.y[ix].min()), "max": float(full.y[ix].max()),
                                                   "fraction_outside_train_range": float(np.mean(
                                                       (full.y[ix] < full.y[partitions[0]].min()) |
                                                       (full.y[ix] > full.y[partitions[0]].max())))}
                                           for k, ix in zip(["train", "valid", "test"], partitions)}}
                if split_name == "scaffold" and any(audit["scaffold_overlap"].values()):
                    raise ValueError("Scaffold partition leaked scaffolds")
                save_json(split_root / "split-audit.json", audit)
                for model_name in args.models or cfg["models"]:
                    out = split_root / model_name
                    if (out / "metrics.json").exists():
                        raise FileExistsError(f"Refusing to overwrite completed run: {out}")
                    try:
                        metrics = execute_model(dc, tf, np, pd, cfg, dataset_name, split_name, seed, model_name,
                                                full, graphs if model_name == "gc" else fingerprints,
                                                partitions, metadata["unit"], out)
                        all_metrics.append(metrics)
                    except Exception:
                        save_json(out / "failure.json", {"traceback": traceback.format_exc(),
                                                         "dataset": dataset_name, "model": model_name,
                                                         "split": split_name, "seed": seed})
                        raise
    save_json(results_root / "completed.json", {"elapsed_seconds": time.perf_counter() - started,
                                                "runs": all_metrics, "config_sha256": sha256(cfg_path)})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--datasets", nargs="+", choices=["esol", "freesolv", "lipophilicity"])
    parser.add_argument("--models", nargs="+", choices=["mean", "rf", "krr", "gc"])
    parser.add_argument("--seeds", nargs="+", type=int)
    parser.add_argument("--splits", nargs="+", choices=["random", "scaffold"])
    parser.add_argument("--output", default="results")
    run(parser.parse_args())
