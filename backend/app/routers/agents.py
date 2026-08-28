"""Agent-facing routers: screening, simulate, careplan, chat, and the
full-pipeline demo endpoint. All of these run through the Orchestrator so
the Safety gate can't be bypassed by calling an agent directly.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.orchestrator import Orchestrator
from app.database import get_db
from app.models.careplan import CarePlan
from app.models.chat import ChatMessage, ChatSession
from app.models.patient import Patient
from app.models.screening import ScreeningAssessment
from app.models.simulation import Simulation
from app.schemas import (
    AgentRunOut,
    AgentRunRequest,
    CarePlanOut,
    CarePlanRequest,
    ChatOut,
    ChatRequest,
    ClinicalAnalysisOut,
    ClinicalAnalysisRequest,
    SafetyOut,
    ScreeningOut,
    ScreeningRequest,
    SimulateOut,
    SimulateRequest,
)
from app.services import twin as twin_service

router = APIRouter(prefix="/api", tags=["agents"])


def _require_patient(db: Session, patient_id: int) -> Patient:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail=f"No patient with id {patient_id}")
    return patient


def _safety_out(result: dict) -> SafetyOut:
    safety = result.get("safety") or {}
    return SafetyOut(
        status=safety.get("status", "APPROVED"),
        reasons=safety.get("reasons", []),
        disclaimer=safety.get("disclaimer"),
        banner=safety.get("banner"),
        policy_version=safety.get("policy_version", "unknown"),
    )


@router.post("/screening/run", response_model=ScreeningOut)
def run_screening(body: ScreeningRequest, db: Session = Depends(get_db)):
    _require_patient(db, body.patient_id)
    result = Orchestrator(db).run(mode="intake", patient_id=body.patient_id, use_llm=False)
    screening = result["screening"]

    record = ScreeningAssessment(
        patient_id=body.patient_id,
        timeline_event_id=result.get("base_timeline_event_id"),
        status=screening["status"],
        risk_probability=screening["risk_probability"],
        risk_tier=screening["risk_tier"],
        unavailable_reason=screening["unavailable_reason"],
        top_features=screening["top_features"],
        model_version=screening["model_version"],
        scope=screening["scope"],
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    # The screening result becomes part of the twin's history, so a later
    # care plan can be traced to the exact assessment that informed it.
    twin_service.append_event(
        db,
        patient_id=body.patient_id,
        event_type="screening",
        payload={
            "screening_assessment_id": record.id,
            "status": screening["status"],
            "risk_tier": screening["risk_tier"],
            "risk_probability": screening["risk_probability"],
            "safety_status": result["safety"]["status"],
        },
        source="real",
    )

    return ScreeningOut(
        id=record.id,
        patient_id=body.patient_id,
        **{k: screening[k] for k in (
            "status", "scope", "disclaimer", "risk_probability", "risk_tier",
            "unavailable_reason", "top_features", "model_version", "summary_text",
        )},
        safety=_safety_out(result),
        trace=result["trace"],
    )


@router.post("/simulate", response_model=SimulateOut)
def run_simulation(body: SimulateRequest, db: Session = Depends(get_db)):
    _require_patient(db, body.patient_id)
    result = Orchestrator(db).run(
        mode="simulation",
        patient_id=body.patient_id,
        hypothesis=body.hypothesis,
        hypothesis_text=body.text,
        use_llm=False,
    )
    sim = result["simulation"]

    record = Simulation(
        patient_id=body.patient_id,
        base_timeline_event_id=sim.get("base_timeline_event_id"),
        hypothesis=sim["hypothesis"],
        projected_trajectory=sim["trajectory"],
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return SimulateOut(
        id=record.id,
        patient_id=body.patient_id,
        **{k: sim[k] for k in (
            "status", "scope", "label", "hypothesis", "trajectory", "assumptions",
            "unavailable_reason", "base_timeline_event_id", "summary_text",
        )},
        safety=_safety_out(result),
        trace=result["trace"],
    )


@router.post("/careplan/generate", response_model=CarePlanOut)
def generate_careplan(body: CarePlanRequest, db: Session = Depends(get_db)):
    _require_patient(db, body.patient_id)
    result = Orchestrator(db).run(
        mode="intake", patient_id=body.patient_id, use_llm=body.use_llm
    )
    plan, screening = result["care_plan"], result["screening"]

    record = CarePlan(
        patient_id=body.patient_id,
        diet_focus=plan["diet_focus"],
        activity_target=plan["activity_target"],
        monitoring_frequency=plan["monitoring_frequency"],
        follow_up_weeks=plan["follow_up_weeks"],
        narrative_text=plan["narrative_text"],
        sources=plan["sources"],
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    twin_service.append_event(
        db,
        patient_id=body.patient_id,
        event_type="care_plan",
        payload={
            "care_plan_id": record.id,
            "risk_tier": plan["risk_tier"],
            "follow_up_weeks": plan["follow_up_weeks"],
            "safety_status": result["safety"]["status"],
        },
        source="real",
    )

    return CarePlanOut(
        id=record.id,
        patient_id=body.patient_id,
        **{k: plan[k] for k in (
            "diet_focus", "activity_target", "monitoring_frequency", "follow_up_weeks",
            "narrative_text", "notes", "sources", "generated_by", "risk_tier",
        )},
        screening=screening,
        safety=_safety_out(result),
        trace=result["trace"],
    )


@router.post("/chat", response_model=ChatOut)
def chat(body: ChatRequest, db: Session = Depends(get_db)):
    _require_patient(db, body.patient_id)

    session = db.get(ChatSession, body.session_id) if body.session_id else None
    if session is None:
        session = ChatSession(patient_id=body.patient_id)
        db.add(session)
        db.commit()
        db.refresh(session)

    prior = (
        db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session.id)
            .order_by(ChatMessage.id.asc())
        )
        .scalars()
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in prior]

    db.add(ChatMessage(session_id=session.id, role="user", content=body.message, sources=[]))
    db.commit()

    result = Orchestrator(db).run(
        mode="chat",
        patient_id=body.patient_id,
        message=body.message,
        history=history,
        use_llm=body.use_llm,
    )
    chat_result, safety = result["chat"], result["safety"]
    # A BLOCKED reply is replaced by the gate's fallback before storage, so
    # the transcript never retains unsafe text.
    reply_text = safety["text"] if safety["status"] == "BLOCKED" else chat_result["reply_text"]

    db.add(
        ChatMessage(
            session_id=session.id,
            role="agent",
            agent_name="ConversationalAssistantAgent",
            content=reply_text,
            sources=chat_result["sources"],
        )
    )
    db.commit()

    return ChatOut(
        session_id=session.id,
        reply_text=reply_text,
        sources=chat_result["sources"],
        generated_by=chat_result["generated_by"],
        tools_used=chat_result["tools_used"],
        safety=_safety_out(result),
        trace=result["trace"],
    )


@router.post("/clinical/analyze", response_model=ClinicalAnalysisOut)
def analyze_clinical(body: ClinicalAnalysisRequest, db: Session = Depends(get_db)):
    """Runs through the Orchestrator (mode="clinical") exactly like every
    other clinically-sensitive endpoint on this router — the Clinical
    Analysis Agent composes the analysis, then the Safety Agent
    independently gates it (docs/CLINICAL_ANALYSIS.md). Not persisted:
    unlike screening/care-plan, nothing downstream references a stored
    clinical-analysis row yet, so there is no ScreeningAssessment-style
    table for this endpoint this phase."""
    _require_patient(db, body.patient_id)
    result = Orchestrator(db).run(
        mode="clinical",
        patient_id=body.patient_id,
        question=body.question,
        include_model_comparison=body.include_model_comparison,
        include_evidence=body.include_evidence,
        include_pubmed=body.include_pubmed,
        include_simulation=body.include_simulation,
        use_llm=body.use_llm,
    )
    ca = result["clinical_analysis"]
    return ClinicalAnalysisOut(
        patient_id=body.patient_id,
        **{k: ca[k] for k in (
            "question", "status", "scope", "patient_summary", "model_analysis", "evidence_findings",
            "simulation", "integrated_analysis", "uncertainties", "citations", "safety_flags",
            "unavailable_reason", "generated_by", "production_risk_tier",
        )},
        safety=_safety_out(result),
        trace=result["trace"],
    )


@router.post("/agents/run", response_model=AgentRunOut)
def run_pipeline(body: AgentRunRequest, db: Session = Depends(get_db)):
    """Full orchestrated pipeline with the complete agent trace — the
    demo/grading endpoint."""
    _require_patient(db, body.patient_id)
    if body.mode == "chat" and not body.message:
        raise HTTPException(status_code=400, detail="mode='chat' requires a message")

    result = Orchestrator(db).run(
        mode=body.mode,
        patient_id=body.patient_id,
        hypothesis=body.hypothesis,
        hypothesis_text=body.hypothesis_text,
        message=body.message,
        use_llm=body.use_llm,
    )
    return AgentRunOut(
        patient_id=body.patient_id,
        mode=body.mode,
        screening=result.get("screening"),
        evidence=result.get("evidence"),
        simulation=result.get("simulation"),
        care_plan=result.get("care_plan"),
        chat=result.get("chat"),
        safety=_safety_out(result),
        trace=result["trace"],
    )
