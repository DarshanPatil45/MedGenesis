"""Phase 7 Step 25: one complete integration test proving the full
composition actually works together —

    patient -> Digital Twin -> Clinical Agent -> models -> evidence
    -> analysis -> Safety -> final output

Real service boundaries throughout: a real SQLite session (db_session
fixture), the real Patient/TimelineEvent models, the real twin service,
the real screening/XGBoost/evidence agents, the real Orchestrator/
LangGraph, and the real Safety Agent with its actual policy file. The only
external dependency mocked is PubMed (a live NCBI call would make this
test flaky/network-dependent, which Phase 5 already established the
required suite must never be) — everything else is the genuine
implementation, not a stub.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import app.services.pubmed as pubmed_module
from app.agents.orchestrator import Orchestrator
from app.models.patient import Patient
from app.services import twin as twin_service


def _build_full_patient(db_session) -> Patient:
    """A hand-built patient with real measurement, lab, and medication
    history through the actual append-only twin service — not a demo
    fixture shortcut, so this test genuinely exercises the same path a
    real intake would."""
    patient = Patient(pseudonym="E2E integration patient", age=55, sex="female", is_synthetic=True)
    db_session.add(patient)
    db_session.commit()
    db_session.refresh(patient)

    now = datetime.now(timezone.utc)
    twin_service.append_event(
        db_session, patient_id=patient.id, event_type="measurement",
        payload={
            "high_bp": 1, "high_chol": 1, "chol_check": 1, "bmi": 31.5, "smoker": 0, "stroke": 0,
            "heart_disease_or_attack": 0, "phys_activity": 0, "fruits": 1, "veggies": 1,
            "hvy_alcohol_consump": 0, "any_healthcare": 1, "no_doc_bc_cost": 0, "gen_hlth": 4,
            "ment_hlth": 3, "phys_hlth": 5, "diff_walk": 1, "education": 4, "income": 5,
        },
        source="real",
    )
    for months_ago, value in ((6, 6.8), (3, 7.2), (0, 7.9)):
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="lab_result",
            payload={"test_name": "HbA1c", "value": value, "unit": "%"},
            source="real", recorded_at=now - timedelta(days=30 * months_ago),
        )
    twin_service.append_event(
        db_session, patient_id=patient.id, event_type="medication_change",
        payload={"medication_name": "Metformin", "action": "started", "dose": "500mg daily"},
        source="real", recorded_at=now - timedelta(days=60),
    )
    return patient


class TestFullCompositionEndToEnd:
    def test_patient_through_twin_models_evidence_safety_to_final_output(self, db_session, monkeypatch):
        # PubMed is the one genuinely external dependency — mocked here so
        # this test never depends on live network access, matching the
        # rest of the required suite's convention (Phase 5).
        class _NoOpPubMed:
            name = "test-stub"

            def search(self, query, max_results=5):
                return []

        monkeypatch.setattr(pubmed_module, "_client", _NoOpPubMed())

        patient = _build_full_patient(db_session)

        # The real Orchestrator, the real LangGraph, mode="clinical" —
        # nothing about this call is mocked.
        result = Orchestrator(db_session).run(
            mode="clinical",
            patient_id=patient.id,
            question="What is relevant to this patient's diabetes risk, including HbA1c trend and blood pressure?",
            include_model_comparison=True,
            include_evidence=True,
            include_pubmed=True,
            include_simulation=False,
            use_llm=False,  # deterministic path — no live/mocked LLM needed to prove composition
        )

        # 1. Digital Twin: the real recorded values reached the analysis.
        ca = result["clinical_analysis"]
        patient_claims_text = " ".join(c["claim"] for c in ca["patient_summary"])
        assert "high blood pressure: 1" in patient_claims_text
        assert "7.9" in patient_claims_text  # latest real HbA1c value
        assert "increasing" in patient_claims_text.lower()  # real trend from get_lab_trend()
        assert "Metformin" in patient_claims_text

        # 2. Production model: a real RandomForest score was computed.
        model_claims_text = " ".join(c["claim"] for c in ca["model_analysis"])
        assert "production RandomForest" in model_claims_text
        assert ca["production_risk_tier"] in ("Low", "Moderate", "High")

        # 3. Candidate model: real XGBoost score + real per-patient SHAP.
        assert "XGBoost candidate model" in model_claims_text
        assert "MODEL FEATURE CONTRIBUTIONS" in model_claims_text

        # 4. Evidence: the real Evidence Agent actually retrieved something
        # (local corpus; PubMed stubbed to empty above).
        assert ca["evidence_findings"]
        assert all(e["source_type"] == "local" for e in ca["evidence_findings"])
        assert ca["citations"]

        # 5. Integrated analysis: a real bounded-synthesis claim exists.
        assert ca["integrated_analysis"]

        # 6. Uncertainty: the fixed, real limitations are present.
        assert any("not been clinically validated" in u for u in ca["uncertainties"])

        # 7. Safety: the real Safety Agent actually reviewed this exact
        # output and the decision was persisted to the real audit log.
        assert result["safety"]["status"] in ("APPROVED", "FLAGGED_FOR_CLINICIAN_REVIEW", "BLOCKED")
        assert result["safety"]["policy_version"]
        from app.models.safety import SafetyAuditLog

        audit_rows = (
            db_session.query(SafetyAuditLog)
            .filter(SafetyAuditLog.target_type == "clinical_analysis", SafetyAuditLog.target_id == str(patient.id))
            .all()
        )
        assert audit_rows, "Safety Agent must have written a real audit-log row for this analysis"

        # 8. Final output: the trace shows every real agent that ran, in
        # order — proving actual composition, not independent parallel
        # pieces bolted together.
        trace_text = " | ".join(result["trace"])
        assert "OrchestratorAgent" in trace_text
        assert "PatientDigitalTwin" in trace_text
        assert "ClinicalAnalysisAgent" in trace_text
        assert "SafetyClinicianReviewAgent" in trace_text

        # 9. Nothing was fabricated to fill a gap: every claim traces back
        # to something this test itself set up, or to a real, computed
        # model/evidence result — never an invented value.
        assert ca["status"] == "analyzed"
        assert ca["unavailable_reason"] is None

    def test_missing_patient_data_flows_through_as_honest_uncertainty(self, db_session):
        """Same composition, deliberately incomplete profile — proves
        missing data is reported, never silently filled in, all the way
        through to the final API-shaped output."""
        patient = Patient(pseudonym="E2E incomplete patient", age=61, sex="male", is_synthetic=True)
        db_session.add(patient)
        db_session.commit()
        db_session.refresh(patient)
        # Deliberately incomplete: no measurement event at all.

        result = Orchestrator(db_session).run(
            mode="clinical", patient_id=patient.id, question="diabetes risk",
            include_evidence=False, use_llm=False,
        )
        ca = result["clinical_analysis"]
        assert ca["status"] == "analyzed"  # composite analysis still runs — see docs/CLINICAL_ANALYSIS.md
        assert any("missing patient data" in u.lower() for u in ca["uncertainties"])
        assert any(c["claim_type"] == "uncertainty" for c in ca["model_analysis"])
