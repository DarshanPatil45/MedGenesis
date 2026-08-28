"""Orchestrator Agent — LangGraph StateGraph over the specialist agents.

Routing is DETERMINISTIC, not LLM-decided. An LLM choosing which agent runs
next would make the safety path non-deterministic, and the whole point of
the Safety gate is that it cannot be routed around. So the graph encodes
fixed routes and the entry mode selects one:

  intake      : load twin -> Screening -> Evidence -> Care-Plan -> Safety
  simulation  : fork twin -> What-if -> Safety
  chat        : load twin -> Conversational (Evidence as tool) -> Safety

Every node appends to `trace`, which the UI renders on the Agent Trace page
so the run order is visible rather than implied.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from langgraph.graph import END, StateGraph
from sqlalchemy.orm import Session

from app.agents.careplan_agent import get_careplan_agent
from app.agents.clinical_agent import get_clinical_agent
from app.agents.conversational_agent import get_conversational_agent
from app.agents.evidence_agent import get_evidence_agent
from app.agents.safety_agent import (
    APPROVED,
    BLOCKED,
    FLAGGED,
    SafetyDecision,
    get_safety_agent,
)
from app.agents.screening_agent import get_screening_agent
from app.agents.simulation_agent import get_simulation_agent
from app.services import twin as twin_service

Mode = Literal["intake", "simulation", "chat", "clinical"]


class MedGenesisState(TypedDict, total=False):
    # inputs
    mode: Mode
    patient_id: int
    hypothesis: dict[str, Any]
    hypothesis_text: str | None
    message: str
    history: list[dict[str, str]]
    use_llm: bool
    question: str
    include_model_comparison: bool
    include_evidence: bool
    include_pubmed: bool
    include_simulation: bool
    # working state
    twin_snapshot: dict[str, Any]
    base_timeline_event_id: int | None
    screening: dict[str, Any]
    evidence: list[dict[str, Any]]
    simulation: dict[str, Any]
    care_plan: dict[str, Any]
    chat: dict[str, Any]
    clinical_analysis: dict[str, Any]
    # outputs
    safety: dict[str, Any]
    trace: list[str]


def _trace(state: MedGenesisState, message: str) -> list[str]:
    return [*state.get("trace", []), message]


def _merge_decisions(*decisions: SafetyDecision) -> SafetyDecision:
    """Combines per-output decisions into the route's overall verdict. The
    most severe status wins, so a clean care plan can't mask a blocked
    screening result."""
    severity = {APPROVED: 0, FLAGGED: 1, BLOCKED: 2}
    worst = max(decisions, key=lambda d: severity[d.status])
    reasons: list[str] = []
    for d in decisions:
        reasons.extend(r for r in d.reasons if r not in reasons)
    return SafetyDecision(
        status=worst.status,
        reasons=reasons,
        text=worst.text,
        disclaimer=next((d.disclaimer for d in decisions if d.disclaimer), None),
        banner=next((d.banner for d in decisions if d.banner), None),
        policy_version=worst.policy_version,
    )


def build_graph(db: Session):
    """The Session is closed over rather than carried in state — LangGraph
    state should stay JSON-serializable so it can be logged and returned."""

    def load_twin(state: MedGenesisState) -> dict[str, Any]:
        snapshot, base_event_id = twin_service.fork_snapshot(db, state["patient_id"])
        return {
            "twin_snapshot": snapshot,
            "base_timeline_event_id": base_event_id,
            "trace": _trace(
                state,
                f"PatientDigitalTwin: materialized current state for patient "
                f"{state['patient_id']} from the append-only timeline "
                f"({len(snapshot)} fields, base event {base_event_id}).",
            ),
        }

    def screening_node(state: MedGenesisState) -> dict[str, Any]:
        result = get_screening_agent().run(state["twin_snapshot"])
        if result.status == "scored":
            note = f"scored {result.risk_probability:.0%} ({result.risk_tier} tier)"
        else:
            note = "returned unavailable_for_profile (eligibility gate)"
        return {
            "screening": result.to_dict(),
            "trace": _trace(state, f"ScreeningRiskBaselineAgent: {note}."),
        }

    def evidence_node(state: MedGenesisState) -> dict[str, Any]:
        agent = get_evidence_agent()
        tier = (state.get("screening") or {}).get("risk_tier")
        query = f"type 2 diabetes {tier or 'general'} risk prevention diet activity monitoring"
        chunks = agent.retrieve_as_dicts(query)
        return {
            "evidence": chunks,
            "trace": _trace(
                state,
                f"EvidenceRetrievalAgent: retrieved {len(chunks)} cited passages "
                f"via {agent.backend_name}.",
            ),
        }

    def careplan_node(state: MedGenesisState) -> dict[str, Any]:
        screening = state.get("screening") or {}
        result = get_careplan_agent().run(
            state["twin_snapshot"],
            risk_tier=screening.get("risk_tier"),
            screening_status=screening.get("status", "unavailable_for_profile"),
            use_llm=state.get("use_llm", True),
        )
        return {
            "care_plan": result.to_dict(),
            "trace": _trace(state, f"CarePlanRecommendationAgent: built plan ({result.generated_by})."),
        }

    def simulation_node(state: MedGenesisState) -> dict[str, Any]:
        result = get_simulation_agent().run(
            state["twin_snapshot"],
            state.get("hypothesis", {}),
            base_timeline_event_id=state.get("base_timeline_event_id"),
            hypothesis_text=state.get("hypothesis_text"),
        )
        if result.status == "scored":
            source = "free-text scenario" if state.get("hypothesis_text") and not state.get("hypothesis") else "structured hypothesis"
            note = f"projected {len(result.trajectory)} points from a {source} (forked snapshot, real timeline untouched)"
        else:
            note = "returned unavailable_for_profile"
        return {
            "simulation": result.to_dict(),
            "trace": _trace(state, f"WhatIfSimulationAgent: {note}."),
        }

    def clinical_node(state: MedGenesisState) -> dict[str, Any]:
        """Runs the Clinical Analysis Agent — a composition layer over the
        screening/XGBoost/evidence/simulation agents, not a reimplementation
        of any of them (docs/CLINICAL_ANALYSIS.md). Its own output is not
        yet reviewed by Safety here; that happens uniformly in safety_node
        below, same as every other route."""
        result = get_clinical_agent().run(
            state["twin_snapshot"],
            state.get("question", ""),
            db=db,
            patient_id=state["patient_id"],
            include_model_comparison=state.get("include_model_comparison", False),
            include_evidence=state.get("include_evidence", True),
            include_pubmed=state.get("include_pubmed", False),
            include_simulation=state.get("include_simulation", False),
            base_timeline_event_id=state.get("base_timeline_event_id"),
            use_llm=state.get("use_llm", True),
        )
        return {
            "clinical_analysis": result.to_dict(),
            "trace": _trace(
                state,
                f"ClinicalAnalysisAgent: {result.status} ({result.generated_by}); "
                f"{len(result.citations)} citation(s), {len(result.uncertainties)} uncertainty note(s), "
                f"{len(result.safety_flags)} generation flag(s).",
            ),
        }

    def chat_node(state: MedGenesisState) -> dict[str, Any]:
        screening = state.get("screening") or {}
        result = get_conversational_agent().run(
            state["message"],
            history=state.get("history"),
            patient_context={"risk_tier": screening.get("risk_tier")},
            use_llm=state.get("use_llm", True),
        )
        return {
            "chat": result.to_dict(),
            "trace": _trace(
                state,
                f"ConversationalAssistantAgent: replied via {result.generated_by} "
                f"(tools: {', '.join(result.tools_used) or 'none'}).",
            ),
        }

    def safety_node(state: MedGenesisState) -> dict[str, Any]:
        """Single gate for all three routes — whichever payload the route
        produced is what gets reviewed, so no route can reach the user
        ungated."""
        mode = state.get("mode", "intake")
        agent = get_safety_agent()

        if mode == "simulation":
            sim = state.get("simulation") or {}
            decision = agent.review_and_log(
                db,
                target_type="simulation",
                target_id=state["patient_id"],
                output_kind="simulation",
                text=sim.get("summary_text", ""),
                scope=sim.get("scope"),
                trajectory=sim.get("trajectory"),
            )
        elif mode == "clinical":
            ca = state.get("clinical_analysis") or {}
            full_text = " ".join(
                c.get("claim", "")
                for section in (ca.get("patient_summary"), ca.get("model_analysis"), ca.get("integrated_analysis"))
                for c in (section or [])
            )
            decision = agent.review_and_log(
                db,
                target_type="clinical_analysis",
                target_id=state["patient_id"],
                output_kind="clinical_analysis",
                text=full_text,
                scope=ca.get("scope"),
                risk_tier=ca.get("production_risk_tier"),
            )
            if decision.is_blocked:
                # The whole composed analysis is withheld together — a
                # partially-blocked structured analysis (e.g. only the
                # integrated_analysis replaced) could still leak the
                # blocked content via patient_summary/model_analysis, so
                # blocking clears every claim list rather than one field.
                blocked = state.setdefault("clinical_analysis", {})
                blocked["patient_summary"] = []
                blocked["model_analysis"] = []
                blocked["integrated_analysis"] = [
                    {"claim": decision.text, "claim_type": "uncertainty", "evidence_ids": []}
                ]
                blocked["evidence_findings"] = []
                blocked["citations"] = []
        elif mode == "chat":
            chat = state.get("chat") or {}
            decision = agent.review_and_log(
                db,
                target_type="chat",
                target_id=state["patient_id"],
                output_kind="chat",
                text=chat.get("reply_text", ""),
                scope="educational_screening_only",
                user_text=state.get("message"),
            )
            if decision.is_blocked:
                state.setdefault("chat", {})["reply_text"] = decision.text
        else:
            # Intake produces two distinct sensitive outputs, so each is gated
            # and audited on its own — a single merged row would make the log
            # unable to answer "was the screening result itself reviewed?".
            screening = state.get("screening") or {}
            plan = state.get("care_plan") or {}

            screening_decision = agent.review_and_log(
                db,
                target_type="screening",
                target_id=state["patient_id"],
                output_kind="screening",
                text=screening.get("summary_text", ""),
                scope=screening.get("scope"),
                risk_tier=screening.get("risk_tier"),
            )
            plan_decision = agent.review_and_log(
                db,
                target_type="care_plan",
                target_id=state["patient_id"],
                output_kind="care_plan",
                text=plan.get("narrative_text", ""),
                scope=screening.get("scope"),
                risk_tier=screening.get("risk_tier"),
            )
            if plan_decision.is_blocked:
                state.setdefault("care_plan", {})["narrative_text"] = plan_decision.text
            if screening_decision.is_blocked:
                state.setdefault("screening", {})["summary_text"] = screening_decision.text

            decision = _merge_decisions(screening_decision, plan_decision)

        return {
            "safety": decision.to_dict(),
            "trace": _trace(
                state,
                f"SafetyClinicianReviewAgent: {decision.status} "
                f"(policy {decision.policy_version}, {len(decision.reasons)} reason(s)).",
            ),
        }

    graph = StateGraph(MedGenesisState)
    graph.add_node("load_twin", load_twin)
    graph.add_node("screening", screening_node)
    graph.add_node("evidence", evidence_node)
    graph.add_node("careplan", careplan_node)
    graph.add_node("simulation", simulation_node)
    graph.add_node("chat", chat_node)
    graph.add_node("clinical", clinical_node)
    graph.add_node("safety", safety_node)

    graph.set_entry_point("load_twin")
    graph.add_conditional_edges(
        "load_twin",
        lambda s: s.get("mode", "intake"),
        {"intake": "screening", "simulation": "simulation", "chat": "screening", "clinical": "clinical"},
    )
    # In chat mode the screening result is context for the reply, not an
    # output of its own — it is not separately gated, the reply is.
    graph.add_conditional_edges(
        "screening",
        lambda s: "chat" if s.get("mode") == "chat" else "intake",
        {"intake": "evidence", "chat": "chat"},
    )
    graph.add_edge("evidence", "careplan")
    graph.add_edge("careplan", "safety")
    graph.add_edge("simulation", "safety")
    graph.add_edge("chat", "safety")
    graph.add_edge("clinical", "safety")
    graph.add_edge("safety", END)

    return graph.compile()


class Orchestrator:
    name = "OrchestratorAgent"

    def __init__(self, db: Session):
        self.db = db
        self.graph = build_graph(db)

    def run(
        self,
        *,
        mode: Mode,
        patient_id: int,
        hypothesis: dict[str, Any] | None = None,
        hypothesis_text: str | None = None,
        message: str | None = None,
        history: list[dict[str, str]] | None = None,
        use_llm: bool = True,
        question: str = "",
        include_model_comparison: bool = False,
        include_evidence: bool = True,
        include_pubmed: bool = False,
        include_simulation: bool = False,
    ) -> dict[str, Any]:
        initial: MedGenesisState = {
            "mode": mode,
            "patient_id": patient_id,
            "hypothesis": hypothesis or {},
            "hypothesis_text": hypothesis_text,
            "message": message or "",
            "history": history or [],
            "use_llm": use_llm,
            "question": question,
            "include_model_comparison": include_model_comparison,
            "include_evidence": include_evidence,
            "include_pubmed": include_pubmed,
            "include_simulation": include_simulation,
            "trace": [f"OrchestratorAgent: routing mode='{mode}' for patient {patient_id}."],
        }
        return dict(self.graph.invoke(initial))
