"""Optional LIVE PubMed smoke test (Phase 5 Step 30).

NOT part of the required offline suite — every test in this file is
skipped unless explicitly opted into, because it makes a real network call
to NCBI's E-utilities API. This is deliberate: the required suite
(everything else under tests/) must never depend on live PubMed
availability (Phase 5 Step 29), but a genuine end-to-end check against the
real API is still valuable to have on hand.

To run it:
    PUBMED_EMAIL=you@example.com MEDGENESIS_RUN_LIVE_PUBMED_TEST=true \
        pytest tests/test_pubmed_live.py -v -s

It performs exactly one small query for a small number of results, only
reads data (never writes/modifies anything on NCBI's side), and asserts
only on the *shape* of a real response (a non-empty PMID/title/URL) — never
on specific paper content, since that could legitimately change over time
as NCBI's index updates.
"""

from __future__ import annotations

import os

import pytest

RUN_LIVE = os.environ.get("MEDGENESIS_RUN_LIVE_PUBMED_TEST", "").lower() in ("1", "true", "yes")
EMAIL = os.environ.get("PUBMED_EMAIL", "").strip()

pytestmark = pytest.mark.skipif(
    not (RUN_LIVE and EMAIL),
    reason=(
        "Live PubMed test skipped by default (Phase 5 Step 30). Set "
        "MEDGENESIS_RUN_LIVE_PUBMED_TEST=true and PUBMED_EMAIL to opt in."
    ),
)


def test_live_search_returns_real_pmid_and_title():
    from app.services.pubmed import EutilsPubMedClient

    client = EutilsPubMedClient(email=EMAIL)
    results = client.search("type 2 diabetes physical activity", max_results=2)

    assert results, "Live PubMed query returned zero results — either NCBI is unreachable or the query needs revisiting."
    for article in results:
        assert article.pmid.isdigit()
        assert article.title
        assert article.url == f"https://pubmed.ncbi.nlm.nih.gov/{article.pmid}/"
    print(f"\n[LIVE PUBMED RESULT] {[(a.pmid, a.title) for a in results]}")
