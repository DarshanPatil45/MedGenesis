"""Direct tests for the Clinical Analysis Agent (Phase 6,
docs/CLINICAL_ANALYSIS.md) — composition, grounding, and non-diagnostic/
non-prescriptive constraints. No live LLM dependency: the LLM service is
mocked where its behavior matters (hallucination defense); everything else
runs the deterministic path (use_llm=False), matching the rest of this
project's established testing convention (ConversationalAgent/CarePlanAgent
tests never require a reachable LLM either).
"""

from __future__ import annotations

import app.services.llm as llm_module
from app.agents.clinical_agent import (
    CLAIM_EVIDENCE_SUPPORTED,
    CLAIM_INFERENCE,
    CLAIM_MODEL_OBSERVATION,
    CLAIM_PATIENT_OBSERVATION,
    CLAIM_TYPES,
    CLAIM_UNCERTAINTY,
    ClinicalClaim,
    _split_into_claims,
    _validate_citations,
    get_clinical_agent,
)

FULL_STATE = {
    "sex": "female", "age": 52, "high_bp": 1, "high_chol": 0, "chol_check": 1,
    "bmi": 29.0, "smoker": 0, "stroke": 0, "heart_disease_or_attack": 0,
    "phys_activity": 1, "fruits": 1, "veggies": 1, "hvy_alcohol_consump": 0,
    "any_healthcare": 1, "no_doc_bc_cost": 0, "gen_hlth": 3, "ment_hlth": 2,
    "phys_hlth": 3, "diff_walk": 0, "education": 5, "income": 6,
}
INCOMPLETE_STATE = {**FULL_STATE, "bmi": None}


class TestValidAnalysis:
    def test_returns_analyzed_status(self):
        result = get_clinical_agent().run(FULL_STATE, "What is relevant to this patient's diabetes risk?", use_llm=False)
        assert result.status == "analyzed"

    def test_model_analysis_contains_rf_observation(self):
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", use_llm=False)
        assert any("RandomForest" in c.claim for c in result.model_analysis)
        assert all(c.claim_type == CLAIM_MODEL_OBSERVATION for c in result.model_analysis if "RandomForest" in c.claim)

    def test_production_risk_tier_is_set(self):
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", use_llm=False)
        assert result.production_risk_tier in ("Low", "Moderate", "High")

    def test_scope_is_educational(self):
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", use_llm=False)
        assert result.scope == "educational_screening_only"


class TestEmptyOrMinimalQuestion:
    def test_generic_question_falls_back_to_top_model_features(self):
        """No concept keywords match -> falls back to the RF's own real
        top feature importances, never an invented default list."""
        result = get_clinical_agent().run(FULL_STATE, "tell me about this patient", use_llm=False)
        assert result.status == "analyzed"
        # Should have picked up at least one of the RF's genuinely
        # top-ranked features (GenHlth/HighBP/BMI/HighChol/Age).
        claimed_fields = " ".join(c.claim for c in result.patient_summary)
        assert any(f in claimed_fields for f in ("blood pressure", "BMI", "cholesterol", "general health"))


class TestMissingPatientData:
    def test_incomplete_profile_reports_uncertainty_not_a_crash(self):
        result = get_clinical_agent().run(INCOMPLETE_STATE, "diabetes risk", use_llm=False)
        assert result.status == "analyzed"  # composite analysis, doesn't refuse outright
        assert any("missing patient data" in u.lower() for u in result.uncertainties)
        assert any(c.claim_type == CLAIM_UNCERTAINTY for c in result.model_analysis)

    def test_never_infers_a_missing_value(self):
        result = get_clinical_agent().run(INCOMPLETE_STATE, "what is this patient's BMI?", use_llm=False)
        claimed_text = " ".join(c.claim for c in result.patient_summary)
        assert "bmi: none" not in claimed_text.lower()
        assert "Recorded BMI" not in claimed_text  # bmi is None -> simply omitted, not guessed


