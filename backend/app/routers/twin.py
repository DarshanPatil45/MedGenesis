from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.patient import Patient
from app.schemas import DigitalTwinOut, LabTrendOut, TimelineEventCreate, TimelineEventOut, TimelineOut
from app.services import twin as twin_service

router = APIRouter(prefix="/api/twin", tags=["digital-twin"])


def _require_patient(db: Session, patient_id: int) -> Patient:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail=f"No patient with id {patient_id}")
    return patient


@router.post("/{patient_id}/events", response_model=TimelineEventOut, status_code=201)
def append_event(patient_id: int, body: TimelineEventCreate, db: Session = Depends(get_db)):
    _require_patient(db, patient_id)
    try:
        event = twin_service.append_event(
            db,
            patient_id=patient_id,
            event_type=body.event_type,
            payload=body.payload,
            source=body.source,
            recorded_at=body.recorded_at,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return event


@router.get("/{patient_id}/timeline", response_model=TimelineOut)
def get_timeline(patient_id: int, db: Session = Depends(get_db)):
    _require_patient(db, patient_id)
    return TimelineOut(
        patient_id=patient_id,
        events=twin_service.get_timeline(db, patient_id),
        current_state=twin_service.get_current_state(db, patient_id),
    )


@router.get("/{patient_id}/digital-twin", response_model=DigitalTwinOut)
def get_digital_twin(patient_id: int, db: Session = Depends(get_db)):
    """The Phase 2 structured Digital Twin view (docs/DIGITAL_TWIN.md) —
    additive; does not change what /timeline returns."""
    _require_patient(db, patient_id)
    return DigitalTwinOut(**twin_service.get_structured_twin(db, patient_id))


@router.get("/{patient_id}/labs/{test_name}", response_model=LabTrendOut)
def get_lab_trend(patient_id: int, test_name: str, db: Session = Depends(get_db)):
    """Latest value, full history, and a plain trend label for one lab test
    (e.g. "HbA1c") — see docs/DIGITAL_TWIN.md for why `trend` never claims
    more than the recorded numbers support."""
    _require_patient(db, patient_id)
    return LabTrendOut(**twin_service.get_lab_trend(db, patient_id, test_name))
