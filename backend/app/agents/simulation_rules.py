"""Transparent delta model for the What-if Simulation Agent.

This is an EXPLICIT, INSPECTABLE HEURISTIC — not a validated physiological
model. It exists so the projection method can be shown and argued with,
rather than hidden inside a second black-box model. Every coefficient below
is stated with the reasoning behind it, and the assumptions are returned in
the API response so the UI can display them next to the chart.

Interpretation limit worth stating plainly: what a trajectory shows is the
SENSITIVITY OF THE TRAINED SCREENING MODEL to a hypothetical change in its
inputs. It is not a forecast of a real clinical outcome for a real person.

DATASET NOTE (see docs/ARCHITECTURE.md §13.7): this module was rewritten when
the project switched from the Pima dataset to the CDC BRFSS 2015 Diabetes
Health Indicators dataset. BRFSS does not record blood glucose at all — it's
a self-reported survey, not a lab panel — so the old `glucose_delta`
hypothesis dimension is gone; there is nothing in the trained model for it to
act on. `PhysActivity` and `Smoker` are also BINARY flags in this dataset
(a yes/no survey question), not continuous quantities, which changes how
`activity_minutes_delta` and the new `smoker_delta` are applied below: instead
of scaling a continuous feature, they move a target FLAG from its current
value toward 0 or 1, and are shown to the model as a fractional value between
those endpoints purely so the projected trajectory chart still reads as a
smooth line — a modelling simplification, disclosed as an assumption.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

SUPPORTED_DELTAS = ("bmi_delta", "weight_kg_delta", "activity_minutes_delta", "smoker_delta")
DEFAULT_HORIZON_WEEKS = 12
MAX_HORIZON_WEEKS = 52
PROJECTION_STEP_WEEKS = 4

# Assumption A: BMI = kg / m^2, so a weight change converts to a BMI change
# once height is known. With no height on file we use 1.68 m — the sample
# mean adult height for the BRFSS 2015 respondent pool this model was fit
# on — and say so.
DEFAULT_HEIGHT_M = 1.68

# Assumption B: changes accrue gradually, not instantly. Continuous
# quantities (BMI) ramp linearly to the full requested delta across the
# horizon — the simplest defensible curve, and linear is easier for a reader
# to audit than an invented exponential.
CLINICAL_FLOORS = {"bmi": 15.0}
CLINICAL_CEILINGS = {"bmi": 70.0}

# Assumption C: PhysActivity and Smoker are binary in the trained model (did
# you engage in physical activity in the last 30 days? do you currently
# smoke?). A hypothesis to change either moves a [0, 1] proxy linearly toward
# the target flag across the horizon, so the chart stays a smooth line
# instead of a step function — the model itself was never trained on
# fractional values, so intermediate weeks are an interpolation device for
# display, not a claim about a real intermediate state.


@dataclass
class Hypothesis:
    bmi_delta: float = 0.0
    weight_kg_delta: float = 0.0
    activity_minutes_delta: float = 0.0
    smoker_delta: float = 0.0
    horizon_weeks: int = DEFAULT_HORIZON_WEEKS

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Hypothesis":
        horizon = int(data.get("horizon_weeks") or DEFAULT_HORIZON_WEEKS)
        horizon = max(PROJECTION_STEP_WEEKS, min(horizon, MAX_HORIZON_WEEKS))
        return cls(
            bmi_delta=float(data.get("bmi_delta") or 0.0),
            weight_kg_delta=float(data.get("weight_kg_delta") or 0.0),
            activity_minutes_delta=float(data.get("activity_minutes_delta") or 0.0),
            smoker_delta=float(data.get("smoker_delta") or 0.0),
            horizon_weeks=horizon,
        )

    def is_empty(self) -> bool:
        return not any(
            [self.bmi_delta, self.weight_kg_delta, self.activity_minutes_delta, self.smoker_delta]
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "bmi_delta": self.bmi_delta,
            "weight_kg_delta": self.weight_kg_delta,
            "activity_minutes_delta": self.activity_minutes_delta,
            "smoker_delta": self.smoker_delta,
            "horizon_weeks": self.horizon_weeks,
        }


def effective_deltas(
    hypothesis: Hypothesis, state: dict[str, Any]
) -> tuple[dict[str, float], dict[str, float], list[str]]:
    """Resolves a hypothesis into (continuous deltas, binary-flag targets,
    assumptions). Continuous deltas ramp linearly; flag targets interpolate
    a display proxy toward 0 or 1 — see the module docstring."""
    assumptions: list[str] = []
    bmi_delta = hypothesis.bmi_delta

    if hypothesis.weight_kg_delta:
        height_m = float(state.get("height_m") or DEFAULT_HEIGHT_M)
        if not state.get("height_m"):
            assumptions.append(
                f"No height on file — assumed {DEFAULT_HEIGHT_M} m to convert weight change to BMI."
            )
        converted = hypothesis.weight_kg_delta / (height_m**2)
        bmi_delta += converted
        assumptions.append(
            f"Weight change of {hypothesis.weight_kg_delta:+.1f} kg converted to "
            f"{converted:+.2f} BMI using BMI = kg / m² at {height_m} m."
        )

    if bmi_delta:
        assumptions.append(f"Total BMI change of {bmi_delta:+.2f} applied linearly across the horizon.")

    flag_targets: dict[str, float] = {}
    if hypothesis.activity_minutes_delta:
        current = state.get("phys_activity")
        target = 1.0 if hypothesis.activity_minutes_delta > 0 else 0.0
        if current is not None and float(current) == target:
            assumptions.append(
                "No change modelled for physical activity — the patient's recorded status "
                "already matches the requested direction."
            )
        else:
            flag_targets["phys_activity"] = target
            direction = "becoming physically active" if target == 1.0 else "becoming physically inactive"
            assumptions.append(
                f"This dataset records physical activity as a yes/no flag (any activity in the "
                f"past 30 days), not weekly minutes — the requested change is modelled as "
                f"{direction}, ramped gradually across the horizon for the chart rather than as "
                f"an instant switch."
            )

    if hypothesis.smoker_delta:
        current = state.get("smoker")
        target = 1.0 if hypothesis.smoker_delta > 0 else 0.0
        if current is not None and float(current) == target:
            assumptions.append(
                "No change modelled for smoking status — the patient's recorded status already "
                "matches the requested direction."
            )
        else:
            flag_targets["smoker"] = target
            direction = "starting smoking" if target == 1.0 else "quitting smoking"
            assumptions.append(f"Modelled as {direction}, ramped gradually across the horizon for the chart.")

    return {"bmi": bmi_delta}, flag_targets, assumptions


def project_state(
    base_state: dict[str, Any],
    deltas: dict[str, float],
    flag_targets: dict[str, float],
    fraction: float,
) -> dict[str, Any]:
    """Applies `fraction` (0..1) of the total continuous deltas and flag
    interpolation to a copy of the base state, clamped to plausible bounds."""
    projected = dict(base_state)
    for field_name, total_delta in deltas.items():
        if not total_delta or projected.get(field_name) is None:
            continue
        value = float(projected[field_name]) + total_delta * fraction
        value = max(CLINICAL_FLOORS.get(field_name, value), value)
        value = min(CLINICAL_CEILINGS.get(field_name, value), value)
        projected[field_name] = round(value, 2)

    for field_name, target in flag_targets.items():
        current = float(projected.get(field_name) or 0.0)
        projected[field_name] = round(current + (target - current) * fraction, 3)

    return projected


def horizon_steps(horizon_weeks: int) -> list[int]:
    steps = list(range(0, horizon_weeks + 1, PROJECTION_STEP_WEEKS))
    if steps[-1] != horizon_weeks:
        steps.append(horizon_weeks)
    return steps
