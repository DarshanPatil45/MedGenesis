"""Tests for the Phase 1 MedGenesis extension points (XGBoost package,
Clinical Analysis Agent, PubMed service, new timeline event types).

These are scaffolding tests, matching what's actually implemented: every new
module intentionally raises NotImplementedError rather than doing anything —
these tests confirm that's true (an honest stub, not a silent no-op) and
that nothing existing was touched. Behavioral tests for the real
implementations belong to whichever later phase builds them.
"""

from __future__ import annotations

import pytest


class TestXGBoostNowImplemented:
    """Phase 1 introduced the XGBoost package as scaffolding — every
    function raised NotImplementedError, which this class used to verify
    directly (that every stub was an honest stub, not a silent no-op).
    Phase 3 (docs/ML.md) replaced those stubs with a real, trained
    implementation, which makes those specific assertions obsolete by
    design — the whole point of that phase was to make load_data(),
    train_and_evaluate(), score_vector(), and compare_to_baseline() stop
    raising NotImplementedError. Comprehensive behavioral tests for the real
    implementation live in tests/test_xgboost_model.py and
    tests/test_ml_api.py. What's still checked here is what Phase 1
    established and Phase 3 was explicitly required to preserve: the
    package still imports cleanly and its artifacts stay isolated from the
    RandomForest's (see TestRandomForestUntouched, immediately below, for
    the RandomForest side of that guarantee)."""

    def test_all_modules_import_cleanly(self):
        from app.ml.xgboost_model import config, evaluate, explain, predict, preprocessing, train  # noqa: F401

    def test_artifact_dir_is_still_separate_from_randomforest(self):
        from app.ml.train_screening_model import ARTIFACT_DIR as RF_ARTIFACT_DIR
        from app.ml.xgboost_model.config import ARTIFACT_DIR

        assert ARTIFACT_DIR.exists() and ARTIFACT_DIR.is_dir()
        assert ARTIFACT_DIR.resolve() != RF_ARTIFACT_DIR.resolve()


class TestRandomForestUntouched:
    """Guards against constraint: 'Do not modify the existing RandomForest
    training or artifact' — the three artifacts from the last real training
    run must still be exactly what they were."""

    def test_randomforest_artifacts_still_present(self):
        from app.ml.train_screening_model import ARTIFACT_DIR

        assert (ARTIFACT_DIR / "screening_model.joblib").exists()
        assert (ARTIFACT_DIR / "screening_scaler.joblib").exists()
        assert (ARTIFACT_DIR / "screening_model_metadata.json").exists()

    def test_randomforest_still_loads_and_scores(self):
        from app.agents.screening_agent import get_screening_agent

        state = {
            "sex": "female", "age": 52, "high_bp": 1, "high_chol": 0, "chol_check": 1,
            "bmi": 29.0, "smoker": 0, "stroke": 0, "heart_disease_or_attack": 0,
            "phys_activity": 1, "fruits": 1, "veggies": 1, "hvy_alcohol_consump": 0,
            "any_healthcare": 1, "no_doc_bc_cost": 0, "gen_hlth": 3, "ment_hlth": 2,
            "phys_hlth": 3, "diff_walk": 0, "education": 5, "income": 6,
        }
        result = get_screening_agent().run(state)
        assert result.status == "scored"
        assert 0.0 <= result.risk_probability <= 1.0


class TestClinicalAgentScaffolding:
    def test_imports_and_instantiates(self):
        from app.agents.clinical_agent import ClinicalAnalysisAgent, get_clinical_agent

        agent = ClinicalAnalysisAgent()
        assert agent.name == "ClinicalAnalysisAgent"
        assert get_clinical_agent() is get_clinical_agent()  # singleton, matches other agents

    def test_run_is_an_honest_stub(self):
        from app.agents.clinical_agent import get_clinical_agent

        with pytest.raises(NotImplementedError):
            get_clinical_agent().run({}, {})

    def test_result_default_status_is_not_implemented(self):
        from app.agents.clinical_agent import ClinicalAnalysisResult

        result = ClinicalAnalysisResult()
        assert result.status == "not_implemented"
        assert result.to_dict()["status"] == "not_implemented"


class TestPubMedScaffolding:
    def test_default_client_is_not_configured(self):
        from app.services.pubmed import get_pubmed_client

        client = get_pubmed_client()
        assert client.name == "not_configured"

    def test_search_is_an_honest_stub_not_a_silent_empty_result(self):
        from app.services.pubmed import get_pubmed_client

        with pytest.raises(NotImplementedError):
            get_pubmed_client().search("type 2 diabetes physical activity")

    def test_article_metadata_round_trips_and_url_is_real(self):
        """PubMedArticle itself is real, working code (not a stub) — only
        the retrieval that would populate it is scaffolding."""
        from app.services.pubmed import PubMedArticle

        article = PubMedArticle(
            pmid="12345678",
            title="Example title",
            journal="Example Journal",
            year="2020",
            authors=["Smith J", "Doe A"],
            abstract="Example abstract.",
        )
        assert article.url == "https://pubmed.ncbi.nlm.nih.gov/12345678/"
        d = article.to_dict()
        assert d["pmid"] == "12345678" and d["url"] == article.url


class TestTimelineEventTypeExtension:
    def test_new_event_types_registered(self):
        from app.models.timeline import EVENT_TYPES

        assert "medication_change" in EVENT_TYPES
        assert "lab_result" in EVENT_TYPES

    def test_new_event_types_deliberately_excluded_from_current_state_fold(self):
        """How medication/lab history should materialize into 'current
        state' is a modeling decision for the Clinical Agent phase, not
        scaffolding — see the comment in models/timeline.py."""
        from app.services.twin import STATE_EVENT_TYPES

        assert "medication_change" not in STATE_EVENT_TYPES
        assert "lab_result" not in STATE_EVENT_TYPES

    def test_twin_service_accepts_the_new_event_types(self, db_session):
        """Real behavior check, not just a stub check — confirms
        services/twin.py (the one Digital Twin abstraction, not a second
        one) is actually compatible with the new types end to end."""
        from app.models.patient import Patient
        from app.services import twin as twin_service

        patient = Patient(pseudonym="Phase 1 twin test", age=60, sex="female", is_synthetic=True)
        db_session.add(patient)
        db_session.commit()
        db_session.refresh(patient)

        # Phase 1 didn't yet define a lab_result payload shape (pure
        # scaffolding); Phase 2 (docs/DIGITAL_TWIN.md) does, and validates
        # it — see test_digital_twin_phase2.py for that validation's own
        # test coverage. Using a payload that satisfies it here so this
        # test keeps checking what it always checked: that the new event
        # type is accepted end-to-end through the one twin service.
        event = twin_service.append_event(
            db_session,
            patient_id=patient.id,
            event_type="lab_result",
            payload={"test_name": "HbA1c", "value": 6.1},
            source="real",
        )
        assert event.event_type == "lab_result"

        # Confirms it deliberately does NOT show up in the materialized
        # current-state view yet (per the design decision above).
        state = twin_service.get_current_state(db_session, patient.id)
        assert "hba1c" not in state
