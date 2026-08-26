"""PubMed retrieval service abstraction.

SCAFFOLDING ONLY — no live PubMed calls happen in this phase, and no test
papers, PMIDs, authors, or citations are fabricated anywhere in this module.
See docs/ARCHITECTURE.md for what's implemented vs. planned.

Design: a `PubMedClient` protocol plus dependency injection, mirroring how
app/services/rag.py already swaps between a real backend (ChromaDB) and a
fallback (keyword ranker) behind one interface, and how app/services/llm.py
tries multiple backends behind `get_llm()`. This is deliberately NOT a
concrete implementation calling api.ncbi.nlm.nih.gov — that's a later phase.
Structuring it this way now means the live client can be added and tested
without touching whatever calls `get_pubmed_client()`, and tests can inject
a fake client instead of hitting the network.

Every article record preserves the metadata MASTER_PROJECT_INSTRUCTION §9
requires (title, publication, year, PMID, source URL) — never paraphrased
into an unsourced claim.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Protocol

PUBMED_API_KEY = os.environ.get("PUBMED_API_KEY", "").strip()
PUBMED_EMAIL = os.environ.get("PUBMED_EMAIL", "").strip()
PUBMED_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


@dataclass
class PubMedArticle:
    pmid: str
    title: str
    journal: str
    year: str | None = None
    authors: list[str] = field(default_factory=list)
    abstract: str | None = None

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
            "url": self.url,
        }


class PubMedClient(Protocol):
    """Interface a real (eutils-backed) and a test/mock client both satisfy."""

    name: str

    def search(self, query: str, max_results: int = 5) -> list[PubMedArticle]: ...


class NotConfiguredPubMedClient:
    """Default client while live PubMed integration isn't implemented yet.

    Deliberately raises rather than returning a silently-empty or
    fabricated result, so a caller can't mistake "not implemented" for
    "searched and found nothing."
    """

    name = "not_configured"

    def search(self, query: str, max_results: int = 5) -> list[PubMedArticle]:
        raise NotImplementedError(
            "PubMed retrieval is scaffolding only in this phase — no live calls are made. "
            "See docs/ARCHITECTURE.md for the planned implementation."
        )


_client: PubMedClient | None = None


def get_pubmed_client() -> PubMedClient:
    """Later phases: return a live eutils-backed client when PUBMED_EMAIL
    (required by NCBI's usage policy) is configured, matching the
    try-the-real-backend-then-fall-back pattern in services/rag.py — not
    implemented yet."""
    global _client
    if _client is None:
        _client = NotConfiguredPubMedClient()
    return _client
