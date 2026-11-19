# Frontend Audit — MedGenesis

Pre-refactor mapping of the **existing** backend contract surface against the
requested frontend redesign. Produced by reading `backend/app/main.py`,
`backend/app/routers/*.py`, `backend/app/schemas.py`, the agent/service modules,
and the trained-model metadata artifacts.

**Nothing in this document proposes a backend change.** It records what the API
actually returns today, so the redesign can be built only on real data.

---

## 1. Endpoint inventory

Base URL in dev: frontend calls relative paths; Vite proxies `/api` → `http://localhost:8010`.

| # | Method | Path | Request | Response schema |
|---|--------|------|---------|-----------------|
| 1 | GET | `/api/health` | — | `HealthOut` |
| 2 | GET | `/` | — | name/docs/health/disclaimer |
| 3 | GET | `/api/patients` | — | `PatientOut[]` |
| 4 | POST | `/api/patients` | `PatientCreate` | `PatientOut` (201) |
| 5 | GET | `/api/patients/demo-profiles` | — | `{key: DemoProfile}` |
| 6 | POST | `/api/patients/demo` | `DemoPatientCreate` | `PatientOut` (201) |
| 7 | GET | `/api/patients/{id}` | — | `PatientOut` |
| 8 | POST | `/api/twin/{id}/events` | `TimelineEventCreate` | `TimelineEventOut` (201) |
| 9 | GET | `/api/twin/{id}/timeline` | — | `TimelineOut` |
| 10 | GET | `/api/twin/{id}/digital-twin` | — | `DigitalTwinOut` |
| 11 | GET | `/api/twin/{id}/labs/{test_name}` | — | `LabTrendOut` |
| 12 | POST | `/api/screening/run` | `{patient_id}` | `ScreeningOut` |
| 13 | POST | `/api/simulate` | `SimulateRequest` | `SimulateOut` |
| 14 | POST | `/api/careplan/generate` | `CarePlanRequest` | `CarePlanOut` |
| 15 | POST | `/api/chat` | `ChatRequest` | `ChatOut` |
| 16 | POST | `/api/clinical/analyze` | `ClinicalAnalysisRequest` | `ClinicalAnalysisOut` |
| 17 | POST | `/api/agents/run` | `AgentRunRequest` | `AgentRunOut` |
| 18 | GET | `/api/safety/audit-log` | `?limit,target_type,status` | `AuditLogOut[]` |
| 19 | GET | `/api/safety/policy` | — | policy dict |
| 20 | GET | `/api/ml/comparison` | — | `ModelComparisonOut` |
| 21 | POST | `/api/ml/xgboost/predict` | `{patient_id}` | `XGBoostPredictOut` |
| 22 | POST | `/api/evidence/search` | `EvidenceSearchRequest` | `EvidenceSearchOut` |

All 22 are already wired in `src/api/client.ts` except **#21 `/api/ml/xgboost/predict`**
and **#7 `getPatient`** (client method exists, unused by any screen).

CORS: `allow_origin_regex=http://(localhost|127\.0\.0\.1):\d+` — loopback only.

---

## 2. Exact response field lists (what the UI may render)

**`PatientOut`** — `id, pseudonym, age, sex, is_synthetic, screening_eligible, created_at`

**`DemoProfile`** — `pseudonym, age, sex, screening_eligible`

**`TimelineEventOut`** — `id, patient_id, event_type, payload (free dict), source, recorded_at`
`event_type` ∈ `measurement | lifestyle_log | note | medication_change | lab_result`
(agent-written also: `screening`, `care_plan`).

**`DigitalTwinOut`** — `patient, clinical, laboratory{latest,history}, medications{current,history}, lifestyle, timeline`

**`LabTrendOut`** — `test_name, latest, history, trend` where trend ∈
`no_data | insufficient_data | stable | increasing | decreasing | mixed`

**`ScreeningOut`** — `id, patient_id, status, scope, disclaimer, risk_probability,
risk_tier, unavailable_reason, top_features{name:float}, model_version, summary_text, safety, trace`

