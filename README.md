# MedGenesis — Agentic AI Healthcare System for Type 2 Diabetes

> **Educational prototype. Not medical advice, not a diagnostic device.**
> Every clinically-sensitive output is gated by a policy-driven safety agent
> before it reaches a user. All data is synthetic or public and de-identified.

A multi-agent system built around a longitudinal **Patient Digital Twin**
rather than a single-shot prediction. An orchestrator routes work across
specialist agents, and a Safety/Clinician-Review Agent reviews every
clinically-sensitive output before it is shown.

**Main capabilities:** a Digital Twin that never overwrites patient
history; a screening-risk RandomForest (production) with an XGBoost
candidate for comparison, including real per-patient SHAP explanations;
evidence retrieval that cites its sources, from a local curated corpus and
optionally live PubMed; a Clinical Analysis Agent that composes all of the
above into one structured, cited, grounded response with tested
hallucination defenses; a what-if simulator; and a deterministic safety
gate that reviews every sensitive output before it's returned.

## Documentation

This README covers setup and a project overview. For depth:

| Document | Covers |
|---|---|
| [docs/FINAL_REPORT.md](docs/FINAL_REPORT.md) | **Start here** — the complete, consolidated project story: motivation, architecture, every subsystem, evaluation, limitations, future work |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full design + phase-by-phase build history |
| [docs/DIGITAL_TWIN.md](docs/DIGITAL_TWIN.md) | Event-sourced patient state model |
| [docs/ML.md](docs/ML.md) / [docs/ML_BASELINE.md](docs/ML_BASELINE.md) / [docs/ML_VALIDATION.md](docs/ML_VALIDATION.md) | Model training, baseline methodology, and Phase 8's independent re-verification of every reported metric |
| [docs/RAG.md](docs/RAG.md) | Local + PubMed evidence retrieval |
| [docs/CLINICAL_ANALYSIS.md](docs/CLINICAL_ANALYSIS.md) | The Clinical Analysis Agent and its frontend |
| [docs/SAFETY.md](docs/SAFETY.md) | The safety policy gate, including the historical metformin false-positive bug and its fix |
| [docs/PRIVACY.md](docs/PRIVACY.md) | What's protected, and the real gap (no auth layer) stated plainly |
| [docs/TESTING.md](docs/TESTING.md) | Exact test counts and coverage, per file |
| [docs/EVALUATION.md](docs/EVALUATION.md) | Formal evaluation — every figure labeled measured/observed/not measured |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | The complete, consolidated limitations list |
| [docs/LEAKAGE.md](docs/LEAKAGE.md) | A worked target-leakage example from the project's original (since-replaced) dataset |

---

## Quick start

No containers, no database server. You need Python 3.11+ and Node 18+.

**Terminal 1 — backend:**

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m app.ml.train_screening_model      # writes app/ml/artifacts/ (once)
uvicorn app.main:app --reload
```

**Terminal 2 — frontend:**

```bash
cd frontend
npm install
npm run dev
```

- Frontend → http://localhost:5173
- API docs → http://localhost:8000/docs

The SQLite database (`backend/medgenesis.db`) is created automatically on
first run, and tables are created at startup — deleting the file simply
resets the app to an empty state. Nothing to install, configure, or start
separately.

### Seeding demo data

From the UI: **Patient Intake → load a demo patient**. Three profiles ship —
a lower-risk and a moderate-risk profile, plus one with a deliberately
*incomplete* recorded history (missing a few required fields). That path is
part of the demo, not a bug: it exercises the screening agent's refusal to
guess at missing data.

```bash
curl -X POST localhost:8000/api/patients/demo \
  -H 'Content-Type: application/json' -d '{"profile":"moderate_risk"}'
```

---

## Architecture

```
                    React + Vite frontend (8 pages)
                                │  REST/JSON
                            FastAPI (6 routers)
                                │
                    Orchestrator Agent (LangGraph StateGraph)
             deterministic routing by mode, shared state + trace
                                │
   ┌───────────┬────────────────┼─────────────────┐
   │           │                │                 │
 intake    simulation         chat            clinical
   │           │                │                 │
Screening   What-if      Conversational    Clinical Analysis Agent
+ Evidence  Simulation    (LLM/rules)     (composes: Screening RF +
+ Care Plan (delta model) + Evidence tool   XGBoost candidate + Evidence
                                            (local + PubMed) + Simulation)
   │           │                │                 │
   └───────────┴────────┬───────┴─────────────────┘
                        │
        Safety / Clinician-Review Agent  ← YAML policy, not an LLM judge
        APPROVED / FLAGGED / BLOCKED → append-only safety_audit_log
                        │
              Patient Digital Twin (event-sourced timeline, SQLite)
