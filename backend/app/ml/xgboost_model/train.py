"""Training entry point for the XGBoost screening-risk candidate model.

Trains a real xgboost.XGBClassifier on the identical CDC BRFSS 2015 data,
target, feature set, and train/test split convention as the RandomForest
baseline (app/ml/train_screening_model.py) — see docs/ML_BASELINE.md and
docs/ML.md for the full methodology and rationale. Produces a metadata dict
shaped for direct comparison with the RandomForest's own metadata via
app/ml/model_comparison.py.

Feature scaling (StandardScaler) is technically unnecessary for a
tree-based model — trees split on a feature's rank order, and a per-feature
monotonic transform like standardization cannot change that order — but is
kept anyway so the two candidates share an identical preprocessing
pipeline, satisfying "same preprocessing assumptions wherever technically
appropriate." It provably cannot help or hurt XGBoost's tree structure.

Run:
    python -m app.ml.xgboost_model.train
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import joblib
import numpy as np
import xgboost as xgb
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

from app.ml.train_screening_model import EDUCATIONAL_SCOPE_LABEL, FEATURE_COLUMNS, TARGET_COLUMN
from app.ml.xgboost_model import explain
from app.ml.xgboost_model.config import (
    ARTIFACT_DIR,
    EARLY_STOPPING_ROUNDS,
    FIXED_HYPERPARAMETERS,
    HYPERPARAMETER_GRID,
    MAX_N_ESTIMATORS,
    MODEL_VERSION,
    RANDOM_STATE,
)
from app.ml.xgboost_model.preprocessing import load_data, scale_features, split_train_val_test

DISCLAIMER = (
    "Educational screening-risk candidate model only, trained on 2015 CDC BRFSS "
    "self-reported survey data. Not a diagnostic tool and not clinically validated. "
    "Reports a model-estimated risk score, not a calibrated clinical probability."
)

RISK_TIER_THRESHOLDS = {"low_max": 0.33, "moderate_max": 0.66}


def _scale_pos_weight(y: np.ndarray) -> float:
    n_pos = int((y == 1).sum())
    n_neg = int((y == 0).sum())
    return n_neg / n_pos


def _tune_hyperparameters(fit_df, val_df) -> tuple[dict, list[dict]]:
    """Small, fixed grid search (docs/ML.md Step 9 — reproducibility over
    maximum optimization), selected on the validation split only. Training
    uses early stopping to pick the round count per candidate rather than
    fixing it in advance."""
    _, (X_fit_s, X_val_s) = scale_features(fit_df, val_df)
    y_fit, y_val = fit_df[TARGET_COLUMN].values, val_df[TARGET_COLUMN].values
    spw = _scale_pos_weight(y_fit)

    results = []
    for combo in HYPERPARAMETER_GRID:
        model = xgb.XGBClassifier(
            n_estimators=MAX_N_ESTIMATORS,
            early_stopping_rounds=EARLY_STOPPING_ROUNDS,
            eval_metric="auc",
            scale_pos_weight=spw,
            **combo,
            **FIXED_HYPERPARAMETERS,
        )
        model.fit(X_fit_s, y_fit, eval_set=[(X_val_s, y_val)], verbose=False)
        results.append(
            {
                **combo,
                "best_iteration": int(model.best_iteration),
                "val_roc_auc": float(model.best_score),
            }
        )

    best = max(results, key=lambda r: r["val_roc_auc"])
    return best, results


def train_and_evaluate() -> dict:
    df = load_data()
    splits = split_train_val_test(df)
    train_df, fit_df, val_df, test_df = splits["train"], splits["fit"], splits["val"], splits["test"]

    best_combo, tuning_results = _tune_hyperparameters(fit_df, val_df)

    scaler, (X_train_s, X_test_s) = scale_features(train_df, test_df)
    y_train, y_test = train_df[TARGET_COLUMN].values, test_df[TARGET_COLUMN].values
    spw_final = _scale_pos_weight(y_train)

    selected_hyperparameters = {
        "n_estimators": max(best_combo["best_iteration"], 10),
        "max_depth": best_combo["max_depth"],
        "learning_rate": best_combo["learning_rate"],
        "scale_pos_weight": spw_final,
        **FIXED_HYPERPARAMETERS,
    }

    final_model = xgb.XGBClassifier(**selected_hyperparameters)
    train_start = time.perf_counter()
    final_model.fit(X_train_s, y_train)
    training_time_seconds = time.perf_counter() - train_start

    infer_start = time.perf_counter()
    y_pred = final_model.predict(X_test_s)
    y_proba = final_model.predict_proba(X_test_s)[:, 1]
    inference_time_seconds = time.perf_counter() - infer_start

    tn, fp, fn, tp = confusion_matrix(y_test, y_pred).ravel()
    test_metrics = {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred)),
        "recall": float(recall_score(y_test, y_pred)),
        "f1": float(f1_score(y_test, y_pred)),
        "roc_auc": float(roc_auc_score(y_test, y_proba)),
    }
    confusion = {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}

    native_importance = explain.native_feature_importance(final_model, FEATURE_COLUMNS)
    shap_importance = explain.shap_feature_importance(final_model, X_test_s, FEATURE_COLUMNS)

    joblib.dump(final_model, ARTIFACT_DIR / "xgboost_model.joblib")
    joblib.dump(scaler, ARTIFACT_DIR / "xgboost_scaler.joblib")
    model_size_bytes = (ARTIFACT_DIR / "xgboost_model.joblib").stat().st_size

    metadata = {
        "model_version": MODEL_VERSION,
        "algorithm": "xgboost",
        "scope": EDUCATIONAL_SCOPE_LABEL,
        "source_dataset": "CDC BRFSS 2015 Diabetes Health Indicators (UCI ML Repository #891)",
        "dataset_identifier": "brfss2015",
        "target": TARGET_COLUMN,
        "disclaimer": DISCLAIMER,
        "feature_columns": FEATURE_COLUMNS,
        "n_features": len(FEATURE_COLUMNS),
        "preprocessing_version": "standard-scaler-v1-shared-with-randomforest",
        "hyperparameter_search": {"grid": HYPERPARAMETER_GRID, "results": tuning_results},
        "selected_hyperparameters": selected_hyperparameters,
        "class_imbalance_handling": {
            "method": "scale_pos_weight",
            "value": spw_final,
            "note": "Analogous to the RandomForest baseline's class_weight='balanced' — "
            "the algorithm accounts for imbalance directly rather than resampling the data.",
        },
        "test_metrics": test_metrics,
        "confusion_matrix": confusion,
        "feature_importances": native_importance,
        "shap_feature_importance": shap_importance,
        "training_time_seconds": training_time_seconds,
        "inference_time_seconds_test_set": inference_time_seconds,
        "inference_time_seconds_per_1000_rows": inference_time_seconds / len(test_df) * 1000,
        "model_size_bytes": model_size_bytes,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "random_seed": RANDOM_STATE,
        "n_train": int(len(train_df)),
        "n_validation": int(len(val_df)),
        "n_test": int(len(test_df)),
        "n_duplicate_rows_kept": int(df.duplicated(subset=FEATURE_COLUMNS + [TARGET_COLUMN]).sum()),
        "risk_tier_thresholds": RISK_TIER_THRESHOLDS,
        "class_balance": {
            "no_diabetes": int((df[TARGET_COLUMN] == 0).sum()),
            "prediabetes_or_diabetes": int((df[TARGET_COLUMN] == 1).sum()),
        },
    }
    with open(ARTIFACT_DIR / "xgboost_model_metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    return metadata


if __name__ == "__main__":
    metadata = train_and_evaluate()
    print(json.dumps(metadata, indent=2))