class TestModelOutputIntegration:
    def test_xgboost_only_included_when_requested(self):
        without = get_clinical_agent().run(FULL_STATE, "diabetes risk", include_model_comparison=False, use_llm=False)
        with_xgb = get_clinical_agent().run(FULL_STATE, "diabetes risk", include_model_comparison=True, use_llm=False)
        assert not any("XGBoost" in c.claim for c in without.model_analysis)
        assert any("XGBoost" in c.claim for c in with_xgb.model_analysis)

    def test_xgboost_labelled_as_candidate_not_production(self):
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", include_model_comparison=True, use_llm=False)
        xgb_score_claims = [c for c in result.model_analysis if "assigned a score of" in c.claim and "XGBoost" in c.claim]
        assert xgb_score_claims
        assert all("not the production model" in c.claim for c in xgb_score_claims)

    def test_per_patient_shap_contribution_present(self):
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", include_model_comparison=True, use_llm=False)
        assert any("MODEL FEATURE CONTRIBUTIONS" in c.claim and "SHAP" in c.claim for c in result.model_analysis)

    def test_model_comparison_metrics_are_the_precomputed_ones_not_recomputed(self):
        from app.ml import model_comparison

        expected = model_comparison.compare()
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", include_model_comparison=True, use_llm=False)
        comparison_claims = [c for c in result.model_analysis if "fixed historical test set" in c.claim]
        assert comparison_claims
        assert str(expected["n_test"]) in comparison_claims[0].claim

    def test_score_never_phrased_as_a_patient_probability(self):
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", use_llm=False)
        for c in result.model_analysis:
            assert "% chance of developing" not in c.claim
            assert "patient has a" not in c.claim.lower()


class TestConflictingModelOutputs:
    def test_disagreeing_tiers_produce_uncertainty_claim(self, monkeypatch):
        from app.agents import clinical_agent as ca_module

        def fake_xgb_claims(twin_state):
            return (
                [ClinicalClaim("The XGBoost candidate model (not the production model) assigned a score of 0.9 (High tier).", CLAIM_MODEL_OBSERVATION)],
                "fake-version",
                "High",
                0.9,
            )

        monkeypatch.setattr(ca_module, "_xgboost_model_claims", fake_xgb_claims)
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", include_model_comparison=True, use_llm=False)
        assert result.production_risk_tier != "High"  # sanity: a real disagreement exists
        assert any(
            c.claim_type == CLAIM_UNCERTAINTY and "different risk tiers" in c.claim for c in result.model_analysis
        )
        assert any("neither model is clinically validated" in c.claim for c in result.model_analysis)


class TestEvidenceIntegration:
    def test_evidence_included_by_default(self):
        result = get_clinical_agent().run(FULL_STATE, "healthy eating and diet", use_llm=False)
        assert result.evidence_findings
        assert result.citations

    def test_evidence_excluded_when_not_requested(self):
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", include_evidence=False, use_llm=False)
        assert result.evidence_findings == []
        assert result.citations == []

    def test_no_relevant_evidence_produces_explicit_uncertainty(self, monkeypatch):
        """The evidence query is always prefixed with real diabetes-risk
        vocabulary (docs/CLINICAL_ANALYSIS.md), so a literally-empty
        retrieval result is exercised directly here rather than via a
        query that happens to find nothing."""
        from app.agents import clinical_agent as ca_module

        monkeypatch.setattr(ca_module.get_evidence_agent(), "retrieve", lambda *a, **kw: [])
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", use_llm=False)
        assert result.evidence_findings == []
        assert any("no sufficiently relevant evidence" in u.lower() for u in result.uncertainties)

    def test_citations_use_format_citation_block_style(self):
        result = get_clinical_agent().run(FULL_STATE, "healthy eating and diet", use_llm=False)
        assert all(c.startswith("[E") for c in result.citations)


