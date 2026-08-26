"""Patient Digital Twin: event-sourced, append-only timeline service.

Nothing in `timeline_events` is ever updated or deleted. A patient's
"current state" is always a materialized view — the latest value per field,
in `recorded_at` order — computed on read from the append-only log. This
module is the only place that should read or write `TimelineEvent` rows;
agents and routers go through it so that contract stays enforced in one
place rather than re-implemented at each call site.

Phase 2 (docs/DIGITAL_TWIN.md) extends this SAME abstraction with lab-result
and medication-history materialization. It does not replace or duplicate
anything above: `get_current_state()` keeps its exact existing shape and
behavior (every current agent/test depends on it being a flat dict), and the
new functions are purely additive reads over the same append-only log.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.patient import Patient
from app.models.timeline import EVENT_SOURCES, EVENT_TYPES, TimelineEvent

# Event types whose payloads contribute fields to the materialized "current
# state" view (screening/care_plan/chat/note events are historical record,
# not patient-state inputs). lab_result and medication_change are
# deliberately excluded — see the comment on EVENT_TYPES in models/timeline.py
# and docs/DIGITAL_TWIN.md for why folding them into this flat view is a
# separate, later modeling decision rather than scaffolding.
STATE_EVENT_TYPES = ("measurement", "lifestyle_log")

LAB_EVENT_TYPE = "lab_result"
MEDICATION_EVENT_TYPE = "medication_change"
MEDICATION_ACTIONS = ("started", "stopped", "dose_changed", "continued")

# A lab result's measurement date is the TimelineEvent's own `recorded_at` —
# deliberately not duplicated as a second date field inside the payload.
# Pass `recorded_at` explicitly to append_event() when backfilling a
# historical value (the synthetic-patient generator already does this for
# measurement events; lab/medication events follow the same convention).


def validate_lab_result_payload(payload: dict[str, Any]) -> None:
    """A lab result must name what was measured and what the value was.
    Everything else (unit, reference_range, provenance) is optional — this
    project never invents a value the caller didn't provide."""
    if not payload.get("test_name"):
        raise ValueError("lab_result payload requires a non-empty 'test_name'")
    if "value" not in payload or payload["value"] is None:
        raise ValueError("lab_result payload requires a 'value'")
    if isinstance(payload["value"], bool) or not isinstance(payload["value"], (int, float)):
        raise ValueError(
            f"lab_result 'value' must be numeric, got {type(payload['value']).__name__}"
        )


def validate_medication_payload(payload: dict[str, Any]) -> None:
    """A medication change must name the medication and what happened to it.
    This never represents a prescription or dosage instruction — only a
    historical record of what was reported (see docs/DIGITAL_TWIN.md)."""
    if not payload.get("medication_name"):
        raise ValueError("medication_change payload requires a non-empty 'medication_name'")
    action = payload.get("action")
    if action not in MEDICATION_ACTIONS:
        raise ValueError(
            f"medication_change 'action' must be one of {MEDICATION_ACTIONS}, got {action!r}"
        )


