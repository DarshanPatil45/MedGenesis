# MedGenesis: Agentic AI Healthcare System for Type 2 Diabetes

**A college project — architecture & design document**
**Status:** v4 — **implemented**. Reflects the built system; see §13 for changes made during implementation, including a target-leak found in the original imputation strategy ([LEAKAGE.md](LEAKAGE.md)) and a mid-build switch of the training dataset (§13.7).
**Stack:** free / open-source throughout, with one **optional, disabled-by-default** exception — a hosted Mistral chat backend (§13.4). The system runs fully offline without it. Data: the CDC's public-domain BRFSS 2015 Diabetes Health Indicators survey (screening-risk baseline only) + public-domain guideline text + synthetic demo patients.

---

## 1. Problem Statement

Type 2 Diabetes (T2D) management benefits from continuous risk monitoring, personalized lifestyle coaching, and evidence-grounded guidance — but most patients only get this during brief clinic visits. MedGenesis explores whether a coordinated team of small, specialized AI agents can approximate a lightweight "diabetes care team," built around a **longitudinal patient digital twin** rather than a single-shot prediction: one agent produces an educational screening-risk indicator, another retrieves relevant care guidance, another lets the patient explore "what if I changed X" scenarios against their own timeline, another turns findings into a personalized plan, another handles natural-language conversation — and a dedicated **safety agent gates every high-stakes output** before it reaches the user. An orchestrator decides which agents run, in what order, over the twin's state.

This is an educational prototype, not a certified medical device, and is explicitly designed *not* to claim clinical-grade diabetes prediction — see §4.3 and §12.

## 2. Objectives

1. Maintain a **timestamped Patient Digital Twin** — an event-sourced timeline of a patient's measurements, lifestyle logs, screenings, and simulations — rather than a single overwritable record, so risk and care recommendations are always traceable to a point in time.
2. Produce an **educational screening-risk baseline** from routine clinical measurements, explicitly scoped as a coarse, non-diagnostic indicator (see §4.3), not a real T2D management predictor.
3. Let users run **what-if simulations** ("what if my BMI dropped by 2 over 12 weeks?") against their own digital twin and see a projected risk trajectory, with the projection method fully transparent and cited.
4. Ground all generated advice in retrievable public-domain evidence (RAG) rather than un-sourced LLM output.
5. Gate every clinically-sensitive output — screening results, care plans, simulations, chat replies — through a **Safety/Clinician-Review Agent** that enforces disclaimers, blocks out-of-scope medical claims, and logs an auditable review trail.
6. Demonstrate a genuinely **agentic** architecture: multiple cooperating agents with distinct roles, explicit shared state, and a visible reasoning/trace.
7. Handle only synthetic or already-public de-identified data.

## 3. System Architecture

```
                          ┌─────────────────────────────┐
                          │      React Frontend (Vite)    │
                          │ Intake · Timeline · Simulator │
                          │ · Care Plan · Chat · Trace     │
                          └───────────────┬───────────────┘
                                          │ REST / JSON
                          ┌───────────────▼───────────────┐
                          │       FastAPI Backend (API)     │
                          │ routers: twin, screening, sim,  │
                          │ careplan, chat, agents           │
                          └───────────────┬───────────────┘
                                          │
                          ┌───────────────▼───────────────┐
                          │        Orchestrator Agent       │
                          │  (LangGraph state machine)      │
                          └──┬──────┬───────┬───────┬───┬───┘
                             │      │       │       │   │
      ┌──────────────┐      │      │       │       │   │      ┌───────────────┐
      │ Patient       │◄─────┘      │       │       │   └─────►│ Conversational │
      │ Digital Twin  │             │       │       │          │ Agent (Ollama) │
      │ (event-sourced│      ┌──────▼───┐ ┌─▼─────┐ │          └───────┬───────┘
      │ timeline;     │      │Screening │ │Evidence│ │                  │
      │ SQLite)       │      │Risk      │ │(RAG)   │ │                  │
      │               │      │Baseline  │ │Agent   │ │                  │
      │ read/append   │      │Agent     │ │(Chroma)│ │                  │
      │ by all agents │      │(sklearn, │ └────┬───┘ │                  │
      └──────┬────────┘      │educational│      │    │                  │
             │                │only)     │      │    │                  │
             │                └────┬─────┘      │    │                  │
             │                     │             │    │                  │
             │   forks (no write)  │             │    │                  │
             ├─────────────────────┤             │    │                  │
             │              ┌──────▼──────┐      │    │                  │
             │              │ What-if      │      │    │                  │
             │              │ Simulation   │◄─────┘    │                  │
             │              │ Agent        │           │                  │
             │              └──────┬──────┘            │                  │
             │                     │                    │                  │
             │              ┌──────▼──────┐      ┌──────▼───────┐          │
             └─────────────►│ Care-Plan    │      │              │◄─────────┘
                             │ Agent        │      │              │
                             └──────┬──────┘      │              │
                                    │              │              │
                    ┌───────────────▼──────────────▼──────────────▼───────┐
                    │         Safety / Clinician-Review Agent               │
                    │  policy-driven gate (safety_policies.yaml) on every   │
                    │  high-stakes output → APPROVED / FLAGGED / BLOCKED    │
                    │  writes append-only safety_audit_log                  │
                    └───────────────────────────┬───────────────────────────┘
                                                 │
                                     Response + trace + safety
                                     status returned to frontend
```

**Why this shape:** the Digital Twin is a *state layer*, not an LLM agent — it's the single source of truth every other agent reads from and (except the simulator) appends to. The What-if Simulation Agent forks a copy of the twin's current state rather than writing to it, so hypothetical exploration can never contaminate real patient history. The Safety Agent is not optional or advisory — architecturally it sits between every high-stakes agent and the response the user actually sees, so nothing clinically sensitive reaches the UI unreviewed.

## 4. Agent & Service Specifications

### 4.1 Orchestrator Agent
- **LangGraph** `StateGraph` (free, MIT-licensed, local). Shared state carries: patient id, the relevant twin snapshot, screening result, retrieved evidence, simulation output, draft care plan, conversation history, and a `trace: list[str]` log — shown to the user on the Agent Trace screen.
- Routing is deterministic, not LLM-decided, for reliability: intake → Screening → Evidence → Care-Plan → Safety Gate; simulation requests → Twin fork → What-if Agent → Safety Gate; chat messages → Conversational Agent (which can call Evidence/Screening/What-if as tools) → Safety Gate.

### 4.2 Patient Digital Twin (state service, not an agent)
- **Event-sourced timeline**: every measurement, lifestyle log entry, screening result, care plan, or simulation is appended as an immutable, timestamped `timeline_event` row — never overwritten. A patient's "current state" is a materialized view (latest value per field) computed on read.
- Because history is append-only, the UI can show a real timeline (weight trending down, glucose readings over months) and every screening/care-plan output stays traceable to *exactly* the twin state it was computed from.
- The What-if Simulation Agent forks a snapshot of this state (copy-on-write) to run hypothetical projections — those projected points are stored in a separate `simulations` table tagged `simulated: true` and are never merged into the real timeline.

### 4.3 Screening Risk Baseline Agent (renamed & reframed from "Risk Prediction")
- Wraps a **scikit-learn** classifier trained offline on the CDC's 2015 BRFSS Diabetes Health Indicators survey (253,680 records, 21 features) — see §13.7 for why this replaced the project's original Pima Indians Diabetes Dataset model.
- **Explicit reframing per project scope:** this agent is deliberately *not* presented as a Type 2 Diabetes management predictor. It outputs a **screening-risk indicator** only — a coarse Low/Moderate/High banding meant to illustrate how a classical ML classifier behaves on routine health-survey answers, using self-reported 2015 US telephone-survey data with its own biases (recall accuracy, non-response, telephone-survey coverage). Every response from this agent carries a fixed disclaimer string and a `scope: "educational_screening_only"` field that the Safety Agent checks for.
- **Eligibility check (important correctness constraint):** unlike the project's original Pima-based model, BRFSS applies to the general adult population, so there is no demographic restriction on who can be screened. The real constraint is **data completeness** — the model needs all 21 of its trained inputs, and BRFSS's "Sex" question was coded as binary (female/male) with no other option recorded, so the model has no encoding for anything else. The agent therefore checks, before scoring, that (a) `patient.sex` is `"female"` or `"male"`, and (b) every required field is on file. If either check fails, it does **not** force a prediction — it returns a structured `unavailable_for_profile` response naming exactly what's missing, and the orchestrator/UI surface that explanation instead of a risk score. The synthetic demo-patient generator intentionally creates both a fully-recorded profile and one with a deliberately incomplete history so this path is exercised and visible in the demo, not hidden.
- It still returns probability + risk tier + top contributing features (feature importances) for eligible profiles — useful for the pedagogical goal (showing an interpretable ML pipeline) without implying clinical validity or general applicability.

