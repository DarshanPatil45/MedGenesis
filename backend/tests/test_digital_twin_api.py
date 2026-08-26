"""API-level tests for the Phase 2 Digital Twin endpoints
(docs/DIGITAL_TWIN.md) and backwards compatibility of the existing ones."""

from __future__ import annotations


def _patient(client):
    return client.post("/api/patients", json={"pseudonym": "api twin test", "age": 55, "sex": "female"}).json()["id"]


class TestNewEventTypesOverAPI:
    def test_lab_result_now_accepted(self, client):
        pid = _patient(client)
        resp = client.post(
            f"/api/twin/{pid}/events",
            json={"event_type": "lab_result", "payload": {"test_name": "HbA1c", "value": 7.2}, "source": "real"},
        )
        assert resp.status_code == 201

    def test_medication_change_now_accepted(self, client):
        pid = _patient(client)
        resp = client.post(
            f"/api/twin/{pid}/events",
            json={
                "event_type": "medication_change",
                "payload": {"medication_name": "Metformin", "action": "started"},
                "source": "real",
            },
        )
        assert resp.status_code == 201

    def test_invalid_lab_payload_returns_400_not_500(self, client):
        pid = _patient(client)
        resp = client.post(
            f"/api/twin/{pid}/events",
            json={"event_type": "lab_result", "payload": {"test_name": "HbA1c"}, "source": "real"},
        )
        assert resp.status_code == 400

    def test_invalid_medication_payload_returns_400(self, client):
        pid = _patient(client)
        resp = client.post(
            f"/api/twin/{pid}/events",
            json={"event_type": "medication_change", "payload": {"action": "started"}, "source": "real"},
        )
        assert resp.status_code == 400

    def test_agent_only_event_types_still_rejected_at_the_schema_level(self, client):
        """screening/care_plan/chat are written internally by agents, never
        posted directly — unchanged by the Phase 2 widening."""
        pid = _patient(client)
        resp = client.post(
            f"/api/twin/{pid}/events",
            json={"event_type": "screening", "payload": {}, "source": "real"},
        )
        assert resp.status_code == 422

    def test_malformed_payload_rejected_before_reaching_the_service(self, client):
        pid = _patient(client)
        resp = client.post(
            f"/api/twin/{pid}/events",
            json={"event_type": "lab_result", "payload": "not a dict", "source": "real"},
        )
        assert resp.status_code == 422

    def test_previously_supported_event_types_still_work(self, client):
        """measurement/lifestyle_log/note — the three original values —
        remain valid and unchanged."""
        pid = _patient(client)
        for event_type, payload in [
            ("measurement", {"bmi": 27.0}),
            ("lifestyle_log", {"note": "felt fine"}),
            ("note", {"text": "patient called"}),
        ]:
            resp = client.post(
                f"/api/twin/{pid}/events",
                json={"event_type": event_type, "payload": payload, "source": "real"},
            )
            assert resp.status_code == 201, event_type


class TestDigitalTwinEndpoint:
    def test_returns_structured_shape(self, client):
        pid = _patient(client)
        resp = client.get(f"/api/twin/{pid}/digital-twin")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body) == {"patient", "clinical", "laboratory", "medications", "lifestyle", "timeline"}
        assert body["patient"]["patient_id"] == pid

    def test_unknown_patient_returns_404(self, client):
        assert client.get("/api/twin/999999/digital-twin").status_code == 404

    def test_reflects_lab_and_medication_history(self, client):
        pid = _patient(client)
        client.post(
            f"/api/twin/{pid}/events",
            json={"event_type": "lab_result", "payload": {"test_name": "HbA1c", "value": 7.0}, "source": "real"},
        )
        client.post(
            f"/api/twin/{pid}/events",
            json={
                "event_type": "medication_change",
                "payload": {"medication_name": "Metformin", "action": "started"},
                "source": "real",
            },
        )
        body = client.get(f"/api/twin/{pid}/digital-twin").json()
        assert body["laboratory"]["latest"]["HbA1c"]["value"] == 7.0
        assert any(m["medication_name"] == "Metformin" for m in body["medications"]["current"])


class TestLabTrendEndpoint:
    def test_returns_trend_for_recorded_test(self, client):
        pid = _patient(client)
        for v in (7.0, 7.4, 7.8):
            client.post(
                f"/api/twin/{pid}/events",
                json={"event_type": "lab_result", "payload": {"test_name": "HbA1c", "value": v}, "source": "real"},
            )
        resp = client.get(f"/api/twin/{pid}/labs/HbA1c")
        assert resp.status_code == 200
        assert resp.json()["trend"] == "increasing"

    def test_never_recorded_test_returns_no_data_not_an_error(self, client):
        pid = _patient(client)
        resp = client.get(f"/api/twin/{pid}/labs/HbA1c")
        assert resp.status_code == 200
        assert resp.json()["trend"] == "no_data"

    def test_unknown_patient_returns_404(self, client):
        assert client.get("/api/twin/999999/labs/HbA1c").status_code == 404


class TestExistingEndpointsUnaffected:
    def test_timeline_endpoint_shape_unchanged(self, client):
        pid = _patient(client)
        client.post(
            f"/api/twin/{pid}/events",
            json={"event_type": "measurement", "payload": {"bmi": 27.0}, "source": "real"},
        )
        body = client.get(f"/api/twin/{pid}/timeline").json()
        assert set(body) == {"patient_id", "events", "current_state"}
        assert body["current_state"]["bmi"] == 27.0

    def test_current_state_does_not_include_lab_or_medication_fields(self, client):
        pid = _patient(client)
        client.post(
            f"/api/twin/{pid}/events",
            json={"event_type": "lab_result", "payload": {"test_name": "HbA1c", "value": 7.0}, "source": "real"},
        )
        body = client.get(f"/api/twin/{pid}/timeline").json()
        assert "HbA1c" not in body["current_state"] and "test_name" not in body["current_state"]

    def test_patient_endpoints_unaffected(self, client):
        pid = _patient(client)
        assert client.get(f"/api/patients/{pid}").status_code == 200
        assert client.get("/api/patients").status_code == 200
