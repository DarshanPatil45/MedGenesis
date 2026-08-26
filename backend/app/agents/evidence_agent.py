"""Evidence Retrieval (RAG) Agent.

Returns top-k cited passages from the local knowledge base. Downstream
agents must cite these rather than paraphrase freely — the citation string
travels with the text so a care plan or chat reply can always be traced back
to a specific source section, URL, and access date.
"""

from __future__ import annotations

from typing import Any

from app.services.rag import EvidenceChunk, get_store


class EvidenceAgent:
    name = "EvidenceRetrievalAgent"

    def retrieve(self, query: str, k: int = 3) -> list[EvidenceChunk]:
        return get_store().query(query, k=k)

    def retrieve_as_dicts(self, query: str, k: int = 3) -> list[dict[str, Any]]:
        return [c.to_dict() for c in self.retrieve(query, k=k)]

    @property
    def backend_name(self) -> str:
        return get_store().backend_name

    @staticmethod
    def format_citations(chunks: list[EvidenceChunk]) -> list[str]:
        return [c.citation for c in chunks]


_agent: EvidenceAgent | None = None


def get_evidence_agent() -> EvidenceAgent:
    global _agent
    if _agent is None:
        _agent = EvidenceAgent()
    return _agent
