# ML Baseline Audit — Existing RandomForest Screening Model

Written before any XGBoost code was added (Phase 3, Step 1), by inspecting
`app/ml/train_screening_model.py`, `app/agents/screening_agent.py`,
`app/ml/artifacts/screening_model_metadata.json`, and the source CSV
directly (not assumed from comments — independently re-derived; see the
verification note at the end). Every number below is measured, not
estimated.

## 1. Existing dataset

CDC's 2015 Behavioral Risk Factor Surveillance System (BRFSS) — a real
annual US telephone health survey — pre-processed into the "Diabetes
Health Indicators" release.

## 2. Dataset source

UCI Machine Learning Repository #891 / CDC. US government work, public
domain (17 U.S.C. §105). File on disk:
`backend/data/diabetes_health_indicators_brfss2015.csv`.

## 3. Target variable

Source column `Diabetes_012` (three-class: 0 = no diabetes, 1 =
prediabetes, 2 = diabetes) is binarized at load time into
`diabetes_binary = (Diabetes_012 > 0).astype(int)` — i.e. 0 = no diabetes,
1 = prediabetes **or** diabetes. Rationale documented in
`train_screening_model.py`: an educational screening tool should flag
elevated risk (prediabetes included), not only a diagnosed case, and this
matches the dataset family's own standard "binary" companion release.

## 4. Number of samples

253,680 rows (verified: `pd.read_csv(...).shape == (253680, 22)`, 21
features + 1 target column).

## 5. Number of features

21.

## 6. Exact 21 existing features

In the exact order the model consumes them (`FEATURE_COLUMNS` in
`train_screening_model.py` — order matters, the model takes a positional
array):

`HighBP`, `HighChol`, `CholCheck`, `BMI`, `Smoker`, `Stroke`,
`HeartDiseaseorAttack`, `PhysActivity`, `Fruits`, `Veggies`,
`HvyAlcoholConsump`, `AnyHealthcare`, `NoDocbcCost`, `GenHlth`, `MentHlth`,
`PhysHlth`, `DiffWalk`, `Sex`, `Age`, `Education`, `Income`.

## 7. Feature types

All 21 columns are stored as `float64` in the source CSV (BRFSS's own
numeric coding), but fall into three distinct kinds — verified by checking
`min`/`max`/`nunique` on the real data:

| Kind | Features | Range |
|---|---|---|
| Binary (0/1) | `HighBP`, `HighChol`, `CholCheck`, `Smoker`, `Stroke`, `HeartDiseaseorAttack`, `PhysActivity`, `Fruits`, `Veggies`, `HvyAlcoholConsump`, `AnyHealthcare`, `NoDocbcCost`, `DiffWalk`, `Sex` | {0, 1} |
| Small-cardinality ordinal/categorical (survey buckets) | `GenHlth` (1–5), `Age` (1–13, five-year BRFSS buckets), `Education` (1–6), `Income` (1–8) | integer-valued |
| Continuous | `BMI` (12.0–98.0, 84 distinct values), `MentHlth` (0–30, days), `PhysHlth` (0–30, days) | integer/float-valued |

No feature is one-hot encoded or otherwise expanded — all 21 are used
as single numeric columns, including the ordinal/categorical ones. This
matches how `app/agents/screening_agent.py::FEATURE_KEY_MAP` builds the
served feature vector.

## 8. Preprocessing

A single `sklearn.preprocessing.StandardScaler`, `fit()` only on the
training split (`X_train`) and then applied via `.transform()` to both
train and test — the test set is never seen during fitting. The fitted
scaler is persisted (`screening_scaler.joblib`) and re-applied at inference
time in `screening_agent.py`. No other transformation (no one-hot
encoding, no binning, no imputation) is applied.

## 9. Missing-value handling

