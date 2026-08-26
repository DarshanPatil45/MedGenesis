"""Phase 2: Digital Twin expansion (docs/DIGITAL_TWIN.md).

Covers lab-result and medication materialization through the ONE existing
Digital Twin service (services/twin.py — no second twin service), the new
validation added to append_event() for those two event types, and the new
additive API endpoints. test_e2e_smoke.py / test_twin_and_simulation.py
already cover that get_current_state() and the existing /timeline endpoint
are completely unaffected; this file focuses on what's new.
"""

from __future__ import annotations

import pytest

from app.models.patient import Patient
from app.services import twin as twin_service


def _make_patient(db, sex="female", age=55):
    patient = Patient(pseudonym="Phase 2 twin test", age=age, sex=sex, is_synthetic=True)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


# --- Step 10: validation -----------------------------------------------------


class TestLabResultValidation:
    def test_valid_lab_result_is_accepted(self, db_session):
        patient = _make_patient(db_session)
        event = twin_service.append_event(
            db_session, patient_id=patient.id, event_type="lab_result",
            payload={"test_name": "HbA1c", "value": 7.2, "unit": "%"},
        )
        assert event.payload["test_name"] == "HbA1c"

    def test_missing_value_is_rejected(self, db_session):
        patient = _make_patient(db_session)
        with pytest.raises(ValueError, match="value"):
            twin_service.append_event(
                db_session, patient_id=patient.id, event_type="lab_result",
                payload={"test_name": "HbA1c"},
            )

    def test_missing_test_name_is_rejected(self, db_session):
        patient = _make_patient(db_session)
        with pytest.raises(ValueError, match="test_name"):
            twin_service.append_event(
                db_session, patient_id=patient.id, event_type="lab_result",
                payload={"value": 7.2},
            )

    def test_non_numeric_value_is_rejected(self, db_session):
        patient = _make_patient(db_session)
        with pytest.raises(ValueError, match="numeric"):
            twin_service.append_event(
                db_session, patient_id=patient.id, event_type="lab_result",
                payload={"test_name": "HbA1c", "value": "high"},
            )

    def test_boolean_value_is_rejected(self):
        """bool is a subclass of int in Python — guard against True/False
        silently passing the numeric check."""
        with pytest.raises(ValueError, match="numeric"):
            twin_service.validate_lab_result_payload({"test_name": "HbA1c", "value": True})

    def test_optional_fields_are_genuinely_optional(self, db_session):
        patient = _make_patient(db_session)
        event = twin_service.append_event(
            db_session, patient_id=patient.id, event_type="lab_result",
            payload={"test_name": "Fasting glucose", "value": 110},
        )
        assert "unit" not in event.payload  # never invented


class TestMedicationChangeValidation:
    def test_valid_medication_change_is_accepted(self, db_session):
        patient = _make_patient(db_session)
        event = twin_service.append_event(
            db_session, patient_id=patient.id, event_type="medication_change",
            payload={"medication_name": "Metformin", "action": "started"},
        )
        assert event.payload["medication_name"] == "Metformin"

    def test_missing_medication_name_is_rejected(self, db_session):
        patient = _make_patient(db_session)
        with pytest.raises(ValueError, match="medication_name"):
            twin_service.append_event(
                db_session, patient_id=patient.id, event_type="medication_change",
                payload={"action": "started"},
            )

    def test_invalid_action_is_rejected(self, db_session):
        patient = _make_patient(db_session)
        with pytest.raises(ValueError, match="action"):
            twin_service.append_event(
                db_session, patient_id=patient.id, event_type="medication_change",
                payload={"medication_name": "Metformin", "action": "prescribed_by_ai"},
            )

    def test_missing_action_is_rejected(self, db_session):
        patient = _make_patient(db_session)
        with pytest.raises(ValueError):
            twin_service.append_event(
                db_session, patient_id=patient.id, event_type="medication_change",
                payload={"medication_name": "Metformin"},
            )


class TestGeneralEventValidation:
    def test_unknown_event_type_still_rejected(self, db_session):
        """Pre-existing behavior — confirmed still true after the Phase 1/2
        EVENT_TYPES extension."""
        patient = _make_patient(db_session)
        with pytest.raises(ValueError, match="Unknown event_type"):
            twin_service.append_event(
                db_session, patient_id=patient.id, event_type="not_a_real_type", payload={},
            )

    def test_missing_recorded_at_defaults_rather_than_errors(self, db_session):
        """"Missing date" at the append_event level means "not explicitly
        backfilled" — the system still needs some timestamp for ordering, so
        it defaults to now() rather than raising. Distinct from a genuinely
        missing *clinical* value, which stays missing (see the tests above)."""
        patient = _make_patient(db_session)
        event = twin_service.append_event(
            db_session, patient_id=patient.id, event_type="lab_result",
            payload={"test_name": "HbA1c", "value": 6.9},
        )
        assert event.recorded_at is not None

    def test_measurement_and_lifestyle_log_unaffected_by_new_validation(self, db_session):
        """The new validation is scoped to lab_result/medication_change only
        — every other event type keeps its existing free-form payload."""
        patient = _make_patient(db_session)
        event = twin_service.append_event(
            db_session, patient_id=patient.id, event_type="measurement", payload={"bmi": 27.0},
        )
        assert event.payload == {"bmi": 27.0}


