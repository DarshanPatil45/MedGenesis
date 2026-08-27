"""API-level tests for the Phase 4/5 evidence-search endpoint
(docs/RAG.md)."""

from __future__ import annotations

import app.services.pubmed as pubmed_module
from app.services.pubmed import PubMedArticle


class TestEvidenceSearchEndpoint:
    def test_on_topic_query_returns_cited_results(self, client):
        resp = client.post("/api/evidence/search", json={"query": "What should I eat to help manage blood sugar?"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["query"] == "What should I eat to help manage blood sugar?"
        assert body["source"] == "local"  # default, unchanged since Phase 4 (Phase 5 Step 12)
        assert body["backend"]
        assert body["results"]
        top = body["results"][0]
        # source_type/doi added in Phase 5 — additive fields on the same
        # EvidenceChunk shape, not a new schema.
        assert set(top) == {
            "text", "document_id", "section", "title", "publisher",
            "source_url", "accessed", "license", "attribution", "score",
            "source_type", "doi",
        }
        assert top["source_type"] == "local"
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


class _FakePubMedClient:
    name = "fake"

    def __init__(self, articles):
        self.articles = articles

    def search(self, query, max_results=5):
        return self.articles[:max_results]


class TestEvidenceSearchSourceSelection:
    """Phase 5: source="local"/"pubmed"/"all", additive and
    backwards-compatible with every pre-Phase-5 request shape."""

    def test_invalid_source_value_rejected_at_schema_level(self, client):
        resp = client.post("/api/evidence/search", json={"query": "diabetes", "source": "not_a_source"})
        assert resp.status_code == 422

    def test_explicit_source_local_matches_default_behavior(self, client):
        default = client.post("/api/evidence/search", json={"query": "healthy eating diet"}).json()
        explicit = client.post("/api/evidence/search", json={"query": "healthy eating diet", "source": "local"}).json()
        assert default["results"] == explicit["results"]

    def test_source_pubmed_with_no_client_configured_returns_empty_not_error(self, client, monkeypatch):
        from app.services.pubmed import NotConfiguredPubMedClient

        monkeypatch.setattr(pubmed_module, "_client", NotConfiguredPubMedClient())
        resp = client.post("/api/evidence/search", json={"query": "diabetes diet", "source": "pubmed"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["results"] == []
        assert body["backend"] == "not_configured"

    def test_source_pubmed_with_fake_client_returns_pubmed_chunks(self, client, monkeypatch):
        fake = _FakePubMedClient(
            [PubMedArticle(pmid="1", title="A diabetes diet study", journal="J", abstract="Findings.")]
        )
        monkeypatch.setattr(pubmed_module, "_client", fake)
        resp = client.post("/api/evidence/search", json={"query": "diabetes diet", "source": "pubmed"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["backend"] == "fake"
        assert body["results"]
        assert body["results"][0]["source_type"] == "pubmed"
        assert body["results"][0]["document_id"] == "pubmed#1"

    def test_source_all_combines_local_and_pubmed(self, client, monkeypatch):
        fake = _FakePubMedClient(
            [PubMedArticle(pmid="1", title="A distinct PubMed study", journal="J", abstract="Findings.")]
        )
        monkeypatch.setattr(pubmed_module, "_client", fake)
        resp = client.post(
            "/api/evidence/search",
            json={"query": "What should I eat to help manage blood sugar?", "source": "all", "k": 5},
        )
        assert resp.status_code == 200
        source_types = {r["source_type"] for r in resp.json()["results"]}
        assert "local" in source_types
        assert "pubmed" in source_types
