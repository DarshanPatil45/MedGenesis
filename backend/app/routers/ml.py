"""Model comparison and candidate-model (XGBoost) endpoints (Phase 3,
docs/ML.md).

IMPORTANT — these endpoints are separate from the production screening
pipeline (`POST /api/screening/run`, in routers/agents.py, unchanged). They
do not run through the Orchestrator or the Safety gate, and nothing here is
persisted to the database. They exist to inspect and compare the two
trained candidates. RandomForest remains the default/production model;
XGBoost is not exposed as a replacement here or anywhere else (Phase 3
Step 16/19 — model *selection* was explicitly out of scope this phase).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.ml import model_comparison
from app.ml.xgboost_model.predict import ModelArtifactsMissing, XGBoostPredictionService
from app.models.patient import Patient
from app.schemas import ModelComparisonOut, XGBoostPredictOut, XGBoostPredictRequest
from app.services import twin as twin_service

router = APIRouter(prefix="/api/ml", tags=["ml"])


def _require_patient(db: Session, patient_id: int) -> Patient:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail=f"No patient with id {patient_id}")
    return patient


@router.get("/comparison", response_model=ModelComparisonOut)
def get_model_comparison():
    """Actual measured RandomForest-vs-XGBoost test-set metrics — see
    app/ml/model_comparison.py. Never a fabricated or assumed result."""
    try:
        return model_comparison.compare()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/xgboost/predict", response_model=XGBoostPredictOut)
def predict_with_xgboost(body: XGBoostPredictRequest, db: Session = Depends(get_db)):
    """Scores a patient's current Digital Twin state with the XGBoost
    candidate model — for comparison against the production RandomForest
    screening result, not as a replacement for it."""
    _require_patient(db, body.patient_id)
    state = twin_service.get_current_state(db, body.patient_id)
    try:
        result = XGBoostPredictionService().predict(state)
    except ModelArtifactsMissing as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return result.to_dict()
