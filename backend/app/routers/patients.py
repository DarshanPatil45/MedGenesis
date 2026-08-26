from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.screening_agent import check_eligibility
from app.database import get_db
from app.ml.synthetic_patients import DEMO_PROFILES, create_demo_patient
from app.models.patient import Patient
from app.schemas import DemoPatientCreate, PatientCreate, PatientOut
from app.services import twin as twin_service

router = APIRouter(prefix="/api/patients", tags=["patients"])


def _to_out(patient: Patient) -> PatientOut:
    return PatientOut(
        id=patient.id,
        pseudonym=patient.pseudonym,
        age=patient.age,
        sex=patient.sex,
        is_synthetic=patient.is_synthetic,
        screening_eligible=patient.screening_eligible,
        created_at=patient.created_at,
    )


@router.post("", response_model=PatientOut, status_code=201)
def create_patient(body: PatientCreate, db: Session = Depends(get_db)):
    patient = Patient(
        pseudonym=body.pseudonym, age=body.age, sex=body.sex, is_synthetic=True
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)

    if body.baseline_measurements:
        twin_service.append_event(
            db,
            patient_id=patient.id,
            event_type="measurement",
            payload=body.baseline_measurements,
            source="real",
        )
    return _to_out(patient)


@router.get("", response_model=list[PatientOut])
def list_patients(db: Session = Depends(get_db)):
    patients = db.execute(select(Patient).order_by(Patient.id.desc())).scalars().all()
    return [_to_out(p) for p in patients]


@router.get("/demo-profiles")
def list_demo_profiles():
    # Reuses the real eligibility check rather than re-deriving it here, so
    # this listing can never drift out of sync with what /screening/run
    # actually decides.
    out = {}
    for key, profile in DEMO_PROFILES.items():
        state = {**profile["baseline"], "sex": profile["sex"], "age": profile["age"]}
        eligible, _ = check_eligibility(state)
        out[key] = {
            "pseudonym": profile["pseudonym"],
            "age": profile["age"],
            "sex": profile["sex"],
            "screening_eligible": eligible,
        }
    return out


@router.post("/demo", response_model=PatientOut, status_code=201)
def create_demo(body: DemoPatientCreate, db: Session = Depends(get_db)):
    try:
        patient = create_demo_patient(db, body.profile, body.months_of_history)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_out(patient)


@router.get("/{patient_id}", response_model=PatientOut)
def get_patient(patient_id: int, db: Session = Depends(get_db)):
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail=f"No patient with id {patient_id}")
    return _to_out(patient)
