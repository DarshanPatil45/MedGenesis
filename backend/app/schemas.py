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
    event_type: Literal["measurement", "lifestyle_log", "note"]
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