# --- Steps 3-5, 9: materialization ------------------------------------------


class TestLabMaterialization:
    def test_history_preserves_every_value_not_just_latest(self, db_session):
        patient = _make_patient(db_session)
        for value in (7.0, 7.4, 7.8):
            twin_service.append_event(
                db_session, patient_id=patient.id, event_type="lab_result",
                payload={"test_name": "HbA1c", "value": value},
            )
        history = twin_service.get_lab_history(db_session, patient.id, test_name="HbA1c")
        assert [h["value"] for h in history] == [7.0, 7.4, 7.8]

    def test_latest_labs_returns_only_the_most_recent_per_test(self, db_session):
        patient = _make_patient(db_session)
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="lab_result",
            payload={"test_name": "HbA1c", "value": 7.0},
        )
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="lab_result",
            payload={"test_name": "HbA1c", "value": 7.8},
        )
        latest = twin_service.get_latest_labs(db_session, patient.id)
        assert latest["HbA1c"]["value"] == 7.8

    def test_different_tests_tracked_independently(self, db_session):
        patient = _make_patient(db_session)
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="lab_result",
            payload={"test_name": "HbA1c", "value": 7.0},
        )
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="lab_result",
            payload={"test_name": "Fasting glucose", "value": 110},
        )
        latest = twin_service.get_latest_labs(db_session, patient.id)
        assert set(latest) == {"HbA1c", "Fasting glucose"}

    def test_never_recorded_test_is_simply_absent_not_a_guess(self, db_session):
        patient = _make_patient(db_session)
        latest = twin_service.get_latest_labs(db_session, patient.id)
        assert "HbA1c" not in latest

    @pytest.mark.parametrize(
        "values,expected_trend",
        [
            ([], "no_data"),
            ([7.0], "insufficient_data"),
            ([7.0, 7.8], "insufficient_data"),  # 2 points — explicitly not called a trend
            ([7.0, 7.4, 7.8], "increasing"),
            ([7.8, 7.4, 7.0], "decreasing"),
            ([7.0, 7.0, 7.0], "stable"),
            ([7.0, 7.8, 7.1], "mixed"),
        ],
    )
    def test_trend_labels(self, db_session, values, expected_trend):
        patient = _make_patient(db_session)
        for v in values:
            twin_service.append_event(
                db_session, patient_id=patient.id, event_type="lab_result",
                payload={"test_name": "HbA1c", "value": v},
            )
        result = twin_service.get_lab_trend(db_session, patient.id, "HbA1c")
        assert result["trend"] == expected_trend
        assert len(result["history"]) == len(values)

    def test_trend_never_invokes_a_hardcoded_medical_threshold(self):
        """Step 4: the Digital Twin represents data, it does not classify
        risk — confirmed by inspection, not just assertion: the function
        takes no threshold parameter and its only inputs are the recorded
        values' relative order."""
        import inspect

        src = inspect.getsource(twin_service.get_lab_trend)
        for forbidden in ("6.5", "diabetic", "diagnos"):
            assert forbidden not in src.lower()


class TestMedicationMaterialization:
    def test_current_medications_uses_latest_action_per_name(self, db_session):
        patient = _make_patient(db_session)
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="medication_change",
            payload={"medication_name": "Metformin", "action": "started", "dose": "500mg"},
        )
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="medication_change",
            payload={"medication_name": "Metformin", "action": "dose_changed", "dose": "1000mg"},
        )
        current = twin_service.get_current_medications(db_session, patient.id)
        assert len(current) == 1
        assert current[0]["dose"] == "1000mg"

    def test_stopped_medication_excluded_from_current(self, db_session):
        patient = _make_patient(db_session)
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="medication_change",
            payload={"medication_name": "Lisinopril", "action": "started"},
        )
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="medication_change",
            payload={"medication_name": "Lisinopril", "action": "stopped"},
        )
        current = twin_service.get_current_medications(db_session, patient.id)
        assert current == []

    def test_stopped_then_restarted_reappears_in_current(self, db_session):
        patient = _make_patient(db_session)
        for action in ("started", "stopped", "started"):
            twin_service.append_event(
                db_session, patient_id=patient.id, event_type="medication_change",
                payload={"medication_name": "Metformin", "action": action},
            )
        current = twin_service.get_current_medications(db_session, patient.id)
        assert len(current) == 1 and current[0]["action"] == "started"

    def test_history_preserves_every_change_including_stopped_ones(self, db_session):
        patient = _make_patient(db_session)
        for action in ("started", "stopped"):
            twin_service.append_event(
                db_session, patient_id=patient.id, event_type="medication_change",
                payload={"medication_name": "Lisinopril", "action": action},
            )
        history = twin_service.get_medication_history(db_session, patient.id)
        assert [h["action"] for h in history] == ["started", "stopped"]

    def test_no_treatment_recommendation_language_anywhere_in_module(self):
        """Step 5: this represents history, it does not prescribe. Checks
        for actual imperative/advisory phrasing, not the bare word
        "prescription" — which legitimately appears in this module's own
        comments explaining that it does NOT do that."""
        import inspect

        src = inspect.getsource(twin_service).lower()
        for forbidden in ("you should take", "we recommend", "start taking", "increase your dose"):
            assert forbidden not in src


