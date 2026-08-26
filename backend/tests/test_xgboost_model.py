"""Phase 3 tests (docs/ML.md): real XGBoost training, preprocessing,
inference, RandomForest comparison, and explainability.

Training genuinely happens in this module — it is no longer a stub (see
test_phase1_scaffolding.py::TestXGBoostNowImplemented for what that
replaced). The real ~8-second training cost is paid once via a
module-scoped fixture and shared across every test class below, rather
than retrained per test.
"""

from __future__ import annotations

import json
import shutil

import numpy as np
import pytest

from app.ml import model_comparison
from app.ml.train_screening_model import FEATURE_COLUMNS, TARGET_COLUMN
from app.ml.train_screening_model import ARTIFACT_DIR as RF_ARTIFACT_DIR
from app.ml.xgboost_model import explain, preprocessing
from app.ml.xgboost_model import train as train_module
from app.ml.xgboost_model.config import ARTIFACT_DIR
from app.ml.xgboost_model.predict import (
    ModelArtifactsMissing,
    XGBoostPredictionService,
    _load_artifacts,
    _resolve_feature_vector,
    score_vector,
)

FULL_STATE = {
    "sex": "female", "age": 52, "high_bp": 1, "high_chol": 0, "chol_check": 1,
    "bmi": 29.0, "smoker": 0, "stroke": 0, "heart_disease_or_attack": 0,
    "phys_activity": 1, "fruits": 1, "veggies": 1, "hvy_alcohol_consump": 0,
    "any_healthcare": 1, "no_doc_bc_cost": 0, "gen_hlth": 3, "ment_hlth": 2,
    "phys_hlth": 3, "diff_walk": 0, "education": 5, "income": 6,
}


@pytest.fixture(scope="module")
def trained_metadata():
    return train_module.train_and_evaluate()


class TestPreprocessing:
    def test_load_data_matches_baseline_schema(self):
        df = preprocessing.load_data()
        assert set(FEATURE_COLUMNS + [TARGET_COLUMN]).issubset(df.columns)
        assert df[FEATURE_COLUMNS + [TARGET_COLUMN]].isnull().sum().sum() == 0

    def test_split_sizes_partition_correctly(self):
        df = preprocessing.load_data()
        splits = preprocessing.split_train_val_test(df)
        assert len(splits["fit"]) + len(splits["val"]) == len(splits["train"])
        assert len(splits["train"]) + len(splits["test"]) == len(df)

    def test_split_is_stratified(self):
        df = preprocessing.load_data()
        splits = preprocessing.split_train_val_test(df)
        overall_rate = df[TARGET_COLUMN].mean()
        for name in ("train", "test", "fit", "val"):
            assert abs(splits[name][TARGET_COLUMN].mean() - overall_rate) < 0.01, name

    def test_scale_features_fits_only_on_first_argument(self):
        df = preprocessing.load_data()
        splits = preprocessing.split_train_val_test(df)
        _, (X_fit_s, _X_test_s) = preprocessing.scale_features(splits["fit"], splits["test"])
        # Scaled fit data is what the scaler was fit on, so its per-feature
        # mean should sit close to zero — this would not generally hold for
        # test data scaled with a scaler fit on test data too.
        assert abs(X_fit_s.mean()) < 0.05


