# MedGenesis

**Phase 8 — Final Report.** This document tells the complete story: what
MedGenesis is, why it exists, how it works, what was actually built, how it
was evaluated, what the measured results are, what its limitations are, and
what remains future work. It consolidates — and does not duplicate — the
detailed supporting documents in this folder:
[ARCHITECTURE.md](ARCHITECTURE.md), [DIGITAL_TWIN.md](DIGITAL_TWIN.md),
[ML.md](ML.md), [ML_BASELINE.md](ML_BASELINE.md),
[ML_VALIDATION.md](ML_VALIDATION.md), [RAG.md](RAG.md),
[CLINICAL_ANALYSIS.md](CLINICAL_ANALYSIS.md), [SAFETY.md](SAFETY.md),
[PRIVACY.md](PRIVACY.md), [TESTING.md](TESTING.md),
[EVALUATION.md](EVALUATION.md), [LIMITATIONS.md](LIMITATIONS.md),
[LEAKAGE.md](LEAKAGE.md), and [REPORT.md](REPORT.md) (the original
pre-MedGenesis-extension project report).

## 1. Introduction

MedGenesis is a research prototype exploring what an **agentic**
architecture around a **longitudinal patient model** looks like for
Type 2 Diabetes education and screening-risk decision support — as opposed
to the more common shape of "one model, one prediction, one number." It
composes a Digital Twin (an event-sourced patient timeline), two
independently-trained risk models (one production, one candidate), a
medical-evidence retrieval layer (local corpus plus optional live PubMed),
a what-if simulator, and a Clinical Analysis Agent that synthesizes all of
the above into one structured, cited, safety-reviewed response — behind a
deterministic policy gate that reviews every clinically-sensitive output
before it reaches a user.

## 2. Motivation

A single-shot classifier that outputs "0.6, elevated risk" gives a user
almost nothing to act on or verify: no history, no evidence, no comparison
against an alternative model, no explanation of what drove the number, and
no acknowledgment of what the model doesn't know. Existing consumer
"symptom checker" tools tend toward the opposite failure mode — confident,
conversational, and unsourced. MedGenesis was built to explore a middle
path: keep every claim traceable to a specific model output, a specific
retrieved passage, or a specific recorded patient fact, and make the system
say "I don't know" or "this is unavailable" instead of guessing, at every
layer where that's the honest answer.

## 3. Problem Statement

Given a patient's recorded health/lifestyle data (BRFSS-style
self-reported indicators) and a free-text clinical question, produce an
**evidence-grounded, model-transparent, safety-reviewed** analysis that: (a)
reports a screening-risk score from a validated-on-its-own-terms model
without overstating what that score means; (b) cites the specific medical
literature passages it draws on; (c) distinguishes direct observation from
inference; (d) never diagnoses or prescribes; and (e) is auditable — every
step of how the answer was produced is inspectable, not a black box.

## 4. Objectives

1. A patient Digital Twin that never overwrites history — every fact is an
   append-only event, and "current state" is always a computed view over
   that log.
2. A production screening-risk model, honestly evaluated, with its real
   metrics (including the unflattering ones) reported.
3. A second, candidate model for comparison — never silently promoted.
4. Evidence retrieval that cites its sources, distinguishes a local
   curated corpus from live PubMed literature, and never fabricates
   metadata it doesn't have.
5. A synthesis layer (the Clinical Analysis Agent) that composes all of
   the above with concrete, testable hallucination defenses.
6. A deterministic, auditable safety gate reviewing every sensitive output.
7. A frontend that shows all of this honestly — including loading, error,
   empty, and blocked states — without inventing content to look more
   complete than the backend actually returned.
8. As of this phase: validate all of the above against the actual current
   code, fix any genuine defect found, and document the true, current state
   — not a stale or aspirational one.

## 5. Proposed Solution

MedGenesis is a FastAPI backend orchestrated by a LangGraph `StateGraph`
(four deterministic routes: `intake`, `simulation`, `chat`, `clinical`)
sitting in front of a SQLite-backed event-sourced Digital Twin, a
scikit-learn RandomForest (production) and XGBoost (candidate) risk model,
a two-source evidence retriever (local ChromaDB/keyword-fallback + optional
live PubMed via NCBI E-utilities), a rules-plus-optional-LLM synthesis
layer, and a YAML-policy-driven Safety Agent that gates every route before
a response reaches the React/TypeScript frontend. See §6 for the full
architecture and §14 for the frontend specifically.

