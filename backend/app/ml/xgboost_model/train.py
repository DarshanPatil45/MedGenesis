"""Training entry point for the XGBoost candidate model.

SCAFFOLDING ONLY. Establishes the module/CLI interface
(`python -m app.ml.xgboost_model.train`) that a later phase will fill in.
Deliberately does not train anything, save any artifact, or fabricate any
metric in this phase — see docs/ARCHITECTURE.md for what's implemented vs.
planned, and MASTER_PROJECT_INSTRUCTION §6/§7 for why fabricated metrics are
explicitly disallowed.
"""

from __future__ import annotations


def train_and_evaluate() -> dict:
    """Will train the XGBoost candidate and return metadata in the same
    shape as app/ml/train_screening_model.py::train_and_evaluate(), so the
    two candidates can be compared like-for-like by model_comparison.py.

    Not implemented in this phase.
    """
    raise NotImplementedError(
        "XGBoost training is scaffolding only in this phase — no model has "
        "been trained. See docs/ARCHITECTURE.md for the planned implementation."
    )


if __name__ == "__main__":
    train_and_evaluate()
