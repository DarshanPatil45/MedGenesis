"""A small, deterministic retrieval evaluation set and IR metrics for the
Evidence Agent's RAG backends (docs/RAG.md, Phase 4 Step 23/24).

EVALUATION_QUERIES is hand-written by inspecting the two real knowledge-base
files this project actually ships (data/knowledge_base/*.md) — every
`expected_document_id` names a section that genuinely exists in that content
right now. Nothing here is a fabricated medical claim; these are retrieval
test queries, not sourced facts, and are labelled as such everywhere they're
used (docs/RAG.md "Evaluation").

Each query is written to have exactly one clearly-correct section given the
corpus's actual content, so Hit Rate@k and MRR are meaningful; Precision@k
is reported too but, with one relevant document per query, is mechanically
1/k on every hit and 0 on every miss — included for completeness, not
because it adds information beyond the hit rate here (see docs/RAG.md's
caveat).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

EVALUATION_QUERIES: list[dict[str, str]] = [
    {"query": "What is diabetes and how does insulin work?", "expected_document_id": "cdc_diabetes_basics#what-is-diabetes"},
    {"query": "How is type 2 diabetes different from other types?", "expected_document_id": "cdc_diabetes_basics#type-2-diabetes"},
    {"query": "What does it mean if my blood sugar is higher than normal but not yet diabetes?", "expected_document_id": "cdc_diabetes_basics#prediabetes"},
    {"query": "What factors put someone at higher risk for type 2 diabetes?", "expected_document_id": "cdc_diabetes_basics#risk-factors-for-type-2-diabetes"},
    {"query": "How much exercise should I do each week?", "expected_document_id": "cdc_diabetes_basics#physical-activity"},
    {"query": "What should I eat to help manage blood sugar?", "expected_document_id": "cdc_diabetes_basics#healthy-eating"},
    {"query": "Does losing weight lower my risk of developing diabetes?", "expected_document_id": "cdc_diabetes_basics#weight-management"},
    {"query": "How often should I check my blood sugar, and what is the A1C test?", "expected_document_id": "cdc_diabetes_basics#blood-sugar-monitoring"},
    {"query": "Who is typically part of a diabetes care team?", "expected_document_id": "cdc_diabetes_basics#working-with-a-health-care-team"},
    {"query": "Does smoking or drinking alcohol affect diabetes risk?", "expected_document_id": "cdc_diabetes_basics#smoking-and-alcohol"},
    {"query": "Can poor sleep or stress affect my blood sugar?", "expected_document_id": "cdc_diabetes_basics#sleep-and-stress"},
    {"query": "How many people worldwide are living with diabetes?", "expected_document_id": "who_diabetes_factsheet#global-burden"},
    {"query": "What are the warning signs of diabetes I should watch for?", "expected_document_id": "who_diabetes_factsheet#symptoms"},
    {"query": "How is diabetes diagnosed by a doctor?", "expected_document_id": "who_diabetes_factsheet#diagnosis-and-screening"},
]


@dataclass
class QueryResult:
    query: str
    expected_document_id: str
    retrieved_document_ids: list[str]
    rank_of_expected: int | None  # 1-indexed; None if not retrieved at all

    @property
    def hit(self) -> bool:
        return self.rank_of_expected is not None


def evaluate_query(store: Any, query: str, expected_document_id: str, k: int) -> QueryResult:
    results = store.query(query, k=k)
    retrieved_ids = [c.document_id for c in results]
    rank = retrieved_ids.index(expected_document_id) + 1 if expected_document_id in retrieved_ids else None
    return QueryResult(query, expected_document_id, retrieved_ids, rank)


def run_evaluation(store: Any, k: int = 3, queries: list[dict[str, str]] | None = None) -> dict:
    """Runs every query in `queries` (default: EVALUATION_QUERIES) against
    `store` and computes Hit Rate@k, Precision@k, Recall@k, and MRR. Returns
    per-query detail alongside the aggregate metrics — never just a bare
    number — so a result can always be traced back to which queries missed."""
    queries = queries if queries is not None else EVALUATION_QUERIES
    results = [evaluate_query(store, q["query"], q["expected_document_id"], k) for q in queries]

    n = len(results)
    hits = sum(1 for r in results if r.hit)
    reciprocal_ranks = [1.0 / r.rank_of_expected for r in results if r.hit]

    return {
        "backend": getattr(store, "backend_name", "unknown"),
        "k": k,
        "n_queries": n,
        "hit_rate_at_k": hits / n if n else 0.0,
        # One relevant document per query by construction, so precision@k
        # on a hit is mechanically 1/k and recall@k on a hit is 1.0 — see
        # module docstring.
        "precision_at_k": (hits * (1.0 / k)) / n if n else 0.0,
        "recall_at_k": hits / n if n else 0.0,
        "mrr": sum(reciprocal_ranks) / n if n else 0.0,
        "misses": [r.query for r in results if not r.hit],
        "per_query": [
            {
                "query": r.query,
                "expected_document_id": r.expected_document_id,
                "retrieved_document_ids": r.retrieved_document_ids,
                "rank_of_expected": r.rank_of_expected,
            }
            for r in results
        ],
    }


if __name__ == "__main__":
    import json

    from app.services.rag import get_store

    print(json.dumps(run_evaluation(get_store()), indent=2))
