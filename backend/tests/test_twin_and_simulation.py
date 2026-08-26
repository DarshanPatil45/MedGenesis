from datetime import datetime, timedelta, timezone

from app.agents.simulation_agent import SimulationAgent
from app.agents.simulation_rules import Hypothesis, effective_deltas, horizon_steps
from app.models.patient import Patient
from app.services import twin as twin_service

BASE_STATE = {
    "sex": "female",
    "age": 52,
    "high_bp": 1, "high_chol": 0, "chol_check": 1, "bmi": 29.0,
    "smoker": 0, "stroke": 0, "heart_disease_or_attack": 0,
    "phys_activity": 1, "fruits": 1, "veggies": 1, "hvy_alcohol_consump": 0,
    "any_healthcare": 1, "no_doc_bc_cost": 0, "gen_hlth": 3,
    "ment_hlth": 2, "phys_hlth": 3, "diff_walk": 0,
    "education": 5, "income": 6,
    "height_m": 1.65,
}


def _make_patient(db):
    patient = Patient(pseudonym="Twin test", age=52, sex="female", is_synthetic=True)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def test_current_state_takes_latest_value_per_field(db_session):
    patient = _make_patient(db_session)
    now = datetime.now(timezone.utc)
    twin_service.append_event(
        db_session,
        patient_id=patient.id,
        event_type="measurement",
        payload={"bmi": 33.0, "high_bp": 1},
        recorded_at=now - timedelta(days=30),
    )
    twin_service.append_event(
        db_session,
        patient_id=patient.id,
        event_type="measurement",
        payload={"bmi": 31.0},
        recorded_at=now,
    )
    state = twin_service.get_current_state(db_session, patient.id)
    assert state["bmi"] == 31.0  # newer wins
    assert state["high_bp"] == 1  # untouched field survives


def test_timeline_is_append_only(db_session):
    patient = _make_patient(db_session)
    first = twin_service.append_event(
        db_session, patient_id=patient.id, event_type="measurement", payload={"bmi": 33.0}
    )
    twin_service.append_event(
        db_session, patient_id=patient.id, event_type="measurement", payload={"bmi": 30.0}
    )
    events = twin_service.get_timeline(db_session, patient.id)
    assert len(events) == 2
    # The original row is preserved verbatim, not overwritten.
    assert events[0].id == first.id and events[0].payload["bmi"] == 33.0


def test_simulation_does_not_write_to_real_timeline(db_session):
    patient = _make_patient(db_session)
    twin_service.append_event(
        db_session, patient_id=patient.id, event_type="measurement", payload=BASE_STATE
    )
    before = len(twin_service.get_timeline(db_session, patient.id))

    snapshot, base_event_id = twin_service.fork_snapshot(db_session, patient.id)
    SimulationAgent().run(snapshot, {"bmi_delta": -3, "horizon_weeks": 12}, base_event_id)

    after = len(twin_service.get_timeline(db_session, patient.id))
    assert after == before, "simulation must never append to the real timeline"


def test_simulation_produces_a_trajectory_not_a_point():
    result = SimulationAgent().run(BASE_STATE, {"bmi_delta": -3, "horizon_weeks": 12})
    assert result.status == "scored"
    assert len(result.trajectory) >= 3
    assert [p["week"] for p in result.trajectory] == [0, 4, 8, 12]
    assert all(p["simulated"] for p in result.trajectory)


def test_lowering_bmi_lowers_projected_risk():
    result = SimulationAgent().run(BASE_STATE, {"bmi_delta": -6, "horizon_weeks": 12})
    assert result.trajectory[-1]["risk_probability"] < result.trajectory[0]["risk_probability"]


def test_simulation_refuses_profile_with_unencoded_sex():
    """Unlike the project's original Pima-based model, male patients are
    fully eligible here (see docs/ARCHITECTURE.md §13.7) — the real
    constraint is a sex value the model has no encoding for."""
    result = SimulationAgent().run({**BASE_STATE, "sex": "other"}, {"bmi_delta": -3})
    assert result.status == "unavailable_for_profile"
    assert result.trajectory == []


def test_simulation_refuses_incomplete_profile():
    result = SimulationAgent().run({**BASE_STATE, "bmi": None}, {"bmi_delta": -3})
    assert result.status == "unavailable_for_profile"
    assert result.trajectory == []


def test_empty_hypothesis_is_rejected():
    result = SimulationAgent().run(BASE_STATE, {})
    assert result.status == "unavailable_for_profile"
    assert "No change was specified" in result.unavailable_reason


def test_weight_change_converts_to_bmi_with_stated_assumption():
    deltas, flag_targets, assumptions = effective_deltas(
        Hypothesis.from_dict({"weight_kg_delta": -8}), {"height_m": 1.63}
    )
    assert deltas["bmi"] < 0
    assert flag_targets == {}
    assert any("BMI = kg / m²" in a for a in assumptions)


def test_missing_height_is_stated_not_hidden():
    _, _, assumptions = effective_deltas(Hypothesis.from_dict({"weight_kg_delta": -8}), {})
    assert any("No height on file" in a for a in assumptions)


def test_activity_and_smoker_are_flag_targets_not_scaled_deltas():
    """PhysActivity/Smoker are binary in the trained model (see
    simulation_rules.py) — any positive activity_minutes_delta means "become
    active" regardless of magnitude, it does not scale a continuous effect
    the way bmi_delta does."""
    _, flag_targets, assumptions = effective_deltas(
        Hypothesis.from_dict({"activity_minutes_delta": 5}), {"phys_activity": 0.0}
    )
    assert flag_targets["phys_activity"] == 1.0
    assert any("yes/no flag" in a for a in assumptions)

    _, flag_targets_big, _ = effective_deltas(
        Hypothesis.from_dict({"activity_minutes_delta": 10000}), {"phys_activity": 0.0}
    )
    assert flag_targets_big["phys_activity"] == 1.0  # same target regardless of magnitude


def test_smoker_delta_targets_quitting():
    _, flag_targets, assumptions = effective_deltas(
        Hypothesis.from_dict({"smoker_delta": -1}), {"smoker": 1.0}
    )
    assert flag_targets["smoker"] == 0.0
    assert any("quitting smoking" in a for a in assumptions)


def test_no_change_modelled_when_already_at_target():
    _, flag_targets, assumptions = effective_deltas(
        Hypothesis.from_dict({"smoker_delta": -1}), {"smoker": 0.0}
    )
    assert flag_targets == {}
    assert any("already matches" in a for a in assumptions)


def test_projected_flag_values_interpolate_across_horizon():
    result = SimulationAgent().run({**BASE_STATE, "smoker": 1.0}, {"smoker_delta": -1, "horizon_weeks": 12})
    smoker_values = [p["smoker"] for p in result.trajectory]
    assert smoker_values[0] == 1.0
    assert smoker_values[-1] == 0.0
    assert smoker_values == sorted(smoker_values, reverse=True)  # monotonically decreasing


def test_horizon_is_clamped():
    assert Hypothesis.from_dict({"bmi_delta": -1, "horizon_weeks": 999}).horizon_weeks == 52
    assert Hypothesis.from_dict({"bmi_delta": -1, "horizon_weeks": 1}).horizon_weeks == 4


def test_horizon_steps_always_include_endpoint():
    assert horizon_steps(10)[-1] == 10
    assert horizon_steps(12) == [0, 4, 8, 12]
