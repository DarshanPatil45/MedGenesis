# Target leakage in the screening baseline: a worked example

> **Historical note (see [ARCHITECTURE.md §13.7](ARCHITECTURE.md)):** this
> analysis was performed on the project's original training pipeline, which
> used the **Pima Indians Diabetes Dataset** (768 rows). The project has
> since switched to the CDC BRFSS 2015 Diabetes Health Indicators dataset
> (253,680 rows) as its active training source — `pima.csv` has been
> removed, and the currently-served model was never exposed to this
> particular leak (BRFSS has no missing-value encoding to impute in the
> first place; see §13.7). This document is kept in full because the
> underlying lesson — that a preprocessing step consulting the target
> variable leaks it, even when correctly fitted on the training split alone
> — is general and not tied to Pima specifically.

This document records a real bug found and fixed while building MedGenesis.
It is kept as a teaching artifact because the bug is subtle, easy to make,
and actively recommended in a number of tutorials for this dataset.

## The setup

The Pima Indians Diabetes Dataset encodes missing physiological measurements
as `0`. Those zeros must be treated as missing rather than as real values:

| Column | Missing (encoded as 0) | Share |
|---|---|---|
| Insulin | 374 / 768 | **48.7%** |
| SkinThickness | 227 / 768 | 29.6% |
| BloodPressure | 35 / 768 | 4.6% |
| BMI | 11 / 768 | 1.4% |
| Glucose | 5 / 768 | 0.7% |

The obvious next question is what to impute them with.

## The tempting answer, and why it is wrong

A common suggestion is **per-outcome median imputation**: fill a missing
value with the median *for that row's outcome class*. It sounds smarter than
a single global median — diabetic and non-diabetic patients genuinely do have
different typical insulin levels, so per-class medians look more faithful.

Fitting those medians on the training split only (so no test rows inform
them) also feels like the careful, leak-free thing to do. That guard is real,
but it addresses a *different* leak.

The problem: **the imputed value encodes the label.**

On the training split the medians are:

```
Insulin median | Outcome 0 (non-diabetic): 100.0
Insulin median | Outcome 1 (diabetic):     168.0
```

Every one of the ~290 training rows with missing insulin therefore receives
exactly `100.0` or exactly `168.0` — and which one it receives is determined
entirely by its label. The model does not need to learn any physiology. It
can learn:

```
Insulin == 168.0  ->  predict diabetic
Insulin == 100.0  ->  predict non-diabetic
```

That is the target, copied into a feature column and handed to the model.

## Measured impact

Both strategies were trained with an identical split, scaler, model set and
random seed. Only the imputation differs.

| | Insulin importance | Test ROC-AUC |
|---|---|---|
| Per-outcome medians (leaky) | **0.409** | **0.9407** |
| Plain train-split medians (clean) | 0.066 | **0.8130** |

Three things give the leak away:

1. **The score is too good.** Published baselines for this dataset cluster
   around 0.82–0.84 ROC-AUC. A jump to 0.94 from an imputation change alone
   is not a modelling win.
2. **Insulin dominates.** The column with ~49% missingness becomes the single
   most important feature — importance rises 6× — precisely because its
   imputed values are label-encoded. In the clean model, Glucose and BMI lead,
   which is what the clinical literature would predict.
3. **The response is non-monotonic.** Sweeping insulin through the leaky model
   produced `insulin=100 → Low risk`, `insulin=120 → High risk`,
   `insulin=165 → High risk`: the model had learned the imputation constants
   as landmarks rather than any dose-response relationship.

## It also cannot be deployed

Set aside the inflated metric. At inference time the outcome is the very thing
being predicted, so the per-outcome median **cannot be computed** for a new
patient. Any production path has to substitute something else, which means
the model is served inputs drawn from a different distribution than it was
trained on — a train/serve skew stacked on top of the leak.

## What the Pima-era pipeline shipped (historical)

At the time, `backend/app/ml/train_screening_model.py` trained **both**
strategies and wrote the comparison into the model metadata, but **always
served the `plain` (leak-free) model** — the honest number, test ROC-AUC ≈
0.81, was what the UI reported, never the leaky ≈0.94.

A monotonicity test defended against a leaky model being served by accident
— the same pattern this project still uses today. Its current form, against
the BRFSS model now served, is
`tests/test_screening_agent.py::test_higher_bmi_and_worse_gen_hlth_increase_risk`.

## The general lesson

> Any imputation, encoding, scaling, or feature-engineering step that consults
> the target variable leaks the target into the features — even when it is
> correctly fitted on the training split alone.

Splitting before preprocessing prevents *test-set* leakage. It does nothing
about *target* leakage. They are separate failures and both need checking.

A useful reflex: when a preprocessing change alone produces a large accuracy
jump, treat it as a leak hypothesis before treating it as a result.