**`SimulateOut`** — `id, patient_id, status, scope, label, hypothesis, trajectory[],
assumptions[], unavailable_reason, base_timeline_event_id, summary_text, safety, trace`
`trajectory[]` item: `week, risk_probability, risk_tier, bmi, phys_activity, smoker, simulated`

**`CarePlanOut`** — `id, patient_id, diet_focus, activity_target, monitoring_frequency,
follow_up_weeks, narrative_text, notes[], sources[], generated_by, risk_tier, screening, safety, trace`

**`ChatOut`** — `session_id, reply_text, sources[], generated_by, tools_used[], safety, trace`

**`ClinicalAnalysisOut`** — `patient_id, question, status, scope, patient_summary[],
model_analysis[], evidence_findings[], simulation, integrated_analysis[], uncertainties[],
citations[], safety_flags[], unavailable_reason, generated_by, production_risk_tier, safety, trace`
Claim item: `{claim: str, claim_type: str, evidence_ids: str[]}`

**`EvidenceSource`** — `text, document_id, section, title, publisher, source_url,
accessed, license, attribution, score, source_type, doi`

**`ModelComparisonOut`** — `random_forest, xgboost, metrics_table, n_test`
`ModelMetricsOut`: `model_version, algorithm, test_metrics, confusion_matrix,
training_time_seconds, inference_time_seconds_test_set, inference_time_seconds_per_1000_rows,
model_size_bytes, feature_importances`
`test_metrics` keys are exactly: **accuracy, precision, recall, f1, roc_auc**

**`XGBoostPredictOut`** — `model, model_version, status, prediction, score, risk_tier,
features_used[], unavailable_reason, disclaimer`

**`AuditLogOut`** — `id, target_type, target_id, status, reasons[], policy_version, reviewed_at`
`status` ∈ `APPROVED | FLAGGED_FOR_CLINICIAN_REVIEW | BLOCKED`

**`SafetyOut`** (embedded everywhere) — `status, reasons[], disclaimer, banner, policy_version`

**`HealthOut`** — `status, database, screening_model, rag_backend, llm, policy_version`

---

## 3. Current frontend routes (to be preserved)

| Route | Screen | Primary calls |
|-------|--------|---------------|
| `/` | Patient Intake | `demoProfiles`, `createDemoPatient`, `createPatient`, `listPatients` |
| `/twin` | Digital Twin | `timeline` |
| `/screening` | Screening | `runScreening`, `mlComparison` |
| `/clinical-analysis` | Clinical Analysis | `analyzeClinical`, `mlComparison`, `digitalTwin`, `labTrend` |
| `/simulator` | What-if Lab | `simulate` |
| `/careplan` | Care Plan | `generateCarePlan` |
| `/chat` | Grounded Chat | `chat` |
| `/trace` | Agent Trace | `runPipeline` |
| `/safety` | Safety | `auditLog`, `safetyPolicy` |

Patient selection lives in `src/PatientContext.tsx` (React state + `localStorage`
key `medgenesis.selectedPatientId`). No auth anywhere. Matches the brief.

### Form + validation inventory (must be preserved verbatim)

Manual patient creation posts `baseline_measurements` keyed by the backend's
snake_case twin-state keys (`app/agents/screening_agent.py::FEATURE_KEY_MAP`):

`high_bp, high_chol, chol_check, stroke, heart_disease_or_attack, diff_walk,
smoker, phys_activity, fruits, veggies, hvy_alcohol_consump, any_healthcare,
no_doc_bc_cost` → each sent as `1|0`
`bmi` (omitted when blank), `gen_hlth 1–5`, `ment_hlth 0–30`, `phys_hlth 0–30`,
`education 1–6`, `income 1–8` → numbers
Top level: `pseudonym` (blank → `"Unnamed patient"`), `age 18–120`, `sex`
∈ `female|male|other|unspecified`.

The screening model needs **all 21** trained features or it returns
`status="unavailable_for_profile"` rather than guessing.

---

## 4. ⚠️ Gaps — spec features with no backing endpoint

These are the items where the brief asks for data the backend does not return.
Listed with the exact evidence. **No UI was written for any of these.**

