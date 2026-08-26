"""What-if Simulation Agent.

Forks a Digital Twin snapshot (copy-on-write — never writes back into the
real timeline), applies the transparent delta model in simulation_rules.py
across the requested horizon, and re-scores each projected feature vector
through the already-trained screening model to produce a RISK TRAJECTORY
rather than a single number.

Eligibility is gated exactly as in the Screening Agent, and for the same
reason: an ineligible profile cannot produce a meaningful score, so it
cannot produce a meaningful projection either.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.agents.screening_agent import (
    EDUCATIONAL_SCOPE,
    STATUS_SCORED,
    STATUS_UNAVAILABLE,
    check_eligibility,
    get_screening_agent,
)
from app.agents.simulation_nlp import parse as parse_hypothesis_text
from app.agents.simulation_rules import (
    Hypothesis,
    effective_deltas,
    horizon_steps,
    project_state,
)

SIMULATION_LABEL = "simulated projection, not a clinical forecast"


@dataclass
class SimulationResult:
    status: str
    scope: str = EDUCATIONAL_SCOPE
    label: str = SIMULATION_LABEL
    hypothesis: dict[str, Any] = field(default_factory=dict)
    trajectory: list[dict[str, Any]] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    unavailable_reason: str | None = None
    base_timeline_event_id: int | None = None
    summary_text: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "scope": self.scope,
            "label": self.label,
            "hypothesis": self.hypothesis,
            "trajectory": self.trajectory,
            "assumptions": self.assumptions,
            "unavailable_reason": self.unavailable_reason,
            "base_timeline_event_id": self.base_timeline_event_id,
            "summary_text": self.summary_text,
        }


class SimulationAgent:
    name = "WhatIfSimulationAgent"

    def run(
        self,
        snapshot: dict[str, Any],
        hypothesis_data: dict[str, Any] | None = None,
        base_timeline_event_id: int | None = None,
        hypothesis_text: str | None = None,
    ) -> SimulationResult:
        """`hypothesis_data` (structured deltas) takes precedence when both
        are given. `hypothesis_text` is only parsed when no structured
        hypothesis was provided — see simulation_nlp.py for why unparseable
        text is reported rather than guessed at."""
        eligible, reason = check_eligibility(snapshot)
        if not eligible:
            return SimulationResult(
                status=STATUS_UNAVAILABLE,
                hypothesis=hypothesis_data or {},
                unavailable_reason=reason,
                base_timeline_event_id=base_timeline_event_id,
                summary_text="Simulation unavailable for this profile. " + (reason or ""),
            )

        parse_notes: list[str] = []
        if not (hypothesis_data or {}) and hypothesis_text:
            parsed = parse_hypothesis_text(hypothesis_text)
            if not parsed.recognized:
                return SimulationResult(
                    status=STATUS_UNAVAILABLE,
                    hypothesis={},
                    unavailable_reason=parsed.message,
                    base_timeline_event_id=base_timeline_event_id,
                    summary_text="Could not turn this scenario into a simulation. " + parsed.message,
                )
            hypothesis_data = parsed.hypothesis
            parse_notes = parsed.notes

        hypothesis = Hypothesis.from_dict(hypothesis_data or {})

        if hypothesis.is_empty():
            return SimulationResult(
                status=STATUS_UNAVAILABLE,
                hypothesis=hypothesis.to_dict(),
                unavailable_reason=(
                    "No change was specified. Provide at least one of: bmi_delta, "
                    "weight_kg_delta, activity_minutes_delta, smoker_delta — or "
                    "describe a scenario in your own words."
                ),
                base_timeline_event_id=base_timeline_event_id,
                summary_text="Simulation needs at least one hypothesised change.",
            )

        deltas, flag_targets, assumptions = effective_deltas(hypothesis, snapshot)
        assumptions = parse_notes + assumptions
        screening = get_screening_agent()

        trajectory: list[dict[str, Any]] = []
        for week in horizon_steps(hypothesis.horizon_weeks):
            fraction = week / hypothesis.horizon_weeks if hypothesis.horizon_weeks else 0.0
            projected = project_state(snapshot, deltas, flag_targets, fraction)
            probability, tier = screening.score_vector(projected)
            trajectory.append(
                {
                    "week": week,
                    "risk_probability": round(probability, 4),
                    "risk_tier": tier,
                    "bmi": projected.get("bmi"),
                    "phys_activity": projected.get("phys_activity"),
                    "smoker": projected.get("smoker"),
                    "simulated": True,
                }
            )

        start, end = trajectory[0], trajectory[-1]
        change = end["risk_probability"] - start["risk_probability"]
        direction = "decrease" if change < 0 else "increase" if change > 0 else "no change"

        return SimulationResult(
            status=STATUS_SCORED,
            hypothesis=hypothesis.to_dict(),
            trajectory=trajectory,
            assumptions=assumptions,
            base_timeline_event_id=base_timeline_event_id,
            summary_text=(
                f"Over {hypothesis.horizon_weeks} weeks this scenario projects a {direction} in the "
                f"educational screening-risk score from {start['risk_probability']:.0%} "
                f"({start['risk_tier']}) to {end['risk_probability']:.0%} ({end['risk_tier']}). "
                f"This is a {SIMULATION_LABEL} — it shows how the trained model responds to changed "
                "inputs, not a prediction of real clinical outcomes."
            ),
        )


_agent: SimulationAgent | None = None


def get_simulation_agent() -> SimulationAgent:
    global _agent
    if _agent is None:
        _agent = SimulationAgent()
    return _agent