```

Every route above passes through the Safety Agent before returning — this
is a structural property of the LangGraph edges, not a convention (see
[docs/SAFETY.md](docs/SAFETY.md)).

Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Consolidated,
current-state final report: **[docs/FINAL_REPORT.md](docs/FINAL_REPORT.md)**
— the right starting point if you're reading this project for the first
time. Original pre-extension project report:
[docs/REPORT.md](docs/REPORT.md).

### Agents

| Agent | Implementation | Notes |
|---|---|---|
| **Orchestrator** | LangGraph `StateGraph` | Deterministic routing — an LLM never decides whether the safety gate runs |
| **Patient Digital Twin** | Event-sourced `timeline_events` | Append-only; current state is a materialized fold, never an overwrite |
| **Screening Baseline** | scikit-learn | Educational screening-risk only, with data-completeness eligibility gating |
| **Evidence (RAG)** | sentence-transformers + ChromaDB | Falls back to a keyword ranker if those aren't installed. Head-to-head comparison: [ARCHITECTURE.md §13.5](docs/ARCHITECTURE.md#135-semantic-rag-was-enabled-and-a-second-real-bug-was-found-in-it) |
| **What-if input** | Structured deltas, or free text ("what if I lost weight and exercised more") | A deterministic parser, not an LLM — unrecognized phrasing is reported, never guessed at |
| **What-if Simulation** | Transparent delta model | Forks the twin; produces a risk *trajectory*, never writes to the real timeline |
| **Care Plan** | Rules table (+ optional LLM phrasing) | The LLM rephrases; it never chooses recommendations |
| **Conversational** | Mistral → Ollama → rules | Three-tier fallback; always works offline |
| **Safety / Clinician-Review** | YAML policy engine | Deterministic and auditable |

---

## Design decisions worth reading

### 1. The project switched training datasets mid-build

The screening model was originally trained on the **Pima Indians Diabetes
Dataset** — 768 rows, exclusively women of Pima Heritage, Arizona, 1980s. It
now trains on the CDC's **2015 BRFSS Diabetes Health Indicators survey** —
253,680 real, self-reported responses from the general US adult population
(UCI ML Repository #891; US government work, public domain). `pima.csv` has
been removed from the repo; its dataset is no longer read by anything.

This changed more than the numbers. Pima's population restriction (only
applicable to one demographic) is gone — the eligibility gate is now a
**data-completeness check** instead (see decision #2). And BRFSS is a survey,
not a lab panel: it records physical activity and smoking as yes/no answers,
not continuous quantities, and has no blood-glucose field at all — so the
What-if Simulator's `glucose_delta` hypothesis is gone, replaced by a new
`smoker_delta` lever that flips a binary flag rather than scaling a number.

Full writeup, including a second real bug the switch surfaced in the RAG
backend's similarity metric: **[ARCHITECTURE.md §13.7](docs/ARCHITECTURE.md)**.

**Served model:** random forest, test ROC-AUC **0.818**, accuracy 0.716,
precision 0.330, recall 0.774, F1 0.463 (202,944 train / 50,736 test).
Cross-validated ROC-AUC 0.819. Precision is low because the model is
class-weight-balanced toward not missing positive cases — a screening tool's
usual tradeoff — reported honestly rather than picking a threshold that looks
better.

### 2. The screening model refuses to score incomplete profiles — on purpose

BRFSS applies to the general population, so (unlike the original Pima model)
there is no demographic restriction on who can be screened. The real
constraint is **data completeness**: the model needs all 21 of its trained
inputs, and forcing a prediction from a partially-filled profile would return
a confident-looking number with no real basis.

So the agent checks every required field is on file *before* scoring, and
returns a structured `unavailable_for_profile` response naming exactly what's
missing, instead of substituting a guess. Demo Patient C ships with a
deliberately incomplete history so this path is part of the demo, not hidden
as an edge case.

### 3. A target-leak was found in the original (Pima-era) training pipeline

Before the dataset switch, the spec called for **per-outcome median
imputation** on Pima. That leaked the label: 49% of `Insulin` values were
missing, and per-outcome imputation filled every one with exactly `100.0`
(non-diabetic) or `168.0` (diabetic), so the imputed value *was* the label
re-encoded as a feature.

| | Insulin importance | Test ROC-AUC |
|---|---|---|
| Per-outcome (leaky) | 0.409 | 0.941 |
| Plain train-median (served) | 0.066 | 0.813 |

The BRFSS dataset that replaced Pima has zero nulls and needs no imputation
step at all, so this specific bug no longer applies — but the general lesson
(a preprocessing step that consults the target leaks it, even when correctly
fitted on the training split alone) is preserved in full, worked example and
all: **[docs/LEAKAGE.md](docs/LEAKAGE.md)**.

---

## The safety layer

Rules live in [`backend/app/agents/safety_policies.yaml`](backend/app/agents/safety_policies.yaml)
and are applied **deterministically** — the gate is a policy engine, not an
LLM judging free text — so the same output always produces the same decision
and the audit log is reproducible.

| Verdict | Behaviour |
|---|---|
| `APPROVED` | Shown unchanged |
| `FLAGGED_FOR_CLINICIAN_REVIEW` | Shown with a banner and the reasons |
| `BLOCKED` | Replaced with a safe fallback; original text never shown or stored |

Blocks diagnostic phrasing, medication/dosage advice, and false certainty.
Flags High risk tiers, implausibly large simulation swings, urgent symptoms,
and any output missing its educational-scope marker. Every decision is written
to the append-only `safety_audit_log` and is visible on the **Agent Trace &
Safety** page.

The conversational agent's own prompt restrictions are only a first line of
defence — a small local model cannot be trusted to police itself, so the gate
re-checks its output independently. A test simulates a rogue LLM emitting
`"you have diabetes … start taking metformin"` and asserts it is blocked and
never persisted to the transcript.

---

## Configuration

Copy `backend/.env.example` → `backend/.env` and edit. **`backend/.env` is
gitignored; never commit real keys, and never put a real value in
`.env.example`.**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Optional. Defaults to `sqlite:///./medgenesis.db`; set only to relocate the file |
| `MISTRAL_API_KEY` | Optional hosted LLM. Blank = skip |
| `MISTRAL_MODEL` | Default `mistral-small-latest` |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Local free LLM |
| `MEDGENESIS_DISABLE_LLM` | `true` forces the deterministic responder |

