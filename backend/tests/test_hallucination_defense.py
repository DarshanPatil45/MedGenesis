"""Phase 7 Step 20-23: hallucination defense expansion beyond Evidence IDs
(Phase 6). Tests the two new validators directly and end-to-end through
ClinicalAnalysisAgent.run() with a mocked LLM — never a live model.
"""

from __future__ import annotations

import app.services.llm as llm_module
from app.agents.clinical_agent import (
    SCORE_TOLERANCE,
    _validate_model_name_claims,
    _validate_numeric_score_claims,
    get_clinical_agent,
)

FULL_STATE = {
    "sex": "female", "age": 52, "high_bp": 1, "high_chol": 0, "chol_check": 1,
    "bmi": 29.0, "smoker": 0, "stroke": 0, "heart_disease_or_attack": 0,
    "phys_activity": 1, "fruits": 1, "veggies": 1, "hvy_alcohol_consump": 0,
    "any_healthcare": 1, "no_doc_bc_cost": 0, "gen_hlth": 3, "ment_hlth": 2,
    "phys_hlth": 3, "diff_walk": 0, "education": 5, "income": 6,
}


class TestModelNameValidation:
    def test_xgboost_mention_flagged_when_not_included(self):
        flags = _validate_model_name_claims("The XGBoost model found elevated risk.", xgboost_included=False)
        assert flags
        assert "XGBoost" in flags[0]

    def test_xgboost_mention_not_flagged_when_included(self):
        assert _validate_model_name_claims("The XGBoost model found elevated risk.", xgboost_included=True) == []

    def test_randomforest_mention_never_flagged(self):
        """RandomForest is always actually run by this agent — a mention
        of it is never a hallucination regardless of any flag."""
        assert _validate_model_name_claims("The RandomForest model found elevated risk.", xgboost_included=False) == []

    def test_case_insensitive_match(self):
        assert _validate_model_name_claims("the xgboost candidate assigned a score", xgboost_included=False)

    def test_no_model_names_mentioned_no_flags(self):
        assert _validate_model_name_claims("Blood pressure is elevated for this patient.", xgboost_included=False) == []


class TestNumericScoreValidation:
    ACTUAL = 0.8255  # the worked example from the Phase 7 spec

    def test_reasonable_rounding_accepted(self):
        assert _validate_numeric_score_claims(f"The model assigned a score of 0.83.", {self.ACTUAL}) == []

    def test_matching_percent_form_accepted(self):
        assert _validate_numeric_score_claims("The probability of 83% was assigned.", {self.ACTUAL}) == []

    def test_fabricated_value_flagged(self):
        flags = _validate_numeric_score_claims("The model assigned a score of 0.99.", {self.ACTUAL})
        assert flags
        assert "0.99" in flags[0]

    def test_tolerance_boundary_is_respected(self):
        # Kept clear of the exact tolerance boundary deliberately — testing
        # float equality at a razor's edge is fragile (formatting a value
        # to 4 decimal places and re-parsing it can land a hair outside the
        # true boundary due to binary floating-point rounding, independent
        # of whether the tolerance logic itself is correct).
        just_inside = self.ACTUAL + SCORE_TOLERANCE * 0.5
        just_outside = self.ACTUAL + SCORE_TOLERANCE * 3
        assert _validate_numeric_score_claims(f"score of {just_inside:.4f}", {self.ACTUAL}) == []
        assert _validate_numeric_score_claims(f"score of {just_outside:.4f}", {self.ACTUAL})

    def test_unrelated_numbers_not_near_trigger_phrase_are_ignored(self):
        """BMI/age/other numbers quoted elsewhere in the text are not
        score claims and must not be flagged — the whole reason this
        check is scoped to trigger phrases (docs/CLINICAL_ANALYSIS.md)."""
        text = "The patient is 52 years old with a BMI of 29.0. The model assigned a score of 0.83."
        assert _validate_numeric_score_claims(text, {self.ACTUAL}) == []

    def test_no_known_scores_means_nothing_can_be_flagged(self):
        """If no real score was ever computed, there is nothing to verify
        against — the validator must not treat every number as suspicious."""
        assert _validate_numeric_score_claims("The model assigned a score of 0.99.", set()) == []

    def test_multiple_known_scores_each_checked_independently(self):
        known = {0.59, 0.83}
        assert _validate_numeric_score_claims("RandomForest: score of 0.59. XGBoost: score of 0.83.", known) == []
        assert _validate_numeric_score_claims("RandomForest: score of 0.59. XGBoost: score of 0.12.", known)


class TestEndToEndThroughRun:
    def test_fabricated_score_is_flagged_not_silently_accepted(self, monkeypatch):
        def fake_generate(system_prompt, user_prompt):
            return "The model assigned a score of 0.99, indicating very high confidence."

        monkeypatch.setattr(llm_module.LLMRouter, "generate", lambda self, *a, **kw: fake_generate(*a, **kw))
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", use_llm=True)
        assert any("does not match any score" in f for f in result.safety_flags)

    def test_accurate_score_produces_no_numeric_flag(self, monkeypatch):
        from app.agents.screening_agent import get_screening_agent

        real_probability = get_screening_agent().run(FULL_STATE).risk_probability

        def fake_generate(system_prompt, user_prompt):
            return f"The model assigned a score of {real_probability:.2f}, a moderate result."

        monkeypatch.setattr(llm_module.LLMRouter, "generate", lambda self, *a, **kw: fake_generate(*a, **kw))
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", use_llm=True)
        assert not any("does not match any score" in f for f in result.safety_flags)

    def test_hallucinated_xgboost_mention_is_flagged_when_comparison_not_requested(self, monkeypatch):
        def fake_generate(system_prompt, user_prompt):
            return "Both RandomForest and XGBoost agree on an elevated risk."

        monkeypatch.setattr(llm_module.LLMRouter, "generate", lambda self, *a, **kw: fake_generate(*a, **kw))
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", include_model_comparison=False, use_llm=True)
        assert any("XGBoost" in f and "not included" in f for f in result.safety_flags)

    def test_legitimate_xgboost_mention_not_flagged_when_comparison_requested(self, monkeypatch):
        def fake_generate(system_prompt, user_prompt):
            return "Both RandomForest and XGBoost were considered for this patient."

        monkeypatch.setattr(llm_module.LLMRouter, "generate", lambda self, *a, **kw: fake_generate(*a, **kw))
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", include_model_comparison=True, use_llm=True)
        assert not any("hallucinated model reference" in f for f in result.safety_flags)

    def test_flags_never_silently_swallowed_they_reach_the_api_response(self, client, eligible_patient, monkeypatch):
        def fake_generate(system_prompt, user_prompt):
            return "The model assigned a score of 0.99."

        monkeypatch.setattr(llm_module.LLMRouter, "generate", lambda self, *a, **kw: fake_generate(*a, **kw))
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "diabetes risk"},
        )
        body = resp.json()
        assert any("does not match any score" in f for f in body["safety_flags"])
