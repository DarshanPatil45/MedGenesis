"""Evidence retrieval endpoint (Phase 4, docs/RAG.md).

Read-only: retrieves cited passages from the local knowledge base through
the existing single Evidence Agent (app/agents/evidence_agent.py) and RAG
service (app/services/rag.py) — no new retrieval implementation, no second
evidence system. Not Safety-gated and not persisted, matching the Phase 3
precedent in app/routers/ml.py: the underlying content is a fixed,
pre-vetted CDC/WHO knowledge base, not model output or LLM-generated text,
so there is nothing here for the Safety gate (which reviews *generated*
clinical content) to review.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.agents.evidence_agent import get_evidence_agent
from app.schemas import EvidenceSearchOut, EvidenceSearchRequest

router = APIRouter(prefix="/api/evidence", tags=["evidence"])


@router.post("/search", response_model=EvidenceSearchOut)
def search_evidence(body: EvidenceSearchRequest):
    agent = get_evidence_agent()
    try:
        results = agent.retrieve_as_dicts(body.query, k=body.k) if body.k else agent.retrieve_as_dicts(body.query)
    except Exception as exc:
        # A genuine backend failure (e.g. an embedding call breaking after a
        # successful startup) is a service-unavailable condition — never
        # papered over with fabricated results.
        raise HTTPException(status_code=503, detail=f"Evidence retrieval unavailable: {exc}") from exc
    return EvidenceSearchOut(query=body.query, backend=agent.backend_name, results=results)
