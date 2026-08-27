"""Pydantic request/response schemas for the MedGenesis API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

SexLiteral = Literal["female", "male", "other", "unspecified"]


class PatientCreate(BaseModel):
    pseudonym: str = Field(..., min_length=1, max_length=120)
    age: int = Field(..., ge=0, le=120)
    sex: SexLiteral = "unspecified"
    baseline_measurements: dict[str, Any] | None = None


class DemoPatientCreate(BaseModel):
    profile: str = "eligible_moderate"
    months_of_history: int = Field(6, ge=0, le=36)


class PatientOut(BaseModel):
    id: int
    pseudonym: str
    age: int
    sex: str
    is_synthetic: bool
    screening_eligible: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TimelineEventCreate(BaseModel):
    # medication_change/lab_result added in Phase 2 (docs/DIGITAL_TWIN.md) —
    # additive, the three original values remain valid and unchanged.
    # screening/care_plan/chat stay excluded: those are written by agents,
    # not posted directly through this endpoint.
    event_type: Literal["measurement", "lifestyle_log", "note", "medication_change", "lab_result"]
    payload: dict[str, Any]
    source: Literal["real", "synthetic"] = "real"
    recorded_at: datetime | None = None


class TimelineEventOut(BaseModel):
    id: int
    patient_id: int
    event_type: str
    payload: dict[str, Any]
    source: str
    recorded_at: datetime

    model_config = {"from_attributes": True}


class TimelineOut(BaseModel):
    patient_id: int
    events: list[TimelineEventOut]
    current_state: dict[str, Any]


class LabTrendOut(BaseModel):
    """Response for GET /api/twin/{id}/labs/{test_name} — see
    docs/DIGITAL_TWIN.md for why `trend` is only ever a plain description of
    the recorded numbers, never a clinical judgement."""

    test_name: str
    latest: dict[str, Any] | None
    history: list[dict[str, Any]]
    trend: Literal["no_data", "insufficient_data", "stable", "increasing", "decreasing", "mixed"]


class DigitalTwinOut(BaseModel):
    """Response for GET /api/twin/{id}/digital-twin — the Phase 2 structured
    view (docs/DIGITAL_TWIN.md). Additive: does not replace or change
    GET /api/twin/{id}/timeline's response shape."""

    patient: dict[str, Any]
    clinical: dict[str, Any]
    laboratory: dict[str, Any]
    medications: dict[str, Any]
    lifestyle: dict[str, Any]
    timeline: list[dict[str, Any]]


class SafetyOut(BaseModel):
    status: str
    reasons: list[str]
    disclaimer: str | None = None
    banner: str | None = None
    policy_version: str


class ScreeningRequest(BaseModel):
    patient_id: int


class ScreeningOut(BaseModel):
    id: int | None
    patient_id: int
    status: str
    scope: str
    disclaimer: str
    risk_probability: float | None
    risk_tier: str | None
    unavailable_reason: str | None
    top_features: dict[str, float]
    model_version: str
    summary_text: str
    safety: SafetyOut
    trace: list[str]


class SimulateRequest(BaseModel):
    patient_id: int
    hypothesis: dict[str, Any] = Field(default_factory=dict)
    # Free-text alternative to `hypothesis` — e.g. "what if I lost weight and
    # exercised more". Only parsed when `hypothesis` is empty; see
    # app/agents/simulation_nlp.py. Unparseable text is reported, never
    # silently guessed at.
    text: str | None = None


class SimulateOut(BaseModel):
    id: int | None
    patient_id: int
    status: str
    scope: str
    label: str
    hypothesis: dict[str, Any]
    trajectory: list[dict[str, Any]]
    assumptions: list[str]
    unavailable_reason: str | None
    base_timeline_event_id: int | None
    summary_text: str
    safety: SafetyOut
    trace: list[str]


class CarePlanRequest(BaseModel):
    patient_id: int
    use_llm: bool = True


class CarePlanOut(BaseModel):
    id: int | None
    patient_id: int
    diet_focus: str
    activity_target: str
    monitoring_frequency: str
    follow_up_weeks: int
    narrative_text: str
    notes: list[str]
    sources: list[dict[str, Any]]
    generated_by: str
    risk_tier: str | None
    screening: dict[str, Any]
    safety: SafetyOut
    trace: list[str]


class ChatRequest(BaseModel):
    patient_id: int
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: int | None = None
    use_llm: bool = True


class ChatOut(BaseModel):
    session_id: int
    reply_text: str
    sources: list[dict[str, Any]]
    generated_by: str
    tools_used: list[str]
    safety: SafetyOut
    trace: list[str]


class AgentRunRequest(BaseModel):
    patient_id: int
    mode: Literal["intake", "simulation", "chat"] = "intake"
    hypothesis: dict[str, Any] | None = None
    hypothesis_text: str | None = None
    message: str | None = None
    use_llm: bool = True


class AgentRunOut(BaseModel):
    patient_id: int
    mode: str
    screening: dict[str, Any] | None = None
    evidence: list[dict[str, Any]] | None = None
    simulation: dict[str, Any] | None = None
    care_plan: dict[str, Any] | None = None
    chat: dict[str, Any] | None = None
    safety: SafetyOut
    trace: list[str]


class AuditLogOut(BaseModel):
    id: int
    target_type: str
    target_id: str
    status: str
    reasons: list[str]
    policy_version: str
    reviewed_at: datetime

    model_config = {"from_attributes": True}


class HealthOut(BaseModel):
    status: str
    database: str
    screening_model: str
    rag_backend: str
    llm: str
    policy_version: str


# --- Phase 3: XGBoost candidate model / RandomForest comparison (docs/ML.md) ---
# Separate from the production screening pipeline (ScreeningRequest/ScreeningOut
# above, unchanged) — these are comparison/candidate-model schemas only.


class XGBoostPredictRequest(BaseModel):
    patient_id: int


class XGBoostPredictOut(BaseModel):
    model: str
    model_version: str
    status: str
    prediction: int | None
    score: float | None
    risk_tier: str | None
    features_used: list[str]
    unavailable_reason: str | None
    disclaimer: str


class ModelMetricsOut(BaseModel):
    model_version: str
    algorithm: str
    test_metrics: dict[str, float]
    confusion_matrix: dict[str, int]
    training_time_seconds: float | None
    inference_time_seconds_test_set: float
    inference_time_seconds_per_1000_rows: float
    model_size_bytes: int
    feature_importances: dict[str, float]


class ModelComparisonOut(BaseModel):
    random_forest: ModelMetricsOut
    xgboost: ModelMetricsOut
    metrics_table: dict[str, dict[str, float]]
    n_test: int


# --- Phase 4: evidence retrieval (docs/RAG.md) ---
# The existing EvidenceAgent/RAG service, not a new retrieval system —
# these schemas just expose it over its own dedicated endpoint.


class EvidenceSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    k: int | None = Field(default=None, ge=1, le=20)
    # Phase 5: "local" preserves the exact pre-Phase-5 behavior and stays
    # the default — a bare {"query": "..."} request is unaffected. "pubmed"
    # and "all" opt into the new PubMed evidence source (docs/RAG.md).
    source: Literal["local", "pubmed", "all"] = "local"


class EvidenceSearchResultOut(BaseModel):
    text: str
    document_id: str
    section: str
    title: str
    publisher: str
    source_url: str
    accessed: str
    license: str
    attribution: str
    score: float
    source_type: str
    doi: str


class EvidenceSearchOut(BaseModel):
    query: str
    source: str
    backend: str
    results: list[EvidenceSearchResultOut]
