"""Screening Risk Baseline Agent.

SCOPE (docs/ARCHITECTURE.md §4.3): an EDUCATIONAL SCREENING-RISK BASELINE
only. Not a clinical or general Type 2 Diabetes management/diagnostic
predictor. Every response carries scope="educational_screening_only".

DATASET (see docs/ARCHITECTURE.md §13.7): trained on the CDC's 2015 BRFSS
Diabetes Health Indicators survey — a general US adult population, not
restricted to one demographic group. That's a deliberate change from this
project's original Pima-based model, which was trained exclusively on women
of Pima Heritage and hard-gated eligibility on sex + a pregnancies value.
BRFSS carries no equivalent population restriction, so that gate is gone.

ELIGIBILITY is now purely a DATA-COMPLETENESS check: the model needs all 21
trained features, and if any are missing the agent refuses to guess rather
than substitute a value and produce a confident-looking, meaningless score —
the same principle as before, just applied on a different, honest basis.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np

ARTIFACT_DIR = Path(__file__).resolve().parents[1] / "ml" / "artifacts"

EDUCATIONAL_SCOPE = "educational_screening_only"
STATUS_SCORED = "scored"
STATUS_UNAVAILABLE = "unavailable_for_profile"

# Maps twin-state keys (snake_case, as stored in timeline event payloads) to
# the model's training feature names (BRFSS's original PascalCase), in the
# exact column order used at fit time — order matters, the model takes a
# positional array. `sex` is derived from Patient.sex ("female"/"male" ->
# 0/1) rather than stored as a duplicate twin-state field.
FEATURE_KEY_MAP = [
    ("high_bp", "HighBP"),
    ("high_chol", "HighChol"),
    ("chol_check", "CholCheck"),
    ("bmi", "BMI"),
    ("smoker", "Smoker"),
    ("stroke", "Stroke"),
    ("heart_disease_or_attack", "HeartDiseaseorAttack"),
    ("phys_activity", "PhysActivity"),
    ("fruits", "Fruits"),
    ("veggies", "Veggies"),
    ("hvy_alcohol_consump", "HvyAlcoholConsump"),
    ("any_healthcare", "AnyHealthcare"),
    ("no_doc_bc_cost", "NoDocbcCost"),
    ("gen_hlth", "GenHlth"),
    ("ment_hlth", "MentHlth"),
    ("phys_hlth", "PhysHlth"),
    ("diff_walk", "DiffWalk"),
    ("sex", "Sex"),
    ("age_bucket", "Age"),
    ("education", "Education"),
    ("income", "Income"),
]

# BRFSS codes age into 13 five-year buckets rather than recording raw years;
# the app collects real age (used elsewhere — care-plan rules, intake forms)
# and converts it here. Bucket 13 is an open-ended "80+".
AGE_BUCKET_MAX_YEARS = (24, 29, 34, 39, 44, 49, 54, 59, 64, 69, 74, 79)


def age_to_brfss_bucket(age: int) -> int:
    for bucket, max_years in enumerate(AGE_BUCKET_MAX_YEARS, start=1):
        if age <= max_years:
            return bucket
    return 13


SEX_TO_CODE = {"female": 0.0, "male": 1.0}

DISCLAIMER = (
    "Educational screening-risk baseline only, trained on 2015 CDC BRFSS self-reported "
    "survey data. Not a diagnostic tool. Self-reported survey data carries its own biases "
    "(recall accuracy, non-response, telephone-survey coverage)."
)


@dataclass
class ScreeningResult:
    status: str
    scope: str = EDUCATIONAL_SCOPE
    disclaimer: str = DISCLAIMER
    risk_probability: float | None = None
    risk_tier: str | None = None
    unavailable_reason: str | None = None
    top_features: dict[str, float] = field(default_factory=dict)
    model_version: str = ""
    summary_text: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "scope": self.scope,
            "disclaimer": self.disclaimer,
            "risk_probability": self.risk_probability,
            "risk_tier": self.risk_tier,
            "unavailable_reason": self.unavailable_reason,
            "top_features": self.top_features,
            "model_version": self.model_version,
            "summary_text": self.summary_text,
        }


class ModelArtifactsMissing(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _load_artifacts():
    model_path = ARTIFACT_DIR / "screening_model.joblib"
    scaler_path = ARTIFACT_DIR / "screening_scaler.joblib"
    meta_path = ARTIFACT_DIR / "screening_model_metadata.json"
    if not model_path.exists():
        raise ModelArtifactsMissing(
            f"Screening model artifacts not found in {ARTIFACT_DIR}. "
            "Run: python -m app.ml.train_screening_model"
        )
    with open(meta_path) as f:
        metadata = json.load(f)
    return joblib.load(model_path), joblib.load(scaler_path), metadata


def _resolve_feature_vector(state: dict[str, Any]) -> tuple[list[float] | None, list[str]]:
    """Builds the ordered feature vector from twin state, or reports which
    fields are missing rather than guessing at them."""
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


def check_eligibility(state: dict[str, Any]) -> tuple[bool, str | None]:
    """Returns (eligible, reason_if_not). See the module docstring for why
    this is a data-completeness check, not a population restriction."""
    if (state.get("sex") or "").lower() not in SEX_TO_CODE:
        return False, (
            "The screening model requires a recorded sex (female/male) to compute one of its "
            f"trained features. This patient's recorded sex is '{state.get('sex')}', which the "
            "model has no encoding for, so no screening score is produced for this profile."
        )
    if state.get("age") is None:
        return False, "The screening model requires a recorded age. No value is on file for this patient."

    _, missing = _resolve_feature_vector(state)
    if missing:
        readable = [k.replace("_", " ") for k in missing if k not in ("sex", "age_bucket")]
        if readable:
            return False, (
                "The screening model needs all of its trained inputs. Missing measurement(s): "
                f"{', '.join(sorted(readable))}. Add these to the patient's timeline to enable screening."
            )
    return True, None


def risk_tier_for(probability: float, thresholds: dict[str, float]) -> str:
    if probability <= thresholds.get("low_max", 0.33):
        return "Low"
    if probability <= thresholds.get("moderate_max", 0.66):
        return "Moderate"
    return "High"


class ScreeningAgent:
    """Wraps the trained baseline. `run()` takes a materialized twin state
    (from app.services.twin.get_current_state) so the agent never touches
    the database itself."""

    name = "ScreeningRiskBaselineAgent"

    def run(self, state: dict[str, Any]) -> ScreeningResult:
        eligible, reason = check_eligibility(state)
        if not eligible:
            return ScreeningResult(
                status=STATUS_UNAVAILABLE,
                unavailable_reason=reason,
                summary_text="Screening model unavailable for this profile. " + (reason or ""),
            )

        model, scaler, metadata = _load_artifacts()
        vector, _ = _resolve_feature_vector(state)
        probability = float(model.predict_proba(scaler.transform(np.array([vector])))[0, 1])
        tier = risk_tier_for(probability, metadata.get("risk_tier_thresholds", {}))

        importances: dict[str, float] = metadata.get("feature_importances", {})
        top_features = dict(list(importances.items())[:5])

        return ScreeningResult(
            status=STATUS_SCORED,
            risk_probability=round(probability, 4),
            risk_tier=tier,
            top_features=top_features,
            model_version=metadata.get("model_version", "unknown"),
            summary_text=(
                f"Educational screening-risk baseline: {tier} tier "
                f"({probability:.0%} model probability). Top contributing features in the "
                f"trained model: {', '.join(top_features)}."
            ),
        )

    def score_vector(self, features: dict[str, Any]) -> tuple[float, str]:
        """Scores a raw feature dict without the eligibility gate — used only
        by the What-if Agent for projected points, which gates eligibility
        once against the real profile before projecting anything."""
        model, scaler, metadata = _load_artifacts()
        vector, missing = _resolve_feature_vector(features)
        if vector is None:
            raise ValueError(f"score_vector called with missing fields: {missing}")
        probability = float(model.predict_proba(scaler.transform(np.array([vector])))[0, 1])
        return probability, risk_tier_for(probability, metadata.get("risk_tier_thresholds", {}))


_agent: ScreeningAgent | None = None


def get_screening_agent() -> ScreeningAgent:
    global _agent
    if _agent is None:
        _agent = ScreeningAgent()
    return _agent
