"""PubMed retrieval service — NCBI E-utilities client.

Design: a `PubMedClient` protocol plus dependency injection, mirroring how
app/services/rag.py already swaps between a real backend (ChromaDB) and a
fallback (keyword ranker) behind one interface, and how app/services/llm.py
tries multiple backends behind `get_llm()`. `get_pubmed_client()` returns a
real eutils-backed client when `PUBMED_EMAIL` is configured (NCBI's usage
policy asks for an identifying email with every request; an API key only
raises the rate limit and stays optional), otherwise the same
`NotConfiguredPubMedClient` this module has always used.

Every article record preserves only metadata NCBI actually returns (title,
journal, year, PMID, authors, DOI, article type, abstract) — nothing here
is paraphrased into an unsourced claim, and a missing field (e.g. no
abstract) is left `None`/empty rather than invented (Phase 5 Step 6/22).

Tests must never depend on live PubMed availability — `EutilsPubMedClient`
accepts an injectable `httpx.Client` (e.g. built with `httpx.MockTransport`)
for exactly this reason; see tests/test_pubmed.py.
"""

from __future__ import annotations

import logging
import os
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

logger = logging.getLogger("medgenesis.pubmed")

# httpx's own request-line logging (independent of anything this module
# logs itself) is verbose enough to include the full request URL — and
# api_key is a URL query parameter for E-utilities, so at INFO level
# httpx's default logger would print it in plaintext. This module never
# logs the key itself (see _get() below), but that guarantee is worthless
# if the underlying HTTP client leaks it anyway — so httpx's logger is
# capped at WARNING here, at import time, regardless of whatever level the
# application's root logger is configured at (app/main.py sets root to
# INFO on startup). Caught by tests/test_pubmed.py::
# test_api_key_not_logged, which failed against the full test suite (every
# other test file's app startup already raises the root level to INFO)
# before this fix, despite passing in isolation.
logging.getLogger("httpx").setLevel(logging.WARNING)

PUBMED_API_KEY = os.environ.get("PUBMED_API_KEY", "").strip()
PUBMED_EMAIL = os.environ.get("PUBMED_EMAIL", "").strip()
PUBMED_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
PUBMED_TIMEOUT_SECONDS = float(os.environ.get("PUBMED_TIMEOUT_SECONDS", "10"))
# NCBI's E-utilities usage policy: identify the tool making requests.
NCBI_TOOL = "medgenesis"
# One retry only, after a short fixed delay, for a transient failure
# (network error, 5xx, HTTP 429) — never a retry loop (Phase 5 Step 13).
RETRY_DELAY_SECONDS = 1.0


class PubMedUnavailableError(RuntimeError):
    """Raised when a PubMed request fails after the single retry. Callers
    (app/services/rag.py's multi-source layer) catch this and gracefully
    omit PubMed rather than let it take down local RAG (Phase 5 Step 15)."""


@dataclass
class PubMedArticle:
    pmid: str
    title: str
    journal: str
    year: str | None = None
    authors: list[str] = field(default_factory=list)
    abstract: str | None = None
    doi: str | None = None
    article_type: list[str] = field(default_factory=list)

    @property
    def url(self) -> str:
        return f"https://pubmed.ncbi.nlm.nih.gov/{self.pmid}/"

    def to_dict(self) -> dict[str, Any]:
        return {
            "pmid": self.pmid,
            "title": self.title,
            "journal": self.journal,
            "year": self.year,
            "authors": self.authors,
            "abstract": self.abstract,
            "doi": self.doi,
            "article_type": self.article_type,
            "url": self.url,
        }


class PubMedClient(Protocol):
    """Interface a real (eutils-backed) and a test/mock client both satisfy."""

    name: str

    def search(self, query: str, max_results: int = 5) -> list[PubMedArticle]: ...


