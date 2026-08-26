"""Evaluation and RandomForest-vs-XGBoost comparison.

Thin wrapper around app/ml/model_comparison.py (the single implementation
of the comparison logic — Phase 3 Step 15 asked for that module to live at
the top-level app/ml/ package, alongside the RandomForest baseline it
compares against, rather than nested inside this XGBoost-only package).
Kept here too so `python -m app.ml.xgboost_model.evaluate` — the interface
this module has exposed since Phase 1's scaffolding — keeps working.

Run:
    python -m app.ml.xgboost_model.evaluate
"""

from __future__ import annotations

import json

from app.ml import model_comparison


def compare_to_baseline() -> dict:
    """Loads both models' metadata (RandomForest from
    app/ml/artifacts/screening_model_metadata.json, XGBoost from
    app/ml/xgboost_model/artifacts/) and reports a side-by-side metric
    comparison — whichever model actually measures better, never assumed
    in advance."""
    return model_comparison.compare()


if __name__ == "__main__":
    print(json.dumps(compare_to_baseline(), indent=2))
