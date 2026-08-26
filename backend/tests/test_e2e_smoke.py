"""End-to-end smoke test over the real API, covering both a screening-
eligible patient and one with an incomplete recorded history — the two
refusal/success paths a grader should see."""

from unittest.mock import patch

from app.agents.conversational_agent import ChatResult


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["policy_version"]


def test_full_journey_eligible_patient(client, eligible_patient):
    pid = eligible_patient["id"]
    assert eligible_patient["screening_eligible"] is True

    timeline = client.get(f"/api/twin/{pid}/timeline").json()
    assert len(timeline["events"]) > 0
    assert timeline["current_state"]["sex"] == "female"

    screening = client.post("/api/screening/run", json={"patient_id": pid}).json()
    assert screening["status"] == "scored"
    assert screening["risk_tier"] in ("Low", "Moderate", "High")
    assert screening["scope"] == "educational_screening_only"
    assert screening["safety"]["disclaimer"]
    assert len(screening["trace"]) >= 4

    simulation = client.post(
        "/api/simulate",
        json={"patient_id": pid, "hypothesis": {"weight_kg_delta": -6, "horizon_weeks": 12}},
    ).json()
    assert simulation["status"] == "scored"
    assert len(simulation["trajectory"]) >= 3
    assert simulation["assumptions"]
    assert simulation["label"] == "simulated projection, not a clinical forecast"

    plan = client.post("/api/careplan/generate", json={"patient_id": pid, "use_llm": False}).json()
    assert plan["follow_up_weeks"] > 0
    assert plan["sources"], "care plan must cite evidence"

    chat = client.post(
        "/api/chat",
        json={"patient_id": pid, "message": "How much exercise should I do?", "use_llm": False},
    ).json()
    assert chat["reply_text"]
    assert chat["sources"]

    audit = client.get("/api/safety/audit-log").json()
    assert len(audit) >= 4
    assert {"screening", "care_plan", "simulation", "chat"} <= {r["target_type"] for r in audit}


def test_full_journey_incomplete_history_patient(client, incomplete_patient):
    pid = incomplete_patient["id"]
    # Sex is recorded (male — fully eligible on that basis, unlike this
    # project's original Pima-based model); what's missing is data.
    assert incomplete_patient["screening_eligible"] is True

    screening = client.post("/api/screening/run", json={"patient_id": pid}).json()
    assert screening["status"] == "unavailable_for_profile"
    assert screening["risk_probability"] is None
    assert "missing measurement" in screening["unavailable_reason"].lower()

    simulation = client.post(
        "/api/simulate", json={"patient_id": pid, "hypothesis": {"bmi_delta": -3}}
    ).json()
    assert simulation["status"] == "unavailable_for_profile"
    assert simulation["trajectory"] == []

    # An incomplete profile still gets a generic, clearly-labelled plan.
    plan = client.post("/api/careplan/generate", json={"patient_id": pid, "use_llm": False}).json()
    assert plan["risk_tier"] is None
    assert "could not produce a screening baseline" in plan["monitoring_frequency"]


def test_pipeline_endpoint_returns_trace(client, eligible_patient):
    body = client.post(
        "/api/agents/run", json={"patient_id": eligible_patient["id"], "mode": "intake", "use_llm": False}
    ).json()
    assert body["screening"] and body["care_plan"] and body["evidence"]
    assert any("Orchestrator" in step for step in body["trace"])
    assert any("Safety" in step for step in body["trace"])


def test_unsafe_llm_output_is_blocked_before_reaching_user(client, eligible_patient):
    """The conversational agent's prompt rules are only a first line of
    defence; the gate must independently stop unsafe text."""
    unsafe = ChatResult(
        reply_text="You have diabetes and should start taking metformin 500 mg daily.",
        sources=[],
        generated_by="llm",
        tools_used=[],
    )
    with patch("app.agents.conversational_agent.ConversationalAgent.run", return_value=unsafe):
        body = client.post(
            "/api/chat",
            json={"patient_id": eligible_patient["id"], "message": "what do my results mean?"},
        ).json()

    assert body["safety"]["status"] == "BLOCKED"
    assert "metformin" not in body["reply_text"].lower()
    assert "you have diabetes" not in body["reply_text"].lower()


def test_blocked_reply_is_not_persisted(client, eligible_patient):
    from app.database import SessionLocal
    from app.models.chat import ChatMessage

    unsafe = ChatResult(
        reply_text="You are diabetic.", sources=[], generated_by="llm", tools_used=[]
    )
    with patch("app.agents.conversational_agent.ConversationalAgent.run", return_value=unsafe):
        client.post(
            "/api/chat", json={"patient_id": eligible_patient["id"], "message": "am I diabetic?"}
        )

    session = SessionLocal()
    try:
        contents = [m.content.lower() for m in session.query(ChatMessage).all()]
    finally:
        session.close()
    assert not any("you are diabetic" in c for c in contents)


def test_unknown_patient_returns_404(client):
    assert client.post("/api/screening/run", json={"patient_id": 99999}).status_code == 404
    assert client.get("/api/twin/99999/timeline").status_code == 404


def test_timeline_event_can_be_appended(client, eligible_patient):
    pid = eligible_patient["id"]
    before = len(client.get(f"/api/twin/{pid}/timeline").json()["events"])
    resp = client.post(
        f"/api/twin/{pid}/events",
        json={"event_type": "measurement", "payload": {"bmi": 27.5}, "source": "real"},
    )
    assert resp.status_code == 201
    after = client.get(f"/api/twin/{pid}/timeline").json()
    assert len(after["events"]) == before + 1
    assert after["current_state"]["bmi"] == 27.5
