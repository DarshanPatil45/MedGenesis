"""Inference for the XGBoost candidate model.

Mirrors app/agents/screening_agent.py's load-artifacts-and-score pattern —
same feature vector construction (same FEATURE_KEY_MAP, same sex/age-bucket
conversion, imported rather than duplicated, so a twin-state dict resolves
to an identical feature ordering for both candidates), same
missing-field-refuses-to-guess discipline. This module does not gate
through the Safety Agent or persist to the database — it is a candidate/
comparison inference path, not the production screening pipeline (that
remains `POST /api/screening/run`, unchanged — see docs/ML.md "API
surface").
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import joblib
import numpy as np

from app.agents.screening_agent import FEATURE_KEY_MAP, SEX_TO_CODE, age_to_brfss_bucket
from app.ml.xgboost_model.config import ARTIFACT_DIR

DISCLAIMER = (
    "Candidate model score for RandomForest-vs-XGBoost comparison only (docs/ML.md). "
    "Educational, not clinically validated, not a diagnosis. Reports a model-estimated "
    "risk score, not a calibrated clinical probability."
)


class ModelArtifactsMissing(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _load_artifacts():
    model_path = ARTIFACT_DIR / "xgboost_model.joblib"
    scaler_path = ARTIFACT_DIR / "xgboost_scaler.joblib"
    meta_path = ARTIFACT_DIR / "xgboost_model_metadata.json"
    if not model_path.exists():
        raise ModelArtifactsMissing(
            f"XGBoost model artifacts not found in {ARTIFACT_DIR}. "
            "Run: python -m app.ml.xgboost_model.train"
        )
    with open(meta_path) as f:
        metadata = json.load(f)
    return joblib.load(model_path), joblib.load(scaler_path), metadata


def _resolve_feature_vector(state: dict[str, Any]) -> tuple[list[float] | None, list[str]]:
    """Same resolution logic as screening_agent's, kept as an independent
    (not imported-private) implementation so this module has no dependency
    on another module's underscore-prefixed internals, while sourcing the
    canonical feature list/order from the same FEATURE_KEY_MAP."""
    sex_code = SEX_TO_CODE.get((state.get("sex") or "").lower())
    age_years = state.get("age")
    age_bucket = age_to_brfss_bucket(int(age_years)) if age_years is not None else None

    resolved: dict[str, float | None] = dict(state)
    resolved["sex"] = sex_code
    resolved["age_bucket"] = age_bucket

    missing = [key for key, _ in FEATURE_KEY_MAP if resolved.get(key) is None]
    if missing:
        return None, missing
    return [float(resolved[key]) for key, _ in FEATURE_KEY_MAP], []


def score_vector(features: dict[str, Any]) -> tuple[float, str]:
    """Returns (probability, risk_tier) for a twin-state feature dict —
    same signature as ScreeningAgent.score_vector(), for direct
    comparability."""
    model, scaler, metadata = _load_artifacts()
    vector, missing = _resolve_feature_vector(features)
    if vector is None:
        raise ValueError(f"score_vector called with missing fields: {missing}")
    probability = float(model.predict_proba(scaler.transform(np.array([vector])))[0, 1])
    thresholds = metadata.get("risk_tier_thresholds", {})
    if probability <= thresholds.get("low_max", 0.33):
        tier = "Low"
    elif probability <= thresholds.get("moderate_max", 0.66):
        tier = "Moderate"
    else:
        tier = "High"
    return probability, tier


@dataclass
class XGBoostPredictionResult:
    model: str = "xgboost"
    model_version: str = ""
    status: str = "not_scored"
    prediction: int | None = None
    score: float | None = None
    risk_tier: str | None = None
    features_used: list[str] = field(default_factory=list)
    unavailable_reason: str | None = None
    disclaimer: str = DISCLAIMER

    def to_dict(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "model_version": self.model_version,
            "status": self.status,
            "prediction": self.prediction,
            "score": self.score,
            "risk_tier": self.risk_tier,
            "features_used": self.features_used,
            "unavailable_reason": self.unavailable_reason,
            "disclaimer": self.disclaimer,
        }


class XGBoostPredictionService:
    """Feature-order-safe wrapper around score_vector(), returning the
    richer response shape described in docs/ML.md (Phase 3 Step 12/13)."""

    def predict(self, state: dict[str, Any]) -> XGBoostPredictionResult:
        _, _, metadata = _load_artifacts()
        model_version = metadata.get("model_version", "unknown")
        expected_features = metadata.get("feature_columns", [])

        vector, missing = _resolve_feature_vector(state)
        if vector is None:
            readable = [k.replace("_", " ") for k in missing if k not in ("sex", "age_bucket")]
            return XGBoostPredictionResult(
                model_version=model_version,
                status="unavailable_for_profile",
                unavailable_reason=(
                    "The XGBoost candidate model needs all of its trained inputs. "
                    f"Missing measurement(s): {', '.join(sorted(readable)) if readable else 'sex or age'}."
                ),
            )

        probability, tier = score_vector(state)
        return XGBoostPredictionResult(
            model_version=model_version,
            status="scored",
            prediction=int(probability >= 0.5),
            score=round(probability, 4),
            risk_tier=tier,
            features_used=list(expected_features),
        )
