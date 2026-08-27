"""Evidence Retrieval (RAG) Agent.

Returns top-k cited passages from the local knowledge base. Downstream
agents must cite these rather than paraphrase freely — the citation string
travels with the text so a care plan or chat reply can always be traced back
to a specific source section, URL, and access date.
"""

from __future__ import annotations

from typing import Any

from app.services.rag import DEFAULT_TOP_K, LOCAL_SOURCE, EvidenceChunk, get_store, search_evidence


class EvidenceAgent:
    name = "EvidenceRetrievalAgent"

    def retrieve(self, query: str, k: int = DEFAULT_TOP_K, source: str = LOCAL_SOURCE) -> list[EvidenceChunk]:
        """Returns ranked, relevance-thresholded evidence chunks for `query`
        — an empty list means no sufficiently relevant evidence was found
        (docs/RAG.md "Relevance threshold"), not an error. `query` should be
        a clinical question or a small set of clinical concepts, never a
        serialized Digital Twin or raw model-output object (docs/RAG.md
        "Patient context boundary" / "Model output boundary") — every
        current caller (ConversationalAgent, CarePlanAgent, the
        orchestrator's evidence_node) already builds a short string from at
        most a risk tier, never the full twin state.

        `source` defaults to "local" — the existing local knowledge base —
        exactly as before Phase 5. Pass "pubmed" or "all" to opt into the
        PubMed evidence source (docs/RAG.md "PubMed Integration"); every
        existing caller above omits this argument and is unaffected."""
        return search_evidence(query, k=k, source=source)

    def retrieve_as_dicts(
        self, query: str, k: int = DEFAULT_TOP_K, source: str = LOCAL_SOURCE
    ) -> list[dict[str, Any]]:
        return [c.to_dict() for c in self.retrieve(query, k=k, source=source)]

    @property
    def backend_name(self) -> str:
        return get_store().backend_name

    @staticmethod
    def format_citations(chunks: list[EvidenceChunk]) -> list[str]:
        return [c.citation for c in chunks]

    @staticmethod
    def format_citation_block(chunks: list[EvidenceChunk]) -> str:
        """The Phase 4 Step 19 [E1]/[E2]... citation representation, for a
        future Clinical Agent to attach a specific claim to a specific
        evidence ID and source. Never fabricated — built only from fields
        already present on retrieved EvidenceChunks, never invented."""
        blocks = [f"[E{i}]\n{c.citation_block}" for i, c in enumerate(chunks, start=1)]
        return "\n\n".join(blocks)


_agent: EvidenceAgent | None = None


def get_evidence_agent() -> EvidenceAgent:
    global _agent
    if _agent is None:
        _agent = EvidenceAgent()
    return _agent
