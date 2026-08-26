"""Configuration for the XGBoost screening-risk candidate model.

Phase 3 (docs/ML.md, docs/ML_BASELINE.md): a real, trained candidate model
evaluated against the existing RandomForest baseline
(app/ml/train_screening_model.py) on identical data — same CDC BRFSS 2015
dataset, same 21 features, same train/test split convention (same
random_state and stratification), so any metric difference reflects the
algorithm, not the data. Its own ARTIFACT_DIR is kept separate from the
RandomForest's app/ml/artifacts/ so training or retraining one model can
never overwrite the other's artifacts.
"""

from __future__ import annotations

from pathlib import Path

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

MODEL_VERSION = "xgboost-candidate-v1-brfss2015"

# Identical to the RandomForest baseline's split convention
# (docs/ML_BASELINE.md §10-11) — required for a fair, apples-to-apples
# comparison, not an independent choice.
TEST_SIZE = 0.2
RANDOM_STATE = 42

# The training split is further divided to carve a validation set for
# hyperparameter selection and early stopping — the test set is never used
# for this (docs/ML.md, Phase 3 Step 7/9).
VALIDATION_FRACTION_OF_TRAIN = 0.15

# A small, fixed hyperparameter grid — reproducibility and fairness over
# maximum computational optimization (Phase 3 Step 9: "this is an academic
# prototype", not a large search).
HYPERPARAMETER_GRID: list[dict] = [
    {"max_depth": 4, "learning_rate": 0.05},
    {"max_depth": 4, "learning_rate": 0.10},
    {"max_depth": 6, "learning_rate": 0.05},
    {"max_depth": 6, "learning_rate": 0.10},
]

# Hyperparameters held fixed (not searched) across the grid above — standard,
# modest defaults rather than exhaustively tuned.
FIXED_HYPERPARAMETERS: dict = {
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 1,
    "random_state": RANDOM_STATE,
    "n_jobs": -1,
}

# Upper bound on boosting rounds; the actual round count is selected per
# candidate via early stopping against the validation split, not fixed.
MAX_N_ESTIMATORS = 500
EARLY_STOPPING_ROUNDS = 30