## 6. System Architecture

```
USER
  ↓
FRONTEND (React 19 + Vite + TypeScript)
  ↓  REST/JSON — one hand-written typed API client
FASTAPI  (app/main.py — 6 routers, CORS restricted to localhost)
  ↓
ORCHESTRATOR  (LangGraph StateGraph, app/agents/orchestrator.py)
  deterministic routing by `mode` — an LLM never decides whether
  the safety gate runs
  │
  ├─ mode="intake":     load_twin → screening → evidence → careplan → safety
  ├─ mode="simulation": load_twin(fork) → simulation → safety
  ├─ mode="chat":       load_twin → screening(context only) → chat → safety
  └─ mode="clinical":   load_twin → clinical → safety
                                       │
                          (clinical_node internally composes:)
                          Digital Twin → RandomForest (always)
                            → XGBoost (opt-in, per-patient SHAP)
                            → Evidence: local RAG (opt-in) + PubMed (opt-in)
                            → Simulation (opt-in, reuses the existing agent)
                            → grounding/hallucination checks
  │
  ↓ (every route's edge terminates here — no route reaches END otherwise)
SAFETY AGENT  (deterministic YAML policy, app/agents/safety_agent.py)
  APPROVED / FLAGGED_FOR_CLINICIAN_REVIEW / BLOCKED
  → append-only safety_audit_log
  ↓
RESPONSE  (Pydantic schema, never persisted for clinical_analysis — see §11)
  ↓
FRONTEND  (renders exactly what was returned; no client-side clinical logic)
```

This diagram was generated from the current code (`orchestrator.py`'s
actual graph-building calls) during Phase 8, not copied from an earlier
phase's diagram — the four separate routes, and the fact that
`clinical_node` is one Python function composing several agents internally
rather than four separate graph nodes, are both real structural facts of
the current implementation.

**Component responsibilities, inputs/outputs, and boundaries:**

| Component | Responsibility | Input | Output | Persisted? | Status |
|---|---|---|---|---|---|
| Orchestrator | Deterministic routing + shared trace | mode, patient_id, mode-specific args | Full state dict incl. trace | No (per-request) | Core |
| Digital Twin | Append-only patient state | TimelineEvent writes; reads at request time | Materialized current state / structured twin | Yes (`timeline_events`, SQLite) | Core |
| Screening (RandomForest) | Risk score + tier | 21 BRFSS-shaped features | Probability, tier, top features | No | **Production** |
| XGBoost candidate | Comparison risk score + per-patient SHAP | Same 21 features | Probability, tier, SHAP values | No | **Candidate**, opt-in |
| Evidence Agent | Cited passage retrieval | Query text, source selector | Ranked, cited chunks | No | Core |
| Local RAG store | Embedding or keyword search over 2 curated docs | Query | Chunks + relevance score | Vector index only (`data/chroma/`) | Core |
| PubMed client | Live NCBI E-utilities search | Query | Article metadata + abstract | No | Optional, network-dependent |
| Clinical Analysis Agent | Composition + grounding | Twin, models' output, evidence, question | Structured claims + citations + uncertainties | No (§11) | Core |
| Simulation Agent | What-if trajectory | Forked twin snapshot, hypothesis | Risk trajectory over time | No (forked, never written back) | Optional |
| Safety Agent | Policy review of every sensitive output | Rendered text + metadata | Verdict + reasons + possibly-redacted text | Yes (`safety_audit_log`) | Core, mandatory |
| Frontend | Display only — zero clinical logic | API responses | Rendered UI | Browser-local only (`localStorage`: one patient-ID key) | Core |

## 7. Digital Twin

Event-sourced: every fact (a measurement, a lifestyle log, a lab result, a
medication change) is an append-only row in `timeline_events`; nothing is
ever updated or deleted. "Current state" is always a fold over that log —
the latest value per key wins. Verified in Phase 8 (`services/twin.py`,
`tests/test_digital_twin_phase2.py`, 36 tests): lab history is never
collapsed to a single value; trend labels honestly distinguish "no data"
(0 points) from "insufficient data" (1–2 points) from a real direction
(3+ monotonic points) from "mixed"; medication history is presented as
fact, never converted into a recommendation; a stopped-then-restarted
medication correctly reappears in "current." Full detail:
[DIGITAL_TWIN.md](DIGITAL_TWIN.md).

## 8. Machine Learning