### LLM backends

Tried in order; the first available wins:

1. **Mistral API** — hosted, needs a key. ⚠️ This is a **paid service** and the
   only component that departs from the project's free/open-source
   constraint. Entirely optional.
2. **Ollama** — local, free, open-source. `ollama pull llama3.2:3b`
3. **Rule-based responder** — no dependencies, always available.

The active backend is logged at startup and reported by `/api/health`, so it
is obvious during grading which path is live. **Everything except chat
phrasing is deterministic and runs fully offline** — screening, simulation,
evidence retrieval, care-plan rules and the safety gate need no LLM at all.

---

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/patients` · `GET /api/patients` · `GET /api/patients/{id}` | Create / list / fetch patients |
| `GET /api/patients/demo-profiles` · `POST /api/patients/demo` | List / create the 3 seeded demo profiles |
| `POST /api/twin/{id}/events` | Append a timeline event (measurement, lifestyle_log, lab_result, medication_change) |
| `GET /api/twin/{id}/timeline` | Full history + materialized current state |
| `GET /api/twin/{id}/digital-twin` | Richer nested view: clinical/lifestyle fields, lab history, medication history |
| `GET /api/twin/{id}/labs/{test_name}` | Latest value, full history, and a trend label for one test (e.g. `HbA1c`) |
| `POST /api/screening/run` | Screening baseline (RandomForest, production), safety-gated |
| `POST /api/simulate` | What-if risk trajectory, safety-gated |
| `POST /api/careplan/generate` | Care plan with citations |
| `POST /api/chat` | Conversational agent, safety-gated |
| `POST /api/clinical/analyze` | Clinical Analysis Agent — Digital Twin + models + evidence + simulation, safety-gated |
| `POST /api/ml/xgboost/predict` · `GET /api/ml/comparison` | XGBoost candidate score; RF-vs-XGBoost comparison (reads persisted artifacts, never retrains) |
| `POST /api/evidence/search` | Direct query into the Evidence Agent (`source`: local / pubmed / all) |
| `POST /api/agents/run` | Full pipeline + trace (demo/grading) |
| `GET /api/safety/audit-log` · `/api/safety/policy` | Audit trail and active policy |
| `GET /api/health` | Liveness + which backends are active |

Interactive docs at `/docs`.

---

## Tests

```bash
cd backend && source venv/bin/activate && python -m pytest tests/ -q   # 391 tests (1 skipped: opt-in live PubMed test)
cd frontend && npm test                                                # 26 tests
```

Backend coverage includes the safety policy (block/flag/approve, determinism,
word-boundary false positives, the historical metformin false-positive
regression), eligibility gating, twin append-only semantics, lab trend
labeling (0/1/2/3+ points), simulation isolation from the real timeline,
the free-text hypothesis parser, both RAG backends (including a regression
guard on the Chroma cosine-similarity fix), multi-source evidence fusion
(local + PubMed), hallucination defense (fabricated citations, model-name
and numeric-score mismatches), privacy boundaries (no patient identifiers
in PubMed/LLM calls or logs), error resilience under component failure,
and end-to-end smoke tests over the API covering **both a
screening-eligible patient and one with an incomplete recorded history**.
Exact per-file counts and methodology: [docs/TESTING.md](docs/TESTING.md).

---

## Data sources and licensing

| Data | Source | Licence |
|---|---|---|
| Screening training data | CDC BRFSS 2015 Diabetes Health Indicators (UCI ML Repository #891) | **Public domain** — U.S. government work (17 U.S.C. §105) |
| Knowledge base | CDC "Diabetes Basics" | **Public domain** (17 U.S.C. §105) |
| Knowledge base | WHO "Diabetes" fact sheet | **© WHO — copyrighted, not public domain.** Used with attribution under [WHO's permissions policy](https://www.who.int/about/policies/publishing/copyright) |
| Demo patients | Generated (`app/ml/synthetic_patients.py`) | Fictional |

WHO attribution, source URL and access date are stored in the vector metadata
and displayed with every WHO-derived excerpt in the UI.

---

## Limitations

Full, consolidated list (including ones not repeated here — no auth layer,
no clinical validation, no expert-labelled PubMed evaluation, XGBoost
candidate-model status): **[docs/LIMITATIONS.md](docs/LIMITATIONS.md)**.
The ones most relevant to the ML baseline specifically:

- **BRFSS is self-reported survey data, not lab measurements.** Every field
  is a telephone-survey answer, subject to recall accuracy, non-response, and
  telephone-survey coverage bias. The model is an educational screening-risk
  baseline, not a clinical or general T2D predictor, and the system says so
  rather than pretending otherwise.
- **Low precision, by design tradeoff.** Test ROC-AUC 0.818, recall 0.774,
  but precision only 0.330 — most "elevated risk" flags would be false
  positives. This comes from class-weight-balancing toward not missing
  positive cases (prediabetes + diabetes are only ~16% of the data), a
  defensible choice for a *screening* tool, but a real cost stated plainly
  rather than hidden behind the headline ROC-AUC.
- **Two binary lifestyle levers have a genuinely small measured effect.**
  Flipping `PhysActivity` or `Smoker` alone moves the trained model's risk
  score by roughly 0.005–0.01 — far smaller than a comparable BMI change.
  This is the model's real, honest behavior on real survey data, not a bug;
  the What-if Simulator shows it as-is rather than exaggerating it.
- **23,899 duplicate rows (~9.4%) were kept, not dropped.** With 17 of 21
  features binary and the rest small-cardinality buckets, distinct real
  respondents sharing an identical answer profile is expected. There's no
  principled way to separate a "real" duplicate from a collection artifact,
  and dropping them would arbitrarily bias the sample toward less-common
  response profiles.
- **The simulation delta model is a documented heuristic**, not a validated
  physiological model. A trajectory shows the *sensitivity of the trained
  model* to changed inputs — not a forecast of real clinical outcomes.
- **The safety agent is a teaching implementation** of a governance pattern.
  Keyword-and-rule matching is bypassable by paraphrase and is not
  regulatory-grade clinical-AI review.
- **The local LLM is small** (3–4B), so phrasing quality is limited; mitigated
  by RAG grounding, narrow scope and safety gating.
- **SQLite rather than PostgreSQL.** Postgres with `JSONB` columns was
  considered and initially specified: it would give indexable/queryable JSON
  payloads and real concurrent access, which is what a production version of
  an event-sourced timeline would want. SQLite was chosen instead so the
  project runs with `pip install` and nothing else — no server to install, no
  container runtime, no credentials to configure for a grader. The tradeoff is
  accepted deliberately: JSON payloads are stored as text and cannot be
  queried by key, and concurrent writers would be a problem at any real scale.
  For a single-user educational prototype neither limitation bites, and the
  schema is plain SQLAlchemy, so migrating to Postgres later would mean
  changing a connection string and the JSON column type, not the model layer.
- **Not a clinical tool.** Coursework and demonstration only.

---

## Future work

Prioritized roadmap — full detail in
[docs/FINAL_REPORT.md §20](docs/FINAL_REPORT.md#20-future-work):

1. **Security foundation** — authentication, authorization, patient-scoped
   access, requester-identity audit logging. The most consequential gap in
   the current system.
2. **Evidence evaluation** — expert-labelled PubMed relevance judgments, a
   larger local corpus, evidence-quality grading.
3. **Stronger ML validation** — an external validation dataset,
   leakage/duplicate-aware split comparison, calibration checking,
   subgroup evaluation.
4. **Clinical validation** — review by qualified clinical experts.
5. **Efficiency/observability** — cache the RF-vs-XGBoost comparison's
   test-set re-evaluation and SHAP explainer construction (currently
   ~0.55–0.68s per request, measured); explicit PubMed availability
   status in API responses.
6. **MCP** — deliberately deferred until Priority 1 exists; exposing this
   system's tools before there is any access control would widen the
   current gap, not narrow it.
