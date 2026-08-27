"""Tests for the Phase 5 multi-source evidence layer in
app/services/rag.py: source selection, PubMedArticle -> EvidenceChunk
normalization, cross-source deduplication, and Reciprocal Rank Fusion.

Never depends on live PubMed — a fake PubMedClient is injected via
monkeypatching app.services.pubmed.get_pubmed_client, the same pattern
test_pubmed.py and the rest of this project already use for swappable
backends (services/rag.py's own ChromaStore/KeywordStore, services/llm.py's
backend list).
"""

from __future__ import annotations

import app.services.pubmed as pubmed_module
from app.services import rag as rag_module
from app.services.pubmed import PubMedArticle, PubMedUnavailableError
from app.services.rag import (
    ALL_SOURCES,
    LOCAL_SOURCE,
    PUBMED_SOURCE,
    EvidenceChunk,
    KeywordStore,
    _deduplicate,
    _pubmed_article_to_chunk,
    _reciprocal_rank_fusion,
    load_chunks,
    search_evidence,
)

CHUNKS = load_chunks()


class _FakePubMedClient:
    name = "fake"

    def __init__(self, articles=None, raise_exc=None):
        self.articles = articles or []
        self.raise_exc = raise_exc
        self.calls: list[tuple[str, int]] = []

    def search(self, query: str, max_results: int = 5):
        self.calls.append((query, max_results))
        if self.raise_exc:
            raise self.raise_exc
        return self.articles[:max_results]


def _article(pmid, title="A study", journal="J", abstract="Some findings.", doi=None):
    return PubMedArticle(pmid=pmid, title=title, journal=journal, abstract=abstract, doi=doi)


def _install_fake_pubmed(monkeypatch, client):
    monkeypatch.setattr(pubmed_module, "_client", client)
    monkeypatch.setattr(pubmed_module, "get_pubmed_client", lambda: client)


class TestPubMedArticleToChunkMapping:
    def test_maps_expected_fields(self):
        article = _article("777", title="Diet study", journal="Nutrition J", doi="10.1/z")
        chunk = _pubmed_article_to_chunk(article, rank=1)
        assert chunk.document_id == "pubmed#777"
        assert chunk.source_url == "https://pubmed.ncbi.nlm.nih.gov/777/"
        assert chunk.title == "Diet study"
        assert chunk.publisher == "Nutrition J"
        assert chunk.text == "Some findings."
        assert chunk.section == "Abstract"
        assert chunk.source_type == PUBMED_SOURCE
        assert chunk.doi == "10.1/z"

    def test_rank_derived_score_is_reciprocal_rank(self):
        article = _article("1")
        assert _pubmed_article_to_chunk(article, rank=1).score == 1.0
        assert _pubmed_article_to_chunk(article, rank=2).score == 0.5
        assert _pubmed_article_to_chunk(article, rank=4).score == 0.25

    def test_no_doi_maps_to_empty_string_not_none(self):
        chunk = _pubmed_article_to_chunk(_article("1", doi=None), rank=1)
        assert chunk.doi == ""


class TestSourceSelection:
    def test_default_source_is_local_and_unchanged(self):
        """Regression guard: source="local" (the default) must behave
        identically to pre-Phase-5 EvidenceAgent.retrieve()."""
        results = search_evidence("What should I eat to help manage blood sugar?", k=3, source=LOCAL_SOURCE)
        assert results
        assert all(c.source_type == LOCAL_SOURCE for c in results)

    def test_pubmed_source_returns_only_pubmed_chunks(self, monkeypatch):
        client = _FakePubMedClient(articles=[_article("1"), _article("2")])
        _install_fake_pubmed(monkeypatch, client)
        results = search_evidence("diabetes diet", k=5, source=PUBMED_SOURCE)
        assert results
        assert all(c.source_type == PUBMED_SOURCE for c in results)

    def test_all_source_can_include_both(self, monkeypatch):
        client = _FakePubMedClient(articles=[_article("1", title="A distinct PubMed study")])
        _install_fake_pubmed(monkeypatch, client)
        results = search_evidence("What should I eat to help manage blood sugar?", k=5, source=ALL_SOURCES)
        source_types = {c.source_type for c in results}
        assert LOCAL_SOURCE in source_types
        assert PUBMED_SOURCE in source_types

    def test_unknown_source_raises_value_error(self):
        import pytest

        with pytest.raises(ValueError):
            search_evidence("diabetes", source="not_a_real_source")

    def test_pubmed_never_called_for_default_local_source(self, monkeypatch):
        """Phase 5 Step 12: existing callers must never silently trigger a
        PubMed call."""
        client = _FakePubMedClient(articles=[_article("1")])
        _install_fake_pubmed(monkeypatch, client)
        search_evidence("What should I eat to help manage blood sugar?")  # source omitted -> "local"
        assert client.calls == []


