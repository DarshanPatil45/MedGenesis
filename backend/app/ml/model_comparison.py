"""RandomForest (baseline) vs. XGBoost (candidate) comparison.

Phase 3 Step 15. Loads both models' persisted artifacts — never retrains
either — and reports actual measured test-set metrics side by side. The
RandomForest's stored metadata (screening_model_metadata.json) already has
accuracy/precision/recall/f1/roc_auc, but not a confusion matrix or timing;
`evaluate_random_forest_on_test_split()` below reproduces the RandomForest's
own train/test split (identical code path to
app/ml/train_screening_model.py — same random_state, same stratification)
and evaluates the *persisted* model + scaler against it to get those two
extra readings, then cross-checks the result against the stored metadata as
a sanity check that this really is the same split the model was tested on.
This never modifies, retrains, or refits the RandomForest artifact.

Run:
    python -m app.ml.model_comparison
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import joblib
import numpy as np
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

from app.ml.train_screening_model import ARTIFACT_DIR as RF_ARTIFACT_DIR
from app.ml.train_screening_model import FEATURE_COLUMNS, TARGET_COLUMN
from app.ml.train_screening_model import load_data as load_baseline_data
from app.ml.xgboost_model.config import ARTIFACT_DIR as XGB_ARTIFACT_DIR
from app.ml.xgboost_model.config import RANDOM_STATE, TEST_SIZE

# A metric may legitimately differ from the stored metadata by float
# rounding only — this bounds how much drift is tolerated before treating a
# mismatch as a real problem (e.g. a stale artifact) rather than noise.
_METRIC_TOLERANCE = 1e-6


def evaluate_random_forest_on_test_split() -> dict:
    """Reproduces the RandomForest's exact test split, loads the persisted
    (not retrained) model + scaler, and evaluates on it — filling in the
    confusion matrix and inference timing the stored metadata doesn't
    include, and cross-checking the other metrics against what's stored."""
    model_path = RF_ARTIFACT_DIR / "screening_model.joblib"
    scaler_path = RF_ARTIFACT_DIR / "screening_scaler.joblib"
    meta_path = RF_ARTIFACT_DIR / "screening_model_metadata.json"
    if not model_path.exists():
        raise FileNotFoundError(
            f"RandomForest artifacts not found in {RF_ARTIFACT_DIR}. "
            "Run: python -m app.ml.train_screening_model"
        )
    stored_metadata = json.loads(meta_path.read_text())

    df = load_baseline_data()
    _, test_df = train_test_split(df, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=df[TARGET_COLUMN])
    X_test = test_df[FEATURE_COLUMNS].values
    y_test = test_df[TARGET_COLUMN].values

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path)
    X_test_s = scaler.transform(X_test)

    infer_start = time.perf_counter()
    y_pred = model.predict(X_test_s)
    y_proba = model.predict_proba(X_test_s)[:, 1]
    inference_time_seconds = time.perf_counter() - infer_start

    tn, fp, fn, tp = confusion_matrix(y_test, y_pred).ravel()
    recomputed = {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred)),
        "recall": float(recall_score(y_test, y_pred)),
        "f1": float(f1_score(y_test, y_pred)),
        "roc_auc": float(roc_auc_score(y_test, y_proba)),
    }

    stored = stored_metadata["test_metrics"]
    for key, value in recomputed.items():
        if abs(value - stored[key]) > _METRIC_TOLERANCE:
            raise RuntimeError(
                f"RandomForest re-evaluation mismatch on '{key}': stored={stored[key]}, "
                f"recomputed={value}. The persisted artifact may not match its own metadata "
                "— investigate before trusting this comparison."
            )

    model_size_bytes = model_path.stat().st_size
    return {
        "test_metrics": stored,
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "inference_time_seconds_test_set": inference_time_seconds,
        "inference_time_seconds_per_1000_rows": inference_time_seconds / len(test_df) * 1000,
        "training_time_seconds": None,  # not measured — would require retraining, which this
        # phase explicitly does not do (Step 3: "do not retrain or modify [the RandomForest]")
        "model_size_bytes": model_size_bytes,
        "model_version": stored_metadata.get("model_version", "unknown"),
        "algorithm": stored_metadata.get("algorithm", "random_forest"),
        "feature_importances": stored_metadata.get("feature_importances", {}),
        "n_test": int(len(test_df)),
    }


def load_xgboost_metadata() -> dict:
    meta_path = XGB_ARTIFACT_DIR / "xgboost_model_metadata.json"
    if not meta_path.exists():
        raise FileNotFoundError(
            f"XGBoost artifacts not found in {XGB_ARTIFACT_DIR}. "
            "Run: python -m app.ml.xgboost_model.train"
        )
    return json.loads(meta_path.read_text())


def compare() -> dict:
    """Builds the full RandomForest-vs-XGBoost comparison from actual
    measured results only. Never asserts a winner in advance — the metric
    table speaks for itself."""
    rf = evaluate_random_forest_on_test_split()
    xgb_meta = load_xgboost_metadata()

    metrics_table = {}
    for metric in ("accuracy", "precision", "recall", "f1", "roc_auc"):
        metrics_table[metric] = {
            "random_forest": rf["test_metrics"][metric],
            "xgboost": xgb_meta["test_metrics"][metric],
        }

    return {
        "random_forest": {
            "model_version": rf["model_version"],
            "algorithm": rf["algorithm"],
            "test_metrics": rf["test_metrics"],
            "confusion_matrix": rf["confusion_matrix"],
            "training_time_seconds": rf["training_time_seconds"],
            "inference_time_seconds_test_set": rf["inference_time_seconds_test_set"],
            "inference_time_seconds_per_1000_rows": rf["inference_time_seconds_per_1000_rows"],
            "model_size_bytes": rf["model_size_bytes"],
            "feature_importances": rf["feature_importances"],
        },
        "xgboost": {
            "model_version": xgb_meta["model_version"],
            "algorithm": xgb_meta["algorithm"],
            "test_metrics": xgb_meta["test_metrics"],
            "confusion_matrix": xgb_meta["confusion_matrix"],
            "training_time_seconds": xgb_meta["training_time_seconds"],
            "inference_time_seconds_test_set": xgb_meta["inference_time_seconds_test_set"],
            "inference_time_seconds_per_1000_rows": xgb_meta["inference_time_seconds_per_1000_rows"],
            "model_size_bytes": xgb_meta["model_size_bytes"],
            "feature_importances": xgb_meta["feature_importances"],
        },
        "metrics_table": metrics_table,
        "n_test": rf["n_test"],
    }


if __name__ == "__main__":
    result = compare()
    print(json.dumps(result, indent=2))
