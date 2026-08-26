"""Patient Digital Twin: event-sourced, append-only timeline service.

Nothing in `timeline_events` is ever updated or deleted. A patient's
"current state" is always a materialized view — the latest value per field,
in `recorded_at` order — computed on read from the append-only log. This
module is the only place that should read or write `TimelineEvent` rows;
agents and routers go through it so that contract stays enforced in one
place rather than re-implemented at each call site.
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
# not patient-state inputs).
STATE_EVENT_TYPES = ("measurement", "lifestyle_log")


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
