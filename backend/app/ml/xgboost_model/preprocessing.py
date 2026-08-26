"""Data loading/preprocessing for the XGBoost candidate model.

Reuses the exact same CDC BRFSS 2015 loading logic as the RandomForest
baseline (app/ml/train_screening_model.py::load_data()) rather than
duplicating it, so both candidates train on byte-identical input — any
metric difference reflects the algorithm, not the data (docs/ML_BASELINE.md
§1-9). The train/validation/test split below mirrors the RandomForest's
split convention exactly (same random_state, same stratification) and adds
one further split — carving a validation set out of the training portion
only — which the RandomForest pipeline doesn't need (it uses k-fold CV for
model selection instead; XGBoost here uses early stopping, which needs a
held-out validation set instead of CV folds).
"""

from __future__ import annotations

import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

from app.ml.train_screening_model import (
    FEATURE_COLUMNS,
    TARGET_COLUMN,
)
from app.ml.train_screening_model import load_data as _load_baseline_data
from app.ml.xgboost_model.config import RANDOM_STATE, TEST_SIZE, VALIDATION_FRACTION_OF_TRAIN


def load_data() -> pd.DataFrame:
    """Loads the same CDC BRFSS 2015 dataset the RandomForest baseline
    trains on, via the baseline's own loader (single source of truth for
    what "the dataset" means in this project)."""
    return _load_baseline_data()


def split_train_val_test(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Same train/test split as the RandomForest baseline (test_size=0.2,
    random_state=42, stratified on the binary target), plus a validation
    split carved out of the training portion only — the test set is never
    touched by this second split."""
    train_df, test_df = train_test_split(
        df, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=df[TARGET_COLUMN]
    )
    fit_df, val_df = train_test_split(
        train_df,
        test_size=VALIDATION_FRACTION_OF_TRAIN,
        random_state=RANDOM_STATE,
        stratify=train_df[TARGET_COLUMN],
    )
    return {"train": train_df, "fit": fit_df, "val": val_df, "test": test_df}


def scale_features(fit_df: pd.DataFrame, *other_dfs: pd.DataFrame) -> tuple[StandardScaler, list]:
    """Fits a StandardScaler on `fit_df` only (never on validation or test
    data — docs/ML_BASELINE.md §8) and transforms it plus any additional
    frames with the same fitted scaler. Returns the fitted scaler and a list
    of transformed feature arrays, one per input frame in the order given
    (fit_df first, then each of other_dfs)."""
    scaler = StandardScaler().fit(fit_df[FEATURE_COLUMNS].values)
    transformed = [scaler.transform(fit_df[FEATURE_COLUMNS].values)]
    transformed += [scaler.transform(df[FEATURE_COLUMNS].values) for df in other_dfs]
    return scaler, transformed
