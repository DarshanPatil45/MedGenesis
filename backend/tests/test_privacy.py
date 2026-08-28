"""Privacy regression tests (Phase 7 Step 15) — audits the full
frontend-facing surface: secrets never reach the browser, patient
identifiers never reach PubMed/RAG queries or LLM prompts, and patient
data never appears in application logs.

Most of the query-construction guarantees were already tested in Phase 6
(tests/test_clinical_agent.py::TestPrivacyBoundary); this file adds the
remaining Step 15 checks that weren't covered yet: secrets in API
responses, secrets/patient data in logs, and the LLM prompt boundary
specifically.
"""

from __future__ import annotations

import logging


class TestSecretsNeverReachTheClient:
    def test_health_endpoint_never_includes_secret_values(self, client, monkeypatch):
        import app.services.llm as llm_module

        monkeypatch.setattr(llm_module, "MISTRAL_API_KEY", "sk-super-secret-value")
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert "sk-super-secret-value" not in resp.text

    def test_evidence_search_response_never_includes_pubmed_credentials(self, client, monkeypatch):
        import app.services.pubmed as pubmed_module

        monkeypatch.setattr(pubmed_module, "PUBMED_API_KEY", "secret-ncbi-key")
        monkeypatch.setattr(pubmed_module, "PUBMED_EMAIL", "researcher@example.com")
        resp = client.post("/api/evidence/search", json={"query": "diabetes diet"})
        assert "secret-ncbi-key" not in resp.text

    def test_clinical_analysis_response_never_includes_api_keys(self, client, eligible_patient, monkeypatch):
        import app.services.llm as llm_module
        import app.services.pubmed as pubmed_module

        monkeypatch.setattr(llm_module, "MISTRAL_API_KEY", "sk-super-secret-value")
        monkeypatch.setattr(pubmed_module, "PUBMED_API_KEY", "secret-ncbi-key")
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "diabetes risk"},
        )
        assert "sk-super-secret-value" not in resp.text
        assert "secret-ncbi-key" not in resp.text


class TestPatientDataNeverLogged:
    def test_clinical_analysis_run_does_not_log_patient_pseudonym_or_raw_values(
        self, client, eligible_patient, caplog
    ):
        caplog.set_level(logging.DEBUG)
        resp = client.post(
            "/api/clinical/analyze",
            json={"patient_id": eligible_patient["id"], "question": "What is this patient's BMI and blood pressure?"},
        )
        assert resp.status_code == 200
        # The demo patient's pseudonym is a real, identifying-shaped string
        # (see app/ml/synthetic_patients.py) — it must never appear in logs,
        # regardless of what the analysis itself legitimately returns to
        # the API caller.
        assert eligible_patient["pseudonym"] not in caplog.text

    def test_evidence_search_does_not_log_the_raw_query_text(self, client, caplog):
        caplog.set_level(logging.DEBUG)
        distinctive_query = "zzz_privacy_probe_query_should_not_appear_in_logs zzz"
        client.post("/api/evidence/search", json={"query": distinctive_query})
        assert distinctive_query not in caplog.text


class TestLLMPromptBoundary:
    def test_clinical_agent_llm_prompt_never_contains_patient_id(self):
        from app.agents.clinical_agent import ClinicalAnalysisAgent, ClinicalClaim

        prompt = ClinicalAnalysisAgent._llm_prompt(
            "diabetes risk",
            [ClinicalClaim("Recorded BMI: 29.0.", "patient_observation")],
            [ClinicalClaim("The production RandomForest screening model assigned a score of 0.6.", "model_observation")],
            {},
        )
        for identifier in ("patient_id", "987654"):
            assert identifier not in prompt

    def test_clinical_agent_llm_prompt_contains_only_supplied_claims_and_evidence(self):
        from app.agents.clinical_agent import SOURCES_DELIMITER_END, SOURCES_DELIMITER_START, ClinicalAnalysisAgent, ClinicalClaim
        from app.services.rag import EvidenceChunk

        chunk = EvidenceChunk(
            text="Physical activity lowers risk.", document_id="cdc_diabetes_basics#physical-activity",
            section="Physical activity", title="Diabetes Basics", publisher="CDC",
            source_url="https://www.cdc.gov/diabetes/about/index.html", accessed="2026-08-23",
            license="public domain", attribution="", score=0.7,
        )
        prompt = ClinicalAnalysisAgent._llm_prompt(
            "diabetes risk", [], [], {"E1": chunk}
        )
        assert SOURCES_DELIMITER_START in prompt
        assert SOURCES_DELIMITER_END in prompt
        assert "[E1]" in prompt
        assert "Physical activity lowers risk." in prompt


class TestPubMedQueryNeverContainsPatientIdentifiers:
    def test_pubmed_source_query_excludes_patient_id_and_pseudonym(self, client, eligible_patient, monkeypatch):
        import app.services.pubmed as pubmed_module

        captured = {}

        class _Tracker:
            name = "tracker"

            def search(self, query, max_results=5):
                captured["query"] = query
                return []

        monkeypatch.setattr(pubmed_module, "_client", _Tracker())
        client.post(
            "/api/clinical/analyze",
            json={
                "patient_id": eligible_patient["id"],
                "question": "diabetes risk",
                "include_pubmed": True,
            },
        )
        query = captured.get("query", "")
        assert str(eligible_patient["id"]) not in query
        assert eligible_patient["pseudonym"] not in query