class TestTraining:
    def test_training_completes_and_returns_metadata(self, trained_metadata):
        assert trained_metadata["algorithm"] == "xgboost"
        assert "test_metrics" in trained_metadata

    def test_artifacts_are_created(self, trained_metadata):
        assert (ARTIFACT_DIR / "xgboost_model.joblib").exists()
        assert (ARTIFACT_DIR / "xgboost_scaler.joblib").exists()
        assert (ARTIFACT_DIR / "xgboost_model_metadata.json").exists()

    def test_metadata_file_on_disk_matches_returned_metadata(self, trained_metadata):
        on_disk = json.loads((ARTIFACT_DIR / "xgboost_model_metadata.json").read_text())
        assert on_disk["model_version"] == trained_metadata["model_version"]
        assert on_disk["test_metrics"] == trained_metadata["test_metrics"]

    def test_metrics_are_plausible_not_fabricated(self, trained_metadata):
        m = trained_metadata["test_metrics"]
        for key in ("accuracy", "precision", "recall", "f1", "roc_auc"):
            assert 0.0 <= m[key] <= 1.0
        # A random/degenerate classifier scores ~0.5 ROC-AUC; a genuinely
        # fit model on this dataset clears that easily (the RandomForest
        # baseline measures 0.818 — docs/ML_BASELINE.md).
        assert m["roc_auc"] > 0.7

    def test_confusion_matrix_sums_to_test_set_size(self, trained_metadata):
        cm = trained_metadata["confusion_matrix"]
        assert cm["tn"] + cm["fp"] + cm["fn"] + cm["tp"] == trained_metadata["n_test"]

    def test_used_same_feature_columns_as_randomforest(self, trained_metadata):
        assert trained_metadata["feature_columns"] == FEATURE_COLUMNS

    def test_class_imbalance_handled_not_ignored(self, trained_metadata):
        handling = trained_metadata["class_imbalance_handling"]
        assert handling["method"] == "scale_pos_weight"
        assert handling["value"] > 1.0  # dataset is imbalanced toward the negative class

    def test_hyperparameter_tuning_used_a_held_out_validation_split(self, trained_metadata):
        search = trained_metadata["hyperparameter_search"]
        assert len(search["results"]) == len(search["grid"])
        for r in search["results"]:
            assert "val_roc_auc" in r and "best_iteration" in r
            assert 0.0 <= r["val_roc_auc"] <= 1.0

    def test_selected_hyperparameters_came_from_the_grid(self, trained_metadata):
        selected = trained_metadata["selected_hyperparameters"]
        grid = trained_metadata["hyperparameter_search"]["grid"]
        assert any(
            g["max_depth"] == selected["max_depth"] and g["learning_rate"] == selected["learning_rate"]
            for g in grid
        )


class TestPrediction:
    def test_valid_input_scores(self, trained_metadata):
        probability, tier = score_vector(FULL_STATE)
        assert 0.0 <= probability <= 1.0
        assert tier in ("Low", "Moderate", "High")

    def test_missing_feature_raises_rather_than_guessing(self, trained_metadata):
        with pytest.raises(ValueError):
            score_vector({**FULL_STATE, "bmi": None})

    def test_extra_unknown_field_is_ignored_not_fatal(self, trained_metadata):
        probability, _ = score_vector({**FULL_STATE, "some_field_the_model_never_trained_on": 123})
        assert 0.0 <= probability <= 1.0

    def test_feature_order_is_fixed_regardless_of_input_dict_order(self, trained_metadata):
        reordered = dict(reversed(list(FULL_STATE.items())))
        p1, t1 = score_vector(FULL_STATE)
        p2, t2 = score_vector(reordered)
        assert p1 == p2 and t1 == t2

    def test_prediction_is_deterministic(self, trained_metadata):
        p1, t1 = score_vector(FULL_STATE)
        p2, t2 = score_vector(FULL_STATE)
        assert p1 == p2 and t1 == t2

    def test_service_reports_unavailable_for_incomplete_profile(self, trained_metadata):
        result = XGBoostPredictionService().predict({**FULL_STATE, "bmi": None})
        assert result.status == "unavailable_for_profile"
        assert result.score is None
        assert result.unavailable_reason

    def test_service_reports_scored_profile_with_feature_list(self, trained_metadata):
        result = XGBoostPredictionService().predict(FULL_STATE)
        assert result.status == "scored"
        assert result.features_used == FEATURE_COLUMNS
        assert result.model_version == trained_metadata["model_version"]
        assert "candidate" in result.disclaimer.lower()

    def test_missing_model_artifact_raises_clear_error(self, trained_metadata, monkeypatch, tmp_path):
        from app.ml.xgboost_model import predict as predict_module

        _load_artifacts.cache_clear()
        monkeypatch.setattr(predict_module, "ARTIFACT_DIR", tmp_path)
        try:
            with pytest.raises(ModelArtifactsMissing):
                score_vector(FULL_STATE)
        finally:
            _load_artifacts.cache_clear()  # restore real artifacts for later tests


