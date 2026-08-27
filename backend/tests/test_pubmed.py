"""Tests for the real PubMed client (Phase 5, docs/RAG.md).

Every HTTP call is mocked via httpx.MockTransport — live PubMed
availability is never required for this suite (Phase 5 Step 29). The one
test that touches the real network lives in test_pubmed_live.py and is
skipped unless explicitly opted into.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.services.pubmed import (
    EutilsPubMedClient,
    NotConfiguredPubMedClient,
    PubMedArticle,
    PubMedUnavailableError,
    _parse_efetch_xml,
    get_pubmed_client,
)

ESEARCH_OK = json.dumps({"esearchresult": {"idlist": ["111", "222"]}})

EFETCH_OK = """<?xml version="1.0"?>
<PubmedArticleSet>
<PubmedArticle><MedlineCitation><PMID>111</PMID><Article>
  <Journal><Title>Diabetes Care</Title><JournalIssue><PubDate><Year>2020</Year></PubDate></JournalIssue></Journal>
  <ArticleTitle>Physical activity and diabetes risk</ArticleTitle>
  <Abstract><AbstractText>Regular activity lowers risk.</AbstractText></Abstract>
  <AuthorList><Author><LastName>Lee</LastName><Initials>K</Initials></Author></AuthorList>
  <PublicationTypeList><PublicationType>Review</PublicationType></PublicationTypeList>
</Article>
<ArticleIdList><ArticleId IdType="doi">10.1/aaa</ArticleId></ArticleIdList>
</MedlineCitation></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID>222</PMID><Article>
  <Journal><Title>Metabolism Journal</Title></Journal>
  <ArticleTitle>An article with no abstract available</ArticleTitle>
