"""Phase 7 Step 29: the Clinical Analysis composition must fail safely
under every component's failure — never crash the whole analysis, never
fabricate a fallback clinical result. Two real bugs were found and fixed
via this hardening pass (both previously crashed the whole analysis
uncaught): a missing XGBoost artifact and a missing RandomForest artifact.
"""

from __future__ import annotations

import pathlib

import app.services.pubmed as pubmed_module
from app.agents import screening_agent
from app.agents.clinical_agent import get_clinical_agent
from app.ml.xgboost_model import predict as predict_module

FULL_STATE = {
    "sex": "female", "age": 52, "high_bp": 1, "high_chol": 0, "chol_check": 1,
    "bmi": 29.0, "smoker": 0, "stroke": 0, "heart_disease_or_attack": 0,
    "phys_activity": 1, "fruits": 1, "veggies": 1, "hvy_alcohol_consump": 0,
    "any_healthcare": 1, "no_doc_bc_cost": 0, "gen_hlth": 3, "ment_hlth": 2,
    "phys_hlth": 3, "diff_walk": 0, "education": 5, "income": 6,
}


class TestMissingModelArtifacts:
    def test_missing_randomforest_artifact_degrades_gracefully(self, monkeypatch):
        """Regression test for a real bug found in Phase 7: the production
        model being unavailable used to crash the whole analysis, losing
        patient data and evidence that were still genuinely valid."""
        screening_agent._load_artifacts.cache_clear()
        monkeypatch.setattr(screening_agent, "ARTIFACT_DIR", pathlib.Path("/tmp/nonexistent_rf_dir_xyz"))
        try:
            result = get_clinical_agent().run(FULL_STATE, "diabetes risk", use_llm=False)
        finally:
            screening_agent._load_artifacts.cache_clear()

        assert result.status == "analyzed"
        assert any("production screening model is unavailable" in c.claim for c in result.model_analysis)
        assert result.production_risk_tier is None

    def test_missing_xgboost_artifact_degrades_gracefully(self, monkeypatch):
        """Regression test for the second real bug found the same way:
        the optional candidate model being unavailable used to crash the
        whole analysis too, even though it's opt-in."""
        predict_module._load_artifacts.cache_clear()
        monkeypatch.setattr(predict_module, "ARTIFACT_DIR", pathlib.Path("/tmp/nonexistent_xgb_dir_xyz"))
        try:
            result = get_clinical_agent().run(
                FULL_STATE, "diabetes risk", include_model_comparison=True, use_llm=False
            )
        finally:
            predict_module._load_artifacts.cache_clear()

        assert result.status == "analyzed"
        assert any("XGBoost candidate model is unavailable" in c.claim for c in result.model_analysis)
        # The production model result must be completely unaffected by the
        # candidate model's unavailability.
        assert any("production RandomForest" in c.claim and "assigned a score" in c.claim for c in result.model_analysis)

    def test_both_artifacts_missing_still_returns_patient_data_and_evidence(self, monkeypatch):
        screening_agent._load_artifacts.cache_clear()
        predict_module._load_artifacts.cache_clear()
        monkeypatch.setattr(screening_agent, "ARTIFACT_DIR", pathlib.Path("/tmp/nonexistent_rf_dir_xyz"))
        monkeypatch.setattr(predict_module, "ARTIFACT_DIR", pathlib.Path("/tmp/nonexistent_xgb_dir_xyz"))
        try:
            result = get_clinical_agent().run(
                FULL_STATE, "healthy eating and diet", include_model_comparison=True, use_llm=False
            )
        finally:
            screening_agent._load_artifacts.cache_clear()
            predict_module._load_artifacts.cache_clear()

        assert result.status == "analyzed"
        assert result.patient_summary  # BMI/blood-pressure claims still built from twin_state directly
        assert result.evidence_findings  # local RAG is entirely independent of either model


class TestLocalRAGUnavailable:
    def test_chroma_init_failure_falls_back_to_keyword_store(self, monkeypatch):
        """Existing Phase 4 guarantee (get_store()'s fallback) — confirmed
        here still holds when reached through the Clinical Agent, not just
        directly against services/rag.py."""
        import app.services.rag as rag_module

        def _boom(_chunks):
            raise RuntimeError("simulated: sentence-transformers not installed")

        monkeypatch.setattr(rag_module, "ChromaStore", _boom)
        rag_module.get_store.cache_clear()
        try:
            result = get_clinical_agent().run(FULL_STATE, "healthy eating and diet", use_llm=False)
            assert result.status == "analyzed"
            assert result.evidence_findings  # keyword fallback still found something
        finally:
            rag_module.get_store.cache_clear()


class TestPubMedUnavailable:
    def test_pubmed_failure_does_not_crash_or_block_local_evidence(self, monkeypatch):
        from app.services.pubmed import PubMedUnavailableError

        class _Failing:
            name = "failing"

            def search(self, query, max_results=5):
                raise PubMedUnavailableError("simulated NCBI outage")

        monkeypatch.setattr(pubmed_module, "_client", _Failing())
        result = get_clinical_agent().run(
            FULL_STATE, "healthy eating and diet", include_pubmed=True, use_llm=False
        )
        assert result.status == "analyzed"
        assert result.evidence_findings  # local evidence still present
        assert all(e["source_type"] == "local" for e in result.evidence_findings)


class TestLLMUnavailable:
    def test_no_llm_reply_falls_back_to_deterministic_synthesis(self, monkeypatch):
        import app.services.llm as llm_module

        monkeypatch.setattr(llm_module.LLMRouter, "generate", lambda self, *a, **kw: None)
        result = get_clinical_agent().run(FULL_STATE, "diabetes risk", use_llm=True)
        assert result.status == "analyzed"
        assert result.generated_by == "rules"
        assert result.integrated_analysis


class TestSimulationUnavailable:
    def test_unparseable_scenario_reports_unavailable_never_fabricates(self):
        result = get_clinical_agent().run(
            FULL_STATE, "asdkjfh nonsense not a real scenario", include_simulation=True, use_llm=False
        )
        assert result.simulation is not None
        assert result.simulation["status"] == "unavailable_for_profile"
        assert any("could not be produced" in u for u in result.uncertainties)


class TestInvalidRequestsAtTheAPI:
    def test_invalid_patient_returns_404_not_a_500(self, client):
        resp = client.post("/api/clinical/analyze", json={"patient_id": 999999999, "question": "diabetes risk"})
        assert resp.status_code == 404

    def test_invalid_question_returns_422_not_a_500(self, client, eligible_patient):
        resp = client.post("/api/clinical/analyze", json={"patient_id": eligible_patient["id"], "question": ""})
        assert resp.status_code == 422

    def test_malformed_body_returns_422_not_a_500(self, client):
        resp = client.post("/api/clinical/analyze", json={"patient_id": "not-a-number", "question": "diabetes risk"})
        assert resp.status_code == 422
