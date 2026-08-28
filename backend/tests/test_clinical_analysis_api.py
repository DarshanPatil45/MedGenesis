"""API-level tests for POST /api/clinical/analyze (Phase 6,
docs/CLINICAL_ANALYSIS.md) — the Orchestrator-gated Clinical Analysis
endpoint, and confirmation the rest of the API is unaffected."""

from __future__ import annotations

import app.services.pubmed as pubmed_module


class TestClinicalAnalyzeEndpoint:
    def test_valid_request_returns_structured_analysis(self, client, eligible_patient):
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "What is relevant to this patient's diabetes risk?"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "analyzed"
        assert body["patient_id"] == eligible_patient["id"]
        assert set(body) == {
            "patient_id", "question", "status", "scope", "patient_summary", "model_analysis",
            "evidence_findings", "simulation", "integrated_analysis", "uncertainties", "citations",
            "safety_flags", "unavailable_reason", "generated_by", "production_risk_tier", "safety", "trace",
        }

    def test_missing_patient_returns_404(self, client):
        resp = client.post("/api/clinical/analyze", json={"patient_id": 999999, "question": "diabetes risk"})
        assert resp.status_code == 404

    def test_empty_question_rejected_at_schema_level(self, client, eligible_patient):
        resp = client.post("/api/clinical/analyze", json={"patient_id": eligible_patient["id"], "question": ""})
        assert resp.status_code == 422

    def test_incomplete_patient_still_returns_an_analysis_with_uncertainty(self, client, incomplete_patient):
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": incomplete_patient["id"], "question": "diabetes risk"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "analyzed"
        assert any("missing" in u.lower() for u in body["uncertainties"])

    def test_trace_includes_clinical_analysis_agent_step(self, client, eligible_patient):
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "diabetes risk"},
        )
        assert any("ClinicalAnalysisAgent" in step for step in resp.json()["trace"])
        assert any("SafetyClinicianReviewAgent" in step for step in resp.json()["trace"])


class TestSafetyGating:
    def test_medication_history_display_is_approved_not_blocked(self, client, eligible_patient):
        """Regression guard for the real collision found during this
        phase's development: the moderate_risk demo profile has recorded
        Metformin history — displaying that as patient history must be
        APPROVED, not blocked as if it were medication advice."""
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "What medications and labs are on record?"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["safety"]["status"] in ("APPROVED", "FLAGGED_FOR_CLINICIAN_REVIEW")
        assert body["safety"]["status"] != "BLOCKED"

    def test_disclaimer_present_on_approved_analysis(self, client, eligible_patient):
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "diabetes risk"},
        )
        assert resp.json()["safety"]["disclaimer"]

    def test_blocked_analysis_clears_all_claim_sections_not_just_one(self, client, eligible_patient, monkeypatch):
        """If Safety blocks the output, patient_summary/model_analysis must
        not leak the blocked content just because only integrated_analysis
        was replaced."""
        from app.agents import clinical_agent as ca_module

        def poisoned_synthesize(question, patient_summary, model_analysis, evidence_id_map, use_llm, **_kwargs):
            from app.agents.clinical_agent import CLAIM_INFERENCE, ClinicalClaim

            return [ClinicalClaim("You should start taking metformin immediately.", CLAIM_INFERENCE)], "rules", []

        monkeypatch.setattr(ca_module.ClinicalAnalysisAgent, "_synthesize", staticmethod(poisoned_synthesize))
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "diabetes risk"},
        )
        body = resp.json()
        assert body["safety"]["status"] == "BLOCKED"
        assert body["patient_summary"] == []
        assert body["model_analysis"] == []
        assert "metformin" not in " ".join(c["claim"] for c in body["integrated_analysis"]).lower()


class TestModelComparisonFlag:
    def test_default_excludes_xgboost(self, client, eligible_patient):
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "diabetes risk"},
        )
        body = resp.json()
        assert not any("XGBoost" in c["claim"] for c in body["model_analysis"])

    def test_flag_includes_xgboost(self, client, eligible_patient):
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "diabetes risk", "include_model_comparison": True},
        )
        body = resp.json()
        assert any("XGBoost" in c["claim"] for c in body["model_analysis"])


class TestSimulationFlag:
    def test_simulation_only_invoked_when_requested(self, client, eligible_patient):
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "what if BMI decreased by 2?"},
        )
        assert resp.json()["simulation"] is None

    def test_simulation_requested_and_parseable_produces_result(self, client, eligible_patient):
        resp = client.post(
            "/api/clinical/analyze",
            json={
                "patient_id": eligible_patient["id"],
                "question": "what happens to the model score if bmi decreases by 2 over 8 weeks?",
                "include_simulation": True,
            },
        )
        body = resp.json()
        assert body["simulation"] is not None
        assert body["simulation"]["status"] in ("scored", "unavailable_for_profile")

    def test_unparseable_simulation_request_does_not_fabricate_output(self, client, eligible_patient):
        resp = client.post(
            "/api/clinical/analyze",
            json={
                "patient_id": eligible_patient["id"],
                "question": "asdkjfh nonsense what if scenario",
                "include_simulation": True,
            },
        )
        body = resp.json()
        assert body["simulation"]["status"] == "unavailable_for_profile"
        assert any("could not be produced" in u.lower() for u in body["uncertainties"])


class TestPubMedFlag:
    def test_pubmed_not_queried_by_default(self, client, eligible_patient, monkeypatch):
        calls = []

        class _Tracker:
            name = "tracker"

            def search(self, query, max_results=5):
                calls.append(query)
                return []

        monkeypatch.setattr(pubmed_module, "_client", _Tracker())
        client.post("/api/clinical/analyze", json={"patient_id": eligible_patient["id"], "question": "diabetes risk"})
        assert calls == []

    def test_pubmed_queried_when_flagged(self, client, eligible_patient, monkeypatch):
        calls = []

        class _Tracker:
            name = "tracker"

            def search(self, query, max_results=5):
                calls.append(query)
                return []

        monkeypatch.setattr(pubmed_module, "_client", _Tracker())
        client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "diabetes risk", "include_pubmed": True},
        )
        assert calls


class TestExistingEndpointsUnaffected:
    def test_screening_endpoint_still_works(self, client, eligible_patient):
        resp = client.post("/api/screening/run", json={"patient_id": eligible_patient["id"]})
        assert resp.status_code == 200

    def test_chat_endpoint_still_works(self, client, eligible_patient):
        resp = client.post(
            "/api/chat", json={"patient_id": eligible_patient["id"], "message": "What foods should I eat?", "use_llm": False}
        )
        assert resp.status_code == 200

    def test_agents_run_endpoint_unaffected_by_new_clinical_mode(self, client, eligible_patient):
        resp = client.post("/api/agents/run", json={"patient_id": eligible_patient["id"], "mode": "intake"})
        assert resp.status_code == 200