### 4.4 Evidence Retrieval Agent (RAG)
- Local knowledge base from CDC "Diabetes Basics" / WHO diabetes fact sheet (public-domain / freely reproducible with attribution). Chunked + embedded with local **sentence-transformers** (`all-MiniLM-L6-v2`), stored in embedded **ChromaDB**. Returns top-k cited chunks; downstream agents must quote/cite rather than paraphrase freely.

### 4.5 What-if Simulation Agent *(new)*
- Takes the patient's current twin state + a structured hypothesis, e.g. `{"bmi_delta": -2, "horizon_weeks": 12}` or `{"smoker_delta": -1, "horizon_weeks": 12}` (a small natural-language parser maps phrases like "what if I lost weight and exercised more" to these structured deltas; unrecognized phrasing asks the user to pick from preset scenarios). `smoker_delta` and `activity_minutes_delta` act on binary flags in the trained model (see §13.7) rather than scaling a continuous quantity.
- Applies a **transparent, documented delta model** (`backend/app/agents/simulation_rules.py` — e.g. clinically-cited weight-loss-to-BMI conversion, gradual-vs-linear change curves) to project a *sequence* of synthetic future feature vectors across the horizon (e.g. weeks 0/4/8/12).
- Re-runs the Screening Risk Baseline Agent's model on each projected vector, producing a **risk trajectory** (not a single number) that the frontend plots as a line chart alongside the current baseline.
- Every simulation output is labeled "simulated projection, not a clinical forecast" and routed through the Safety Agent, which specifically flags unrealistically large projected risk swings for review.
- This is a counterfactual/sensitivity-analysis technique built entirely from the already-trained screening model plus an explicit, inspectable rule table — no additional black-box model, so it stays explainable and free to build.

### 4.6 Care-Plan Recommendation Agent
- Rules-driven core (`careplan_rules.py`): risk tier + patient profile → diet focus, activity target, monitoring frequency, follow-up interval. Optionally phrased more naturally by the local LLM, always citing Evidence Agent sources. Can incorporate a What-if scenario's target state ("plan to reach a Moderate-risk projection") when the user asks for one.

### 4.7 Conversational Assistant Agent
- Small **local, open-source LLM via Ollama** (e.g. `llama3.2:3b` or `phi3:mini`) — free, local, no API key. System prompt restricts it to lifestyle/education topics, requires citing Evidence Agent snippets for factual claims, and forbids diagnostic or medication-dosage language (enforced again downstream by the Safety Agent as a second line of defense). Falls back to a rule-based FAQ responder if Ollama isn't installed, documented in the README.

### 4.8 Safety / Clinician-Review Agent *(new)*
- A **policy-driven gate**, not a free-text LLM judge (for reliability/reproducibility in grading): rules are declared in `backend/app/agents/safety_policies.yaml` — e.g. block diagnostic phrasing ("you have diabetes"/"you are diabetic"), block medication or dosage suggestions, require the `educational_screening_only` disclaimer to be present on every Screening/Simulation output, flag High risk-tier results and any simulation projecting a swing beyond a configured threshold for mandatory "recommended: review with a clinician" banners.
- Every agent output that reaches the Safety gate is scored **APPROVED / FLAGGED_FOR_CLINICIAN_REVIEW / BLOCKED**. FLAGGED content is still shown with a visible banner and reasons; BLOCKED content is replaced with a safe fallback message and never shown as-is.
- Writes every decision to an append-only `safety_audit_log` table (target type/id, status, reasons, policy version, timestamp) — gives the project a genuine governance/auditability story for the report, mirroring how real clinical-AI systems are expected to log review decisions.

## 5. Data Sources & Ethics