def append_event(
    db: Session,
    *,
    patient_id: int,
    event_type: str,
    payload: dict[str, Any],
    source: str = "real",
    recorded_at: datetime | None = None,
) -> TimelineEvent:
    if event_type not in EVENT_TYPES:
        raise ValueError(f"Unknown event_type {event_type!r}; expected one of {EVENT_TYPES}")
    if source not in EVENT_SOURCES:
        raise ValueError(f"Unknown source {source!r}; expected one of {EVENT_SOURCES}")
    if event_type == LAB_EVENT_TYPE:
        validate_lab_result_payload(payload)
    elif event_type == MEDICATION_EVENT_TYPE:
        validate_medication_payload(payload)

    event = TimelineEvent(
        patient_id=patient_id,
        event_type=event_type,
        payload=payload,
        source=source,
        recorded_at=recorded_at or datetime.now(timezone.utc),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def get_timeline(db: Session, patient_id: int) -> list[TimelineEvent]:
    stmt = (
        select(TimelineEvent)
        .where(TimelineEvent.patient_id == patient_id)
        .order_by(TimelineEvent.recorded_at.asc(), TimelineEvent.id.asc())
    )
    return list(db.execute(stmt).scalars().all())


def get_current_state(db: Session, patient_id: int) -> dict[str, Any]:
    """Materializes "current state": patient demographics plus the latest
    value per field across all measurement/lifestyle_log events (later
    events win on key collision, so this is a pure fold over the log)."""
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise ValueError(f"No patient with id {patient_id}")

    state: dict[str, Any] = {
        "patient_id": patient.id,
        "age": patient.age,
        "sex": patient.sex,
    }
    for event in get_timeline(db, patient_id):
        if event.event_type not in STATE_EVENT_TYPES:
            continue
        for key, value in (event.payload or {}).items():
            state[key] = value
    return state


def fork_snapshot(db: Session, patient_id: int) -> tuple[dict[str, Any], int | None]:
    """Copy-on-write fork for the What-if Simulation Agent: the current
    materialized state, plus the id of the latest timeline event it was
    computed from. Simulations read this and are stored separately — nothing
    downstream of a fork ever writes back into the real timeline."""
    events = get_timeline(db, patient_id)
    base_event_id = events[-1].id if events else None
    return get_current_state(db, patient_id), base_event_id


# --- Phase 2: lab result and medication history (additive) -----------------


def _serialize_payload_event(event: TimelineEvent) -> dict[str, Any]:
    return {**event.payload, "recorded_at": event.recorded_at.isoformat()}


def get_lab_history(db: Session, patient_id: int, test_name: str | None = None) -> list[dict[str, Any]]:
    """All recorded lab results, oldest first, never collapsed to a single
    value — a patient's full HbA1c history stays a full history. Pass
    `test_name` to filter to one test (e.g. "HbA1c")."""
    records = [
        _serialize_payload_event(e) for e in get_timeline(db, patient_id) if e.event_type == LAB_EVENT_TYPE
    ]
    if test_name is not None:
        records = [r for r in records if r.get("test_name") == test_name]
    return records


def get_latest_labs(db: Session, patient_id: int) -> dict[str, dict[str, Any]]:
    """test_name -> most recent recorded value, across every distinct test
    this patient has any result for. A test with no recorded result simply
    has no key here — never filled in with a guess."""
    latest: dict[str, dict[str, Any]] = {}
    for record in get_lab_history(db, patient_id):
        name = record.get("test_name")
        if name:
            latest[name] = record  # later (chronologically) overwrites earlier
    return latest


def get_lab_trend(db: Session, patient_id: int, test_name: str) -> dict[str, Any]:
    """Latest value, full history, and a plain-language trend label for one
    test. Never a clinical judgement — purely a description of the recorded
    numbers, and never claims a trend from too few points (see
    docs/DIGITAL_TWIN.md): 0 points is "no_data", 1-2 points is
    "insufficient_data" (a 2-point change is easily noise), 3+ points get a
    direction only when the values are monotonic, "mixed" otherwise."""
    history = get_lab_history(db, patient_id, test_name=test_name)
    if not history:
        return {"test_name": test_name, "latest": None, "history": [], "trend": "no_data"}

    values = [h["value"] for h in history]
    if len(values) < 3:
        trend = "insufficient_data"
    elif all(v == values[0] for v in values):
        trend = "stable"
    elif all(b >= a for a, b in zip(values, values[1:])) and values[-1] > values[0]:
        trend = "increasing"
    elif all(b <= a for a, b in zip(values, values[1:])) and values[-1] < values[0]:
        trend = "decreasing"
    else:
        trend = "mixed"

    return {"test_name": test_name, "latest": history[-1], "history": history, "trend": trend}


def get_medication_history(db: Session, patient_id: int) -> list[dict[str, Any]]:
    """Every recorded medication_change event, oldest first. A historical
    record, not a prescription — see docs/DIGITAL_TWIN.md."""
    return [
        _serialize_payload_event(e)
        for e in get_timeline(db, patient_id)
        if e.event_type == MEDICATION_EVENT_TYPE
    ]


def get_current_medications(db: Session, patient_id: int) -> list[dict[str, Any]]:
    """The latest recorded action per medication name, excluding any whose
    latest action is "stopped" — the same latest-value-wins fold
    get_current_state() already uses, just grouped by medication name
    instead of a flat top-level key."""
    latest_by_name: dict[str, dict[str, Any]] = {}
    for record in get_medication_history(db, patient_id):
        name = record.get("medication_name")
        if name:
            latest_by_name[name] = record
    return [r for r in latest_by_name.values() if r.get("action") != "stopped"]


# Measurement-event fields already materialized by get_current_state() that
# are clinical/lifestyle in nature — surfaced by get_structured_twin() below
# as a convenience grouping. Not new data: every key here already exists in
# the BRFSS feature set every screening/simulation call already uses.
_CLINICAL_STATE_KEYS = (
    "high_bp", "high_chol", "bmi", "heart_disease_or_attack", "stroke",
    "diff_walk", "gen_hlth", "ment_hlth", "phys_hlth",
)
_LIFESTYLE_STATE_KEYS = ("phys_activity", "smoker", "hvy_alcohol_consump", "fruits", "veggies")


def get_structured_twin(db: Session, patient_id: int) -> dict[str, Any]:
    """A richer, nested Digital Twin view for the future ML/agent pipeline
    (docs/DIGITAL_TWIN.md). Purely additive — built entirely from
    get_current_state()/get_lab_history()/get_medication_history(), and does
    not change what any of those return. Existing consumers of
    get_current_state() are unaffected by this function's existence."""
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise ValueError(f"No patient with id {patient_id}")

    state = get_current_state(db, patient_id)
    events = get_timeline(db, patient_id)

    return {
        "patient": {
            "patient_id": patient.id,
            "age": patient.age,
            "sex": patient.sex,
            "is_synthetic": patient.is_synthetic,
            "screening_eligible": patient.screening_eligible,
        },
        "clinical": {k: state[k] for k in _CLINICAL_STATE_KEYS if k in state},
        "laboratory": {
            "latest": get_latest_labs(db, patient_id),
            "history": get_lab_history(db, patient_id),
        },
        "medications": {
            "current": get_current_medications(db, patient_id),
            "history": get_medication_history(db, patient_id),
        },
        "lifestyle": {k: state[k] for k in _LIFESTYLE_STATE_KEYS if k in state},
        "timeline": [_serialize_payload_event(e) | {"event_type": e.event_type} for e in events],
    }