</Article></MedlineCitation></PubmedArticle>
</PubmedArticleSet>"""


def _client_with(handler) -> EutilsPubMedClient:
    transport = httpx.MockTransport(handler)
    return EutilsPubMedClient(email="test@example.com", client=httpx.Client(transport=transport))


def _ok_handler(request: httpx.Request) -> httpx.Response:
    if "esearch" in str(request.url):
        return httpx.Response(200, text=ESEARCH_OK)
    return httpx.Response(200, text=EFETCH_OK)


class TestSearch:
    def test_valid_query_returns_articles_in_esearch_relevance_order(self):
        client = _client_with(_ok_handler)
        results = client.search("type 2 diabetes physical activity", max_results=2)
        assert [a.pmid for a in results] == ["111", "222"]

    def test_empty_query_returns_empty_list_no_request_made(self):
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(200, text=ESEARCH_OK)

        client = _client_with(handler)
        assert client.search("   ", max_results=5) == []
        assert calls == []

    def test_max_results_passed_through_to_esearch(self):
        captured = {}

        def handler(request):
            if "esearch" in str(request.url):
                captured["retmax"] = request.url.params.get("retmax")
                return httpx.Response(200, text=ESEARCH_OK)
            return httpx.Response(200, text=EFETCH_OK)

        _client_with(handler).search("diabetes", max_results=7)
        assert captured["retmax"] == "7"

    def test_no_pmids_found_returns_empty_list_and_skips_efetch(self):
        efetch_called = {"n": 0}

        def handler(request):
            if "esearch" in str(request.url):
                return httpx.Response(200, text=json.dumps({"esearchresult": {"idlist": []}}))
            efetch_called["n"] += 1
            return httpx.Response(200, text=EFETCH_OK)

        client = _client_with(handler)
        assert client.search("xyzzy nonsense query", max_results=5) == []
        assert efetch_called["n"] == 0

    def test_malformed_esearch_json_raises_pubmed_unavailable_not_a_crash(self):
        def handler(request):
            return httpx.Response(200, text="not valid json{{{")

        with pytest.raises(PubMedUnavailableError):
            _client_with(handler).search("diabetes", max_results=3)


class TestFetchAndParsing:
    def test_valid_pmid_parses_full_metadata(self):
        articles = _parse_efetch_xml(EFETCH_OK)
        a = articles["111"]
        assert a.pmid == "111"
        assert a.title == "Physical activity and diabetes risk"
        assert a.journal == "Diabetes Care"
        assert a.year == "2020"
        assert a.authors == ["Lee K"]
        assert a.doi == "10.1/aaa"
        assert a.article_type == ["Review"]
        assert a.abstract == "Regular activity lowers risk."

    def test_missing_abstract_is_none_not_fabricated(self):
        articles = _parse_efetch_xml(EFETCH_OK)
        assert articles["222"].abstract is None

    def test_missing_doi_is_none(self):
        articles = _parse_efetch_xml(EFETCH_OK)
        assert articles["222"].doi is None

    def test_missing_publication_date_is_none(self):
        articles = _parse_efetch_xml(EFETCH_OK)
        assert articles["222"].year is None

    def test_missing_pmid_element_is_skipped_not_crashed(self):
        xml = """<PubmedArticleSet>
        <PubmedArticle><MedlineCitation><Article><ArticleTitle>No PMID here</ArticleTitle></Article></MedlineCitation></PubmedArticle>
        <PubmedArticle><MedlineCitation><PMID>333</PMID><Article><ArticleTitle>Has PMID</ArticleTitle></Article></MedlineCitation></PubmedArticle>
        </PubmedArticleSet>"""
        articles = _parse_efetch_xml(xml)
        assert list(articles.keys()) == ["333"]

    def test_completely_malformed_xml_returns_empty_not_a_crash(self):
        assert _parse_efetch_xml("<this is not <<< valid xml") == {}

    def test_structured_abstract_labels_preserved_inline(self):
        xml = """<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>444</PMID><Article>
        <ArticleTitle>Structured abstract example</ArticleTitle>
        <Abstract>
          <AbstractText Label="BACKGROUND">Context here.</AbstractText>
          <AbstractText Label="RESULTS">Findings here.</AbstractText>
        </Abstract>
        </Article></MedlineCitation></PubmedArticle></PubmedArticleSet>"""
        a = _parse_efetch_xml(xml)["444"]
        assert "BACKGROUND: Context here." in a.abstract
        assert "RESULTS: Findings here." in a.abstract

    def test_collective_name_used_when_no_individual_authors(self):
        xml = """<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>555</PMID><Article>
        <ArticleTitle>Group authored study</ArticleTitle>
        <AuthorList><Author><CollectiveName>Diabetes Prevention Program Group</CollectiveName></Author></AuthorList>
        </Article></MedlineCitation></PubmedArticle></PubmedArticleSet>"""
        a = _parse_efetch_xml(xml)["555"]
        assert a.authors == ["Diabetes Prevention Program Group"]


class TestFailureHandling:
    def test_transport_error_retries_once_then_raises(self):
        attempts = {"n": 0}

        def handler(request):
            attempts["n"] += 1
            raise httpx.ConnectError("simulated connection failure", request=request)

        with pytest.raises(PubMedUnavailableError):
            _client_with(handler).search("diabetes", max_results=3)
        assert attempts["n"] == 2  # one attempt + one retry, never a loop

    def test_http_500_retries_once_then_raises(self):
        attempts = {"n": 0}

        def handler(request):
            attempts["n"] += 1
            return httpx.Response(500, text="internal server error")

        with pytest.raises(PubMedUnavailableError):
            _client_with(handler).search("diabetes", max_results=3)
        assert attempts["n"] == 2

    def test_rate_limit_429_retries_once_then_raises(self):
        attempts = {"n": 0}

        def handler(request):
            attempts["n"] += 1
            return httpx.Response(429, text="rate limited")

        with pytest.raises(PubMedUnavailableError):
            _client_with(handler).search("diabetes", max_results=3)
        assert attempts["n"] == 2

    def test_succeeds_after_one_transient_failure(self):
        """The retry actually has to work, not just exist — first attempt
        fails, second succeeds."""
        attempts = {"n": 0}

        def handler(request):
            attempts["n"] += 1
            if attempts["n"] == 1:
                return httpx.Response(503, text="temporarily unavailable")
            return _ok_handler(request)

        results = _client_with(handler).search("diabetes", max_results=2)
        assert len(results) == 2

    def test_http_400_does_not_retry(self):
        """A client error (bad request) is not transient — retrying it
        would just fail the same way again, so it should raise immediately."""
        attempts = {"n": 0}

        def handler(request):
            attempts["n"] += 1
            return httpx.Response(400, text="bad request")

        with pytest.raises(httpx.HTTPStatusError):
            _client_with(handler).search("diabetes", max_results=3)
        assert attempts["n"] == 1


class TestNotConfigured:
    def test_not_configured_client_raises_not_implemented(self):
        with pytest.raises(NotImplementedError):
            NotConfiguredPubMedClient().search("diabetes")

    def test_get_pubmed_client_returns_not_configured_when_email_unset(self, monkeypatch):
        import app.services.pubmed as pubmed_module

        monkeypatch.setattr(pubmed_module, "PUBMED_EMAIL", "")
        monkeypatch.setattr(pubmed_module, "_client", None)
        client = pubmed_module.get_pubmed_client()
        assert client.name == "not_configured"

    def test_get_pubmed_client_returns_real_client_when_email_set(self, monkeypatch):
        import app.services.pubmed as pubmed_module

        monkeypatch.setattr(pubmed_module, "PUBMED_EMAIL", "test@example.com")
        monkeypatch.setattr(pubmed_module, "_client", None)
        client = pubmed_module.get_pubmed_client()
        assert client.name == "eutils"


class TestPubMedArticleModel:
    def test_url_is_constructed_from_pmid(self):
        article = PubMedArticle(pmid="12345", title="T", journal="J")
        assert article.url == "https://pubmed.ncbi.nlm.nih.gov/12345/"

    def test_to_dict_round_trips_all_fields(self):
        article = PubMedArticle(
            pmid="1", title="T", journal="J", year="2021",
            authors=["A B"], abstract="Abs.", doi="10.1/x", article_type=["Review"],
        )
        d = article.to_dict()
        assert d == {
            "pmid": "1", "title": "T", "journal": "J", "year": "2021",
            "authors": ["A B"], "abstract": "Abs.", "doi": "10.1/x",
            "article_type": ["Review"], "url": article.url,
        }

    def test_defaults_never_fabricate_missing_fields(self):
        article = PubMedArticle(pmid="1", title="T", journal="J")
        assert article.year is None
        assert article.abstract is None
        assert article.doi is None
        assert article.authors == []
        assert article.article_type == []


class TestNoAPIKeyLoggedOrHardcoded:
    def test_no_hardcoded_api_key_or_email_in_source(self):
        import inspect

        import app.services.pubmed as pubmed_module

        source = inspect.getsource(pubmed_module)
        # Only ever read from the environment — never a literal credential.
        assert 'PUBMED_API_KEY = os.environ.get("PUBMED_API_KEY"' in source
        assert 'PUBMED_EMAIL = os.environ.get("PUBMED_EMAIL"' in source

    def test_httpx_request_logger_is_capped_at_warning(self):
        """The actual fix, tested directly: importing this module caps
        httpx's own logger at WARNING. Needed because httpx logs the full
        request URL — api_key included, as an E-utilities query param — at
        INFO by default, independent of anything app/services/pubmed.py
        logs itself. Without this, app/main.py's real startup config
        (logging.basicConfig(level=logging.INFO)) would let that leak
        straight into application logs in normal operation, not just in a
        test."""
        import logging

        import app.services.pubmed  # noqa: F401 — import side effect is what's under test

        assert logging.getLogger("httpx").level == logging.WARNING

    def test_api_key_not_logged_by_this_modules_own_logger(self, caplog):
        """This module's own log statements never include the key,
        independent of the httpx-level fix above."""
        import logging

        caplog.set_level(logging.INFO, logger="medgenesis.pubmed")
        client = EutilsPubMedClient(
            email="test@example.com", api_key="SECRET_KEY_VALUE", client=httpx.Client(transport=httpx.MockTransport(_ok_handler))
        )
        client.search("diabetes", max_results=2)
        assert "SECRET_KEY_VALUE" not in caplog.text
