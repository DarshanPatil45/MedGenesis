# The Patient Digital Twin

The Digital Twin is an event-sourced, append-only representation of a
patient. Nothing in `timeline_events` is ever updated or deleted — a
patient's "current state" is always a materialized view computed on read
from the log, never a mutated row. **`backend/app/services/twin.py` is the
one and only Digital Twin service** — every agent, router, and test reads
and writes through it; nothing in this document introduces a second one.

This document distinguishes what the Digital Twin already did before Phase
2 from what Phase 2 (docs/ARCHITECTURE.md §13.9) added, and states plainly
what still isn't there.

---

## Current Digital Twin (before Phase 2)

### What patient information was exposed

`GET /api/twin/{id}/timeline` returned `{patient_id, events, current_state}`.
`current_state` was, and remains, a **flat dict**: demographic fields from
the `patients` table, plus the latest value per key across every
`measurement`/`lifestyle_log` event's JSON payload — a pure fold, last
write wins per key.

### Which fields came from where

| Source | Fields |
|---|---|
| `patients` table | `patient_id`, `age`, `sex` (+ `pseudonym`, `is_synthetic`, `created_at`, `screening_eligible` — exposed via `/api/patients`, not folded into `current_state`) |
| `measurement`/`lifestyle_log` event payloads | Whatever keys were actually posted — for the BRFSS-shaped demo/screening data this means `high_bp`, `high_chol`, `bmi`, `smoker`, `phys_activity`, `gen_hlth`, `ment_hlth`, `phys_hlth`, `education`, `income`, `height_m`, `weight_kg`, etc. There is no fixed schema; a field simply doesn't exist in `current_state` until some event sets it. |

### Which events were (and still are) materialized into `current_state`

Only `measurement` and `lifestyle_log` — that's `twin.STATE_EVENT_TYPES`,
unchanged by Phase 2.

### Which events were historical-only (never folded)

`screening`, `care_plan`, `chat`, `note` — visible in the raw `events` list
returned by `/timeline`, never in `current_state`. (Phase 1 added
`medication_change` and `lab_result` to the set of *allowed* event types
without materializing them anywhere — see §13.8. Phase 2 is what actually
does something with them; see below.)

### Which values were calculated

Only `Patient.screening_eligible` (a Python property on the ORM model,
derived from `sex`). The twin service itself does zero computation — it is
a pure fold over recorded events. (Note: the synthetic-patient *generator*,
`app/ml/synthetic_patients.py`, does derive BMI from weight/height when
fabricating demo history — that's data generation, not something the twin
service does for real recorded data.)

### Which values were missing, and how that showed up

Any field never posted in an event simply has no key in `current_state`.
Consumers (`screening_agent.check_eligibility()`, for example) check for
`None`/absent keys explicitly and refuse to guess — see
`docs/ARCHITECTURE.md` §4.3.

---

## MedGenesis-required Digital Twin — what Phase 2 added

Per the MedGenesis master specification, the twin needs to represent
laboratory values (HbA1c above all), medication history, and richer
lifestyle information, en route to the future XGBoost/Clinical
Agent/Evidence Agent pipeline. Phase 2 adds exactly three things, all
inside the existing `services/twin.py`:

1. **Lab result materialization** (`get_lab_history`, `get_latest_labs`,
   `get_lab_trend`)
2. **Medication history materialization** (`get_medication_history`,
   `get_current_medications`)
3. **A structured, nested aggregate view** (`get_structured_twin`) built
   entirely from the above plus the existing `get_current_state`

Nothing about `get_current_state()`'s shape or behavior changed. Every
function below is **additive** — a new way to read the same append-only
log, not a replacement for the existing flat view.

### Lab results

**Payload shape**, validated by `twin.validate_lab_result_payload()` and
enforced inside `append_event()`:

