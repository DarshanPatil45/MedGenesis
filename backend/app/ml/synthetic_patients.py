"""Synthetic demo patients with multi-timepoint histories.

Entirely fictional — no real patient data, ever. Baselines are tuned against
the actually-trained model (see docs/ARCHITECTURE.md §13.7) so the three
profiles land in visibly different risk tiers, rather than guessed at.

Three profiles ship deliberately:
  - two SCREENING-ELIGIBLE profiles at different risk tiers, and
  - one with an INCOMPLETE recorded history, to exercise the "screening
    unavailable" refusal path. Note what changed from this project's
    original Pima-based demo set: that profile used to be ineligible because
    of *sex* (Pima's model only applies to women). The current model has no
    such population restriction (see app/models/patient.py), so the
    ineligibility path is now demonstrated with a data-completeness gap
    instead — a designed behaviour, not hidden as an error either way.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.patient import Patient
from app.services import twin as twin_service

DEMO_PROFILES: dict[str, dict[str, Any]] = {
    "lower_risk": {
        "pseudonym": "Demo Patient A (lower risk)",
        "age": 27,
        "sex": "female",
        "baseline": {
            "high_bp": 0, "high_chol": 0, "chol_check": 1, "bmi": 22.0,
            "smoker": 0, "stroke": 0, "heart_disease_or_attack": 0,
            "phys_activity": 1, "fruits": 1, "veggies": 1, "hvy_alcohol_consump": 0,
            "any_healthcare": 1, "no_doc_bc_cost": 0, "gen_hlth": 1,
            "ment_hlth": 0, "phys_hlth": 0, "diff_walk": 0,
            "education": 6, "income": 7,
            "height_m": 1.65, "weight_kg": 59.9,
        },
    },
    "moderate_risk": {
        "pseudonym": "Demo Patient B (moderate risk)",
        "age": 52,
        "sex": "female",
        "baseline": {
            "high_bp": 1, "high_chol": 0, "chol_check": 1, "bmi": 29.0,
            "smoker": 0, "stroke": 0, "heart_disease_or_attack": 0,
            "phys_activity": 1, "fruits": 1, "veggies": 1, "hvy_alcohol_consump": 0,
            "any_healthcare": 1, "no_doc_bc_cost": 0, "gen_hlth": 3,
            "ment_hlth": 2, "phys_hlth": 3, "diff_walk": 0,
            "education": 5, "income": 6,
            "height_m": 1.65, "weight_kg": 79.0,
        },
    },
    "incomplete_history": {
        "pseudonym": "Demo Patient C (incomplete history)",
        "age": 63,
        "sex": "male",
        "baseline": {
            # Deliberately omits a few required fields (no_doc_bc_cost,
            # education, income) to exercise the missing-data refusal path —
            # everything present is realistic for an older, higher-risk
            # profile, it's just an incomplete intake.
            "high_bp": 1, "high_chol": 1, "chol_check": 1, "bmi": 34.0,
            "smoker": 1, "stroke": 0, "heart_disease_or_attack": 0,
            "phys_activity": 0, "fruits": 0, "veggies": 1, "hvy_alcohol_consump": 0,
            "any_healthcare": 1, "gen_hlth": 4,
            "ment_hlth": 5, "phys_hlth": 8, "diff_walk": 1,
            "height_m": 1.78, "weight_kg": 107.7,
        },
    },
}

# Fields that trend over time, with noise expressed as a FRACTION of each
# field's own value — an absolute noise term doesn't work across fields at
# very different scales (BMI ~20-40 vs. days-of-poor-health 0-30).
DRIFT_NOISE_FRACTION = {
    "bmi": 0.02,
    "weight_kg": 0.008,
    "ment_hlth": 0.15,
    "phys_hlth": 0.15,
}
TOTAL_DRIFT = 0.06  # oldest reading sits ~6% below the current value, for drifting fields
# Binary/categorical fields are recorded as-is at every visit rather than
# drifted — flipping a survey yes/no answer or a health-status bucket by a
# fractional "noise" amount has no sensible interpretation.
STATIC_FIELDS = (
    "high_bp", "high_chol", "chol_check", "smoker", "stroke",
    "heart_disease_or_attack", "phys_activity", "fruits", "veggies",
    "hvy_alcohol_consump", "any_healthcare", "no_doc_bc_cost", "gen_hlth",
    "diff_walk", "education", "income", "height_m",
)


def create_demo_patient(
    db: Session,
    profile_key: str = "moderate_risk",
    months_of_history: int = 6,
    seed: int | None = 42,
) -> Patient:
    if profile_key not in DEMO_PROFILES:
        raise ValueError(f"Unknown profile {profile_key!r}; expected one of {list(DEMO_PROFILES)}")
    profile = DEMO_PROFILES[profile_key]
    rng = random.Random(seed)

    patient = Patient(
        pseudonym=profile["pseudonym"],
        age=profile["age"],
        sex=profile["sex"],
        is_synthetic=True,
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)

    baseline = dict(profile["baseline"])
    now = datetime.now(timezone.utc)

    # Oldest first so the append-only log reads chronologically and the
    # materialized "latest value wins" fold lands on the most recent visit.
    for months_ago in range(months_of_history, -1, -1):
        recorded_at = now - timedelta(days=30 * months_ago)
        drift_scale = months_ago / max(months_of_history, 1)
        measurement = {}
        for key, value in baseline.items():
            if key in DRIFT_NOISE_FRACTION:
                noise = DRIFT_NOISE_FRACTION[key]
                drifted = value * (1 - TOTAL_DRIFT * drift_scale) * (1 + rng.uniform(-noise, noise))
                measurement[key] = max(0.0, round(drifted, 2))
            else:
                measurement[key] = value

        # BMI is derived from the drifted weight, not drifted independently
        # — the two must stay consistent (BMI = kg / m²), same reasoning as
        # the What-if Agent's own weight->BMI conversion.
        height_m = measurement.get("height_m")
        if "bmi" in baseline and measurement.get("weight_kg") and height_m:
            measurement["bmi"] = round(measurement["weight_kg"] / height_m**2, 2)

        twin_service.append_event(
            db,
            patient_id=patient.id,
            event_type="measurement",
            payload=measurement,
            source="synthetic",
            recorded_at=recorded_at,
        )

    return patient
