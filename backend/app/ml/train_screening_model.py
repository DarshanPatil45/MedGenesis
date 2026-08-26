"""
Trains the MedGenesis "Screening Risk Baseline" classifier on the CDC's
Diabetes Health Indicators dataset — 253,680 responses to the 2015 CDC
Behavioral Risk Factor Surveillance System (BRFSS), a real annual US health
survey. Source: UCI ML Repository #891 / CDC (US government work, public
domain under 17 U.S.C. §105 — same status as the CDC "Diabetes Basics" text
already cited elsewhere in this project).

IMPORTANT SCOPE NOTE (see docs/ARCHITECTURE.md §4.3 and §12):
This model is trained purely as an EDUCATIONAL SCREENING-RISK BASELINE. It is
NOT presented, marketed, or validated as a clinical diagnostic tool. BRFSS is
a self-reported telephone survey of the general US adult population — see the
limitations noted in the architecture doc for survey-response-bias caveats.

PROJECT HISTORY: this project originally trained on the Pima Indians Diabetes
Dataset (768 rows, women of Pima Heritage only). That CSV has since been
removed (it's no longer read by anything), but its target-leakage finding is
preserved as a teaching artifact in docs/LEAKAGE.md — see
docs/ARCHITECTURE.md §13.7 for why the project switched datasets.

DATA NOTES (verified before writing this script, not assumed):
  - Zero nulls in the source file — unlike Pima, there is no "0 encodes
    missing" placeholder problem here, so no imputation step is needed.
  - The file contains 23,899 exact-duplicate rows (~9.4%). These are kept.
    With 17 of 21 features binary and the rest small-cardinality categorical
    buckets, two distinct real respondents legitimately sharing an identical
    answer profile is expected, not a collection error — there is no
    principled way to tell a "real" duplicate from a data artifact, and
    dropping them would arbitrarily bias the sample toward less-common
    response profiles.
  - The original label (`Diabetes_012`) is three-class: 0 = no diabetes
    (84.3%), 1 = prediabetes (1.8%), 2 = diabetes (13.9%). This is binarized
    to 0 vs. {1, 2} — matching the dataset family's standard companion
    "binary" release — because an educational SCREENING tool should flag
    elevated risk (prediabetes included), not only a diagnosed case.

Run:
    python -m app.ml.train_screening_model
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.preprocessing import StandardScaler

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DATA_FILE = DATA_DIR / "diabetes_health_indicators_brfss2015.csv"
ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

RAW_TARGET_COLUMN = "Diabetes_012"
TARGET_COLUMN = "diabetes_binary"

# Order matters — the model takes a positional array built from this list.
# Kept as the dataset's original PascalCase column names; the mapping to the
# snake_case twin-state keys the app actually stores lives in
# app/agents/screening_agent.py (STATE_KEY_BY_FEATURE), one source of truth.
FEATURE_COLUMNS = [
    "HighBP", "HighChol", "CholCheck", "BMI", "Smoker", "Stroke",
    "HeartDiseaseorAttack", "PhysActivity", "Fruits", "Veggies",
    "HvyAlcoholConsump", "AnyHealthcare", "NoDocbcCost", "GenHlth",
    "MentHlth", "PhysHlth", "DiffWalk", "Sex", "Age", "Education", "Income",
]

MODEL_VERSION = "screening-baseline-v3-brfss2015"
EDUCATIONAL_SCOPE_LABEL = "educational_screening_only"


def load_data(csv_path: Path = DATA_FILE) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    assert df[FEATURE_COLUMNS + [RAW_TARGET_COLUMN]].isnull().sum().sum() == 0, (
        "Expected zero nulls in this pre-cleaned dataset — if this fires, the "
        "no-imputation-needed assumption documented above no longer holds."
    )
    df[TARGET_COLUMN] = (df[RAW_TARGET_COLUMN] > 0).astype(int)
    return df


def train_and_evaluate(df: pd.DataFrame) -> dict:
    train_df, test_df = train_test_split(
        df, test_size=0.2, random_state=42, stratify=df[TARGET_COLUMN]
    )

    X_train, y_train = train_df[FEATURE_COLUMNS].values, train_df[TARGET_COLUMN].values
    X_test, y_test = test_df[FEATURE_COLUMNS].values, test_df[TARGET_COLUMN].values

    scaler = StandardScaler().fit(X_train)
    X_train_s, X_test_s = scaler.transform(X_train), scaler.transform(X_test)

    candidates = {
        "logistic_regression": LogisticRegression(
            max_iter=1000, random_state=42, class_weight="balanced"
        ),
        "random_forest": RandomForestClassifier(
            n_estimators=300, max_depth=8, random_state=42, class_weight="balanced", n_jobs=-1
        ),
    }
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_results = {}
    for name, model in candidates.items():
        scores = cross_val_score(
            model, X_train_s, y_train, cv=cv, scoring="roc_auc", n_jobs=-1
        )
        cv_results[name] = {"mean_roc_auc": float(scores.mean()), "std_roc_auc": float(scores.std())}

    best_name = max(cv_results, key=lambda k: cv_results[k]["mean_roc_auc"])
    best_model = candidates[best_name]
    best_model.fit(X_train_s, y_train)

    y_pred = best_model.predict(X_test_s)
    y_proba = best_model.predict_proba(X_test_s)[:, 1]
    test_metrics = {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred)),
        "recall": float(recall_score(y_test, y_pred)),
        "f1": float(f1_score(y_test, y_pred)),
        "roc_auc": float(roc_auc_score(y_test, y_proba)),
    }

    if hasattr(best_model, "feature_importances_"):
        raw = best_model.feature_importances_.tolist()
    else:
        raw = np.abs(best_model.coef_[0]).tolist()
    importances = dict(sorted(zip(FEATURE_COLUMNS, raw), key=lambda kv: kv[1], reverse=True))

    joblib.dump(best_model, ARTIFACT_DIR / "screening_model.joblib")
    joblib.dump(scaler, ARTIFACT_DIR / "screening_scaler.joblib")

    metadata = {
        "model_version": MODEL_VERSION,
        "scope": EDUCATIONAL_SCOPE_LABEL,
        "source_dataset": "CDC BRFSS 2015 Diabetes Health Indicators (UCI ML Repository #891)",
        "disclaimer": (
            "Educational screening-risk baseline only, trained on 2015 CDC BRFSS "
            "self-reported survey data. Not a diagnostic tool. Self-reported survey "
            "data carries its own biases (recall accuracy, non-response, telephone-"
            "survey coverage) — see docs/ARCHITECTURE.md for details."
        ),
        "algorithm": best_name,
        "feature_columns": FEATURE_COLUMNS,
        "cross_validation": cv_results,
        "test_metrics": test_metrics,
        "feature_importances": importances,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_train": int(len(train_df)),
        "n_test": int(len(test_df)),
        "n_duplicate_rows_kept": int(df.duplicated(subset=FEATURE_COLUMNS + [RAW_TARGET_COLUMN]).sum()),
        "risk_tier_thresholds": {"low_max": 0.33, "moderate_max": 0.66},
        "class_balance": {
            "no_diabetes": int((df[TARGET_COLUMN] == 0).sum()),
            "prediabetes_or_diabetes": int((df[TARGET_COLUMN] == 1).sum()),
        },
    }
    with open(ARTIFACT_DIR / "screening_model_metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    return metadata


if __name__ == "__main__":
    metadata = train_and_evaluate(load_data())
    print(json.dumps(metadata, indent=2))
