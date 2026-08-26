"""Evaluation and RandomForest-vs-XGBoost comparison.

SCAFFOLDING ONLY — not implemented yet.

IMPORTANT (MASTER_PROJECT_INSTRUCTION §6/§7 and "VERY IMPORTANT: EXISTING
RANDOM FOREST"): when built, this module must compare the two candidates
using actual measured metrics only. It must not assert or imply that
XGBoost outperforms the existing RandomForest baseline unless a real
evaluation run demonstrates that — including the honest possibility that it
does not, which must be reported as-is.
"""

from __future__ import annotations


def compare_to_baseline() -> dict:
    """Will load both models' metadata (RandomForest from
    app/ml/artifacts/screening_model_metadata.json, XGBoost from
    app/ml/xgboost_model/artifacts/) and report a side-by-side metric
    comparison. Reports whichever model actually measures better — never
    assumed in advance.

    Not implemented in this phase — no XGBoost model exists yet to compare.
    """
    raise NotImplementedError(
        "Model comparison is scaffolding only in this phase. "
        "See docs/ARCHITECTURE.md for the planned implementation."
    )
