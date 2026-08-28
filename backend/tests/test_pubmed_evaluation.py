"""Phase 7 Step 24: PubMed retrieval evaluation infrastructure — the
schema and metric computation exist, but PUBMED_EXPERT_EVALUATION_SET
ships empty. No fabricated PMIDs, no invented expert judgments.
"""

from __future__ import annotations

from app.services.rag import KeywordStore, load_chunks
from app.services.retrieval_evaluation import (
    PUBMED_EXPERT_EVALUATION_SET,
    ExpertLabelledQuery,
    run_pubmed_evaluation,
)

CHUNKS = load_chunks()


class TestPubMedEvaluationSetIsEmptyByDesign:
    def test_default_set_ships_empty(self):
        """Not a bug — Step 24 explicitly prohibits fabricating PMID
        ground truth. This is the deliberate default."""
        assert PUBMED_EXPERT_EVALUATION_SET == []


class TestRunPubMedEvaluation:
    def test_empty_set_returns_insufficient_data_not_a_fabricated_metric(self):
        result = run_pubmed_evaluation(KeywordStore(CHUNKS))
        assert result["status"] == "insufficient_data"
        assert "domain-expert" in result["reason"]
        assert "hit_rate_at_k" not in result
        assert "mrr" not in result

    def test_uses_the_real_default_set_when_none_supplied(self, monkeypatch):
        """Confirms the function reads the actual module-level default
        rather than requiring it to be passed explicitly every time."""
        import app.services.retrieval_evaluation as eval_module

        monkeypatch.setattr(eval_module, "PUBMED_EXPERT_EVALUATION_SET", [])
        assert run_pubmed_evaluation(KeywordStore(CHUNKS))["status"] == "insufficient_data"

    def test_mechanism_works_when_expert_labelled_queries_are_supplied(self):
        """Exercises the real metric computation with a test-supplied
        query — never populates the actual default evaluation set, which
        stays empty; this only proves the mechanism is correct."""
        query = ExpertLabelledQuery(
            query="healthy eating and diet",
            expected_documents=["cdc_diabetes_basics#healthy-eating"],
            expert_label="relevant",
        )
        result = run_pubmed_evaluation(KeywordStore(CHUNKS), queries=[query])
        assert result["status"] == "evaluated"
        assert result["n_queries"] == 1
        assert result["hit_rate_at_k"] == 1.0
        assert result["per_query"][0]["expert_label"] == "relevant"

    def test_multiple_expected_documents_any_match_counts_as_a_hit(self):
        query = ExpertLabelledQuery(
            query="healthy eating and diet",
            expected_documents=["pubmed#00000000", "cdc_diabetes_basics#healthy-eating"],
            expert_label="relevant",
        )
        result = run_pubmed_evaluation(KeywordStore(CHUNKS), queries=[query])
        assert result["hit_rate_at_k"] == 1.0

    def test_miss_when_no_expected_document_is_retrieved(self):
        query = ExpertLabelledQuery(
            query="healthy eating and diet",
            expected_documents=["pubmed#00000000"],
            expert_label="relevant",
        )
        result = run_pubmed_evaluation(KeywordStore(CHUNKS), queries=[query])
        assert result["hit_rate_at_k"] == 0.0
        assert result["per_query"][0]["rank_of_first_expected_match"] is None