| Data | Source | Notes |
|---|---|---|
| Screening baseline training data | CDC BRFSS 2015 Diabetes Health Indicators survey (UCI ML Repository #891) | Public domain — U.S. government work (17 U.S.C. §105), de-identified survey responses, no PII. **Used only as an educational screening-risk baseline** — explicitly not presented as a general or clinical T2D management predictor (see §4.3, §12). Replaced the project's original Pima Indians Diabetes Dataset training source; see §13.7. |
| Knowledge base text | CDC "Diabetes Basics" (U.S. government work, public domain under 17 U.S.C. §105); WHO "Diabetes" fact sheet | CDC text is public domain. **WHO material is copyrighted and is used with attribution under WHO's applicable copyright/permissions policy** (https://www.who.int/about/policies/publishing/copyright) — it is not public domain, so the project stores the source URL, access date, and a short-excerpt/attribution notice alongside every WHO-derived chunk in the vector store metadata, rather than treating it as freely reproducible. |
| Demo "patients" & timelines | Synthetically generated (`backend/app/ml/synthetic_patients.py`), including multi-timepoint synthetic histories for the Digital Twin demo | Fictional, realistic clinical ranges, never real patient data. |
| Simulation projections | Derived, not observed | Clearly labeled `simulated: true`, stored separately from the real timeline. |

Every risk/simulation/care-plan screen carries a visible "Educational prototype — not medical advice, not a diagnostic device" banner; the Safety Agent enforces this at the API layer as well, not just in the UI, so it can't be bypassed by a different frontend calling the same API.

## 6. Technology Stack (free / open-source, with one optional exception — §13.4)

| Layer | Choice | Why |
|---|---|---|
| Backend framework | FastAPI + Uvicorn | Async, auto OpenAPI docs, plays well with ML libs |
| ORM / DB | SQLAlchemy + **SQLite** | Embedded, ships with Python, zero install and zero configuration — the database file is created on first run. Chosen so the project runs with `pip install` alone, with no server or container runtime for a grader to set up. Postgres/JSONB was considered; see §12 for the tradeoff. |
| ML | scikit-learn (RandomForest baseline) + XGBoost (candidate, §13.10) + SHAP (explainability) | Standard, explainable, free |
| Agent orchestration | LangGraph | Open-source, explicit graph/state, good for showing agentic + safety-gate design |
| Embeddings | sentence-transformers (`all-MiniLM-L6-v2`) | Local CPU inference, free |
| Vector store | ChromaDB (embedded mode) | Local, open-source, no server |
| LLM (chat) | Ollama + open model (llama3.2 / phi3) | Free, local, no API cost |
| Policy config | PyYAML | Human-readable, versionable safety policy file |
| Frontend | React + Vite + TypeScript | Fast dev loop, modern |
| Charts | Recharts | Free; used for both timeline and simulation trajectory charts |
| Testing | pytest, Vitest/RTL | Free, standard |

No component requires a paid API key, subscription, or license — with the
single, optional, disabled-by-default exception of the hosted Mistral chat
backend described in §13.4. The system runs fully offline without it.

## 7. Data Model (SQLite)

- **patients**: id, pseudonym, age, sex (`female`/`male`/`other`/`unspecified`), screening_eligible (bool, derived: `sex in ("female", "male")` — a structural check only; per-request data completeness is checked separately at scoring time, see §4.3), created_at
- **timeline_events** *(the Digital Twin)*: id, patient_id (FK), event_type (`measurement`/`lifestyle_log`/`screening`/`care_plan`/`chat`/`note`/`medication_change`/`lab_result` — the last two added in Phase 2, §13.9), payload (JSON), recorded_at (timestamp), source (`real`/`synthetic`)
- **screening_assessments**: id, patient_id (FK), timeline_event_id (FK), status (`scored`/`unavailable_for_profile`), risk_probability (nullable), risk_tier (nullable), unavailable_reason (nullable), top_features (JSON), model_version, scope (`educational_screening_only`), created_at
- **simulations**: id, patient_id (FK), base_timeline_event_id (FK, the twin state it forked from), hypothesis (JSON), projected_trajectory (JSON list of `{week, risk_probability, risk_tier}`), created_at — simulations also require an eligible profile, same rule as screening
- **care_plans**: id, patient_id (FK), screening_assessment_id (FK, nullable), simulation_id (FK, nullable), diet_focus, activity_target, monitoring_frequency, follow_up_weeks, narrative_text, sources (JSON), created_at
- **chat_sessions** / **chat_messages**: id, patient_id (nullable FK), role, agent_name, content, sources (JSON), created_at
- **safety_audit_log**: id, target_type, target_id, status (`APPROVED`/`FLAGGED_FOR_CLINICIAN_REVIEW`/`BLOCKED`), reasons (JSON), policy_version, reviewed_at

JSON columns use SQLAlchemy's generic `JSON` type (`app/models/types.py`), which SQLite stores as TEXT and transparently serialises to and from Python dicts and lists. Payloads are therefore readable and round-trip correctly, but are not indexable or queryable by key — see the §12 tradeoff note.

## 8. API Surface (FastAPI)

- `POST /api/patients` — create a patient (or synthetic demo patient with a generated history)
- `POST /api/twin/{patient_id}/events` — append a timeline event (measurement, lifestyle log, note, medication change, lab result)
- `GET /api/twin/{patient_id}/timeline` — full timestamped history (the digital twin view)
- `GET /api/twin/{patient_id}/digital-twin` *(Phase 2, §13.9)* — structured aggregate view: patient, clinical, laboratory, medications, lifestyle, timeline
- `GET /api/twin/{patient_id}/labs/{test_name}` *(Phase 2, §13.9)* — latest value, full history, and trend label for one lab test (e.g. HbA1c)
- `POST /api/screening/run` — Screening Risk Baseline Agent on current twin state → probability + tier + disclaimer, gated through Safety
- `POST /api/simulate` — What-if Simulation Agent: `{patient_id, hypothesis}` → risk trajectory, gated through Safety
- `POST /api/careplan/generate` — Care-Plan Agent (from a screening assessment or a simulation target)
- `POST /api/chat` — Conversational Agent (orchestrated; may call Evidence/Screening/What-if as tools), gated through Safety
- `POST /api/agents/run` — full orchestrated pipeline for a patient, returns complete agent trace + safety statuses (demo/grading endpoint)
- `GET /api/safety/audit-log` — read the safety review audit trail (admin/grading view)
- `GET /api/ml/comparison` *(Phase 3, §13.10)* — actual measured RandomForest-vs-XGBoost test metrics, computed live from both persisted artifacts
- `POST /api/ml/xgboost/predict` *(Phase 3, §13.10)* — scores a patient's twin state with the XGBoost candidate model; comparison-only, not Safety-gated, not the production model
- `POST /api/evidence/search` *(Phase 4/5, §13.11/§13.12)* — direct query into the Evidence Agent/RAG store; read-only, not Safety-gated (retrieves fixed, pre-vetted CDC/WHO content or live PubMed metadata, not generated text). `source` (`local`/`pubmed`/`all`, default `local`) added in Phase 5 — backwards compatible, existing `{"query": "..."}` requests unaffected
- `POST /api/clinical/analyze` *(Phase 6/7, §13.13/§13.14)* — the Clinical Analysis Agent, run through the Orchestrator (`mode="clinical"`) so it is Safety-gated like every other clinically-sensitive endpoint; composes Digital Twin + RandomForest + XGBoost (optional) + local/PubMed evidence (optional) + Simulation (optional) into a structured, cited analysis. Phase 7 wired this into the frontend (`/clinical-analysis`, React) — the first UI for it
- `GET /api/health` — liveness check

## 9. Frontend Pages

1. **Patient Intake** — create/select patient, or load a synthetic demo patient with pre-seeded history
2. **Digital Twin Timeline** *(new)* — chronological view of all recorded events (measurements, screenings, plans, simulations) for a patient
3. **Screening Dashboard** — probability gauge, risk tier badge, contributing-factor chart, permanent educational-scope disclaimer
4. **What-if Simulator** *(new)* — pick/compose a hypothesis, view the projected risk trajectory as a line chart next to the current baseline, with the delta model's assumptions shown inline
5. **Care Plan** — generated plan with cited sources
6. **Chat** — conversational assistant with source citations per message
7. **Agent Trace & Safety Log** *(expanded)* — timeline of which agent ran, in what order, plus each output's Safety status (APPROVED/FLAGGED/BLOCKED) and reasons — the "show your work" screen for both the agentic architecture and the governance layer
8. **Clinical Analysis** *(Phase 7, §13.14)* — ask a free-text clinical question, choose which of evidence/PubMed/model comparison/simulation to include, and view the structured result: patient observations, production-vs-candidate model analysis, model feature contributions, numbered expandable evidence citations, integrated analysis, uncertainty/limitations, and the same Safety banner every other page uses. Also the first page to surface the Phase 2 Digital Twin/lab-trend endpoints (`GET /api/twin/{id}/digital-twin`, `GET /api/twin/{id}/labs/{test_name}`) — built then, never called by the frontend until now

## 10. Project Structure

```
medgenesis/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── database.py
│   │   ├── models/                 # ORM: patients, timeline_events, screening_assessments,
│   │   │                           #      simulations, care_plans, chat, safety_audit_log
│   │   ├── routers/                # patients, twin, screening, simulate, careplan, chat, agents, safety
│   │   ├── ml/                     # training script, model artifact, synthetic_patients.py
│   │   ├── agents/                  # orchestrator.py (LangGraph), screening_agent.py,
│   │   │                           #   evidence_agent.py, simulation_agent.py, simulation_rules.py,
│   │   │                           #   careplan_agent.py, careplan_rules.py, conversational_agent.py,
│   │   │                           #   safety_agent.py, safety_policies.yaml
│   │   └── services/                # rag.py (Chroma), llm.py (Ollama client), twin.py (event sourcing helpers)
│   ├── data/                       # diabetes_health_indicators_brfss2015.csv, knowledge_base/*.md
│   ├── tests/
│   ├── medgenesis.db               # SQLite database, created on first run (gitignored)
│   └── requirements.txt
├── frontend/
│   ├── src/ (pages/, components/, api/)
│   └── package.json
├── docs/
│   ├── ARCHITECTURE.md         # this document — design
│   ├── REPORT.md               # project report — results, findings, limitations
│   └── LEAKAGE.md              # worked analysis of the target-leakage bug
└── README.md
```

`DATABASE_URL` defaults to `sqlite:///./medgenesis.db` and only needs setting to relocate the database file (the test suite points it at a temporary path). Tables are created at application startup, so deleting the file resets the app to an empty state.

## 11. Build Plan / Milestones

1. Design doc (this document) ✅
2. Repo scaffold ✅
3. Prepare Pima dataset + preprocessing ✅ *(superseded — see §13.7: the project later switched to the CDC BRFSS dataset and `pima.csv` was removed)*
4. Train & evaluate screening-risk baseline model (explicitly scoped, disclaimer built into output schema) ✅
5. FastAPI core + Digital Twin service (event-sourced `timeline_events`, patient endpoints) ✅
6. RAG knowledge base (public-domain text → Chroma) ✅
7. Safety/Clinician-Review Agent + policy file + audit log (built early so every later agent output can be gated through it) ✅
8. LangGraph orchestration: Screening, Evidence, Care-Plan, Conversational agents wired through the Safety gate ✅
9. What-if Simulation Agent (delta model + trajectory projection + Safety gating) ✅
10. React frontend: 7 pages above, wired to the API ✅
11. README + setup docs + disclaimers ✅
12. End-to-end smoke test and delivery ✅
13. Semantic RAG enabled + natural-language what-if input implemented (§13.5, §13.6) ✅
14. Training dataset switched from Pima to CDC BRFSS, with the full downstream redesign (§13.7) ✅

## 12. Limitations (worth stating explicitly in a college report)

- The BRFSS dataset is **self-reported survey data, not lab measurements or a diagnosis** — every field is a telephone-survey answer, subject to recall accuracy, non-response, and telephone-survey coverage bias. The trained model is used **only as an educational screening-risk baseline** to demonstrate an interpretable ML pipeline — it is explicitly not presented, marketed, or validated as a general or clinical Type 2 Diabetes management predictor, and every output carries that disclaimer both in the UI and in the API response schema.
- **Low precision, by design tradeoff.** The served model reaches test ROC-AUC 0.818 with recall 0.774 but precision only 0.330 (see §13.7) — most "elevated risk" flags would be false positives. This comes from class-weight-balancing toward not missing positive cases (prediabetes + diabetes are only ~16% of respondents), a defensible choice for a screening tool, stated plainly rather than hidden behind the headline ROC-AUC.
- **23,899 duplicate rows (~9.4% of the dataset) were kept, not dropped** — with 17 of 21 features binary and the rest small-cardinality buckets, distinct real respondents sharing an identical answer profile is expected, and there is no principled way to separate a "real" duplicate from a collection artifact.
- The What-if Simulation Agent's delta model is a transparent, documented heuristic (not a validated physiological/clinical simulation model); projected trajectories illustrate sensitivity of the screening score to hypothetical changes, not a forecast of real clinical outcomes.
- The Safety Agent's policy rules are a teaching implementation of a governance pattern, not a substitute for real clinical-AI regulatory review.
- The conversational agent's local LLM is small (3–4B parameters) to stay free/local-friendly, so response quality is more limited than a large hosted model — mitigated by RAG grounding, narrow scope, and Safety-Agent gating.
- **SQLite was chosen over PostgreSQL, and that is a real tradeoff.** This
  document originally specified Postgres with `JSONB` payload columns, which
  would give indexable and queryable JSON, proper concurrent access, and a
  more production-realistic story for an event-sourced timeline. SQLite was
  chosen instead because it is embedded in Python: the project runs with
  `pip install -r requirements.txt` and nothing else — no database server to
  install, no container runtime, no credentials for a grader to configure.
  What is given up: JSON payloads are stored as TEXT and cannot be queried or
  indexed by key (the app reads whole payloads and folds them in Python
  instead), and concurrent writers would contend on a single file lock at any
  real scale. For a single-user educational prototype neither limitation is
  felt, and because the schema is plain SQLAlchemy, moving to Postgres would
  mean changing a connection string and one column type — not the model layer.
- This is a prototype for coursework/demonstration, not a validated clinical tool.

## 13. Implementation notes — where the build departed from this design

Four decisions were changed or added while building. Each is recorded here
because the reasoning matters more than the design doc's original wording.

### 13.1 Imputation strategy changed (target leakage) — historical, see §13.7

This section describes a finding on the project's *original* Pima-based
training pipeline. The dataset that replaced it (§13.7) has zero nulls and
needs no imputation step at all, so the specific mechanism below no longer
exists in the active training script — it is kept for the general lesson,
which is not dataset-specific.

§4.3 originally specified **per-outcome median imputation**, fitted on the
train split only. The train/test hygiene was correct, but per-outcome
imputation leaks the *target*: 49% of `Insulin` values are missing, and
filling them with the median of their own outcome class assigns exactly
`100.0` (outcome 0) or `168.0` (outcome 1) — the label, re-encoded as a
feature. Test ROC-AUC inflated 0.813 → 0.941 and Insulin's importance rose
0.066 → 0.409, while the model became non-monotonic in insulin.

The training script now fits **both** strategies and always serves the
leak-free `plain` one, keeping the comparison in the model metadata as a
teaching artifact. Two tests prevent the leaky model from being served.
Full write-up: [LEAKAGE.md](LEAKAGE.md).

### 13.2 Screening and care plan are gated separately

The design implied one safety verdict per pipeline run. In the built system
the intake route gates the screening result **and** the care plan as two
independent audited events, then merges them into an overall verdict
(most-severe wins). A single merged row could not answer "was the screening
result itself reviewed?", which is the question an audit log exists for.

### 13.3 Every optional dependency has a working fallback

So the project is gradeable on a clean machine with no extra installs (the datastore needs no fallback at all — SQLite is embedded):

| Component | Primary | Fallback |
|---|---|---|
| Evidence retrieval | ChromaDB + sentence-transformers (installed and verified — see §13.5) | Deterministic keyword ranker with synonym expansion + light stemming |
| Conversational agent | Mistral API → Ollama | Rule-based responder over the same cited KB |

The active backend for each is reported by `/api/health` and shown in the UI
sidebar, so a fallback is never mistaken for the primary path.

### 13.4 A hosted LLM backend was added (constraint exception)

An optional **Mistral API** backend was added at the project owner's request.
It is a **paid hosted service** and therefore the one component that departs
from the project's free/open-source constraint. It is strictly optional,
disabled by default (blank `MISTRAL_API_KEY`), and every other agent —
screening, simulation, evidence, care-plan rules, safety gate — is
deterministic and runs fully offline. Credentials are read from the
environment only; `backend/.env` is gitignored and `.env.example` carries
placeholders.

### 13.5 Semantic RAG was enabled, and a second real bug was found in it

§13.3 above describes the keyword ranker as a *fallback* — it was, for a
while, also the *default*, because the semantic backend was never installed.
Once `chromadb` and `sentence-transformers` were actually installed and
exercised, retrieval initially produced scores like `-0.605` and `-0.391` for
correct top-1 matches: implausible, since cosine similarity is bounded in
roughly [-1, 1] and a genuinely relevant match should score positive.

The cause: Chroma creates new collections with raw squared-L2 distance by
default, not cosine. `ChromaStore` was computing `score = 1.0 - distance` —
correct arithmetic for cosine distance, meaningless for unbounded L2. Ranking
itself (which Chroma computes internally from its own distance metric,
regardless of this post-hoc score) still returned sensible results for easy
queries, which is what let the bug hide. Fixed by setting
`metadata={"hnsw:space": "cosine"}` explicitly at collection creation — it
cannot be changed on an existing collection, so old ones must be rebuilt.
`tests/test_rag.py::TestChromaStore::test_scores_are_plausible_cosine_similarities`
regression-guards this.

With that fixed, a 12-query head-to-head against the keyword ranker (6
queries with literal keyword overlap, 6 rephrased with none) gave an honest,
modest result — not a dramatic win:

| | Top-1 correct | Top-3 correct (recall) |
|---|---|---|
| Keyword ranker | 10/12 | 11/12 |
| Semantic (Chroma, cosine) | 10/12 | 12/12 |

Top-1 precision tied. The real, defensible difference is recall: the
semantic backend never returned a total miss, including for phrasing with
**zero literal keyword overlap** with the source text (e.g. "what are the
warning signs I should watch for" → *Symptoms*), which is structurally the
class of query no amount of synonym-table tuning can fix for a keyword
ranker. It also has a genuine weakness the keyword ranker doesn't: "should I
check my blood sugar at home" ranked *Diagnosis and screening* above the
more specific *Blood sugar monitoring*, which the keyword ranker's literal
"blood sugar" match got right immediately. Both backends are real
options now, selected automatically by whichever import succeeds — see §13.3.

### 13.6 Natural-language what-if input (§4.5) was implemented

The free-text parser (`app/agents/simulation_nlp.py`) is a **deterministic
regex/keyword extractor, not an LLM** — consistent with the rest of this
agent's design, where every number traces to an inspectable rule
(`simulation_rules.py`). An LLM turning "lost weight" into a specific
kilogram figure would invent a number with no basis; this parser instead
substitutes a fixed, documented default (matching the frontend's preset
scenarios) and discloses that substitution in the same `assumptions` list
the delta model already returns.

One implementation detail worth recording: the horizon phrase must be
extracted and stripped from the text *before* per-topic magnitude parsing
runs. Without that ordering, "what if I exercised more over 12 weeks" would
have the horizon's "12" read as an activity-minutes magnitude, since both
extraction passes would be competing for the same number in the same
string. `test_horizon_number_is_not_mistaken_for_a_magnitude` regression-
guards this specifically.

Text that doesn't map confidently to a topic + direction is reported as
unrecognized (`recognized=False`) with guidance toward the preset scenarios,
never silently defaulted to an empty simulation — matching the spec's
"unrecognized phrasing asks the user to pick from preset scenarios."

### 13.7 The training dataset was switched from Pima to CDC BRFSS

Requested mid-build, as an extension of the original screening baseline
work. The request was to add "10,000 more entries" to the training data.
That surfaced a fact worth stating plainly: the **Pima Indians Diabetes
Dataset is fixed at exactly 768 rows** — a specific historical collection,
not something with an official larger version. Any addition would have had
to be fabricated, which would have quietly falsified the entire leakage
writeup and the "matches published Pima baselines" comparison in the report
— both built on this being real, unmodified UCI data. Rather than pad the
dataset with synthetic rows, the project switched to a different, larger,
**still-real** public dataset: the **CDC's 2015 BRFSS Diabetes Health
Indicators survey** (253,680 responses, UCI ML Repository #891), already
present on the development machine and public domain as a U.S. government
work — the same legal status as the CDC "Diabetes Basics" text already
cited in the knowledge base. `pima.csv` has been deleted; nothing in the
active codebase reads it. Its target-leakage finding is preserved in full in
[LEAKAGE.md](LEAKAGE.md) as a general lesson, not a claim about the current
model.

**This changed more than the training data.** Three cascading redesigns,
each verified against real data before being written down here:

**Eligibility gating.** Pima consists exclusively of women of Pima Heritage
and includes "number of pregnancies" as a trained feature, so the original
model hard-gated on `sex == "female"`. BRFSS surveys the general adult
population — there is no equivalent demographic restriction, so that gate is
gone. What replaced it is a **data-completeness check**: BRFSS's "Sex"
question was coded as binary with no other option recorded, so the model
still can't score a patient whose sex isn't female/male, and it needs all 21
trained fields present. The demo profile that used to be "ineligible because
male" is now "ineligible because incomplete" — a male patient is fully
eligible; a profile missing a few required fields is not. See §4.3.

**The simulation hypothesis space.** BRFSS is a survey, not a lab panel — it
has no blood-glucose field at all, so `glucose_delta` (a hypothesis
dimension in the Pima-era simulator) has nothing to act on and was removed.
`PhysActivity` and `Smoker` are also recorded as binary yes/no answers, not
continuous quantities. `activity_minutes_delta` and the new `smoker_delta`
now move a target flag toward 0 or 1 (any positive value means "become
active" / "start smoking," any negative means the opposite) rather than
scaling a continuous effect — the sign is what matters, not the magnitude.
For the projected-trajectory chart to still read as a smooth line rather
than a step function, intermediate weeks interpolate a `[0, 1]` proxy toward
the target; this is a display simplification, disclosed as an assumption in
the API response, not a claim that a real intermediate state exists. Probed
against the trained model before shipping: a BMI change moves the risk score
substantially (a −6 BMI swing on the moderate-risk demo profile moves it
from 59% to 47%), while flipping `PhysActivity` or `Smoker` alone moves it by
only ~0.005–0.01 — a real, small, honestly-reported effect size, not a bug
to paper over.

**Feature set and demo profiles.** All 21 BRFSS columns are used (matches
published usage of this dataset rather than an arbitrary subset), which
meant rebuilding the patient intake form around checkboxes and dropdowns for
conditions, lifestyle, healthcare access, and socioeconomic fields instead of
Pima's seven clinical-measurement inputs. The three demo profiles were
re-tuned against the actually-trained model (not guessed at) to land in
visibly different tiers: Low (5.6%), Moderate (59.4%), and a third profile
with a deliberately incomplete history to exercise the refusal path.

**Model comparison** (both trained the same way — stratified split, 5-fold
CV, logistic regression vs. random forest, `class_weight="balanced"`):

| | Pima (768 rows, 8 features) | BRFSS (253,680 rows, 21 features) |
|---|---|---|
| Algorithm selected | logistic regression | random forest |
| Test ROC-AUC | 0.813 | 0.818 |
| Test recall | 0.500 | 0.774 |
| Test precision | 0.600 | 0.330 |
| Top feature | Glucose | GenHlth |

Recall improved substantially; precision dropped in exchange — a real
tradeoff from class-balancing against a dataset where positive cases are a
smaller share (~16%) than Pima's (~35%), reported plainly rather than
picking whichever number looks best.

Switching datasets also surfaced a second real bug, this time in the RAG
backend rather than the model — see §13.5.

### 13.8 MedGenesis extension: Phase 1 (repository/architecture scaffolding)

The project owner requested extending this system toward a broader
"MedGenesis" specification (structured clinical decision-support framing,
XGBoost model comparison, PubMed-grounded evidence, a Clinical Analysis
Agent, MCP tool access) while explicitly rejecting a rewrite: the existing
FastAPI/SQLite/React+Vite/scikit-learn stack — and its 107 passing tests —
stays, and the new capabilities are added on top, incrementally, phase by
phase. Phase 1 is repository/architecture setup only: extension points, not
functioning features. The distinction below is deliberate and load-bearing —
none of the "planned" items exist yet, and nothing in this codebase should
be read as claiming otherwise.

**Implemented now:**

- `app/ml/xgboost_model/` — package skeleton (`config.py`, `preprocessing.py`,
  `train.py`, `predict.py`, `evaluate.py`, `artifacts/`) with its own artifact
  directory, kept separate from the RandomForest's `app/ml/artifacts/` so
  neither model's files can ever collide. Every function raises
  `NotImplementedError` — no training, no fabricated metrics, no placeholder
  model files.
- `app/agents/clinical_agent.py` — `ClinicalAnalysisAgent` skeleton following
  the exact conventions of the six existing agents (dataclass result,
  `.run()`, module-level singleton getter). `.run()` raises
  `NotImplementedError`; no LLM reasoning or medical prompts exist yet.
- `app/services/pubmed.py` — a `PubMedClient` protocol plus a
  `NotConfiguredPubMedClient` default implementation, mirroring the
  try-a-real-backend-then-fall-back pattern already used by `services/rag.py`
  and `services/llm.py`. No live NCBI E-utilities calls are made; `.search()`
  raises `NotImplementedError` rather than returning an empty or fabricated
  result. `PubMedArticle` (the citation-metadata dataclass) is real, working
  code — only retrieval is a stub.
- `models/timeline.py` — `EVENT_TYPES` extended with `medication_change` and
  `lab_result`. Confirmed compatible before changing anything: `event_type`
  is a plain `String(30)` column with no DB-level enum or CHECK constraint,
  so this is a pure Python-level validation-tuple addition, not a schema
  migration. Deliberately **not** added to `services.twin.STATE_EVENT_TYPES`
  (the tuple that decides what folds into the materialized "current state"
  view) — how medication history and lab results should materialize is a
  real modeling decision, left for whichever phase first consumes them
  rather than decided as scaffolding.
- `.env.example` — `PUBMED_API_KEY` / `PUBMED_EMAIL` documented as planned,
  unused variables.
- 18 new scaffolding tests (`tests/test_phase1_scaffolding.py`) — confirm
  every stub is an honest `NotImplementedError` (not a silent no-op),
  confirm the RandomForest artifacts and inference path are byte-for-byte
  untouched, and confirm the new event types work end-to-end through the
  one existing Digital Twin service.

**Explicitly not implemented — planned for later phases:**

- XGBoost training, evaluation, or a RandomForest-vs-XGBoost comparison
  (Phase 4 in the MedGenesis phase list)
- Any live PubMed / NCBI E-utilities call (Phase 6)
- Clinical Analysis Agent reasoning or prompts (Phase 7)
- Extending `evidence_agent.py` to incorporate PubMed sources (Phase 6/7 —
  extending the existing agent, not a second Evidence Agent)
- Extending `simulation_agent.py` to score XGBoost-projected scenarios
  (Phase 8)
- New Safety Agent rules for the broader MedGenesis fabrication/medication-
  change/citation-consistency checks (Phase 9)
- Any change to `agents/orchestrator.py`'s routing — the existing three
  routes (intake/simulation/chat) are unchanged; a Clinical Analysis node
  will be introduced only once it does something (Phase 10)
- MCP tool exposure (`get_patient`, `run_risk_prediction`,
  `search_medical_evidence`, `search_pubmed`, `run_what_if`) — deferred until
  the underlying Python functions exist and are independently tested
  (Phase 13)
- Next.js frontend, PostgreSQL migration, Flask migration — not planned;
  Path B was chosen explicitly over a stack pivot (§13.7 established the
  precedent of switching only when something is genuinely broken, not to
  match a spec's named technology list when the existing choice already
  satisfies the underlying requirement)

### 13.9 MedGenesis extension: Phase 2 (Digital Twin lab/medication materialization)

Phase 2 expanded the Digital Twin to represent laboratory results (HbA1c
above all) and medication history, ahead of the future Clinical Analysis
Agent and XGBoost phases needing richer input than the flat measurement
fold. Full detail, including payload contracts, trend-labeling rules, and
worked examples, lives in `docs/DIGITAL_TWIN.md` — this entry records what
changed and why, matching the Phase 1 entry's format.

**Implemented now:**

- `services/twin.py` (the one Digital Twin service — no second one created)
  gained `validate_lab_result_payload()` / `validate_medication_payload()`,
  wired into `append_event()`, plus six new read functions:
  `get_lab_history`, `get_latest_labs`, `get_lab_trend`,
  `get_medication_history`, `get_current_medications`, and
  `get_structured_twin` (a nested aggregate built purely from the existing
  and new functions). `get_current_state()` is byte-for-byte unchanged —
  confirmed by a dedicated backwards-compatibility test.
- `schemas.TimelineEventCreate.event_type` widened to accept
  `medication_change` and `lab_result` (additive `Literal` change; the
  agent-internal types `screening`/`care_plan`/`chat` remain excluded from
  direct API posts, unchanged).
- Two new endpoints (§8): `GET /api/twin/{id}/digital-twin` and
  `GET /api/twin/{id}/labs/{test_name}`. The existing `/timeline` endpoint's
  response shape is unchanged.
- `ml/synthetic_patients.py`'s `moderate_risk` demo profile gained a
  synthetic 3-point HbA1c history and one Metformin `medication_change`
  event, so the new endpoints have a demo patient to show. The other two
  profiles are unaffected.
- 52 new tests (`tests/test_digital_twin_phase2.py`,
  `tests/test_digital_twin_api.py`) covering payload validation, trend
  labeling (including a meta-test that no hardcoded clinical threshold
  appears in the trend-labeling code), medication current/history folding,
  the structured view, and API-level backwards compatibility.

**Explicitly not implemented — planned for later phases:**

- Any classification of a lab value or medication as clinically
  significant, high/low/normal, or risk-relevant — the twin represents
  recorded data only; interpretation is deferred to the Clinical Analysis
  Agent (Phase 7)
- Folding `lab_result`/`medication_change` into `get_current_state()`'s flat
  fold — deliberately deferred (§13.8's reasoning still holds: this is a
  modeling decision for whichever agent first needs it, not scaffolding)
- Any ML feature transformer reading lab/medication history — the boundary
  between the Digital Twin and a model's feature vector is documented in
  `docs/DIGITAL_TWIN.md`, but the transformer itself belongs to the
  XGBoost training phase (Phase 4), which has not started
- `diabetes_type`, `diabetes_duration`, `daily_steps`, `diet_pattern`,
  `sleep` — considered and deliberately not added; nothing in the current
  architecture consumes them (see `docs/DIGITAL_TWIN.md`'s "Lifestyle
  information" section for the full reasoning)

### 13.10 MedGenesis extension: Phase 3 (XGBoost training, evaluation, explainability, RF comparison)

Phase 3 turned the Phase 1 XGBoost scaffolding (§13.8) into a real, trained
candidate model and compared it against the existing RandomForest baseline
on identical data. Full methodology, hyperparameters, actual measured
metrics, and the model-selection decision live in `docs/ML.md`
(and the pre-Phase-3 baseline audit in `docs/ML_BASELINE.md`) — this entry
records what changed and what's still deliberately absent, matching the
Phase 1/Phase 2 entries' format.

**Implemented now:**

- `app/ml/xgboost_model/{config,preprocessing,train,predict,evaluate}.py` —
  every Phase 1 stub replaced with a real implementation: loads the
  identical CDC BRFSS 2015 dataset/target/21-feature set as the
  RandomForest (imported from `train_screening_model.py`, not duplicated),
  same train/test split (`random_state=42`), a small fixed hyperparameter
  grid selected via a held-out validation split with early stopping, class
  imbalance handled via `scale_pos_weight`, real saved artifacts
  (`xgboost_model.joblib`, `xgboost_scaler.joblib`,
  `xgboost_model_metadata.json`).
- `app/ml/xgboost_model/explain.py` *(new)* — native gain-based feature
  importance plus an independent SHAP cross-check; both explicitly
  documented as "what the model weighted," not a causal medical claim.
- `app/ml/model_comparison.py` *(new)* — loads both models' persisted
  artifacts (never retrains either), reproduces the RandomForest's own test
  split to recover its confusion matrix/timing (not stored in its original
  metadata), self-checks that reproduction against the RandomForest's
  stored metadata before trusting it, and reports the actual measured
  comparison. Result: XGBoost measures modestly better on every metric
  (~0.7 ROC-AUC points) while its artifact is ~26× smaller and ~7.5× faster
  at inference — not assumed in advance, and not a large enough margin to
  automatically replace the production model (§13.10's "Model decision" in
  `docs/ML.md`).
- `app/routers/ml.py` + `GET /api/ml/comparison` / `POST
  /api/ml/xgboost/predict` (§8) — read-only, not Safety-gated, not
  persisted, entirely separate from `POST /api/screening/run`, which this
  phase left completely unmodified (confirmed by
  `tests/test_ml_api.py::TestProductionScreeningEndpointUnaffected`).
- A genuine dataset-integrity finding surfaced during this phase's Step 2
  audit: ~12.7% of the BRFSS test split's rows are exact duplicates
  (feature *and* label) of a row also present in the training split, a
  side effect of the dataset's many low-cardinality features combined with
  row-independent splitting. Documented in `docs/ML.md`'s "Dataset
  integrity" section along with why it was left uncorrected for this
  comparison (correcting it would require a different split than the one
  the RandomForest's own reported metrics were evaluated against, breaking
  the fairness requirement it exists to serve) rather than silently fixed.
- A real, reproducible macOS environment issue was found and fixed:
  `xgboost` and `torch` (pulled in by the RAG evidence agent) ship
  incompatible bundled OpenMP runtimes and segfault the test process if
  `torch` loads first. Fixed by importing `xgboost` first in
  `tests/conftest.py`, with the reproduction steps recorded in a comment
  there.
- 40 new/updated tests across `tests/test_xgboost_model.py` (new),
  `tests/test_ml_api.py` (new), and `tests/test_phase1_scaffolding.py`
  (five now-obsolete "is this a stub" assertions retired — the explicit
  goal of this phase was to make them stop being true — and replaced with
  two narrower ones for what's still true: the package imports cleanly and
  its artifacts stay isolated from the RandomForest's).

**Explicitly not implemented — planned for later phases:**

- Any change to which model is the default/production one — RandomForest
  remains the sole model behind `POST /api/screening/run`; model
  *selection* between the two was explicitly out of this phase's scope
  (Phase 3 Step 16)
- A lab/medication-aware XGBoost variant — the CDC BRFSS 2015 training
  dataset has no lab or medication columns at all, so there is nothing
  legitimate to train such a model against without fabricating labels,
  which is explicitly disallowed; see `docs/ML.md`'s "Digital Twin
  boundary" section
- Wiring the XGBoost candidate into the Orchestrator, Safety Agent, or any
  agent's reasoning — Phase 3 was ML-layer only, per its own explicit "do
  not implement" list (PubMed, RAG, Clinical Agent, What-if Agent, Safety
  Agent, MCP, frontend, database/framework migrations)
- MCP tool exposure for either model — still deferred to Phase 13 of the
  original MedGenesis phase list (§13.8)

### 13.11 MedGenesis extension: Phase 4 (medical evidence RAG and citation grounding)

Phase 4 audited and strengthened the one existing RAG implementation
(`app/services/rag.py`, `app/agents/evidence_agent.py`) — no second RAG
system, no second Evidence Agent, no PubMed integration. Full audit,
methodology, and actual measured retrieval numbers live in `docs/RAG.md` —
this entry records what changed and what's still deliberately absent,
matching the Phase 1-3 entries' format.

**Implemented now:**

- **`document_id`** added to `EvidenceChunk` — a stable, citable identifier
  (`{file}#{section-slug}`), propagated through both the keyword and Chroma
  backends (Chroma's collection metadata schema was version-bumped so an
  old on-disk collection is detected as stale and rebuilt, same mechanism
  as the earlier cosine-space fix, §13.5).
- **Centralized `DEFAULT_TOP_K = 3`** (`app/services/rag.py`) — the three
  existing call sites that each hard-coded `k=3` now share one constant.
- **Per-backend relevance thresholds**
  (`ChromaStore.MIN_RELEVANCE_SCORE = 0.15`,
  `KeywordStore.MIN_RELEVANCE_SCORE = 0.5`), empirically calibrated against
  this project's actual corpus and embedding model — an unmet threshold now
  returns "no sufficiently relevant evidence," not the nearest chunks
  regardless of relevance. The first calibration attempt (using only 5 easy
  probe queries) was too aggressive and broke an existing regression test
  for hard-paraphrase queries; caught by the test suite and corrected
  before being kept — see `docs/RAG.md`'s "Relevance threshold" section for
  the full before/after measurement.
- **`EvidenceChunk.citation_block`** / **`EvidenceAgent.
  format_citation_block()`** — the `[E1]/[E2]…` structured citation format,
  additive alongside the existing inline `citation` string.
- **Prompt-injection data/instruction boundary**
  (`app/agents/conversational_agent.py`) — explicit delimiters around the
  retrieved-sources block plus a system-prompt instruction that delimited
  text is never an instruction to obey. The only agent this applies to:
  `CarePlanAgent`'s LLM call never sees retrieved chunk text at all (it
  only rephrases an already-decided plan).
- **`app/services/retrieval_evaluation.py`** *(new)* — a 14-query
  deterministic evaluation set (every `expected_document_id` verified to
  exist in the real 17-chunk corpus) and Hit Rate@k/Precision@k/Recall@k/
  MRR. Measured, not fabricated: ChromaStore 14/14 hit rate (MRR 0.929),
  KeywordStore 12/14 (MRR 0.821) — a real, reproducible demonstration of
  the semantic backend's advantage on hard paraphrases.
- **`POST /api/evidence/search`** (`app/routers/evidence.py`) — the first
  direct API access to the Evidence Agent, independent of chat/care-plan/
  orchestrator; read-only, not Safety-gated, not persisted.
- 34 new tests (`tests/test_rag_boundaries.py`, `tests/test_evidence_api.py`)
  covering citation/metadata preservation, deduplication, the patient-
  context and model-output boundaries (both verified structurally, not
  just by convention), the prompt-injection boundary (with a clearly-
  labelled synthetic fixture, never a fabricated real source), and the
  evaluation module itself.

**Explicitly not implemented — planned for later phases:**

- Any live PubMed call, or touching `app/services/pubmed.py` at all — still
  Phase 5, per its own explicit constraint this phase. `docs/RAG.md`'s
  "Future PubMed extension" section documents exactly where it would plug
  into the now-strengthened `EvidenceChunk`/`EvidenceAgent` interface.
- The Clinical Analysis Agent — `format_citation_block()` produces what a
  future claim-to-citation mapping would need as input; nothing consumes
  it yet.
- A formal structured query object (`{question, topic, patient_context,
  model_context}`) — considered and deliberately not built, since every
  current caller already respects the patient-context/model-output
  boundaries with a plain string; see `docs/RAG.md`'s "Patient context
  boundary" section for the reasoning.
- Hybrid (keyword + semantic) retrieval — the existing single-backend
  design (semantic preferred, deterministic keyword fallback) was found
  sufficient for this corpus; not built without a demonstrated need.
- MCP tool exposure (`search_medical_evidence`) — still deferred to
  Phase 13 of the original MedGenesis phase list (§13.8).

### 13.12 MedGenesis extension: Phase 5 (PubMed integration and multi-source evidence)

Phase 5 turned the Phase 1 PubMed scaffolding (§13.8) into a real NCBI
E-utilities client and added it as a second, opt-in evidence source
alongside the existing local RAG — no second Evidence Agent, no second
`EvidenceChunk` abstraction. Full methodology, real measured/observed
results, and the multi-source architecture live in `docs/RAG.md` — this
entry records what changed and what's still deliberately absent, matching
the Phase 1-4 entries' format.

**Implemented now:**

- `app/services/pubmed.py::EutilsPubMedClient` — real ESearch + EFetch
  calls behind the existing `PubMedClient` protocol; `PubMedArticle`
  extended with `doi` and `article_type` (both new, backwards-compatible
  defaults). One retry only, after a fixed delay, for a transient failure
  — never a retry loop. Verified against the live NCBI API during
  development (not part of the required test suite — see
  `tests/test_pubmed_live.py`, skipped by default).
- A real, order-dependent secret-logging leak was found and fixed during
  this phase's own test development: httpx's own request-line logger
  (independent of anything `services/pubmed.py` logs itself) includes the
  full request URL — `api_key` included, since NCBI requires it as a query
  parameter — at INFO level by default. Since `app/main.py` already raises
  the root logger to INFO on startup, this would have leaked the key into
  real application logs. Fixed by capping `logging.getLogger("httpx")` at
  WARNING at import time; regression-tested directly
  (`tests/test_pubmed.py::TestNoAPIKeyLoggedOrHardcoded::
  test_httpx_request_logger_is_capped_at_warning`).
- `EvidenceChunk` gained two backwards-compatible fields:
  `source_type` (`"local"`/`"pubmed"`, defaults to `"local"`) and `doi`
  (defaults to `""`) — no second evidence model.
- `app/services/rag.py::search_evidence(query, k, source)` — the
  multi-source orchestration layer, added to the existing RAG module (not
  a new `medical_evidence_service.py`). `source="local"` (the default)
  is byte-for-byte identical to pre-Phase-5 behavior; `"pubmed"` and
  `"all"` are opt-in only. PubMed→EvidenceChunk normalization, cross-
  source deduplication (by document_id/DOI/PubMed-title, deliberately
  scoped away from local-KB titles — see `docs/RAG.md` for the specific
  collision bug this avoids), and Reciprocal Rank Fusion (chosen over
  score-normalization fusion because PubMed's ESearch provides no numeric
  relevance score, rank order only) all live here.
- `EvidenceAgent.retrieve()`/`retrieve_as_dicts()` gained one new
  `source` parameter; every existing caller (`ConversationalAgent`,
  `CarePlanAgent`, the orchestrator's `evidence_node`) omits it and is
  unaffected.
- `POST /api/evidence/search` gained an optional `source` field
  (`"local"`/`"pubmed"`/`"all"`, default `"local"`) — additive, backwards
  compatible.
- A PubMed failure (not configured, network error, NCBI outage) degrades
  to an empty result set, never an exception and never fabricated
  evidence — local RAG is unaffected even in `source="all"` mode.
- 61 new tests across `tests/test_pubmed.py`, `tests/
  test_multi_source_evidence.py`, and additions to `tests/
  test_evidence_api.py` — all mocked (`httpx.MockTransport`), no live
  PubMed dependency for the required suite.

**Explicitly not implemented — planned for later phases:**

- Wiring PubMed into `ConversationalAgent`, `CarePlanAgent`, or the
  orchestrator — all three still default to `source="local"`; deciding
  when a real caller should query PubMed is the future Clinical Analysis
  Agent's job, per its own explicit constraint this phase (Phase 5
  Step 12/37)
- A PubMed/multi-source retrieval evaluation set — Step 31 requires either
  live access (which this phase confirmed works) or a recorded, clearly-
  labelled fixture set with non-fabricated expected PMIDs; building a
  trustworthy expected-PMID ground truth requires a domain-expert
  judgment call this phase has no grounds to make, so it was left
  undone rather than built on invented "expected" results (`docs/RAG.md`
  "Evaluation (PubMed / multi-source)")
- Caching of PubMed results — evaluated and deliberately not built; no
  existing caching infrastructure to extend, and this prototype's query
  volume doesn't need one yet (`docs/RAG.md` "Caching")
- Parallel local+PubMed retrieval for `source="all"` — evaluated and
  deliberately kept sequential; the local store's contribution to total
  latency is negligible next to PubMed's network round trip, and
  introducing async/threading here would be the first concurrency
  primitive in an otherwise fully synchronous codebase
- Full-text retrieval, evidence-quality/study-design grading, or any
  causal/hierarchy claim about article types — outside E-utilities'
  actual scope or explicitly prohibited by this phase's own constraints
- The Clinical Analysis Agent, MCP, or any change to the RandomForest/
  XGBoost models or the Digital Twin — all explicitly out of scope this
  phase and confirmed untouched (no file under `app/ml/` or
  `app/services/twin.py` changed)

### 13.13 MedGenesis extension: Phase 6 (Clinical Analysis Agent and grounded reasoning pipeline)

Phase 6 turned the Phase 1 `ClinicalAnalysisAgent` scaffolding (§13.8) into
a real composition layer over every agent/service built in Phases 1-5 — no
subsystem was reimplemented; full detail and reasoning live in
`docs/CLINICAL_ANALYSIS.md`. This is the first phase where the previously
independent components (Digital Twin, RandomForest, XGBoost, local RAG,
PubMed, Simulation, Safety) are combined into one output.

**Implemented now:**

- `app/agents/clinical_agent.py` — real implementation (`.run()` signature
  changed from the Phase 1 guess `(twin_state, risk_output)` to
  `(twin_state, question, **flags)`, since the actual spec required a
  `question` field the skeleton predates). Produces a structured
  `ClinicalAnalysisResult`: `patient_summary`/`model_analysis`/
  `integrated_analysis` as lists of typed `ClinicalClaim`s
  (`patient_observation`/`model_observation`/`evidence_supported`/
  `inference`/`uncertainty`), plus `evidence_findings`, `citations`,
  `uncertainties`, `safety_flags`.
- Production (RandomForest, always run) and candidate (XGBoost, opt-in via
  `include_model_comparison`) results are clearly and separately labelled
  throughout; a tier disagreement between them produces an explicit
  uncertainty claim rather than picking a winner. Real per-patient SHAP
  contributions for XGBoost (via the existing `explain.py`, reusing
  already-loaded artifacts) — not the aggregate training-time importances,
  which would be a mismatch for a claim about one patient.
- Evidence: reuses `EvidenceAgent.retrieve(query, source=...)` exactly —
  `include_evidence` → `"local"`, `include_pubmed` → `"all"`. Query text
  contains only human-readable clinical concepts, never patient
  identifiers or raw twin values.
- Hallucination defense: an LLM reply's `[E#]` citations are validated
  against the evidence IDs actually supplied; an unknown ID is stripped
  and flagged (`safety_flags`), never silently trusted. The deterministic
  fallback path (no LLM) never paraphrases evidence text at all — only an
  LLM is trusted to attempt that, matching the existing rules-decide/
  LLM-only-rephrases pattern from `CarePlanAgent`/`ConversationalAgent`.
- Orchestrator: new `"clinical"` mode (`Mode` Literal extended, not
  replaced), a `clinical_node`, and a `safety_node` branch — the three
  existing routes are byte-for-byte unchanged. `Orchestrator.run()` gained
  five new optional kwargs (`question`, `include_model_comparison`,
  `include_evidence`, `include_pubmed`, `include_simulation`), all
  defaulted so no existing caller needed to change.
- `POST /api/clinical/analyze` (`app/routers/agents.py`, not a new router
  — co-located with the other Orchestrator/Safety-gated endpoints, unlike
  Phase 3/4/5's deliberately non-gated `ml.py`/`evidence.py` utility
  endpoints, since this one generates synthesized narrative text that
  Safety exists to review).
- **A real safety-policy bug found and fixed**: the existing
  `medication_advice` blocked-pattern list blocked the bare word
  "metformin" unconditionally — designed before anything needed to
  *display* a medication name at all. Once the Clinical Agent correctly
  started showing recorded medication history (Step 24's explicit
  requirement), every analysis mentioning a patient's real Metformin
  history was being blocked as if it were medication advice. Fixed by
  removing the bare drug-name pattern (`safety_policies.yaml`, policy
  version 1.0.0 → 1.1.0); every remaining pattern is drug-name-agnostic
  and still catches genuine advice phrasing regardless of which drug is
  named, confirmed by the existing parametrized advice-blocking test still
  passing unchanged plus a new regression test locking in the fix.
- 50 new tests across `tests/test_clinical_agent.py` (agent-level,
  including hallucination defense, model-conflict handling, and privacy
  boundary tests) and `tests/test_clinical_analysis_api.py` (API-level,
  including a test that a Safety block clears every claim section, not
  just the narrative).

**Explicitly not implemented — planned for later phases:**

- Validating that LLM-referenced patient values/model outputs exist in
  the supplied data — only Evidence-ID validation was built (Step 34's
  explicit "at minimum"); free-text numeric-value validation would need
  disproportionate NLP work for this phase's scope
- Persisting clinical analyses to a database table — no
  `ScreeningAssessment`-style model was added, since nothing downstream
  yet references a stored analysis; the endpoint is purely computational,
  same precedent as `ml.py`/`evidence.py`'s read-only endpoints
- Extending the generic `/api/agents/run` demo endpoint to cover
  `mode="clinical"` — would require bolting `question`/`include_*` fields
  onto a schema meant to stay a thin multi-mode DTO; the dedicated
  `/api/clinical/analyze` endpoint already covers this need
- MCP tool exposure — still deferred to Phase 13 of the original
  MedGenesis phase list (§13.8)
- Frontend integration — backend only this phase, per its own explicit
  constraint

### 13.14 MedGenesis extension: Phase 7 (end-to-end product integration)

Phase 7 turned the backend-only Phase 6 capability into a demonstrable
product: frontend integration, live-browser verification (which is how
two real severe bugs were found — below), expanded hallucination defense,
explicit persistence and MCP decisions, and error-resilience hardening.
Full detail and reasoning: `docs/CLINICAL_ANALYSIS.md`'s "Phase 7:
End-to-End Integration" section — this entry is the summary.

**Implemented now:**

- `frontend/src/pages/ClinicalAnalysisPage.tsx` + `components/
  EvidenceCitation.tsx` — the first UI for the Clinical Analysis Agent,
  registered at `/clinical-analysis`. Reuses every existing frontend
  convention (React Context for patient selection, the hand-written `api`
  client, shared `Card`/`SafetyBanner`/`AgentTrace` components) — no new
  frontend framework, state library, or styling system introduced.
- The frontend's first use of the Phase 2 Digital Twin endpoints
  (`GET /api/twin/{id}/digital-twin`, `GET /api/twin/{id}/labs/{test_name}`)
  — built in Phase 2, never called by any page until now.
- Two real, severe bugs found via live browser testing (not caught by the
  passing unit test suite) and fixed:
  1. A process-crashing macOS OpenMP conflict — `POST /api/clinical/analyze`
     with `include_model_comparison=True` killed the entire uvicorn
     process the first time it ran in a live server after RAG had already
     loaded torch. Same root cause as the Phase 3/5 pytest-side fix;
     `app/main.py` now carries the equivalent fix for the actual
     application entrypoint, which has no conftest.py to rely on.
  2. Two missing-model-artifact crashes inside `ClinicalAnalysisAgent.run()`
     (RandomForest and XGBoost, independently) that used to discard an
     entire valid analysis over one unavailable model — now caught locally
     and degraded to an honest uncertainty claim, without modifying
     `ScreeningAgent`/`XGBoostPredictionService` themselves (so every other
     existing caller is unaffected).
- Hallucination defense expanded from Evidence-ID-only (Phase 6) to also
  cover model-name validation (reliable, fully implemented) and
  numeric model-score validation (implemented, deliberately scoped to
  score-claim trigger phrases with an explicit, documented tolerance rule
  — not every number in the text). Patient-value validation (BMI/HbA1c/
  blood pressure) was investigated and explicitly not attempted — the
  false-positive rate from ambiguous free-text number attribution would
  make it unreliable, and Step 20 explicitly permits documenting that
  boundary rather than faking it.
- Explicit persistence decision, re-affirmed with the full Step 14
  checklist: clinical analyses remain generated on demand, not persisted —
  no functional requirement exists yet, and adding a patient-data-bearing
  table without one would be a real, unjustified privacy-surface increase.
- Explicit MCP decision: deferred in full. The underlying functions are
  mature enough, but this project has never built any authorization layer,
  and an MCP tool exposes patient data to *autonomous agentic* access in a
  way the existing local-only, human-driven REST API does not — Step 18's
  own instruction to defer rather than weaken security was followed
  directly.
- `app/services/retrieval_evaluation.py::PUBMED_EXPERT_EVALUATION_SET` —
  the schema for future domain-expert-labelled PubMed evaluation, shipped
  deliberately empty; `run_pubmed_evaluation()` returns an explicit
  `"insufficient_data"` status rather than a fabricated metric until real
  expert labels exist.
- One comprehensive real-service-boundary integration test
  (`tests/test_end_to_end_integration.py`) proving patient → Digital Twin
  → Clinical Agent → models → evidence → Safety → audit log → final trace
  actually compose, using a real DB session and the real Orchestrator
  throughout (only PubMed mocked, to avoid a live network dependency in
  the required suite).
- 45 new backend tests (`test_app_startup.py`, `test_privacy.py`,
  `test_hallucination_defense.py`, `test_pubmed_evaluation.py`,
  `test_end_to_end_integration.py`, `test_error_resilience.py`) plus 13
  new frontend tests (`ClinicalAnalysisPage.test.tsx`,
  `EvidenceCitation.test.tsx`) — component-level "E2E-style" tests using
  the project's existing, configured tooling (Vitest + Testing Library);
  see "Frontend E2E testing" below for why a full browser-automation
  framework (Playwright, present as a devDependency but never configured)
  was used for live manual verification during development rather than
  wired into the automated suite this phase.

**Explicitly not implemented — no phase has built this yet:**

- MCP (deferred, reasoned above)
- Clinical-analysis persistence (deferred, reasoned above)
- Patient-value/simulation-value hallucination validation (investigated,
  explicitly out of reliable reach this phase)
- Any authentication/authorization layer anywhere in this project —
  the prerequisite for ever revisiting the MCP decision
- A full rewrite of the root `README.md`'s architecture diagram/agent
  table or of `docs/REPORT.md` to reflect Phases 3-7 — both predate Phase
  3 entirely and were out of this phase's explicit scope (`docs/
  ARCHITECTURE.md` and `docs/CLINICAL_ANALYSIS.md` specifically); flagged
  here as known, pre-existing documentation debt rather than silently left
  unmentioned
- Any clinical validation, diagnosis, or treatment capability — this
  remains, and will remain, a research/decision-support prototype

### Frontend E2E testing

Step 26 asked for "patient selection → question → analyze → loading →
result → evidence display," using existing tooling and not adding a new
browser-testing framework unless necessary. `playwright` is already a
frontend devDependency but has no config file and was never wired up by
any earlier phase. Two things were actually done, not conflated:

1. **Automated, required-suite tests**: `ClinicalAnalysisPage.test.tsx`
   covers exactly that flow using Vitest + Testing Library — the
   project's one *configured* test architecture (`vite.config.ts`'s
   `test.include`) — with the `api` client and `PatientContext` mocked.
   This is what CI/the grading suite actually runs.
2. **Live manual verification**: a one-off Playwright script (chromium,
   installed for this purpose) drove the real dev frontend against the
   real dev backend and screenshotted every step — this is how both real
   bugs above were found, since a mocked-API component test cannot
   reproduce a live-process crash or an artifact-loading failure. This was
   deliberately not wired into the automated suite or committed — it was
   a development-time verification tool, not a regression test, and
   turning it into one would mean standing up real server-process
   orchestration (ports, health-check polling, teardown) that no phase has
   asked for and that would need its own design, not a rushed addition
   here.

## 13.15 Phase 8: validation, and the current-state architecture

Phase 8 audited this entire document against the actual current code
(agents, routers, services, tests) rather than assuming the sections above
— many written incrementally across §13.8-§13.14 — were still fully
in sync with each other. Finding: they were. No architectural drift was
found; no component described above has been removed, replaced, or
silently changed since the phase that introduced it.

One genuine gap was closed: §3's original architecture diagram (and the
top-level README's, which pointed back to it) predates the Clinical
Analysis Agent, XGBoost, and PubMed, and shows a single linear pipeline
rather than the LangGraph's actual four separate routes
(`intake`/`simulation`/`chat`/`clinical`). Rather than editing §3 in place
(preserving it as an accurate record of the *original* design this project
extended), the current, code-derived diagram, component responsibility
table, and technology-choice rationale now live in
**[FINAL_REPORT.md §6 and §15](FINAL_REPORT.md)** — generated directly from
`app/agents/orchestrator.py`'s actual graph-building calls during Phase 8,
not copied forward from an earlier diagram. That is the diagram to trust
for "what does this system actually do right now."

Full Phase 8 validation methodology and findings, subsystem by subsystem:
[ML_VALIDATION.md](ML_VALIDATION.md), [SAFETY.md](SAFETY.md),
[PRIVACY.md](PRIVACY.md), [TESTING.md](TESTING.md),
[EVALUATION.md](EVALUATION.md), [LIMITATIONS.md](LIMITATIONS.md).

## 14. References

- CDC BRFSS 2015 Diabetes Health Indicators — UCI Machine Learning Repository #891 / Centers for Disease Control and Prevention Behavioral Risk Factor Surveillance System (U.S. government work, public domain). The project's active training source — see §13.7.
- Pima Indians Diabetes Dataset — UCI Machine Learning Repository / National Institute of Diabetes and Digestive and Kidney Diseases. The project's original training source (§13.7); its target-leakage finding is preserved in [LEAKAGE.md](LEAKAGE.md).
- CDC, "Diabetes Basics" — https://www.cdc.gov/diabetes/basics/ (U.S. government work, public domain)
- WHO, "Diabetes" fact sheet — https://www.who.int/news-room/fact-sheets/detail/diabetes (© WHO; used with attribution under WHO's copyright/permissions policy: https://www.who.int/about/policies/publishing/copyright — not public domain)
- LangGraph documentation — https://langchain-ai.github.io/langgraph/
- Ollama — https://ollama.com
