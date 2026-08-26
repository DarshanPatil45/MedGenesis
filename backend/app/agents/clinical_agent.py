"""Clinical Analysis Agent.

SCAFFOLDING ONLY — establishes the extension point and conventions this
agent will follow; no reasoning or prompts are implemented yet. See
docs/ARCHITECTURE.md for what's implemented vs. planned.

Planned responsibilities (MASTER_PROJECT_INSTRUCTION §10): read the Patient
Digital Twin (via services/twin.py — no second twin service) and a
screening-risk output (the existing RandomForest today; optionally the
XGBoost candidate once app/ml/xgboost_model/ is implemented), and produce a
structured clinical summary. Must never invent missing information, never
diagnose autonomously, and must clearly separate model output from medical
evidence — the same non-fabrication principle every other agent in this
project already follows.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ClinicalAnalysisResult:
    """Shape planned for the eventual implementation — fields match what
    MASTER_PROJECT_INSTRUCTION §10 asks the Clinical Analysis Agent to
    produce. Not populated by anything yet."""

    status: str = "not_implemented"
    structured_summary: str | None = None
    key_factors: list[str] = field(default_factory=list)
    model_risk_estimate: dict[str, Any] | None = None
    evidence_gaps: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "structured_summary": self.structured_summary,
            "key_factors": self.key_factors,
            "model_risk_estimate": self.model_risk_estimate,
            "evidence_gaps": self.evidence_gaps,
        }


class ClinicalAnalysisAgent:
    name = "ClinicalAnalysisAgent"

    def run(self, twin_state: dict[str, Any], risk_output: dict[str, Any]) -> ClinicalAnalysisResult:
        """Will read twin_state (from services/twin.get_current_state) and a
        screening-risk result and produce a structured clinical summary —
        never diagnosing, never inventing missing fields.

        Not implemented in this phase.
        """
        raise NotImplementedError(
            "ClinicalAnalysisAgent is scaffolding only in this phase — no reasoning is "
            "implemented. See docs/ARCHITECTURE.md for the planned implementation."
        )


_agent: ClinicalAnalysisAgent | None = None


def get_clinical_agent() -> ClinicalAnalysisAgent:
    global _agent
    if _agent is None:
        _agent = ClinicalAnalysisAgent()
    return _agent
