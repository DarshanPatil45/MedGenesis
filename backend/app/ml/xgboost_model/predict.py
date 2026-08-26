"""Inference for the XGBoost candidate model.

SCAFFOLDING ONLY — not implemented yet. When built, this will mirror
app/agents/screening_agent.py's load-artifacts-and-score pattern (same
feature vector construction, same eligibility gating) so the existing
Screening Agent can call either model behind one interface.
"""

from __future__ import annotations

from typing import Any


def score_vector(features: dict[str, Any]) -> tuple[float, str]:
    """Will return (probability, risk_tier) for a feature dict, matching
    ScreeningAgent.score_vector()'s signature.

    Not implemented in this phase — no model has been trained to load.
    """
    raise NotImplementedError(
        "XGBoost inference is scaffolding only in this phase. "
        "See docs/ARCHITECTURE.md for the planned implementation."
    )