RandomForest (production, selected over logistic regression by 5-fold
cross-validated ROC-AUC) and XGBoost (candidate, hyperparameters selected
by a small grid search with early stopping) train on the identical CDC
BRFSS 2015 dataset, features, target definition, and train/test split.
Reproduced during Phase 8 directly from the persisted artifacts:

| Metric | RandomForest | XGBoost |
|---|---|---|
| Accuracy | 0.7164 | 0.7206 |
| Precision | 0.3297 | 0.3352 |
| Recall | 0.7745 | 0.7865 |
| F1 | 0.4625 | 0.4701 |
| ROC-AUC | 0.8185 | 0.8255 |

XGBoost scores marginally higher on every metric on this split — it is
**not** promoted to production. Full validation methodology:
[ML_VALIDATION.md](ML_VALIDATION.md).

## 9. Explainability

RandomForest exposes **aggregate, trained-model-level** feature importance
only — explicitly labeled as such in every place it's surfaced, never
patient-specific. XGBoost additionally computes **real per-patient SHAP
values** (`shap.TreeExplainer` on that one patient's feature vector) when a
Clinical Analysis includes model comparison. Neither is presented, or
should be read, as a cause of the patient's risk — every generated claim
referencing feature contributions carries explicit non-causal language,
enforced at template-generation time, not left to the reader to infer.

## 10. Medical Evidence

Two sources, clearly distinguished throughout the stack and the UI: a
small local knowledge base (CDC "Diabetes Basics," WHO "Diabetes" fact
sheet — chunked by section, embedded via sentence-transformers into
ChromaDB, with a deterministic keyword-overlap fallback when those
dependencies aren't installed) and optional live PubMed (NCBI
E-utilities — ESearch + EFetch, abstract/metadata scope, opt-in per
request, degrades to "no PubMed evidence" on any failure rather than
crashing or blocking local results). A combined query
(`source="all"`) fuses both by Reciprocal Rank Fusion on rank position
only — never a fabricated cross-source score — and deduplicates by
document ID, DOI, or normalized title. No PubMed retrieval-accuracy claim
is made anywhere in this project; the evaluation infrastructure exists but
its expert-labelled ground truth is intentionally empty. Full detail:
[RAG.md](RAG.md), [EVALUATION.md](EVALUATION.md) §5.

## 11. Clinical Analysis Agent

A composition layer, not a reimplementation of any underlying agent — it
calls the same screening, evidence, and simulation agents everything else
in the system uses. Its output is a structured set of typed claims
(`patient_observation` / `model_observation` / `evidence_supported` /
`inference` / `uncertainty`), each optionally citing specific evidence IDs.
Grounding defenses, all tested: a fabricated `[E#]` citation is stripped
and flagged; a claimed model name not actually used is flagged; a claimed
numeric score that doesn't match the real computed value (outside a small
rounding tolerance) is flagged. Retrieved evidence text is wrapped in an
explicit data/instruction delimiter the system prompt tells the LLM never
to obey as a command, defending against prompt injection via a malicious
or adversarial source passage. Results are **not persisted** — every
analysis is generated fresh per request; this is a deliberate scope
decision (see [CLINICAL_ANALYSIS.md](CLINICAL_ANALYSIS.md) "Persistence
decision"), not an oversight.

## 12. Simulation

The What-if Simulation Agent forks the Digital Twin's current state (the
real timeline is never written to), applies a transparent, documented delta
heuristic (never a validated physiological model — stated as such in every
projection returned), and produces a risk trajectory. A free-text
scenario ("what if I lost weight and exercised more") is parsed by a
small deterministic parser, not an LLM — unrecognized phrasing is reported
as unavailable, never guessed at. The Safety Agent flags any projection
whose risk swing exceeds a configured plausibility threshold.

## 13. Safety

A deterministic, declarative YAML policy engine
(`safety_policies.yaml`) — not an LLM judge — reviews every
clinically-sensitive output on every route, after generation, with no
route able to bypass it (a structural property of the LangGraph edges, not
a convention). Blocks diagnostic phrasing, medication/dosage advice, and
false-certainty claims; flags high risk tiers, implausible simulation
swings, and urgent-symptom mentions. A real, historical false-positive bug
— a bare drug name ("metformin") incorrectly blocking a factual mention of
a patient's own recorded medication history — was found and fixed in an
earlier phase (patterns are now phrase-level and drug-name-agnostic) and
is covered by regression tests across three files, reconfirmed passing in
Phase 8. Full detail: [SAFETY.md](SAFETY.md).