class TestPubMedIntegration:
    def test_pubmed_not_called_unless_requested(self, monkeypatch):
        import app.services.pubmed as pubmed_module

        calls = []

        class _Tracker:
            name = "tracker"

            def search(self, query, max_results=5):
                calls.append(query)
                return []

        monkeypatch.setattr(pubmed_module, "_client", _Tracker())
        get_clinical_agent().run(FULL_STATE, "diabetes risk", include_pubmed=False, use_llm=False)
        assert calls == []

    def test_pubmed_requested_uses_source_all(self, monkeypatch):
        import app.services.pubmed as pubmed_module

        calls = []

        class _Tracker:
            name = "tracker"

            def search(self, query, max_results=5):
                calls.append(query)
                return []

        monkeypatch.setattr(pubmed_module, "_client", _Tracker())
        get_clinical_agent().run(FULL_STATE, "diabetes risk", include_pubmed=True, use_llm=False)
        assert calls  # PubMed was actually queried this time


class TestStructuredResponse:
    def test_to_dict_has_expected_top_level_keys(self):
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", use_llm=False)
        d = result.to_dict()
        assert set(d) == {
            "status", "question", "scope", "patient_summary", "model_analysis", "evidence_findings",
            "simulation", "integrated_analysis", "uncertainties", "citations", "safety_flags",
            "unavailable_reason", "generated_by", "production_risk_tier",
        }

    def test_all_claim_types_come_from_the_closed_vocabulary(self):
        result = get_clinical_agent().run(
            FULL_STATE, "healthy eating diabetes risk", include_model_comparison=True, use_llm=False
        )
        all_claims = result.patient_summary + result.model_analysis + result.integrated_analysis
        for c in all_claims:
            assert c.claim_type in CLAIM_TYPES


class TestGrounding:
    def test_patient_observation_claims_need_no_evidence_ids(self):
        result = get_clinical_agent().run(FULL_STATE, "blood pressure", use_llm=False)
        for c in result.patient_summary:
            assert c.claim_type == CLAIM_PATIENT_OBSERVATION
            assert c.evidence_ids == []

    def test_deterministic_inference_claim_cites_evidence_when_present(self):
        result = get_clinical_agent().run(FULL_STATE, "healthy eating and diet", use_llm=False)
        assert result.integrated_analysis
        assert result.integrated_analysis[0].claim_type == CLAIM_INFERENCE
        assert result.integrated_analysis[0].evidence_ids  # points at the retrieved evidence


class TestHallucinationDefense:
    def test_unknown_evidence_id_is_stripped_and_flagged(self):
        text = "Elevated BP is a risk factor [E1]. Some other claim [E99]."
        cleaned, flags = _validate_citations(text, {"E1", "E2"})
        assert "[E99]" not in cleaned
        assert "[E1]" in cleaned
        assert any("E99" in f for f in flags)

    def test_known_evidence_id_survives_validation(self):
        text = "Claim grounded in [E1] and [E2]."
        cleaned, flags = _validate_citations(text, {"E1", "E2"})
        assert cleaned == text
        assert flags == []

    def test_llm_reply_with_fabricated_citation_is_flagged_end_to_end(self, monkeypatch):
        """Full pipeline test: a mocked LLM tries to cite an evidence ID
        that was never supplied — the agent must catch it, not the LLM."""

        def fake_generate(system_prompt, user_prompt):
            return "This patient's risk is associated with several factors [E1] and also [E404]."

        monkeypatch.setattr(llm_module.LLMRouter, "generate", lambda self, *a, **kw: fake_generate(*a, **kw))
        result = get_clinical_agent().run(FULL_STATE, "healthy eating and diet", use_llm=True)
        rendered = " ".join(c.claim for c in result.integrated_analysis)
        assert "[E404]" not in rendered
        assert result.safety_flags
        assert any("E404" in f for f in result.safety_flags)

    def test_sentences_citing_real_evidence_are_evidence_supported_type(self, monkeypatch):
        def fake_generate(system_prompt, user_prompt):
            return "Physical activity is associated with lower risk [E1]. This is a bounded synthesis."

        monkeypatch.setattr(llm_module.LLMRouter, "generate", lambda self, *a, **kw: fake_generate(*a, **kw))
        result = get_clinical_agent().run(FULL_STATE, "physical activity and exercise", use_llm=True)
        types_seen = {c.claim_type for c in result.integrated_analysis}
        assert CLAIM_EVIDENCE_SUPPORTED in types_seen or CLAIM_INFERENCE in types_seen  # depends on retrieval hit
        for c in result.integrated_analysis:
            if c.claim_type == CLAIM_EVIDENCE_SUPPORTED:
                assert c.evidence_ids


