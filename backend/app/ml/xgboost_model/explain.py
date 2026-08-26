"""Explainability for the XGBoost candidate model (Phase 3 Step 14).

Two independent views of feature contribution are provided: the model's
native gain-based importance (always available, cheap) and SHAP values
(a second, theoretically-grounded measure, used to sanity-check the native
ranking rather than replace it).

IMPORTANT — both describe which features the MODEL weighted most heavily in
producing its output. Neither is a claim that a feature *causes* diabetes,
and neither has been clinically validated. See docs/ML.md for the full
disclaimer this module's output is expected to carry wherever it's surfaced
(e.g. a future Clinical Analysis Agent).
"""

from __future__ import annotations

import numpy as np
import xgboost as xgb


def native_feature_importance(model: xgb.XGBClassifier, feature_names: list[str]) -> dict[str, float]:
    """Gain-based feature importance native to the fitted model, sorted
    descending. Reflects how much each feature contributed to reducing the
    model's training loss across all trees."""
    raw = model.feature_importances_.tolist()
    return dict(sorted(zip(feature_names, raw), key=lambda kv: kv[1], reverse=True))


def shap_feature_importance(
    model: xgb.XGBClassifier,
    X_background: np.ndarray,
    feature_names: list[str],
    max_samples: int = 2000,
) -> dict[str, float]:
    """Mean absolute SHAP value per feature over a background sample of the
    data — an independent cross-check on `native_feature_importance`.
    `max_samples` only bounds runtime (SHAP's TreeExplainer is exact for
    tree ensembles regardless of sample count); it does not change what is
    being measured."""
    import shap

    sample = X_background[:max_samples]
    explainer = shap.TreeExplainer(model)
    shap_values = np.asarray(explainer.shap_values(sample))
    mean_abs = np.abs(shap_values).mean(axis=0)
    return dict(sorted(zip(feature_names, mean_abs.tolist()), key=lambda kv: kv[1], reverse=True))


def explain_single_prediction(
    model: xgb.XGBClassifier, feature_vector: np.ndarray, feature_names: list[str]
) -> dict[str, float]:
    """Per-instance SHAP contribution for one feature vector — how much
    each feature pushed this one model score away from the model's baseline
    output. Not a medical explanation of the patient's risk."""
    import shap

    explainer = shap.TreeExplainer(model)
    shap_values = np.asarray(explainer.shap_values(feature_vector.reshape(1, -1)))
    return dict(zip(feature_names, shap_values[0].tolist()))