class NotConfiguredPubMedClient:
    """Default client when PUBMED_EMAIL isn't set.

    Deliberately raises rather than returning a silently-empty or
    fabricated result, so a caller can't mistake "not configured" for
    "searched and found nothing." app/services/rag.py's multi-source layer
    catches this exactly like a live failure — PubMed being unconfigured
    degrades to "no PubMed evidence," never a crash.
    """

    name = "not_configured"

    def search(self, query: str, max_results: int = 5) -> list[PubMedArticle]:
        raise NotImplementedError(
            "PubMed is not configured — set PUBMED_EMAIL in backend/.env to enable it "
            "(see backend/.env.example). PUBMED_API_KEY is optional; it only raises the "
            "NCBI rate limit."
        )


class EutilsPubMedClient:
    """Real client for the NCBI E-utilities API (ESearch + EFetch).

    ESearch returns PMIDs already ranked by relevance but with no numeric
    relevance score at all — EFetch's XML then supplies the actual article
    metadata for those PMIDs. Results are re-ordered to match ESearch's
    ranking (EFetch does not guarantee it preserves input order).
    """

    name = "eutils"

    def __init__(
        self,
        email: str = PUBMED_EMAIL,
        api_key: str = PUBMED_API_KEY,
        timeout: float = PUBMED_TIMEOUT_SECONDS,
        client: httpx.Client | None = None,
    ):
        self.email = email
        self.api_key = api_key
        self.timeout = timeout
        # Tests inject a client built with httpx.MockTransport; production
        # code leaves this None and gets a real network-backed client.
        self._client = client or httpx.Client(timeout=timeout)

    def _common_params(self) -> dict[str, str]:
        params = {"tool": NCBI_TOOL, "email": self.email}
        if self.api_key:
            params["api_key"] = self.api_key
        return params

    def _get(self, endpoint: str, params: dict[str, Any]) -> httpx.Response:
        url = f"{PUBMED_BASE_URL}/{endpoint}"
        full_params = {**self._common_params(), **params}
        attempts_left = 2  # one real attempt + one retry, never a loop
        last_exc: Exception | None = None
        while attempts_left > 0:
            attempts_left -= 1
            start = time.perf_counter()
            try:
                resp = self._client.get(url, params=full_params)
                latency = time.perf_counter() - start
                if resp.status_code == 429 or resp.status_code >= 500:
                    logger.warning(
                        "PubMed %s returned %s (latency=%.3fs); %s",
                        endpoint, resp.status_code, latency,
                        "retrying once" if attempts_left else "giving up",
                    )
                    last_exc = PubMedUnavailableError(f"{endpoint} returned HTTP {resp.status_code}")
                    if attempts_left:
                        time.sleep(RETRY_DELAY_SECONDS)
                        continue
                    raise last_exc
                resp.raise_for_status()
                logger.info(
                    "PubMed %s ok (latency=%.3fs, query_len=%d)",
                    endpoint, latency, len(str(full_params.get("term", full_params.get("id", "")))),
                )
                return resp
            except httpx.TransportError as exc:
                # Network-level failure (timeout, connection error) — same
                # single-retry treatment as a 5xx/429 response above.
                last_exc = PubMedUnavailableError(f"{endpoint} request failed: {exc}")
                if attempts_left:
                    logger.warning("PubMed %s transport error (%s); retrying once.", endpoint, exc)
                    time.sleep(RETRY_DELAY_SECONDS)
                    continue
                raise last_exc from exc
        # Unreachable in practice (the loop always returns or raises), but
        # keeps the type checker honest and fails loudly rather than
        # returning None if the loop logic above is ever changed.
        raise last_exc or PubMedUnavailableError(f"{endpoint} request failed for an unknown reason")

    def search(self, query: str, max_results: int = 5) -> list[PubMedArticle]:
        # Minimal normalization only (Phase 5 Step 28) — no medical-term
        # rewriting, no LLM involvement.
        normalized = " ".join(query.split())
        if not normalized:
            return []

        esearch = self._get(
            "esearch.fcgi",
            {"db": "pubmed", "term": normalized, "retmax": max_results, "retmode": "json"},
        )
        try:
            pmids: list[str] = esearch.json().get("esearchresult", {}).get("idlist", [])
        except ValueError as exc:  # json.JSONDecodeError is a ValueError subclass
            raise PubMedUnavailableError(f"esearch.fcgi returned a malformed JSON response: {exc}") from exc
        if not pmids:
            return []

        efetch = self._get(
            "efetch.fcgi",
            {"db": "pubmed", "id": ",".join(pmids), "retmode": "xml", "rettype": "abstract"},
        )
        articles_by_pmid = _parse_efetch_xml(efetch.text)
        # Re-order to match ESearch's relevance ranking; silently drop any
        # PMID EFetch didn't return an article for rather than erroring —
        # a partial result is more useful than none (Phase 5 Step 29:
        # "malformed article" must degrade gracefully, not crash the batch).
        return [articles_by_pmid[pmid] for pmid in pmids if pmid in articles_by_pmid]