class TestDiagnosisAndTreatmentBan:
    def test_deterministic_claims_never_contain_diagnostic_language(self):
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", include_model_comparison=True, use_llm=False)
        full_text = result.full_text().lower()
        for banned in ("you have diabetes", "patient is diabetic", "this confirms diabetes"):
            assert banned not in full_text

    def test_deterministic_claims_never_prescribe(self):
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", use_llm=False)
        full_text = result.full_text().lower()
        for banned in ("you should start", "you should stop", "increase your dose"):
            assert banned not in full_text

    def test_current_medications_displayed_as_history_not_advice(self, monkeypatch):
        """Step 24: displaying recorded medication history is allowed and
        must not read as an instruction."""
        from app.services import twin as twin_service

        class _FakeDB:
            pass

        def fake_get_structured_twin(db, patient_id):
            return {
                "patient": {}, "clinical": {}, "lifestyle": {},
                "laboratory": {"latest": {}},
                "medications": {"current": [{"medication_name": "Metformin", "dose": "500mg daily"}]},
            }

        monkeypatch.setattr(twin_service, "get_structured_twin", fake_get_structured_twin)
        monkeypatch.setattr(
            twin_service, "get_lab_trend",
            lambda db, patient_id, test_name: {"test_name": test_name, "latest": None, "history": [], "trend": "no_data"},
        )
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", db=_FakeDB(), patient_id=1, use_llm=False)
        med_claims = [c for c in result.patient_summary if "Metformin" in c.claim]
        assert med_claims
        assert med_claims[0].claim_type == CLAIM_PATIENT_OBSERVATION
        assert "should" not in med_claims[0].claim.lower()


class TestBloodGlucoseLabsSurfaced:
    """Diabetes & Blood Sugar feature: Fasting Glucose and the 2-hour OGTT
    are recorded via the same generic `lab_result` mechanism as HbA1c, so
    they should be surfaced into Clinical Analysis the same verbatim way —
    extending _lab_and_medication_claims rather than adding a parallel
    path."""

    def test_fasting_glucose_and_ogtt_surfaced_like_hba1c(self, monkeypatch):
        from app.services import twin as twin_service

        class _FakeDB:
            pass

        def fake_get_structured_twin(db, patient_id):
            return {
                "patient": {}, "clinical": {}, "lifestyle": {},
                "laboratory": {
                    "latest": {
                        "HbA1c": {"value": 6.1, "unit": "%", "recorded_at": "2026-01-01"},
                        "Fasting Glucose": {"value": 112, "unit": "mg/dL", "recorded_at": "2026-01-02"},
                        "2-Hour Glucose Tolerance Test": {"value": 155, "unit": "mg/dL", "recorded_at": "2026-01-03"},
                    },
                },
                "medications": {"current": []},
            }

        monkeypatch.setattr(twin_service, "get_structured_twin", fake_get_structured_twin)
        monkeypatch.setattr(
            twin_service, "get_lab_trend",
            lambda db, patient_id, test_name: {"test_name": test_name, "latest": None, "history": [], "trend": "no_data"},
        )
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", db=_FakeDB(), patient_id=1, use_llm=False)
        claim_text = " ".join(c.claim for c in result.patient_summary)
        assert "112" in claim_text and "Fasting Glucose" in claim_text
        assert "155" in claim_text and "2-Hour Glucose Tolerance Test" in claim_text
        assert "6.1" in claim_text and "HbA1c" in claim_text
        glucose_claims = [c for c in result.patient_summary if "Fasting Glucose" in c.claim or "OGTT" in c.claim or "Glucose Tolerance" in c.claim]
        assert all(c.claim_type == CLAIM_PATIENT_OBSERVATION for c in glucose_claims)

    def test_absent_glucose_labs_produce_no_claim(self, monkeypatch):
        """The extension must not fabricate a claim for a test that was
        never recorded — same "only what's on file" guarantee as HbA1c."""
        from app.services import twin as twin_service

        class _FakeDB:
            pass

        monkeypatch.setattr(
            twin_service, "get_structured_twin",
            lambda db, patient_id: {"clinical": {}, "lifestyle": {}, "laboratory": {"latest": {}}, "medications": {"current": []}},
        )
        monkeypatch.setattr(
            twin_service, "get_lab_trend",
            lambda db, patient_id, test_name: {"test_name": test_name, "latest": None, "history": [], "trend": "no_data"},
        )
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", db=_FakeDB(), patient_id=1, use_llm=False)
        claim_text = " ".join(c.claim for c in result.patient_summary)
        assert "Fasting Glucose" not in claim_text
        assert "Glucose Tolerance" not in claim_text