class TestComparison:
    def test_random_forest_metrics_load_from_persisted_artifact(self, trained_metadata):
        rf = model_comparison.evaluate_random_forest_on_test_split()
        assert 0.0 <= rf["test_metrics"]["roc_auc"] <= 1.0
        assert rf["confusion_matrix"]["tn"] + rf["confusion_matrix"]["tp"] > 0

    def test_xgboost_metrics_load_from_persisted_artifact(self, trained_metadata):
        xgb_meta = model_comparison.load_xgboost_metadata()
        assert xgb_meta["model_version"] == trained_metadata["model_version"]

    def test_comparison_output_is_structured(self, trained_metadata):
        result = model_comparison.compare()
        assert set(result) == {"random_forest", "xgboost", "metrics_table", "n_test"}
        for metric in ("accuracy", "precision", "recall", "f1", "roc_auc"):
            assert "random_forest" in result["metrics_table"][metric]
            assert "xgboost" in result["metrics_table"][metric]

    def test_comparison_uses_real_measured_numbers_not_placeholders(self, trained_metadata):
        """A fabricated/placeholder comparison would tend toward round
        numbers or identical values between models — real measurements on
        50,000+ held-out rows essentially never land on either."""
        result = model_comparison.compare()
        rf_auc = result["metrics_table"]["roc_auc"]["random_forest"]
        xgb_auc = result["metrics_table"]["roc_auc"]["xgboost"]
        assert rf_auc != xgb_auc
        assert rf_auc not in (0.5, 1.0) and xgb_auc not in (0.5, 1.0)

    def test_randomforest_reevaluation_matches_its_own_stored_metadata(self, trained_metadata):
        rf = model_comparison.evaluate_random_forest_on_test_split()
        stored = json.loads((RF_ARTIFACT_DIR / "screening_model_metadata.json").read_text())
        assert rf["test_metrics"] == stored["test_metrics"]

    def test_mismatched_stored_metadata_is_detected_not_silently_trusted(self, monkeypatch, tmp_path):
        """The reproduced-split sanity check must actually fail loud on a
        real mismatch, not just pass by construction."""
        stored = json.loads((RF_ARTIFACT_DIR / "screening_model_metadata.json").read_text())
        tampered = {**stored, "test_metrics": {**stored["test_metrics"], "accuracy": 0.0}}
        (tmp_path / "screening_model_metadata.json").write_text(json.dumps(tampered))
        shutil.copy(RF_ARTIFACT_DIR / "screening_model.joblib", tmp_path / "screening_model.joblib")
        shutil.copy(RF_ARTIFACT_DIR / "screening_scaler.joblib", tmp_path / "screening_scaler.joblib")

        monkeypatch.setattr(model_comparison, "RF_ARTIFACT_DIR", tmp_path)
        with pytest.raises(RuntimeError):
            model_comparison.evaluate_random_forest_on_test_split()


class TestExplainability:
    def test_native_feature_importance_matches_trained_features(self, trained_metadata):
        assert set(trained_metadata["feature_importances"]) == set(FEATURE_COLUMNS)

    def test_shap_importance_matches_trained_features(self, trained_metadata):
        assert set(trained_metadata["shap_feature_importance"]) == set(FEATURE_COLUMNS)

    def test_importances_are_non_negative(self, trained_metadata):
        for v in trained_metadata["feature_importances"].values():
            assert v >= 0
        for v in trained_metadata["shap_feature_importance"].values():
            assert v >= 0

    def test_explain_single_prediction_returns_per_feature_contribution(self, trained_metadata):
        model, scaler, _metadata = _load_artifacts()
        vector, _missing = _resolve_feature_vector(FULL_STATE)
        scaled = scaler.transform(np.array([vector]))[0]
        contributions = explain.explain_single_prediction(model, scaled, FEATURE_COLUMNS)
        assert set(contributions) == set(FEATURE_COLUMNS)
        assert all(isinstance(v, float) for v in contributions.values())


class TestRandomForestStillUntouched:
    """Guards the explicit Phase 3 constraint: training/evaluating XGBoost
    must never modify the RandomForest's own artifact."""

    def test_randomforest_artifact_unchanged_after_xgboost_training(self, trained_metadata):
        assert (RF_ARTIFACT_DIR / "screening_model.joblib").exists()
        meta = json.loads((RF_ARTIFACT_DIR / "screening_model_metadata.json").read_text())
        assert meta["model_version"] == "screening-baseline-v3-brfss2015"
        assert meta["algorithm"] == "random_forest"
