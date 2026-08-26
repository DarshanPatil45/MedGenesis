"""API-level tests for the Phase 3 model-comparison/candidate-model
endpoints (docs/ML.md) and confirmation the production screening endpoint
is unaffected by their presence."""

from __future__ import annotations


class TestModelComparisonEndpoint:
    def test_returns_200_with_structured_metrics(self, client):
        resp = client.get("/api/ml/comparison")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body) == {"random_forest", "xgboost", "metrics_table", "n_test"}
        assert body["random_forest"]["algorithm"] == "random_forest"
        assert body["xgboost"]["algorithm"] == "xgboost"

    def test_metrics_table_has_all_five_metrics_for_both_models(self, client):
        body = client.get("/api/ml/comparison").json()
        for metric in ("accuracy", "precision", "recall", "f1", "roc_auc"):
            assert metric in body["metrics_table"]
            assert "random_forest" in body["metrics_table"][metric]
            assert "xgboost" in body["metrics_table"][metric]


class TestXGBoostPredictEndpoint:
    def test_scores_eligible_patient(self, client, eligible_patient):
        resp = client.post("/api/ml/xgboost/predict", json={"patient_id": eligible_patient["id"]})
        assert resp.status_code == 200
        body = resp.json()
        assert body["model"] == "xgboost"
        assert body["status"] == "scored"
        assert 0.0 <= body["score"] <= 1.0
        assert body["risk_tier"] in ("Low", "Moderate", "High")

    def test_incomplete_patient_returns_unavailable_not_an_error(self, client, incomplete_patient):
        resp = client.post("/api/ml/xgboost/predict", json={"patient_id": incomplete_patient["id"]})
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "unavailable_for_profile"
        assert body["score"] is None
        assert body["unavailable_reason"]

    def test_unknown_patient_returns_404(self, client):
        resp = client.post("/api/ml/xgboost/predict", json={"patient_id": 999999})
        assert resp.status_code == 404

    def test_response_carries_a_disclaimer(self, client, eligible_patient):
        body = client.post("/api/ml/xgboost/predict", json={"patient_id": eligible_patient["id"]}).json()
        assert "candidate" in body["disclaimer"].lower()


class TestProductionScreeningEndpointUnaffected:
    """The production, Safety-gated screening pipeline must be completely
    unaware that a second candidate model now exists."""

    def test_production_screening_endpoint_still_works(self, client, eligible_patient):
        resp = client.post("/api/screening/run", json={"patient_id": eligible_patient["id"]})
        assert resp.status_code == 200
        body = resp.json()
        assert body["model_version"] == "screening-baseline-v3-brfss2015"
        assert "safety" in body

    def test_production_screening_endpoint_unaffected_for_incomplete_patient(self, client, incomplete_patient):
        resp = client.post("/api/screening/run", json={"patient_id": incomplete_patient["id"]})
        assert resp.status_code == 200
        assert resp.json()["status"] == "unavailable_for_profile"
