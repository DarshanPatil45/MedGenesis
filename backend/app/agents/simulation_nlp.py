"""Natural-language front end for the What-if Simulation Agent.

Per docs/ARCHITECTURE.md §4.5: "a small natural-language parser maps phrases
like 'what if I lost weight and exercised more' to structured deltas;
unrecognized phrasing asks the user to pick from preset scenarios."

Deliberately a deterministic, regex/keyword parser — NOT an LLM. The
simulation agent's whole design principle is that every number it produces
traces back to an inspectable rule (see simulation_rules.py); an LLM parsing
"lost weight" into a specific kilogram figure would quietly invent a number
with no basis. When a clause names a topic but gives no magnitude, this
parser substitutes a fixed, documented default and says so in `notes` —
never a value pulled from nowhere.

Anything this parser doesn't confidently recognize is reported as such
(`recognized=False`) rather than guessed at, matching the spec's fallback:
send the user to the preset scenarios instead.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.agents.simulation_rules import DEFAULT_HORIZON_WEEKS

# Topic detection uses substring containment on short stems rather than exact
# tokens, so "exercised"/"exercising"/"exercise" all match "exercis" without a
# full stemmer — the same pragmatic approach used by the keyword-fallback RAG
# ranker in app/services/rag.py.
TOPIC_STEMS: dict[str, tuple[str, ...]] = {
    "weight_kg_delta": ("weight", " kg", "kilogram", "pound", " lb"),
    "bmi_delta": ("bmi", "body mass index"),
    "activity_minutes_delta": ("exercis", "activ", "walk", "workout", "work out", "gym"),
    "smoker_delta": ("smok", "cigarette", "vaping", "vape"),
}

# activity_minutes_delta and smoker_delta act on binary flags in the trained
# model (see simulation_rules.py) — direction is what matters, not a
# quantity, so they never go through the "no amount given, defaulting to X"
# framing the continuous fields use.
FLAG_TOPICS = ("activity_minutes_delta", "smoker_delta")

NEGATIVE_STEMS = (
    "lost", "lose", "losing", "loses", "drop", "cut", "reduc", "decreas",
    "lower", "down", "less", "fewer", "shed", "quit", "stop", "stopped", "stopping",
)
POSITIVE_STEMS = (
    "gain", "put on", "increas", "more", "extra", "addition", "up ", "higher", "raise", "start",
)

# Used only when a topic is named without a magnitude in the same clause —
# and only for continuous fields (see FLAG_TOPICS above). Chosen to match the
# frontend's preset scenarios, so a vague phrase and the nearest preset
# button project the same trajectory.
DEFAULT_MAGNITUDES = {
    "weight_kg_delta": 5.0,
    "bmi_delta": 2.0,
}

LBS_TO_KG = 0.453592

HORIZON_PATTERN = re.compile(
    r"(?:over|in|across|for)?\s*(\d+(?:\.\d+)?)\s*(week|wk|month|mo|year|yr)s?\b"
)
NUMBER_PATTERN = re.compile(r"(\d+(?:\.\d+)?)")
CLAUSE_SPLIT_PATTERN = re.compile(r"\band\b|[,;]|\bwhile\b|\balso\b")

MIN_RECOGNIZABLE_CLAUSE_LENGTH = 3  # guards against stray topic-stem substring hits


@dataclass
class ParsedHypothesis:
    recognized: bool
    hypothesis: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    message: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "recognized": self.recognized,
            "hypothesis": self.hypothesis,
            "notes": self.notes,
            "message": self.message,
        }


def _extract_horizon(text: str) -> tuple[int | None, str]:
    """Finds a horizon phrase and returns (weeks, text_with_phrase_removed).

    Stripping the matched span before topic/magnitude parsing is what stops
    "exercised more over 12 weeks" from reading the horizon's "12" as an
    activity-minutes magnitude — the two extraction passes would otherwise
    compete for the same number.
    """
    match = HORIZON_PATTERN.search(text)
    if not match:
        return None, text

    amount = float(match.group(1))
    unit = match.group(2)
    if unit.startswith("week") or unit == "wk":
        weeks = round(amount)
    elif unit.startswith("month") or unit == "mo":
        weeks = round(amount * 4.345)
    else:  # year / yr
        weeks = round(amount * 52)

    return weeks, text[: match.start()] + " " + text[match.end() :]


def _direction_sign(clause: str) -> int | None:
    has_negative = any(stem in clause for stem in NEGATIVE_STEMS)
    has_positive = any(stem in clause for stem in POSITIVE_STEMS)
    if has_negative and not has_positive:
        return -1
    if has_positive and not has_negative:
        return 1
    return None  # absent, or both present — too ambiguous to guess a sign


def _magnitude(clause: str, field_name: str) -> tuple[float | None, str | None]:
    """Returns (raw_number, note) — note is set only when a unit conversion
    was applied, so the caller can surface it. Only called for continuous
    fields (weight, BMI); FLAG_TOPICS never reach this function."""
    match = NUMBER_PATTERN.search(clause)
    if not match:
        return None, None

    value = float(match.group(1))
    if field_name == "weight_kg_delta" and ("lb" in clause or "pound" in clause):
        converted = round(value * LBS_TO_KG, 1)
        return converted, f"Converted {value:g} lb to {converted:g} kg."
    return value, None


def parse(text: str) -> ParsedHypothesis:
    """Parses free text into a structured simulation hypothesis, or reports
    that it couldn't — see the module docstring for why this never guesses."""
    if not text or not text.strip():
        return ParsedHypothesis(
            recognized=False,
            message="No scenario text was provided. Try a preset scenario or the custom fields.",
        )

    normalized = f" {text.lower().strip()} "
    horizon_weeks, remaining = _extract_horizon(normalized)

    hypothesis: dict[str, Any] = {}
    notes: list[str] = []
    matched_topics: list[str] = []

    for clause in CLAUSE_SPLIT_PATTERN.split(remaining):
        clause = clause.strip()
        if len(clause) < MIN_RECOGNIZABLE_CLAUSE_LENGTH:
            continue

        topic = next(
            (field_name for field_name, stems in TOPIC_STEMS.items() if any(s in clause for s in stems)),
            None,
        )
        if topic is None or topic in hypothesis:
            continue  # no recognizable topic in this clause, or already set

        sign = _direction_sign(clause)
        if sign is None:
            continue  # topic named but direction unclear — do not guess

        if topic in FLAG_TOPICS:
            # A magnitude has no meaning here — "start" or "quit" already
            # fully specifies the change; only the sign is used downstream.
            raw_magnitude = 1.0
        else:
            raw_magnitude, unit_note = _magnitude(clause, topic)
            if raw_magnitude is None:
                raw_magnitude = DEFAULT_MAGNITUDES[topic]
                label = topic.replace("_delta", "").replace("_", " ")
                notes.append(
                    f"No specific amount was given for {label}, so a moderate default of "
                    f"{raw_magnitude:g} was assumed."
                )
            elif unit_note:
                notes.append(unit_note)

        hypothesis[topic] = round(sign * raw_magnitude, 2)
        matched_topics.append(topic)

    if not matched_topics:
        return ParsedHypothesis(
            recognized=False,
            message=(
                "This system couldn't confidently map that scenario to a specific change. "
                "Try a preset scenario, or use the custom fields to set an exact amount."
            ),
        )

    if horizon_weeks is None:
        horizon_weeks = DEFAULT_HORIZON_WEEKS
        notes.append(f"No time horizon was given, so the default of {DEFAULT_HORIZON_WEEKS} weeks was used.")
    hypothesis["horizon_weeks"] = horizon_weeks

    readable = ", ".join(t.replace("_delta", "").replace("_", " ") for t in matched_topics)
    return ParsedHypothesis(
        recognized=True,
        hypothesis=hypothesis,
        notes=notes,
        message=f"Understood this as a change in: {readable}.",
    )