None needed and none implemented. Verified directly:
`df[FEATURE_COLUMNS + [RAW_TARGET_COLUMN]].isnull().sum().sum() == 0`
(re-confirmed independently for this audit, not just read from the
training script's own assertion). Unlike the project's original Pima
dataset (where 0 was an undocumented missing-value placeholder for some
fields — see `docs/LEAKAGE.md`), BRFSS's pre-cleaned release has no such
problem.

## 10. Train/test split

`sklearn.model_selection.train_test_split(df, test_size=0.2,
random_state=42, stratify=df[TARGET_COLUMN])` — a single 80/20 split,
stratified on the binary target so both splits preserve the ~84/16 class
ratio. No separate validation set is carved out for the RandomForest itself
— model *selection* (RandomForest vs. LogisticRegression) instead uses
5-fold cross-validation within the training split (see §14).

## 11. Random seed

`random_state=42`, used consistently for the split, the `StratifiedKFold`,
and both candidate models — reproducible end to end.

## 12. Class distribution

Raw three-class (`Diabetes_012`): 84.24% no diabetes (0), 1.83%
prediabetes (1), 13.93% diabetes (2) — verified directly from the CSV.

Binarized (`diabetes_binary`, what the model is actually trained on):

| Class | Count | % |
|---|---:|---:|
| 0 — no diabetes | 213,703 | 84.24% |
| 1 — prediabetes or diabetes | 39,977 | 15.76% |

Moderately imbalanced (~5.3:1). Both candidate models are trained with
`class_weight="balanced"` to address this (see §13) — this was already the
case before Phase 3, not a new decision.

## 13. Existing RandomForest hyperparameters

```python
RandomForestClassifier(
    n_estimators=300, max_depth=8, random_state=42,
    class_weight="balanced", n_jobs=-1,
)
```

Note on what's actually served: `train_and_evaluate()` trains **two**
candidates (`logistic_regression` and `random_forest`) and 5-fold
cross-validates both on ROC-AUC within the training split, then fits and
serves whichever wins. Per the current `screening_model_metadata.json`:
`random_forest` won (mean CV ROC-AUC 0.8190 vs. logistic regression's
0.8177 — a 0.13-point margin) and is the model currently deployed as
`screening_model.joblib`. The module is named "train_screening_model" and
the served artifact happens to be a RandomForest, but the code technically
implements a small model-selection step, not a RandomForest-only script.

## 14. Existing evaluation methodology

1. 80/20 stratified train/test split (§10).
2. Both candidates cross-validated on the training split only:
   `StratifiedKFold(n_splits=5, shuffle=True, random_state=42)`,
   `scoring="roc_auc"`.
3. The higher-mean-CV-ROC-AUC candidate is refit on the full training split.
4. That single fitted model is evaluated exactly once on the held-out test
   split: accuracy, precision, recall, F1, ROC-AUC. The test set is never
   used for model selection or tuning — only for this final, single
   evaluation.

## 15. Existing model artifact

`backend/app/ml/artifacts/`:
- `screening_model.joblib` — the fitted RandomForestClassifier
- `screening_scaler.joblib` — the fitted StandardScaler
- `screening_model_metadata.json` — version, dataset identity, CV results,
  test metrics, feature importances, risk-tier thresholds, class balance,
  training timestamp, train/test sample counts

Current `model_version`: `screening-baseline-v3-brfss2015`.

## 16. Existing prediction API/service

`app/agents/screening_agent.py::ScreeningAgent` — loads the three artifacts
above via an `lru_cache`d singleton loader, builds a 21-value ordered
feature vector from a Digital Twin state dict (`_resolve_feature_vector`,
refusing rather than guessing when any field is missing —
`check_eligibility`), scales it with the persisted scaler, and calls
`model.predict_proba()`. Exposed at `POST /api/screening/run` (through
`Orchestrator` + the Safety gate, persisted as a `ScreeningAssessment` row
and a `screening` timeline event) and used directly by the What-if
Simulation Agent via `ScreeningAgent.score_vector()` (same model, no
eligibility gate — the What-if Agent gates the real profile once up front).

## 17. Existing limitations

- Self-reported telephone survey data — recall accuracy, non-response, and
  telephone-coverage biases apply (already documented in
  `docs/ARCHITECTURE.md` §12 and the model's own `disclaimer` field).
- Not clinically validated — explicitly scoped as
  `educational_screening_only` throughout the codebase.
- BRFSS encodes several fields coarsely (5-year age buckets rather than
  raw age at the model's input; `GenHlth` is a 1–5 self-rating, not a
  clinical measure).
- 23,899 exact-duplicate rows (~9.4%) are kept, not deduplicated — see
  `train_screening_model.py`'s docstring for why (no principled way to
  distinguish a real coincidental duplicate from a collection artifact
  given how many features are low-cardinality).
- Single train/test split with CV used only for model *selection*, not a
  full nested-CV generalization estimate — the reported test metrics come
  from one held-out split, not an average over several.
- Moderate class imbalance (~5.3:1), addressed with `class_weight` only —
  no resampling.

## Verification note

Every count/statistic above was re-derived directly from the source CSV
and the actual `screening_model_metadata.json` for this audit (not merely
copied from the training script's comments), so this document reflects
measured reality, not asserted intent. Nothing here is fabricated; nothing
was "not established in the existing implementation."