| Field | Required | Notes |
|---|---|---|
| `test_name` | Yes | e.g. `"HbA1c"`, `"Fasting glucose"` — a free-text label, not an enum, so any test can be recorded |
| `value` | Yes | Must be numeric (bool is explicitly rejected — it's a Python `int` subclass and would otherwise pass silently) |
| `unit` | No | e.g. `"%"`, `"mg/dL"` |
| `reference_range` | No | e.g. `"4.0-5.6"` |
| `provenance` | No | Where the value came from (e.g. `"lab report"`, `"patient self-report"`) — distinct from `TimelineEvent.source` (`real`/`synthetic`), which is about whether the *patient* is synthetic, not where a *value* originated |

**The measurement date is `TimelineEvent.recorded_at`** — deliberately not
duplicated as a second date field inside the payload. Pass `recorded_at`
explicitly to `append_event()` when backfilling a historical value (the
synthetic-patient generator already does this).

**Materialization functions:**

- `get_lab_history(db, patient_id, test_name=None)` — every recorded result
  for a patient (optionally filtered to one test), oldest first. Nothing is
  ever collapsed away; a full HbA1c history stays a full history.
- `get_latest_labs(db, patient_id)` — `test_name -> most recent record`,
  across every distinct test the patient has *any* result for. A test never
  recorded simply has no key — never filled in with a guess.
- `get_lab_trend(db, patient_id, test_name)` — latest value, full history,
  and a plain trend label for one test.

### HbA1c specifically

HbA1c is not special-cased in code — it's just a `test_name` value like any
other — but it's the use case the trend logic is built for. Retrieval:

- **Latest**: `get_latest_labs(...)["HbA1c"]`, or `GET
  /api/twin/{id}/labs/HbA1c` (`.latest`)
- **History**: `get_lab_history(..., test_name="HbA1c")`, or the same
  endpoint's `.history`
- **Trend**: `get_lab_trend(..., "HbA1c")["trend"]`

**Trend labels, and why each threshold is where it is** (Step 9's "do not
claim a trend from insufficient observations," taken literally):

| Points | Label | Reasoning |
|---|---|---|
| 0 | `no_data` | Nothing recorded |
| 1 | `insufficient_data` | A single value has no trend to speak of |
| 2 | `insufficient_data` | A two-point change is easily noise — deliberately *not* called a trend even though "it went up" is tempting to say |
| 3+, monotonic increase | `increasing` | |
| 3+, monotonic decrease | `decreasing` | |
| 3+, all equal | `stable` | |
| 3+, non-monotonic | `mixed` | Honest label for fluctuation — never forced into "stable" or a direction it doesn't have |

**No hard-coded medical thresholds anywhere in this path** — confirmed by a
test that inspects `get_lab_trend`'s source for clinical-threshold-shaped
strings (`test_no_hardcoded_threshold_...` in
`test_digital_twin_phase2.py`). The function's only inputs are the recorded
values' relative order; it has no concept of what counts as a "high" HbA1c.
That classification is explicitly deferred to a future Clinical Analysis
Agent phase — the twin represents data, it does not diagnose.

### Medications

**Payload shape**, validated by `twin.validate_medication_payload()`:

| Field | Required | Notes |
|---|---|---|
| `medication_name` | Yes | Free text |
| `action` | Yes | One of `started`, `stopped`, `dose_changed`, `continued` — `twin.MEDICATION_ACTIONS` |
| `dose` | No | Free text (e.g. `"500mg daily"`) — recorded as reported, never a prescription |
| `provenance` | No | Same meaning as for labs |

Date = `recorded_at`, same convention as labs.

**Materialization functions:**

- `get_medication_history(db, patient_id)` — every `medication_change`
  event, oldest first, including ones whose latest action was later
  superseded (the full history is never lost).
- `get_current_medications(db, patient_id)` — the latest recorded action
  per medication name, **excluding** any medication whose latest action is
  `stopped`. This is the exact same "latest value per key wins" fold
  `get_current_state()` already uses for flat measurement fields, just
  grouped by medication name instead of a top-level key — architecturally
  consistent with the rest of the twin, not a new pattern.

Worked example: `started` → `dose_changed` → the medication appears in
`current` with the *new* dose. `started` → `stopped` → absent from
`current` (present in `history`). `started` → `stopped` → `started` again →
reappears in `current`.

**This is a historical record, not a prescription.** Nothing in this module
recommends starting, stopping, or changing a medication — it only stores
what was reported. (Verified by a test that checks the module's source for
actual advisory phrasing like "you should take" or "we recommend" — not the
bare word "prescription," which legitimately appears in this file's own
comments explaining what it *doesn't* do.)

### Lifestyle information — reviewed, nothing new added

The MedGenesis spec lists physical activity, daily steps, diet pattern,
sleep, smoking, and alcohol as candidate lifestyle fields. Inspection
result: `phys_activity`, `smoker`, and `hvy_alcohol_consump` **already
exist** as BRFSS measurement fields, already flow through
`get_current_state()`, and are already consumed by the screening model and
the What-if Simulator. `daily_steps`, `diet_pattern`, and `sleep` do
**not** exist and were **deliberately not added** — nothing in the current
architecture (the trained BRFSS model, the six existing agents) reads them,
and inventing storage for fields nothing consumes would be exactly the
"arbitrary fields" the phase spec says not to add. If a future phase's
Clinical Agent or a new ML feature genuinely needs one of these, it should
be added then, justified by that consumer — not spinning it forward.

### Structured twin (`get_structured_twin`)

```
{
  "patient": {patient_id, age, sex, is_synthetic, screening_eligible},
  "clinical": {<subset of current_state — health-condition fields>},
  "laboratory": {"latest": {...}, "history": [...]},
  "medications": {"current": [...], "history": [...]},
  "lifestyle": {<subset of current_state — lifestyle fields>},
  "timeline": [<every event, chronological>]
}
```

`clinical` and `lifestyle` are **not new data** — they're the same keys
already in `current_state`, grouped for readability
(`twin._CLINICAL_STATE_KEYS`, `twin._LIFESTYLE_STATE_KEYS`). `laboratory`
and `medications` are new. `timeline` is the same event log
`get_timeline()` already returned, serialized.

Two `diabetes_type`/`diabetes_duration`-style fields from the master spec's
conceptual patient model were **not added** for the same reason as the
lifestyle fields above: nothing currently produces or consumes them. If a
later phase needs them, add them justified by that need.

### Timestamps and history (Step 9)

Every lab and medication function above returns full chronological history
by construction — `get_timeline()` already orders by `recorded_at` then
`id`, and none of the new functions collapse anything except the explicitly
"latest" variants, which exist *alongside* (never instead of) the full
history. A concrete worked example, matching what's actually implemented
and tested:

```
HbA1c: 2024-01 → 7.0    2024-04 → 7.4    2024-08 → 7.8
```

`get_lab_history(...)` returns all three. `get_latest_labs(...)["HbA1c"]`
returns only the 7.8 record. `get_lab_trend(...)` returns both, plus
`"trend": "increasing"`.

---

## ML feature boundary (Step 8)

The Digital Twin (rich, nested, human-readable) and an ML feature vector
(ordered, numeric, model-specific) are different things and stay separate.
The **existing, working example** of this boundary is
`screening_agent._resolve_feature_vector()` — it takes a flat twin state
dict and returns the ordered 21-value vector the RandomForest expects,
raising rather than guessing when a required field is missing. Phase 2
does not add a new transformer: the future XGBoost `preprocessing.py`
(`app/ml/xgboost_model/`, currently a scaffolded stub — see §13.8) will need
an analogous function, but *what* it should read from the twin (the same 21
BRFSS fields only, or also lab/medication history) is a modeling decision
for the training phase, not something to decide in this phase. Building
that transformer now would be exactly the "arbitrary feature engineering
until the dataset/model phase" the spec says to avoid.

---

## Backwards compatibility

Verified, not assumed:

- `get_current_state()` — identical signature, identical return shape,
  identical behavior. A dedicated test
  (`test_backwards_compatible_get_current_state_unaffected`) posts a
  `lab_result` event and confirms it does not appear in `current_state`.
- `GET /api/twin/{id}/timeline` — identical response shape
  (`{patient_id, events, current_state}`); a test confirms it.
- `POST /api/twin/{id}/events` — the three original `event_type` values
  (`measurement`, `lifestyle_log`, `note`) remain valid and behave exactly
  as before; two new values were added (additive `Literal` widening in
  `schemas.TimelineEventCreate`). Agent-internal types (`screening`,
  `care_plan`, `chat`) remain excluded from direct API posts, unchanged.
- All 130 tests passing before Phase 2 still pass, unmodified in behavior
  (two had their *fixture data* updated where a payload no longer satisfied
  a newly-defined, spec-required validation contract — see the commit for
  exactly which two and why; no assertion was weakened).

## Synthetic test data (Step 12)

`app/ml/synthetic_patients.py`'s `moderate_risk` demo profile now includes
an `lab_history` (3-point HbA1c series, 7.0 → 7.4 → 7.8, `"increasing"`)
and a `medication_history` (Metformin `started`, 500mg daily). This is
**entirely fictional synthetic data**, generated the same way the existing
measurement history already was — never real patient data. The other two
profiles (`lower_risk`, `incomplete_history`) don't define
`lab_history`/`medication_history` and are completely unaffected — a test
confirms they still generate zero lab/medication events, exactly as before
Phase 2.

## API surface added

| Endpoint | Purpose |
|---|---|
| `GET /api/twin/{id}/digital-twin` | The structured, nested view above |
| `GET /api/twin/{id}/labs/{test_name}` | Latest value, history, and trend for one test |

Both are additive — no existing endpoint's contract changed.

## What is still not implemented

- Diabetes type/duration, daily steps, diet pattern, sleep — not added;
  reasoning above
- Any classification of a lab value as high/low/normal, or of a patient as
  at-risk based on a lab or medication field — explicitly out of scope for
  the Digital Twin; belongs to a future Clinical Analysis Agent
- Any ML feature transformer consuming lab/medication data — the boundary
  is documented, the transformer is not built
- Folding `lab_result`/`medication_change` into `get_current_state()`'s flat
  view — deliberately deferred (see `models/timeline.py`'s comment on
  `EVENT_TYPES`); would need a real design decision about key-naming
  collisions with existing measurement fields, better made by whichever
  agent first needs it