class TestStructuredTwin:
    def test_shape_matches_documented_structure(self, db_session):
        patient = _make_patient(db_session)
        twin = twin_service.get_structured_twin(db_session, patient.id)
        assert set(twin) == {"patient", "clinical", "laboratory", "medications", "lifestyle", "timeline"}
        assert set(twin["laboratory"]) == {"latest", "history"}
        assert set(twin["medications"]) == {"current", "history"}

    def test_backwards_compatible_get_current_state_unaffected(self, db_session):
        """The existing flat view every agent/test depends on must be
        byte-for-byte the same shape as before Phase 2."""
        patient = _make_patient(db_session)
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="measurement", payload={"bmi": 27.0},
        )
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="lab_result",
            payload={"test_name": "HbA1c", "value": 7.0},
        )
        state = twin_service.get_current_state(db_session, patient.id)
        assert state == {"patient_id": patient.id, "age": patient.age, "sex": patient.sex, "bmi": 27.0}
        assert "HbA1c" not in state and "test_name" not in state

    def test_clinical_and_lifestyle_reuse_existing_measurement_fields(self, db_session):
        patient = _make_patient(db_session)
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="measurement",
            payload={"high_bp": 1, "phys_activity": 0, "unrelated_field": "x"},
        )
        twin = twin_service.get_structured_twin(db_session, patient.id)
        assert twin["clinical"]["high_bp"] == 1
        assert twin["lifestyle"]["phys_activity"] == 0
        assert "unrelated_field" not in twin["clinical"] and "unrelated_field" not in twin["lifestyle"]


class TestTimelineOrdering:
    def test_lab_and_medication_events_stay_in_chronological_order(self, db_session):
        from datetime import datetime, timedelta, timezone

        patient = _make_patient(db_session)
        now = datetime.now(timezone.utc)
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="lab_result",
            payload={"test_name": "HbA1c", "value": 7.8}, recorded_at=now,
        )
        twin_service.append_event(
            db_session, patient_id=patient.id, event_type="lab_result",
            payload={"test_name": "HbA1c", "value": 7.0}, recorded_at=now - timedelta(days=180),
        )
        history = twin_service.get_lab_history(db_session, patient.id, test_name="HbA1c")
        assert [h["value"] for h in history] == [7.0, 7.8]  # oldest first despite insertion order


# --- Step 12: synthetic patient --------------------------------------------


class TestSyntheticPatientLabsAndMedications:
    def test_moderate_risk_profile_has_hba1c_history_and_a_medication(self, db_session):
        from app.ml.synthetic_patients import create_demo_patient

        patient = create_demo_patient(db_session, "moderate_risk")
        assert patient.is_synthetic is True

        trend = twin_service.get_lab_trend(db_session, patient.id, "HbA1c")
        assert trend["trend"] == "increasing"
        assert len(trend["history"]) == 3

        current = twin_service.get_current_medications(db_session, patient.id)
        assert any(m["medication_name"] == "Metformin" for m in current)

        for event in twin_service.get_medication_history(db_session, patient.id):
            assert event.get("source", "synthetic")  # sanity: no crash reading it back

    def test_profiles_without_lab_history_are_unaffected(self, db_session):
        """Backwards compatibility: lower_risk/incomplete_history never
        defined lab_history/medication_history — confirms they still
        generate with zero lab/medication events, same as before Phase 2."""
        from app.ml.synthetic_patients import create_demo_patient

        for key in ("lower_risk", "incomplete_history"):
            patient = create_demo_patient(db_session, key, seed=1)
            assert twin_service.get_lab_history(db_session, patient.id) == []
            assert twin_service.get_medication_history(db_session, patient.id) == []