## 14. Frontend

React 19 + TypeScript + Vite, plain React Context for state, a
hand-written typed API client, plain CSS. The Clinical Analysis page is
the primary surface for this project's core capability: a question
composer with per-option explanatory copy, an honest static
(non-fake-progress) loading state, and a result view ordered
Safety → Patient observations → Model analysis (Production vs. Candidate,
visually distinct) → Model Feature Contributions → Evidence (Local vs.
PubMed, numbering preserved from the backend's original retrieval order)
→ Integrated analysis → Simulation → Uncertainty → collapsible trace.
Verified responsive at 1440/1024/768/390px with no horizontal scroll, and
accessible (labelled form controls, visible keyboard focus, no
color-only distinctions between Production/Candidate/Safety states). No
frontend code performs clinical computation of any kind — every number and
label displayed is passed through from a backend response.

## 15. Technology Stack — and why

| Technology | Role | Why this, specifically |
|---|---|---|
| **FastAPI** | HTTP API framework | Pydantic-native request/response validation gives the whole project one enforced schema boundary between agents and the wire format, plus free interactive docs (`/docs`) useful for a project meant to be inspectable. |
| **Python** | Backend language | The only language with mature, first-class libraries for every ML/RAG component used (scikit-learn, xgboost, shap, sentence-transformers, chromadb) without gluing across language boundaries. |
| **SQLAlchemy + SQLite** | Persistence | Zero-install, zero-server database — the project runs with `pip install` and nothing else, which matters for a project meant to be reproduced by a grader/reviewer with no infrastructure setup. SQLAlchemy's ORM means migrating to Postgres later (considered, and initially specified) would change a connection string and a column type, not the model layer — a documented, deliberate tradeoff, not an oversight. |
| **LangGraph** | Agent orchestration | Gives the routing a real, inspectable graph structure (nodes, typed state, explicit edges) rather than a chain of if/else calls — and critically, makes "every route passes through Safety" a structural property of the graph's edges, not something that has to be remembered at every call site. |
| **scikit-learn** | RandomForest baseline | Mature, well-understood, and — via `class_weight="balanced"` — handles this dataset's real class imbalance (only ~16% positive) directly, without a separate resampling step. |
| **XGBoost** | Candidate model | The natural comparison point for a tree-ensemble baseline; supports early stopping against a validation set for principled hyperparameter/round-count selection, and (via the `shap` library's `TreeExplainer`) exact, fast per-instance explanations — unlike RandomForest, for which exact per-instance SHAP is dramatically more expensive to compute at this project's scale. |
| **SHAP** | Explainability | The `TreeExplainer` variant is exact (not approximate) for tree ensembles, and is the most widely used method with an actual theoretical grounding (Shapley values) rather than a heuristic — appropriate for a project that explicitly wants to avoid overstating what an explanation means. |
| **ChromaDB + sentence-transformers** | Local evidence retrieval | An embedded (no server) vector store paired with a small, well-regarded open sentence-embedding model (`all-MiniLM-L6-v2`) — free, runs offline, and (critically) has a documented, tested fallback to a dependency-free keyword ranker when either isn't installed, so the system never hard-fails on a missing optional dependency. |
| **NCBI E-utilities (PubMed)** | Live medical-literature evidence | The standard, free, public API for the medical literature corpus a project like this should be able to cite from — no license cost, no proprietary corpus, and it's what practicing clinicians and researchers actually use to search PubMed themselves. |
| **React + TypeScript + Vite** | Frontend | A typed component model catches an entire class of "the API changed shape and the UI silently broke" bugs at compile time — verified directly in this project (`api/types.ts` was found to be missing real backend fields during the Phase 7 build, caught by the type system, not a runtime failure). Vite's dev server + build tooling requires effectively no configuration for a project this size. |
| **Mistral API → Ollama → rule-based fallback** | Conversational/synthesis LLM (optional, three-tier) | Free/open-source is a hard constraint for the project as a whole; Mistral's hosted API is the one deliberate, documented exception (a paid service), included only as the highest-quality optional tier — the system is fully functional, offline, and free with either of the other two tiers active, including every screening/simulation/evidence/safety path, none of which need an LLM at all. |

## 16. Evaluation

Full detail, with MEASURED/OBSERVED/NOT MEASURED labeling throughout:
[EVALUATION.md](EVALUATION.md). Headline: ML metrics reproduced live and
matched their own stored metadata exactly; safety/privacy/grounding
behaviors confirmed by currently-passing automated tests, not just
inspection; live PubMed connectivity positively confirmed in this
environment; runtime measurements taken as prototype-grade single-machine
observations, with the XGBoost-comparison path's consistent ~0.55–0.68s
cost identified and traced to an un-cached full-test-set re-evaluation —
documented as future work, not fixed in this phase.

## 17. Testing

391 backend tests (390 passed, 1 skipped by design — opt-in live PubMed,
manually run and confirmed passing this phase), 26 frontend tests, both
0 failures. Full per-file breakdown, before/after comparison, and the
XGBoost-retraining-as-test-side-effect explanation: [TESTING.md](TESTING.md).

## 18. Privacy and Security

Secrets never reach a client response or a log; patient identifiers never
enter a PubMed query or an LLM prompt — all confirmed by currently-passing
tests, not just code reading. **No authentication or authorization layer
exists** — stated plainly, not minimized, and is this project's clearest,
most consequential gap. Full detail: [PRIVACY.md](PRIVACY.md).

## 19. Limitations

Complete, honest list — dataset (self-reported survey, binary-collapsed
target, known duplicate rows), ML (no external validation, no calibration
check, no subgroup evaluation), evidence (small local corpus, no
expert-labelled PubMed relevance set), grounding (specific defenses exist
and are tested; general patient-value hallucination checking does not),
safety (deterministic keyword policy, not semantic understanding), privacy
(no auth layer), and more. Full list, not summarized further here:
[LIMITATIONS.md](LIMITATIONS.md).

## 20. Future Work

**Priority 1 — Security foundation.** Authentication, authorization,
patient-scoped access control, and a real requester-identity audit log.
This is the most consequential gap in the current system and should
precede any feature that exposes it beyond a local/trusted environment.

**Priority 2 — Evidence evaluation.** Recruit a domain expert (or several)
to label query/document relevance for a real Hit@K/MRR evaluation of both
local and PubMed retrieval; grow the local evidence corpus beyond two
source documents; consider evidence-quality grading (e.g. distinguishing a
systematic review from a single small study).

**Priority 3 — Stronger ML validation.** Evaluate against an external
dataset or a different survey year; add calibration checking; add
subgroup evaluation; consider leakage/duplicate-aware splitting as an
explicit, compared alternative to the current split (not necessarily a
replacement — the current choice is defensible and documented, but an
explicit comparison would strengthen the claim).

**Priority 4 — Clinical validation.** Review by qualified clinical experts
— of the screening baseline's real-world utility, the Clinical Analysis
Agent's synthesized text, and the safety policy's coverage. Nothing in
this project substitutes for this, and no document claims otherwise.

**Priority 5 — Observability and efficiency.** Cache
`model_comparison.py`'s RandomForest test-set re-evaluation and/or the
XGBoost `TreeExplainer` construction (measured, in Phase 8, at a
consistent ~0.55–0.68s per request); add explicit PubMed availability
status reporting to the API response so a client can distinguish "searched,
found nothing" from "PubMed was unreachable" without inferring it;
general observability (structured request tracing beyond the existing
agent trace).

**Priority 6 — MCP.** Deliberately deferred (see
[CLINICAL_ANALYSIS.md](CLINICAL_ANALYSIS.md) "MCP decision"), and should
stay deferred until the Priority 1 security foundation exists — exposing
this system's tools via MCP before there is any access control would
widen the same gap, not narrow it.

## 21. Conclusion

MedGenesis demonstrates a working, non-trivial agentic architecture for
health-education decision support: an event-sourced patient model feeding
two independently-evaluated risk models, a two-source cited-evidence
retriever, a grounded synthesis layer with concrete and tested
hallucination defenses, and a deterministic safety gate that structurally
cannot be bypassed by any route. Every metric reported in this project's
documentation was verified, during Phase 8, to trace back to a real
measurement or a real, currently-passing test — none were found to be
fabricated, and the one place a real historical bug was found (the
metformin safety false-positive), it was already fixed with a regression
test in place. The system's most significant limitations — no clinical
validation, no authentication layer, no expert-labelled evidence
evaluation — are stated here and throughout this documentation set
explicitly, not discovered by a reviewer despite the documentation. It
remains, by design and by every document in this repository, a research
prototype: evidence-grounded, model-transparent, and safety-gated, not a
clinical tool.
