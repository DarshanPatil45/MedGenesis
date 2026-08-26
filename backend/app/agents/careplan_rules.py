"""Rules table for the Care-Plan Recommendation Agent.

Deterministic core: (risk tier, patient profile) -> plan fields. Kept as
data rather than prose so the plan a given patient receives is reproducible
and reviewable, with the LLM only ever rephrasing what these rules decided.

Targets follow general public-health guidance (CDC: ~150 min/week moderate
activity; ~5-7% body-weight loss in prevention programmes) and are
lifestyle-scoped only — nothing here touches medication, dosage, or
diagnosis, which the Safety Agent blocks independently.
"""

from __future__ import annotations

from typing import Any

BASE_PLANS: dict[str, dict[str, Any]] = {
    "Low": {
        "diet_focus": "Maintain a balanced eating pattern: non-starchy vegetables, whole grains, lean protein, water instead of sugar-sweetened drinks.",
        "activity_target": "Keep up at least 150 minutes per week of moderate activity, plus muscle-strengthening on 2 days.",
        "monitoring_frequency": "Routine check-ups as advised by your clinician; no additional self-monitoring indicated by this educational baseline.",
        "follow_up_weeks": 26,
    },
    "Moderate": {
        "diet_focus": "Reduce refined carbohydrates and sugar-sweetened drinks; build meals around vegetables, whole grains and lean protein with consistent portions and meal timing.",
        "activity_target": "Work up to 150-180 minutes per week of moderate activity spread across most days, plus muscle-strengthening on 2 days.",
        "monitoring_frequency": "Discuss periodic blood glucose testing with your clinician; track weight and activity weekly.",
        "follow_up_weeks": 12,
    },
    "High": {
        "diet_focus": "Prioritise a structured, sustainable eating pattern with reduced refined carbohydrate and saturated fat intake; a registered dietitian can help tailor this.",
        "activity_target": "Build gradually toward 150+ minutes per week of moderate activity, starting from your current level rather than jumping straight to the target.",
        "monitoring_frequency": "Ask your clinician about blood glucose and A1C testing; keep a weekly log of weight, activity and any symptoms.",
        "follow_up_weeks": 6,
    },
    "unavailable": {
        "diet_focus": "General healthy-eating guidance: vegetables, whole grains, lean protein, water in place of sugar-sweetened drinks.",
        "activity_target": "General adult guidance: at least 150 minutes per week of moderate activity, plus muscle-strengthening on 2 days.",
        "monitoring_frequency": "Discuss appropriate screening and monitoring with your clinician — this system could not produce a screening baseline for your profile.",
        "follow_up_weeks": 12,
    },
}

AGE_MODIFIER_THRESHOLD = 45
AGE_MODIFIER_NOTE = (
    "Age 45+ is listed as a type 2 diabetes risk factor, so discussing a baseline screening "
    "test with your clinician is reasonable even at a lower risk tier."
)

BMI_MODIFIER_THRESHOLD = 30.0
BMI_MODIFIER_NOTE = (
    "Prevention programmes report meaningful risk reduction from losing about 5-7% of starting "
    "body weight combined with regular activity — a gradual, sustained change is the goal."
)

INACTIVITY_NOTE = (
    "No physical activity in the past 30 days is on file; adding short walks after meals is a "
    "common way to start without a big schedule change."
)

SMOKER_NOTE = (
    "Quitting smoking lowers the risk of serious diabetes-related complications, including heart "
    "and kidney disease — ask a clinician about support programmes and cessation aids."
)


def build_plan(risk_tier: str | None, state: dict[str, Any]) -> dict[str, Any]:
    plan = dict(BASE_PLANS.get(risk_tier or "unavailable", BASE_PLANS["unavailable"]))
    notes: list[str] = []

    age = state.get("age")
    if isinstance(age, (int, float)) and age >= AGE_MODIFIER_THRESHOLD:
        notes.append(AGE_MODIFIER_NOTE)

    bmi = state.get("bmi")
    if isinstance(bmi, (int, float)) and bmi >= BMI_MODIFIER_THRESHOLD:
        notes.append(BMI_MODIFIER_NOTE)

    if state.get("phys_activity") == 0:
        notes.append(INACTIVITY_NOTE)

    if state.get("smoker") == 1:
        notes.append(SMOKER_NOTE)

    plan["notes"] = notes
    return plan
