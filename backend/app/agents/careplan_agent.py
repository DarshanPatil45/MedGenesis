"""Care-Plan Recommendation Agent.

Rules-driven core (careplan_rules.py) decides every substantive field. The
local LLM, when available, only rephrases that decided plan into friendlier
prose — it never chooses the recommendations, so plan content stays
deterministic and reviewable. Evidence Agent sources are always cited.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.agents.careplan_rules import build_plan
from app.agents.evidence_agent import get_evidence_agent
from app.services.llm import get_llm

CAREPLAN_SYSTEM_PROMPT = """You are a diabetes health-education assistant writing a short, \
encouraging summary of a lifestyle plan that has ALREADY been decided by a clinical rules engine.

Strict rules:
- Rephrase only. Do not add, remove, or change any recommendation.
- Never diagnose, never mention medication or dosages, never state that the reader has or \
does not have diabetes.
- Do not promise outcomes. Use "may help" / "is associated with" phrasing.
- 120 words maximum, warm and plain-language, second person.
- End by encouraging the reader to discuss the plan with a clinician."""


@dataclass
class CarePlanResult:
    diet_focus: str
    activity_target: str
    monitoring_frequency: str
    follow_up_weeks: int
    narrative_text: str
    notes: list[str] = field(default_factory=list)
    sources: list[dict[str, Any]] = field(default_factory=list)
    generated_by: str = "rules"
    risk_tier: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "diet_focus": self.diet_focus,
            "activity_target": self.activity_target,
            "monitoring_frequency": self.monitoring_frequency,
            "follow_up_weeks": self.follow_up_weeks,
            "narrative_text": self.narrative_text,
            "notes": self.notes,
            "sources": self.sources,
            "generated_by": self.generated_by,
            "risk_tier": self.risk_tier,
        }


class CarePlanAgent:
    name = "CarePlanRecommendationAgent"

    def run(
        self,
        state: dict[str, Any],
        risk_tier: str | None,
        screening_status: str = "scored",
        use_llm: bool = True,
    ) -> CarePlanResult:
        tier_key = risk_tier if screening_status == "scored" else "unavailable"
        plan = build_plan(tier_key, state)

        evidence = get_evidence_agent()
        query = f"type 2 diabetes {risk_tier or ''} risk lifestyle diet physical activity monitoring"
        chunks = evidence.retrieve(query)

        deterministic = self._deterministic_narrative(plan, risk_tier, screening_status, chunks)
        narrative, generated_by = deterministic, "rules"

        if use_llm:
            phrased = get_llm().generate(CAREPLAN_SYSTEM_PROMPT, self._llm_prompt(plan, risk_tier))
            if phrased:
                citations = "\n\nSources: " + "; ".join(c.citation for c in chunks)
                narrative, generated_by = phrased + citations, "rules+llm"

        return CarePlanResult(
            diet_focus=plan["diet_focus"],
            activity_target=plan["activity_target"],
            monitoring_frequency=plan["monitoring_frequency"],
            follow_up_weeks=plan["follow_up_weeks"],
            narrative_text=narrative,
            notes=plan["notes"],
            sources=[c.to_dict() for c in chunks],
            generated_by=generated_by,
            risk_tier=risk_tier,
        )

    @staticmethod
    def _llm_prompt(plan: dict[str, Any], risk_tier: str | None) -> str:
        notes = "\n".join(f"- {n}" for n in plan["notes"]) or "- (none)"
        return (
            f"Screening-risk tier: {risk_tier or 'not available for this profile'}\n"
            f"Diet focus: {plan['diet_focus']}\n"
            f"Activity target: {plan['activity_target']}\n"
            f"Monitoring: {plan['monitoring_frequency']}\n"
            f"Follow-up: {plan['follow_up_weeks']} weeks\n"
            f"Additional notes:\n{notes}\n\n"
            "Rewrite this as a short encouraging summary following your rules."
        )

    @staticmethod
    def _deterministic_narrative(plan, risk_tier, screening_status, chunks) -> str:
        if screening_status == "scored":
            opening = (
                f"Based on an educational screening-risk baseline of {risk_tier} tier, here is a "
                "lifestyle-focused plan to discuss with your clinician."
            )
        else:
            opening = (
                "A screening-risk baseline could not be produced for this profile, so this plan "
                "follows general public-health guidance rather than an individual risk score."
            )
        parts = [
            opening,
            f"Diet: {plan['diet_focus']}",
            f"Activity: {plan['activity_target']}",
            f"Monitoring: {plan['monitoring_frequency']}",
            f"Suggested follow-up: in about {plan['follow_up_weeks']} weeks.",
        ]
        parts.extend(plan["notes"])
        if chunks:
            parts.append("Sources: " + "; ".join(c.citation for c in chunks))
        return "\n\n".join(parts)


_agent: CarePlanAgent | None = None


def get_careplan_agent() -> CarePlanAgent:
    global _agent
    if _agent is None:
        _agent = CarePlanAgent()
    return _agent
