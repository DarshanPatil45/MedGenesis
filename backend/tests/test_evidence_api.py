"""API-level tests for the Phase 4 evidence-search endpoint
(docs/RAG.md)."""

from __future__ import annotations


class TestEvidenceSearchEndpoint:
    def test_on_topic_query_returns_cited_results(self, client):
        resp = client.post("/api/evidence/search", json={"query": "What should I eat to help manage blood sugar?"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["query"] == "What should I eat to help manage blood sugar?"
        assert body["backend"]
        assert body["results"]
        top = body["results"][0]
        assert set(top) == {
            "text", "document_id", "section", "title", "publisher",
            "source_url", "accessed", "license", "attribution", "score",
        }
        assert top["document_id"]
        assert top["section"]

    def test_off_topic_query_returns_no_results_not_an_error(self, client):
        resp = client.post("/api/evidence/search", json={"query": "What is the capital of France?"})
        assert resp.status_code == 200
        assert resp.json()["results"] == []

    def test_empty_query_rejected_at_schema_level(self, client):
        resp = client.post("/api/evidence/search", json={"query": ""})
        assert resp.status_code == 422

    def test_extremely_long_query_rejected_at_schema_level(self, client):
        resp = client.post("/api/evidence/search", json={"query": "a" * 3000})
        assert resp.status_code == 422

    def test_k_is_respected_and_bounded(self, client):
        resp = client.post("/api/evidence/search", json={"query": "diabetes diet activity monitoring", "k": 2})
        assert resp.status_code == 200
        assert len(resp.json()["results"]) <= 2

        resp2 = client.post("/api/evidence/search", json={"query": "diet", "k": 0})
        assert resp2.status_code == 422

        resp3 = client.post("/api/evidence/search", json={"query": "diet", "k": 100})
        assert resp3.status_code == 422

    def test_missing_query_field_rejected(self, client):
        resp = client.post("/api/evidence/search", json={})
        assert resp.status_code == 422