def _text_or_none(el: ET.Element | None) -> str | None:
    if el is None or el.text is None:
        return None
    text = el.text.strip()
    return text or None


def _parse_efetch_xml(xml_text: str) -> dict[str, PubMedArticle]:
    """Parses an EFetch abstract-XML response into PubMedArticle records,
    keyed by PMID. A single malformed <PubmedArticle> is skipped (logged),
    not allowed to fail the whole batch."""
    out: dict[str, PubMedArticle] = {}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        logger.warning("PubMed EFetch response was not valid XML: %s", exc)
        return out

    for article_el in root.findall(".//PubmedArticle"):
        try:
            pmid = _text_or_none(article_el.find(".//PMID"))
            if not pmid:
                continue

            title = _text_or_none(article_el.find(".//ArticleTitle")) or ""

            journal = _text_or_none(article_el.find(".//Journal/Title")) or _text_or_none(
                article_el.find(".//Journal/ISOAbbreviation")
            ) or ""

            year = _text_or_none(article_el.find(".//JournalIssue/PubDate/Year")) or _text_or_none(
                article_el.find(".//JournalIssue/PubDate/MedlineDate")
            )

            authors: list[str] = []
            for author_el in article_el.findall(".//AuthorList/Author"):
                last = _text_or_none(author_el.find("LastName"))
                initials = _text_or_none(author_el.find("Initials"))
                if last:
                    authors.append(f"{last} {initials}".strip() if initials else last)
                else:
                    collective = _text_or_none(author_el.find("CollectiveName"))
                    if collective:
                        authors.append(collective)

            # Structured abstracts carry a Label per section (e.g.
            # "BACKGROUND", "METHODS") — preserved inline as plain text
            # rather than split into separate chunks, keeping the existing
            # one-chunk-per-source-unit convention (docs/RAG.md "PubMed
            # Integration" documents this choice explicitly).
            abstract_parts = []
            for ab_el in article_el.findall(".//Abstract/AbstractText"):
                label = ab_el.get("Label")
                text = "".join(ab_el.itertext()).strip()
                if not text:
                    continue
                abstract_parts.append(f"{label}: {text}" if label else text)
            abstract = " ".join(abstract_parts) or None  # never fabricate a placeholder abstract

            doi = None
            for id_el in article_el.findall(".//ArticleIdList/ArticleId"):
                if id_el.get("IdType") == "doi":
                    doi = _text_or_none(id_el)
                    break

            article_type = [
                t for t in (_text_or_none(el) for el in article_el.findall(".//PublicationTypeList/PublicationType"))
                if t
            ]

            out[pmid] = PubMedArticle(
                pmid=pmid,
                title=title,
                journal=journal,
                year=year,
                authors=authors,
                abstract=abstract,
                doi=doi,
                article_type=article_type,
            )
        except Exception as exc:  # noqa: BLE001 — one bad record must not sink the batch
            logger.warning("Skipping a malformed PubMed article record: %s", exc)
            continue

    return out


_client: PubMedClient | None = None


def get_pubmed_client() -> PubMedClient:
    """Returns a live eutils-backed client when PUBMED_EMAIL is configured
    (NCBI's usage policy requires an identifying email), matching the
    try-the-real-backend-then-fall-back pattern in services/rag.py —
    otherwise the same NotConfiguredPubMedClient this module has always
    returned."""
    global _client
    if _client is None:
        _client = EutilsPubMedClient() if PUBMED_EMAIL else NotConfiguredPubMedClient()
    return _client
