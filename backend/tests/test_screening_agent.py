"""Eligibility gating is the correctness constraint that matters most for
this agent. Since the project switched to the CDC BRFSS dataset (see
docs/ARCHITECTURE.md §13.7), eligibility is a DATA-COMPLETENESS check rather
than a population restriction — refusing to score with incomplete inputs is
the correct behaviour, not a failure."""

import pytest

from app.agents.screening_agent import (
    STATUS_SCORED,
    STATUS_UNAVAILABLE,
    ScreeningAgent,
    age_to_brfss_bucket,
    check_eligibility,
    risk_tier_for,
)

FULL_STATE = {
    "sex": "female",
    "age": 52,
    "high_bp": 1, "high_chol": 0, "chol_check": 1, "bmi": 29.0,
    "smoker": 0, "stroke": 0, "heart_disease_or_attack": 0,
    "phys_activity": 1, "fruits": 1, "veggies": 1, "hvy_alcohol_consump": 0,
    "any_healthcare": 1, "no_doc_bc_cost": 0, "gen_hlth": 3,
    "ment_hlth": 2, "phys_hlth": 3, "diff_walk": 0,
    "education": 5, "income": 6,
}


def test_eligible_with_all_features():
    eligible, reason = check_eligibility(FULL_STATE)
    assert eligible and reason is None


@pytest.mark.parametrize("sex", ["female", "male"])
def test_female_and_male_are_both_eligible(sex):
    """Unlike the project's original Pima-based model, this dataset is not
    restricted to one sex — BRFSS surveys the general adult population."""
    eligible, reason = check_eligibility({**FULL_STATE, "sex": sex})
    assert eligible and reason is None


@pytest.mark.parametrize("sex", ["other", "unspecified", None])
def test_unencoded_sex_is_ineligible(sex):
    """The real constraint: BRFSS's Sex question was coded as binary with no
    other option recorded, so the trained model has no encoding for
    anything else — a genuine data limitation, not an arbitrary gate."""
    eligible, reason = check_eligibility({**FULL_STATE, "sex": sex})
    assert not eligible
    assert "sex" in reason.lower()


def test_missing_age_is_ineligible():
    state = {**FULL_STATE, "age": None}
    eligible, reason = check_eligibility(state)
    assert not eligible
    assert "age" in reason.lower()


def test_missing_measurement_is_ineligible():
    state = {**FULL_STATE, "bmi": None}
    eligible, reason = check_eligibility(state)
    assert not eligible
    assert "bmi" in reason.lower()


def test_multiple_missing_measurements_all_named():
    state = {**FULL_STATE, "bmi": None, "smoker": None}
    eligible, reason = check_eligibility(state)
    assert not eligible
    assert "bmi" in reason.lower() and "smoker" in reason.lower()


def test_agent_scores_eligible_profile():
    result = ScreeningAgent().run(FULL_STATE)
    assert result.status == STATUS_SCORED
    assert 0.0 <= result.risk_probability <= 1.0
    assert result.risk_tier in ("Low", "Moderate", "High")
    assert result.scope == "educational_screening_only"
    assert result.disclaimer


def test_agent_refuses_incomplete_profile_rather_than_guessing():
    result = ScreeningAgent().run({**FULL_STATE, "bmi": None})
    assert result.status == STATUS_UNAVAILABLE
    assert result.risk_probability is None
    assert result.risk_tier is None
    assert result.unavailable_reason
    assert result.scope == "educational_screening_only"


def test_scope_marker_always_present():
    for state in (FULL_STATE, {**FULL_STATE, "sex": "other"}):
        assert ScreeningAgent().run(state).to_dict()["scope"] == "educational_screening_only"


@pytest.mark.parametrize(
    "probability,expected",
    [(0.0, "Low"), (0.33, "Low"), (0.34, "Moderate"), (0.66, "Moderate"), (0.67, "High"), (1.0, "High")],
)
def test_risk_tier_thresholds(probability, expected):
    assert risk_tier_for(probability, {"low_max": 0.33, "moderate_max": 0.66}) == expected


@pytest.mark.parametrize(
    "age,expected_bucket",
    [(18, 1), (24, 1), (25, 2), (44, 5), (45, 6), (64, 9), (65, 10), (80, 13), (95, 13)],
)
def test_age_to_brfss_bucket(age, expected_bucket):
    assert age_to_brfss_bucket(age) == expected_bucket


def test_higher_bmi_and_worse_gen_hlth_increase_risk():
    """Sanity check that the served model is monotonic in the directions a
    clinician would expect — the same discipline that caught a leaky earlier
    model (see docs/LEAKAGE.md) and a broken RAG similarity metric."""
    agent = ScreeningAgent()
    low, _ = agent.score_vector({**FULL_STATE, "bmi": 22.0, "gen_hlth": 1, "high_bp": 0})
    high, _ = agent.score_vector({**FULL_STATE, "bmi": 38.0, "gen_hlth": 5, "high_bp": 1})
    assert high > low


def test_served_model_metadata_matches_current_dataset():
    import json
    from pathlib import Path

    meta_path = (
        Path(__file__).resolve().parents[1] / "app" / "ml" / "artifacts" / "screening_model_metadata.json"
    )
    metadata = json.loads(meta_path.read_text())
    assert "BRFSS" in metadata["source_dataset"]
    assert metadata["test_metrics"]["roc_auc"] > 0.70