class TestLabTrendRespectsExistingSemantics:
    def test_uses_get_lab_trend_values_verbatim(self, monkeypatch):
        from app.services import twin as twin_service

        class _FakeDB:
            pass

        monkeypatch.setattr(
            twin_service, "get_lab_trend",
            lambda db, patient_id, test_name: {"test_name": "HbA1c", "latest": None, "history": [], "trend": "mixed"},
        )
        monkeypatch.setattr(
            twin_service, "get_structured_twin",
            lambda db, patient_id: {"clinical": {}, "lifestyle": {}, "laboratory": {"latest": {}}, "medications": {"current": []}},
        )
        result = get_clinical_agent().run(FULL_STATE, "HbA1c trend", db=_FakeDB(), patient_id=1, use_llm=False)
        assert any("trend across available measurements: mixed" in c.claim.lower() for c in result.patient_summary)

    def test_no_data_trend_produces_no_trend_claim(self, monkeypatch):
        from app.services import twin as twin_service

        class _FakeDB:
            pass

        monkeypatch.setattr(
            twin_service, "get_lab_trend",
            lambda db, patient_id, test_name: {"test_name": "HbA1c", "latest": None, "history": [], "trend": "no_data"},
        )
        monkeypatch.setattr(
            twin_service, "get_structured_twin",
            lambda db, patient_id: {"clinical": {}, "lifestyle": {}, "laboratory": {"latest": {}}, "medications": {"current": []}},
        )
        result = get_clinical_agent().run(FULL_STATE, "HbA1c trend", db=_FakeDB(), patient_id=1, use_llm=False)
        assert not any("trend across available measurements" in c.claim.lower() for c in result.patient_summary)


class TestPrivacyBoundary:
    def test_evidence_query_never_contains_patient_id(self, monkeypatch):
        from app.agents import clinical_agent as ca_module

        captured = {}
        real_retrieve = ca_module.get_evidence_agent().retrieve

        def spy_retrieve(query, k=None, source="local", **kwargs):
            captured["query"] = query
            return real_retrieve(query, source=source) if k is None else real_retrieve(query, k=k, source=source)

        monkeypatch.setattr(ca_module.get_evidence_agent(), "retrieve", spy_retrieve)
        get_clinical_agent().run(FULL_STATE, "blood pressure", db=None, patient_id=987654, use_llm=False)
        assert "987654" not in captured.get("query", "")

    def test_evidence_query_never_contains_raw_twin_values(self):
        from app.agents.clinical_agent import _build_evidence_query

        query = _build_evidence_query("blood pressure", ["high_bp", "bmi"])
        assert "29.0" not in query  # a raw BMI value must never leak into the query text