class TestPubMedFailureHandling:
    def test_pubmed_failure_does_not_break_local_results_in_all_mode(self, monkeypatch):
        client = _FakePubMedClient(raise_exc=PubMedUnavailableError("simulated outage"))
        _install_fake_pubmed(monkeypatch, client)
        results = search_evidence("What should I eat to help manage blood sugar?", k=3, source=ALL_SOURCES)
        assert results  # local results still came back
        assert all(c.source_type == LOCAL_SOURCE for c in results)

    def test_pubmed_source_alone_returns_empty_not_a_crash_on_failure(self, monkeypatch):
        client = _FakePubMedClient(raise_exc=PubMedUnavailableError("simulated outage"))
        _install_fake_pubmed(monkeypatch, client)
        assert search_evidence("diabetes", source=PUBMED_SOURCE) == []

    def test_not_configured_pubmed_degrades_to_empty_not_a_crash(self, monkeypatch):
        from app.services.pubmed import NotConfiguredPubMedClient

        _install_fake_pubmed(monkeypatch, NotConfiguredPubMedClient())
        results = search_evidence("What should I eat to help manage blood sugar?", k=3, source=ALL_SOURCES)
        assert results
        assert all(c.source_type == LOCAL_SOURCE for c in results)

    def test_articles_without_abstract_are_dropped_not_returned_as_empty_text(self, monkeypatch):
        client = _FakePubMedClient(articles=[_article("1", abstract=None), _article("2", abstract="Real text.")])
        _install_fake_pubmed(monkeypatch, client)
        results = search_evidence("diabetes", source=PUBMED_SOURCE, k=5)
        assert len(results) == 1
        assert results[0].document_id == "pubmed#2"


class TestDeduplication:
    def _chunk(self, doc_id, title, source_type="pubmed", doi="", score=1.0):
        return EvidenceChunk(
            text="x", document_id=doc_id, section="Abstract", title=title, publisher="J",
            source_url="", accessed="", license="", attribution="", score=score,
            source_type=source_type, doi=doi,
        )

    def test_duplicate_document_id_collapsed(self):
        chunks = [self._chunk("pubmed#1", "Study A"), self._chunk("pubmed#1", "Study A")]
        assert len(_deduplicate(chunks)) == 1

    def test_duplicate_doi_collapsed_even_with_different_pmid(self):
        chunks = [
            self._chunk("pubmed#1", "Study A", doi="10.1/x"),
            self._chunk("pubmed#2", "Study A (preprint)", doi="10.1/x"),
        ]
        assert len(_deduplicate(chunks)) == 1

    def test_duplicate_normalized_title_collapsed_for_pubmed_chunks(self):
        chunks = [
            self._chunk("pubmed#1", "Diet And Diabetes Risk!"),
            self._chunk("pubmed#2", "diet and diabetes risk"),
        ]
        assert len(_deduplicate(chunks)) == 1

    def test_distinct_pubmed_studies_are_not_collapsed(self):
        chunks = [self._chunk("pubmed#1", "Study About Diet"), self._chunk("pubmed#2", "Study About Exercise")]
        assert len(_deduplicate(chunks)) == 2

    def test_local_chunks_sharing_one_document_title_are_never_collapsed(self):
        """The real bug this guards against: every section of the local
        'Diabetes Basics' KB file shares one document-level `title`. Naive
        title-based dedup would wrongly merge unrelated sections."""
        local_chunks = [c for c in CHUNKS if c.document_id.startswith("cdc_diabetes_basics")]
        assert len(local_chunks) > 5  # sanity: the real corpus really has this many sections
        assert len({c.title for c in local_chunks}) == 1  # they really do share one title
        deduped = _deduplicate(local_chunks)
        assert len(deduped) == len(local_chunks)  # nothing was dropped


class TestReciprocalRankFusion:
    def _chunk(self, doc_id, source_type):
        return EvidenceChunk(
            text="x", document_id=doc_id, section="s", title="t", publisher="p",
            source_url="", accessed="", license="", attribution="", source_type=source_type,
        )

    def test_top_ranked_in_both_lists_wins(self):
        local = [self._chunk("local#a", "local"), self._chunk("local#b", "local")]
        pubmed = [self._chunk("local#a", "local"), self._chunk("pubmed#1", "pubmed")]
        fused = _reciprocal_rank_fusion(local, pubmed)
        assert fused[0].document_id == "local#a"  # ranked #1 in both lists

    def test_fusion_score_is_deterministic(self):
        local = [self._chunk("local#a", "local")]
        pubmed = [self._chunk("pubmed#1", "pubmed")]
        a = _reciprocal_rank_fusion(local, pubmed)
        b = _reciprocal_rank_fusion(local, pubmed)
        assert [c.document_id for c in a] == [c.document_id for c in b]
        assert [c.score for c in a] == [c.score for c in b]

    def test_empty_pubmed_list_still_returns_local_results(self):
        local = [self._chunk("local#a", "local")]
        fused = _reciprocal_rank_fusion(local, [])
        assert [c.document_id for c in fused] == ["local#a"]


class TestCitationBlockForPubMed:
    def test_pubmed_citation_block_includes_pmid_and_doi(self):
        chunk = _pubmed_article_to_chunk(_article("999", title="T", journal="J", doi="10.1/y"), rank=1)
        block = chunk.citation_block
        assert "PMID: 999" in block
        assert "DOI: 10.1/y" in block
        assert "Section:" not in block  # PubMed uses PMID/DOI instead of a local Section line

    def test_pubmed_citation_block_omits_doi_line_when_absent(self):
        chunk = _pubmed_article_to_chunk(_article("999", doi=None), rank=1)
        assert "DOI:" not in chunk.citation_block

    def test_local_citation_block_still_shows_section_not_pmid(self):
        chunk = KeywordStore(CHUNKS).query("healthy eating diet", k=1)[0]
        block = chunk.citation_block
        assert "Section:" in block
        assert "PMID:" not in block