| # | Spec item | Reality | Evidence |
|---|-----------|---------|----------|
| G1 | Command bar **global search** | No search endpoint exists. `/api/evidence/search` searches *evidence text only*, not patients/pages. | Endpoint inventory |
| G2 | Screening **"confidence"** | `ScreeningOut` has `risk_probability` + `risk_tier` only. No confidence/interval field. | `schemas.py:101` |
| G3 | Model metrics **"calibration"** | `test_metrics` = accuracy, precision, recall, f1, roc_auc. No calibration curve or Brier score. | `xgboost_model_metadata.json` |
| G4 | **SHAP waterfall / force plot** | Per-patient SHAP is **never returned as structured data**. It is rendered into an English sentence inside one `ClinicalClaim.claim` string, **top-5 features only**, by `/api/clinical/analyze` (requires `include_model_comparison=true`). `/api/ml/xgboost/predict` returns **no** SHAP. Today's UI regex-parses that prose. | `clinical_agent.py:342-352`; `predict.py:103-114` |
| G5 | Global SHAP importance | `shap_feature_importance` exists in the XGBoost metadata file but is **not** in `ModelMetricsOut` — only native `feature_importances` is exposed. | `model_comparison.py:107` |
| G6 | What-if sliders for **BP** and **glucose** | Simulation supports exactly 4 deltas: `bmi_delta, weight_kg_delta, activity_minutes_delta, smoker_delta` (+ `horizon_weeks`). Glucose was **deliberately removed** — BRFSS has no glucose field. No BP delta. | `simulation_rules.py:31`, module docstring |
| G7 | PubMed cards with **authors** + **year** | The PubMed client parses journal/year/authors, but only `journal` survives — mapped to `publisher`. `authors` and `year` are dropped at the `EvidenceSource` boundary and are absent from the API response. | `rag.py:427`; `schemas.py:278` |
| G8 | Agent trace **duration / status / input+output summary** | `trace` is `list[str]` on every response. No per-node timing, status, or IO. | `schemas.py` (6 occurrences) |
| G9 | Agent **DAG via reactflow** | Same as G8 — no node IDs or edges are returned. A graph would have to be hardcoded from the string prefixes, i.e. invented topology. | `schemas.py` |
| G10 | Care Plan **sleep** domain | Plan fields are `diet_focus`, `activity_target`, `monitoring_frequency` only. No sleep recommendation. | `schemas.py:148` |
| G11 | Care Plan **per-item citations** | `sources[]` is plan-level, not attached to individual recommendations. | `schemas.py:157` |
| G12 | Digital Twin **"twin health" gauge** | No composite health score is computed or returned anywhere. | `DigitalTwinOut` |

---

## 5. Fully supported (safe to build now)

- Journey framing Patient → Twin → Models → Evidence → Synthesis → Safety
- Patient chip + switcher, demo-profile selector, 3-step progressive create form
- Digital Twin longitudinal timeline with **real** lanes: measurement, lab_result,
  medication_change, lifestyle_log, screening, care_plan; click → record drawer;
  date-range/brush from real `recorded_at`; lab trend via `/labs/{test}`
- Screening: risk %, tier, model_version, `top_features` bar chart (global importance),
  RF-vs-XGB metric table, per-patient XGB score via `/api/ml/xgboost/predict`
- Clinical Analysis: prompt composer, evidence column, model comparison,
  claim-typed synthesis, `evidence_ids` → `[E#]` pills, uncertainties list
- What-if Lab: 4 real sliders + horizon, trajectory chart, before/after delta, assumptions
- Grounded Chat: turns, `sources[]` pills, `generated_by`, `tools_used`
- Agent Trace: vertical step timeline from the real `trace` strings
- Safety: audit log table, grouping by real `status`, policy panel
- Loading / empty / error states, persistent disclaimer, a11y, responsive

---

## 6. Decisions needed before Tier A work begins

See the questions raised alongside this document. Building any of G1–G12 as
specified would require either a backend change (out of scope) or fabricated
data (prohibited).
