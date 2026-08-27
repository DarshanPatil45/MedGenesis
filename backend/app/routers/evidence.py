"""Evidence retrieval endpoint (Phase 4/5, docs/RAG.md).

Read-only: retrieves cited passages through the existing single Evidence
Agent (app/agents/evidence_agent.py) and RAG service (app/services/rag.py)
— no new retrieval implementation, no second evidence system. Not
Safety-gated and not persisted, matching the Phase 3 precedent in
app/routers/ml.py: local-KB content is fixed and pre-vetted, and a PubMed
failure degrades to an empty result set rather than an error (Phase 5
Step 15), so there is nothing here for the Safety gate (which reviews
*generated* clinical content) to review.

`source` defaults to "local", identical to Phase 4's behavior — a bare
{"query": "..."} request never triggers a PubMed call (Phase 5 Step 12).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.agents.evidence_agent import get_evidence_agent
from app.schemas import EvidenceSearchOut, EvidenceSearchRequest

router = APIRouter(prefix="/api/evidence", tags=["evidence"])


def _backend_descriptor(source: str, agent) -> str:
    from app.services.pubmed import get_pubmed_client

    if source == "local":
        return agent.backend_name
    if source == "pubmed":
        return get_pubmed_client().name
    return f"{agent.backend_name}+{get_pubmed_client().name}"


@router.post("/search", response_model=EvidenceSearchOut)
def search_evidence(body: EvidenceSearchRequest):
    agent = get_evidence_agent()
    kwargs = {"source": body.source}
    if body.k:
        kwargs["k"] = body.k
    try:
        results = agent.retrieve_as_dicts(body.query, **kwargs)
    except Exception as exc:
        # A genuine backend failure (e.g. an embedding call breaking after a
        # successful startup) is a service-unavailable condition — never
        # papered over with fabricated results. PubMed-specific failures
        # never reach here — search_evidence() already absorbs those into
        # an empty result set (Phase 5 Step 15).
        raise HTTPException(status_code=503, detail=f"Evidence retrieval unavailable: {exc}") from exc
    return EvidenceSearchOut(
        query=body.query, source=body.source, backend=_backend_descriptor(body.source, agent), results=results
    )
