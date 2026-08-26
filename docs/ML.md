# ML Models: RandomForest Baseline vs. XGBoost Candidate

Phase 3. Companion to `docs/ML_BASELINE.md` (the pre-Phase-3 audit of the
existing RandomForest pipeline, written first and unchanged by this
document). This is the living reference for both trained models, their
comparison, and the Digital Twin boundary decision — kept in sync with
what's actually implemented, not aspirational.

## Existing RandomForest

- **Purpose**: the production, Safety-gated educational screening-risk
  baseline (`POST /api/screening/run`). Unchanged by Phase 3.
- **Dataset**: CDC BRFSS 2015 Diabetes Health Indicators (UCI ML
  Repository #891), 253,680 rows.
- **Features**: 21 BRFSS survey fields — full list and types in
  `docs/ML_BASELINE.md` §6-7.
- **Target**: `diabetes_binary` = `Diabetes_012 > 0` (no diabetes vs.
  prediabetes-or-diabetes).
- **Preprocessing**: `StandardScaler`, fit on the training split only.
- **Model selection**: `RandomForestClassifier` vs. `LogisticRegression`,
  5-fold stratified CV on ROC-AUC within the training split; RandomForest
  won (0.8190 vs. 0.8177 mean CV ROC-AUC) and is the served model.
- **Test metrics** (single held-out 20% split, `random_state=42`):

  | Metric | Value |
  |---|---:|
  | Accuracy | 0.7164 |
  | Precision | 0.3297 |
  | Recall | 0.7745 |
  | F1 | 0.4625 |
  | ROC-AUC | 0.8185 |

  Confusion matrix (reproduced this phase from the persisted artifact,
  never stored before — see "Dataset integrity" below for the reproduction
  method): TN 30,154 · FP 12,587 · FN 1,803 · TP 6,192.

Full detail: `docs/ML_BASELINE.md`.

## New XGBoost

- **Purpose**: a second, independently trained candidate for the same
  screening task, evaluated on identical data for a fair comparison against
  the RandomForest baseline. **Not exposed as the production model** —
  see "API surface" below.
- **Dataset / target / features**: identical to the RandomForest baseline
  — same CSV, same `diabetes_binary` target, same 21 `FEATURE_COLUMNS`
  (imported from `app/ml/train_screening_model.py`, not copy-pasted, so
  the two can never silently drift apart).
- **Preprocessing**: the same `StandardScaler` approach, fit on the
  training split only. Scaling is provably inert for a tree-based
  model — a monotonic per-feature transform cannot change which split
  points a tree picks — but was kept anyway so both candidates share one
  identical preprocessing pipeline, satisfying "same preprocessing
  assumptions wherever technically appropriate" without a documented
  scientific need to diverge.
- **Split**: identical `train_test_split(test_size=0.2, random_state=42,
  stratify=target)` as the baseline, so both models are scored on the
  *same* test rows. An additional split — 15% of the training portion
  carved out as a validation set — is used only for hyperparameter
  selection and early stopping; the RandomForest doesn't need this because
  it uses k-fold CV for model selection instead.
- **Hyperparameter tuning**: a small, fixed 4-combination grid
  (`max_depth` ∈ {4, 6} × `learning_rate` ∈ {0.05, 0.10}), each trained
  with up to 500 boosting rounds and early stopping (30 rounds, on
  validation ROC-AUC). All four combinations landed within 0.0005 val
  ROC-AUC of each other (0.8284–0.8289) — the selection is stable, not
  noise-sensitive:

  | max_depth | learning_rate | best_iteration | val ROC-AUC |
  |---:|---:|---:|---:|
  | 4 | 0.05 | 294 | 0.82885 |
  | 4 | 0.10 | 146 | 0.82863 |
  | 6 | 0.05 | 161 | 0.82839 |
  | 6 | 0.10 | 60 | 0.82852 |

  Selected: `max_depth=4, learning_rate=0.05, n_estimators=294` (the
  winning combination's `best_iteration`, refit on the full training
  split — no further early stopping, since the test set stays untouched
  until final evaluation).
- **Fixed hyperparameters** (not searched — standard, modest defaults):
  `subsample=0.8`, `colsample_bytree=0.8`, `min_child_weight=1`,
  `random_state=42`.
- **Class imbalance**: handled via `scale_pos_weight` (≈5.35, i.e.
  negative-class-count / positive-class-count on the training split) —
  the XGBoost-native analogue of the RandomForest's `class_weight=
  "balanced"`. No resampling was used, on either model.
- **Test metrics** (same held-out split as the RandomForest):

  | Metric | Value |
  |---|---:|
  | Accuracy | 0.7206 |
  | Precision | 0.3352 |
  | Recall | 0.7865 |
  | F1 | 0.4701 |
  | ROC-AUC | 0.8255 |

  Confusion matrix: TN 30,270 · FP 12,471 · FN 1,707 · TP 6,288.
- **Artifact**: `backend/app/ml/xgboost_model/artifacts/xgboost_model.joblib`
  (511,497 bytes — ~26× smaller than the RandomForest's 13,349,897 bytes),
  `xgboost_scaler.joblib`, `xgboost_model_metadata.json` (full schema:
  model_version, algorithm, dataset_identifier, target, feature_columns,
  n_features, preprocessing_version, hyperparameter_search,
  selected_hyperparameters, class_imbalance_handling, test_metrics,
  confusion_matrix, feature_importances, shap_feature_importance,
  training_time_seconds, inference timings, model_size_bytes, trained_at,
  random_seed, n_train/n_validation/n_test, class_balance,
  risk_tier_thresholds — the same thresholds as the RandomForest,
  `{low_max: 0.33, moderate_max: 0.66}`, reused deliberately so risk tiers
  are comparable between the two models rather than independently
  recalibrated).
- **Explainability** (`app/ml/xgboost_model/explain.py`): native
  gain-based `feature_importances_`, plus an independent SHAP
  (`TreeExplainer`) mean-|value| ranking computed over the test set as a
  cross-check, plus `explain_single_prediction()` for per-instance SHAP
  contributions. Both rankings agree that `HighBP`, `GenHlth`, `HighChol`,
  `Age`, and `BMI` dominate, though in a different order and with a much
  more concentrated top feature (`HighBP` alone carries 47% of native
  importance) than the RandomForest's more evenly spread ranking (top
  feature `GenHlth` at 25%) — see "Comparison" below.
  **These describe what the model weighted, not what causes diabetes** —
  see "Language rule" below.
- **Timing** (single-process, not GPU-accelerated): training 0.75s;
  inference on the full 50,736-row test set 0.035s (≈0.0007s per 1,000
  rows) — about 7.5× faster than the RandomForest's measured 0.265s
  (≈0.0052s per 1,000 rows) on the same test set and machine.

## Model comparison

| Metric | RandomForest | XGBoost | Δ (XGBoost − RF) |
|---|---:|---:|---:|
| Accuracy | 0.7164 | 0.7206 | +0.0042 |
| Precision | 0.3297 | 0.3352 | +0.0055 |
| Recall | 0.7745 | 0.7865 | +0.0120 |
| F1 | 0.4625 | 0.4701 | +0.0075 |
| ROC-AUC | 0.8185 | 0.8255 | +0.0070 |
| Model size | 13.3 MB | 0.51 MB | 26× smaller |
| Inference / 1,000 rows | 5.2 ms | 0.70 ms | ~7.5× faster |

Reproduced by `python -m app.ml.model_comparison`
(`backend/app/ml/model_comparison.py`), which loads both persisted
artifacts, never retrains either, and includes a built-in sanity check:
the RandomForest is re-evaluated on a freshly-reproduced copy of its own
test split and the result is asserted to match its stored metadata before
any comparison is reported (this actually catches a real mismatch — see
`tests/test_xgboost_model.py::TestComparison::
test_mismatched_stored_metadata_is_detected_not_silently_trusted`).

**Interpretation**: XGBoost measures modestly better on every metric —
about 0.7 ROC-AUC points, well inside the range where the underlying
signal (self-reported survey data, see limitations) rather than the
algorithm choice is the binding constraint. Neither model is being
"beaten" by a wide margin; both land in the same performance regime. The
practically significant difference is size and inference speed, not
predictive power.

## Model decision

**Both models remain available.** RandomForest stays the default,
production model behind `POST /api/screening/run` — nothing about that
endpoint changed in this phase. XGBoost is exposed only through the
separate comparison endpoints described below.

This is not a "declined to decide" — it's the correct call given the
measured evidence: a 0.7-point ROC-AUC edge is real but modest, XGBoost's
size/speed advantage is a genuine operational plus, and neither model has
been clinically validated regardless of which one is technically stronger
on this offline metric. Choosing a new production default is a decision
for whichever future phase actually needs to make that tradeoff (e.g. if
inference latency or artifact size become binding constraints) — not
something to decide automatically off a single offline evaluation.

## Dataset integrity (Phase 3 Step 2)

Verified independently from the source CSV for this phase (not assumed):
253,680 rows, 22 columns, zero nulls, 23,899 exact-duplicate rows — all
consistent with `docs/ML_BASELINE.md`.

**A genuine, newly-quantified finding**: because the dataset contains many
exact-duplicate rows (expected, given how many of the 21 features are
binary or small-cardinality — see `docs/ML_BASELINE.md` §17) and the
train/test split treats every row independently, **12.69% of test-split
rows are exact duplicates (identical features *and* label) of a row that
also landed in the training split**, and 13.62% share identical features
alone. This means both models have, in a literal sense, "seen" the exact
input for roughly 1 in 8 of the rows they're evaluated on during training
— a mild, real form of train/test contamination, distinct from the
classic target-leakage finding already documented for the project's
original Pima pipeline (`docs/LEAKAGE.md`).

**Why this was not corrected for this comparison**: Phase 3's constraints
require (a) never retraining or modifying the existing RandomForest
pipeline, and (b) evaluating XGBoost on the *same* split as the
RandomForest for a fair, apples-to-apples comparison. Deduplicating before
splitting would produce a different, arguably more rigorous split — but
one the RandomForest's own reported metrics were never evaluated against,
breaking the fairness requirement it would be introduced to serve. Because
the contamination is a property of the *split*, not of either algorithm,
it affects both candidates symmetrically — the **relative** comparison
between them stays valid even though both models' **absolute** metrics are
likely mildly optimistic versus a hypothetically deduplicated split. This
is recorded here as a known, quantified limitation of both models' headline
numbers, not something this phase silently fixed.

## Digital Twin boundary

Phase 2 added lab results (HbA1c history/trend) and medication history to
the Digital Twin (`docs/DIGITAL_TWIN.md`). **Neither is used by this
baseline XGBoost model.** Two independent reasons, not one:

1. **Step 5's explicit requirement**: the first XGBoost experiment must use
   the same 21-feature representation as the RandomForest, specifically so
   the comparison above answers one question — does the algorithm change
   the result under identical data conditions — without a simultaneous
   feature-set change confounding the answer.
2. **The training dataset itself doesn't support it.** CDC BRFSS 2015 is a
   self-reported survey with no lab values or medication fields at all —
   there is no HbA1c column, no medication column, nothing to train a
   lab-aware model against. Digital Twin lab/medication data exists only
   for patients created *after* Phase 2 (real or synthetic demo patients);
   the training corpus predates and is entirely independent of it. Building
   a lab-aware model would require either a different, lab-inclusive
   training dataset (not something this phase sourced or vetted) or
   fabricating synthetic training labels — explicitly disallowed (Phase 3
   Step 17/18: "do not create synthetic labels just to force HbA1c into the
   model").

**Lab-aware XGBoost was not implemented because the training dataset does
not contain compatible labelled data.** If a future phase sources a
legitimate dataset with real lab/medication variables and an appropriate
target, `docs/DIGITAL_TWIN.md`'s "ML feature boundary" section already
describes where that transformer would plug in
(`app/ml/xgboost_model/preprocessing.py`, parallel to how
`app/agents/screening_agent.py::_resolve_feature_vector` resolves the
current 21 features from a twin state).

## API surface

Two new endpoints, both intentionally outside the production pipeline —
see `app/routers/ml.py`'s module docstring:

- `GET /api/ml/comparison` — the table above, computed live from both
  persisted artifacts (never cached/precomputed, so it always reflects
  whatever is currently on disk).
- `POST /api/ml/xgboost/predict` — `{"patient_id": int}` → scores that
  patient's current Digital Twin state with the XGBoost candidate,
  returning `{model, model_version, status, prediction, score, risk_tier,
  features_used, unavailable_reason, disclaimer}`.

Neither endpoint runs through the `Orchestrator`, the Safety gate, or
persists anything to the database — they are read-only comparison tools.
**`POST /api/screening/run` (the production, Safety-gated RandomForest
pipeline) is completely unmodified** — confirmed by
`tests/test_ml_api.py::TestProductionScreeningEndpointUnaffected`.

## Reproducibility

```bash
# 1. Dataset is already at backend/data/diabetes_health_indicators_brfss2015.csv
# 2. Train the XGBoost candidate (also runs the tuning grid and saves artifacts)
python -m app.ml.xgboost_model.train

# 3. Compare against the (untouched, already-trained) RandomForest baseline
python -m app.ml.model_comparison
# equivalently: python -m app.ml.xgboost_model.evaluate

# 4. Score a single feature dict directly (used internally by the API route)
python -c "from app.ml.xgboost_model.predict import score_vector; \
print(score_vector({'sex': 'female', 'age': 52, 'high_bp': 1, 'high_chol': 0, \
'chol_check': 1, 'bmi': 29.0, 'smoker': 0, 'stroke': 0, \
'heart_disease_or_attack': 0, 'phys_activity': 1, 'fruits': 1, 'veggies': 1, \
'hvy_alcohol_consump': 0, 'any_healthcare': 1, 'no_doc_bc_cost': 0, \
'gen_hlth': 3, 'ment_hlth': 2, 'phys_hlth': 3, 'diff_walk': 0, \
'education': 5, 'income': 6}))"
```

All four commands are deterministic (`random_state=42` throughout) —
rerunning `train` reproduces byte-identical hyperparameter selection and
statistically identical metrics.

**Environment note (macOS)**: `xgboost` requires the OpenMP runtime:
`brew install libomp`. Additionally, in a process that also imports
`torch`/`sentence-transformers` (this project's RAG evidence agent),
`xgboost` must be imported *first* — see the comment in
`backend/tests/conftest.py` for the reproducible crash this avoids.

## Testing

Comprehensive tests added across three files:
- `backend/tests/test_xgboost_model.py` — preprocessing, training,
  prediction (including missing/extra/reordered features, determinism, a
  missing-artifact error path), comparison (including a test that the
  reproduced-RandomForest-split sanity check actually fails on a real
  mismatch, not just passes by construction), explainability, and a
  RandomForest-artifact-unchanged regression guard.
- `backend/tests/test_ml_api.py` — both new endpoints, plus confirmation
  that `POST /api/screening/run` is unaffected.
- `backend/tests/test_phase1_scaffolding.py` — the five Phase-1 assertions
  that XGBoost's functions raised `NotImplementedError` are retired (that
  was the explicit goal of this phase) and replaced with two narrower
  assertions for what's still true: the package still imports cleanly and
  its artifacts stay isolated from the RandomForest's. See that file's
  `TestXGBoostNowImplemented` docstring for the full accounting.

## Language rule

Every XGBoost-facing response and artifact uses "model score" /
"model-estimated risk" / "feature contribution" — never "diagnosis",
"causes", or "the patient will…" — matching the RandomForest's existing
`ScreeningResult.disclaimer` convention. `XGBoostPredictionResult.disclaimer`
additionally states the score is for RandomForest-vs-XGBoost comparison,
since (unlike the production screening result) it isn't Safety-gated.
