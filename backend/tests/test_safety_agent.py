"""The safety gate is the system's last line of defence, so its rules are
tested directly rather than only through the API."""

import pytest

from app.agents.safety_agent import APPROVED, BLOCKED, FLAGGED, SafetyAgent


@pytest.fixture()
def agent():
    return SafetyAgent()


def test_clean_lifestyle_text_is_approved(agent):
    decision = agent.review(
        output_kind="chat",
        text="Walking for 30 minutes most days may help with blood sugar management.",
        scope="educational_screening_only",
    )
    assert decision.status == APPROVED
    assert decision.reasons == []


@pytest.mark.parametrize(
    "text",
    [
        "Based on these results you have diabetes.",
        "You are diabetic and need treatment.",
        "Your diagnosis is type 2 diabetes.",
        "Good news — you don't have diabetes.",
    ],
)
def test_diagnostic_phrasing_is_blocked(agent, text):
    decision = agent.review(output_kind="chat", text=text, scope="educational_screening_only")
    assert decision.status == BLOCKED
    assert "diagnostic_claim" in decision.reasons[0]
    # The original text must never survive a block.
    assert text not in decision.text


@pytest.mark.parametrize(
    "text",
    [
        "You should start taking metformin.",
        "Increase your dose to 1000 mg daily.",
        "I will prescribe something for this.",
        "Adjust your units of insulin accordingly.",
    ],
)
def test_medication_advice_is_blocked(agent, text):
    decision = agent.review(output_kind="chat", text=text, scope="educational_screening_only")
    assert decision.status == BLOCKED
    assert "medication_advice" in decision.reasons[0]


def test_high_risk_tier_is_flagged_not_blocked(agent):
    decision = agent.review(
        output_kind="screening",
        text="Screening baseline indicates an elevated result.",
        scope="educational_screening_only",
        risk_tier="High",
    )
    assert decision.status == FLAGGED
    assert decision.banner
    # Flagged content is still shown to the user, unlike blocked content.
    assert "elevated result" in decision.text


def test_large_simulation_swing_is_flagged(agent):
    decision = agent.review(
        output_kind="simulation",
        text="Projection complete.",
        scope="educational_screening_only",
        trajectory=[{"risk_probability": 0.88}, {"risk_probability": 0.20}],
    )
    assert decision.status == FLAGGED
    assert any("plausibility threshold" in r for r in decision.reasons)


def test_small_simulation_swing_is_approved(agent):
    decision = agent.review(
        output_kind="simulation",
        text="Projection complete.",
        scope="educational_screening_only",
        trajectory=[{"risk_probability": 0.44}, {"risk_probability": 0.33}],
    )
    assert decision.status == APPROVED


def test_missing_scope_marker_is_flagged_and_disclaimer_still_attached(agent):
    decision = agent.review(output_kind="screening", text="A result.", scope=None)
    assert decision.status == FLAGGED
    assert any("scope marker" in r for r in decision.reasons)
    assert decision.disclaimer, "the gate must attach the disclaimer even when upstream omits scope"


def test_urgent_symptoms_in_user_message_are_flagged(agent):
    decision = agent.review(
        output_kind="chat",
        text="Here is some general information about activity.",
        scope="educational_screening_only",
        user_text="I've had chest pain since this morning",
    )
    assert decision.status == FLAGGED
    assert any("urgent" in r.lower() or "chest pain" in r for r in decision.reasons)


def test_word_boundary_prevents_false_positive(agent):
    # "prescribe" is blocked, but the substring inside another word must not fire.
    decision = agent.review(
        output_kind="chat",
        text="Your clinician may suggest a prescribed exercise programme.",
        scope="educational_screening_only",
    )
    assert decision.status == APPROVED


def test_decisions_are_deterministic(agent):
    kwargs = dict(
        output_kind="screening",
        text="Screening result summary.",
        scope="educational_screening_only",
        risk_tier="High",
    )
    first = agent.review(**kwargs)
    second = agent.review(**kwargs)
    assert first.status == second.status and first.reasons == second.reasons


def test_review_and_log_writes_audit_row(agent, db_session):
    from app.models.safety import SafetyAuditLog

    before = db_session.query(SafetyAuditLog).count()
    agent.review_and_log(
        db_session,
        target_type="screening",
        target_id=999,
        output_kind="screening",
        text="You have diabetes.",
        scope="educational_screening_only",
    )
    rows = db_session.query(SafetyAuditLog).all()
    assert len(rows) == before + 1
    assert rows[-1].status == BLOCKED
    assert rows[-1].policy_version
