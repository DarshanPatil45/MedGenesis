# MedGenesis — ML Validation (Phase 8)

Purpose: verify, from the actual repository state, that the RandomForest
(production) and XGBoost (candidate) models are what they've been claimed
to be — same data, same features, same target, same split convention — and
that every reported metric traces back to a real, reproducible measurement.
Nothing in this document was assumed from a prior phase's report; every
number below was independently re-derived from the current repository
during Phase 8. See [ML.md](ML.md) and [ML_BASELINE.md](ML_BASELINE.md) for
the original build narrative this document validates against.

## 1. What was verified, and how

| Claim | Verification method |
|---|---|
| Stored test metrics are real, not fabricated | Read `app/ml/artifacts/screening_model_metadata.json` and `app/ml/xgboost_model/artifacts/xgboost_model_metadata.json` directly; re-ran `python -m app.ml.model_comparison` live during Phase 8 and confirmed byte-identical output |
| RF artifact matches its own metadata | `app/ml/model_comparison.py::evaluate_random_forest_on_test_split()` reproduces the RF's exact train/test split, loads the *persisted* model (never retrains), and asserts every recomputed metric matches the stored metadata within 1e-6 — this assertion ran live during Phase 8 and passed |
| Both models use the same 21 features | Compared `FEATURE_COLUMNS` in `app/ml/train_screening_model.py` against `app/ml/xgboost_model/preprocessing.py` (which imports it directly rather than redefining it) |
| Both models use the same target definition | Both derive `diabetes_binary = (Diabetes_012 > 0)` via the same shared `load_data()` (XGBoost's `preprocessing.py::load_data()` calls the RF module's `load_data()` directly — one implementation, not two) |
| Both use the same train/test split convention | Read `app/ml/xgboost_model/preprocessing.py::split_train_val_test()` — same `test_size=0.2`, `random_state=42`, stratified on the binary target, as `train_screening_model.py::train_and_evaluate()` |
| No test-set leakage into scaling | Read `scale_features()` — the `StandardScaler` used for the *final* model is fit on `train_df` only, never on `val_df`/`test_df`; confirmed by code inspection, not just docstring claim |
| SHAP is per-patient for XGBoost, aggregate for RF | Read `app/ml/xgboost_model/explain.py` (`explain_single_prediction` takes one feature vector) and `app/agents/clinical_agent.py::_xgboost_model_claims` (calls it once per analysis, on that patient's own feature vector); RF's claim text is explicitly generated as "(aggregate, trained-model-level, not specific to this patient)" in `_rf_model_claims` |
| Dataset limitations are not hidden | Read the dataset docstrings in `train_screening_model.py` and the source-controlled `docs/LEAKAGE.md`; confirmed both are still present and accurate |
| Backend regression suite still passes | `python -m pytest -q`: 390 passed, 1 skipped |

## 2. RandomForest (production) — reproduced results

Reproduced live during Phase 8 via `python -m app.ml.model_comparison`
(loads the persisted `screening_model.joblib`/`screening_scaler.joblib`,
never retrains):

| Metric | Value |
|---|---|
| Accuracy | 0.7164 (0.7163749605802586) |
| Precision | 0.3297 (0.3297300175728207) |
| Recall | 0.7745 (0.774484052532833) |
| F1 | 0.4625 (0.46253828340927766) |
| ROC-AUC | 0.8185 (0.8184822952753557) |

- Algorithm selected by 5-fold stratified cross-validation between
  `LogisticRegression` and `RandomForestClassifier` on ROC-AUC
  (`train_screening_model.py::train_and_evaluate`) — RandomForest won,
  narrowly: CV mean ROC-AUC 0.81896 vs. logistic regression's 0.81774
  (`screening_model_metadata.json::cross_validation`). This is a real
  selection outcome, not a hard-coded choice of algorithm.
- `n_train=202,944`, `n_test=50,736` (80/20 stratified split,
  `random_state=42`).
- `model_version: "screening-baseline-v3-brfss2015"`, trained
  2026-08-26T18:14:01Z, and untouched since — the RandomForest is never
  retrained by the test suite (confirmed: no test file calls
  `train_screening_model.train_and_evaluate()`; `test_phase1_scaffolding.py`
  only loads its persisted artifacts).

## 3. XGBoost (candidate) — reproduced results

Reproduced live during Phase 8 via the same `model_comparison.py` run,
reading `xgboost_model_metadata.json`:

| Metric | Value |
|---|---|
| Accuracy | 0.7206 (0.7205534531693472) |
| Precision | 0.3352 (0.33519910442987366) |
| Recall | 0.7865 (0.7864915572232646) |
| F1 | 0.4701 (0.47006055169320476) |
| ROC-AUC | 0.8255 (0.825483363228922) |

Confusion matrix on the held-out test set: TN 30,270 · FP 12,471 · FN 1,707
· TP 6,288.

- Hyperparameters selected by a small fixed grid search
  (`max_depth ∈ {4,6}`, `learning_rate ∈ {0.05,0.1}`) evaluated on a
  validation split carved out of the training portion only, using early
  stopping (`eval_metric="auc"`) to pick the round count per candidate. The
  selected combination — `max_depth=4, learning_rate=0.05,
  n_estimators=294` — is the actual winner by validation ROC-AUC (0.82885
  vs. 0.82863/0.82839/0.82852 for the other three grid points); all four
  results are stored in `hyperparameter_search.results`, not just the
  winner.
- Class imbalance handled via `scale_pos_weight` (≈5.35, computed from the
  training split's actual class ratio) — the XGBoost analogue of the
  RandomForest's `class_weight="balanced"`, not resampling.
- `n_train=202,944` — the full training pool the final model is fit on.
  `n_validation=30,442` is a subset **carved out of that same 202,944-row
  pool** for hyperparameter tuning only; it is not additional held-out
  data, and it is folded back into the final `train_df` used to fit the
  reported model. `n_test=50,736` is the same held-out split as the
  RandomForest's, reached via the identical `test_size=0.2,
  random_state=42, stratify=...` call — the two models are compared on the
  same test rows.
- `training_time_seconds ≈ 0.94s`, `inference_time_seconds_test_set ≈
  0.035s` for the full 50,736-row test set (≈0.0007s per 1,000 rows),
  `model_size_bytes = 511,497` — all self-reported by `train.py` at
  training time, not separately re-measured (re-measuring training time
  would require retraining, which Phase 8 does not do).

## 4. Head-to-head

| Metric | RandomForest (production) | XGBoost (candidate) | Δ |
|---|---|---|---|
| Accuracy | 0.7164 | 0.7206 | +0.0042 |
| Precision | 0.3297 | 0.3352 | +0.0055 |
| Recall | 0.7745 | 0.7865 | +0.0120 |
| F1 | 0.4625 | 0.4701 | +0.0075 |
| ROC-AUC | 0.8185 | 0.8255 | +0.0070 |

XGBoost scores marginally higher on every reported metric, on this one
held-out split, on this one dataset. **This does not promote it.** The
codebase treats RandomForest as production and XGBoost as candidate
throughout — `app/ml/model_comparison.py`'s own docstring: "Never asserts a
winner in advance — the metric table speaks for itself." No code path
auto-switches which model is used for screening; only the Clinical
Analysis Agent optionally *also* runs XGBoost, alongside RandomForest,
when `include_model_comparison=true` is requested.

## 5. A measured methodological difference (not a bug)

The two models' `n_duplicate_rows_kept` figures differ: 23,899
(RandomForest) vs. 23,968 (XGBoost). This is not an inconsistency in the
data — it's because the two counts are computed against slightly different
column sets: `train_screening_model.py` counts duplicates against
`FEATURE_COLUMNS + [RAW_TARGET_COLUMN]` (the original three-class label),
while `xgboost_model/train.py` counts against `FEATURE_COLUMNS +
[TARGET_COLUMN]` (the binarized label) — collapsing the three-class label
to binary merges a small number of previously-distinct rows (ones that
differed only between prediabetes and diabetes, both now "1") into
additional duplicates. Both figures are real measurements of the same
253,680-row file, just against two valid, differently-scoped
definitions of "duplicate." Documented here so the ~69-row difference
isn't mistaken for a data integrity problem.

## 6. Explainability — what was checked

- **Two independent measures for XGBoost:** native gain-based importance
  (`native_feature_importance`) and mean-absolute SHAP over a background
  sample (`shap_feature_importance`), stored side by side in the metadata
  as a cross-check, not a replacement of one by the other.
- **Per-patient SHAP is real, not a rescaled aggregate.** In
  `explain_single_prediction`, `shap.TreeExplainer(model).shap_values(...)`
  is called on that one patient's own scaled feature vector — a genuinely
  different, patient-specific computation from the aggregate
  `shap_feature_importance` stored in the model's metadata.
- **Non-causal framing is enforced at the text-generation layer, not left
  to the reader to infer.** Every generated claim referencing feature
  contributions is templated with explicit non-causal language:
  RandomForest's is "(aggregate, trained-model-level, not specific to this
  patient)"; XGBoost's per-patient claim ends "These describe what the
  model weighted, not a cause of the patient's risk." (`clinical_agent.py`,
  `_rf_model_claims` / `_xgboost_model_claims`).

## 7. Dataset limitations — confirmed still true and still stated

- BRFSS 2015, self-reported survey, not lab measurements — stated in both
  models' `disclaimer` field, returned in every API response that includes
  one.
- Three-class source label collapsed to binary — implemented in
  `load_data()`, documented in the module docstring.
- 23,899 (or 23,968 — see §5) duplicate rows kept, not dropped — computed
  fresh at every training run, stored in metadata, documented as a
  deliberate choice, not an oversight.
- Zero nulls in the source file (verified by an `assert` in `load_data()`
  that fires loudly if this ever stops being true) — no imputation step
  exists or is needed.

None of this is new to Phase 8 — it was already accurately documented
before this phase began. This section exists to record that Phase 8
specifically re-checked it against the current code rather than assuming
the existing documentation was still correct.

## 8. What was not (re-)done in Phase 8

- The RandomForest was **not** retrained.
- The XGBoost candidate **was** retrained, but only as an incidental side
  effect of running the existing backend test suite
  (`tests/test_xgboost_model.py` has a module-scoped fixture that calls
  `train_and_evaluate()` live, to test the training pipeline itself, not
  just artifact loading) — this reproduces the same metrics every time
  given the fixed `random_state=42` and hyperparameter grid, confirmed by
  comparing pre- and post-test-run metadata during this phase. No model
  file was hand-edited.
- No new model, no ensembling, no promotion of XGBoost to production.
