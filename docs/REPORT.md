# MedGenesis — Project Report

**An Agentic AI System for Type 2 Diabetes Education**

> **Educational prototype. Not medical advice, not a diagnostic device.**
> All data used is synthetic or public and de-identified. No real patient
> data was handled at any stage.

---

## 1. Abstract

MedGenesis is a multi-agent system that explores whether a coordinated team of
small, specialised AI agents can act as a lightweight "diabetes education
team." It is built around two ideas that distinguish it from a typical
predict-a-number ML project:

1. A **longitudinal Patient Digital Twin** — an append-only, event-sourced
   timeline — rather than a single overwritable record, so every output is
   traceable to the exact patient state that produced it.
2. A **Safety/Clinician-Review Agent** that sits architecturally between every
   clinically-sensitive agent output and the user, gating each one as
   `APPROVED`, `FLAGGED_FOR_CLINICIAN_REVIEW`, or `BLOCKED` and writing an
   append-only audit trail.

The most instructive results of the project were not the model's accuracy but
a series of negative findings, each caught by refusing to trust a good-looking
number — or a literal reading of a request — at face value: a
**target-leakage bug** in the original training pipeline that inflated
apparent accuracy from 0.813 to 0.941 ROC-AUC; a **broken similarity metric**
in the semantic retrieval backend, where implausible negative "relevance"
scores turned out to be raw distance values mislabelled as cosine similarity;
and, most consequentially, a request to add "10,000 more entries" to the
training data that — followed literally — would have required fabricating
data and quietly falsifying the project's own honesty claims about training
on real, unmodified public data. The training dataset was switched instead,
to a larger dataset that is still genuinely real (§5.7), which cascaded into
a redesign of the eligibility gate, the what-if simulator, and most of the
documentation.

---

## 2. Problem Statement and Objectives

Type 2 Diabetes management benefits from continuous risk awareness,
personalised lifestyle guidance, and evidence-grounded education, but most
people receive this only during brief clinical encounters. The project asks a
narrower, tractable question:

> Can a set of cooperating specialised agents, operating over a longitudinal
> patient state, produce useful health *education* while provably refusing to
> produce clinical *advice*?

The emphasis on "provably refusing" is deliberate. In a health context the
interesting engineering problem is not maximising what the system will say, it
is constraining it — and being able to demonstrate the constraint.

**Objectives**

| # | Objective | Status |
|---|---|---|
| 1 | Event-sourced Patient Digital Twin, never overwritten | Met |
| 2 | Educational screening-risk baseline, explicitly non-diagnostic | Met |
| 3 | What-if simulation producing a risk *trajectory* over time | Met |
| 4 | All generated advice grounded in retrievable cited evidence | Met |
| 5 | Every sensitive output gated and audited by a safety agent | Met |
| 6 | Genuinely agentic design with visible reasoning trace | Met |
| 7 | Only synthetic or public de-identified data | Met |

---

## 3. System Design

### 3.1 Agents

Eight components, seven of which are agents plus one state layer:

| Component | Role | Implementation |
|---|---|---|
| **Orchestrator** | Routes work, owns shared state and trace | LangGraph `StateGraph` |
| **Patient Digital Twin** | State layer (not an agent) | Event-sourced SQLAlchemy models |
| **Screening Risk Baseline** | Educational risk indicator | scikit-learn random forest |
| **Evidence Retrieval (RAG)** | Cited passages from a local KB | sentence-transformers + ChromaDB, keyword fallback |
| **What-if Simulation** | Counterfactual risk trajectory | Documented delta model + re-scoring |
| **Care-Plan Recommendation** | Lifestyle plan from risk tier | Deterministic rules + optional LLM phrasing |
| **Conversational Assistant** | Natural-language Q&A | Mistral → Ollama → rule-based |
| **Safety / Clinician-Review** | Gate on every sensitive output | YAML policy engine |

### 3.2 Why routing is deterministic

The orchestrator uses fixed routes rather than letting an LLM decide which
agent runs next. This was a deliberate reversal of the more "impressive"
design. If an LLM chooses the next step, then whether the safety gate executes
becomes a probabilistic outcome of a prompt. Since the entire safety argument
rests on the gate being unavoidable, routing must be a property of the graph,
not a model output.

Three routes, all terminating at the gate:

```
intake      : load twin → Screening → Evidence → Care-Plan → Safety → END
simulation  : fork twin → What-if                         → Safety → END
chat        : load twin → Screening (context) → Conversational → Safety → END
```

### 3.3 Why the twin is event-sourced

Storing `timeline_events` append-only, and computing "current state" as a fold
over that log at read time, buys three things that a mutable patient row does
not:

- A screening result can be tied to the exact `timeline_event` it was computed
  from, so a later reviewer can reconstruct the input.
- The UI can show a real longitudinal history rather than a snapshot.
- The What-if agent can fork a snapshot copy-on-write and project against it
  with a structural guarantee that hypothetical data never contaminates real
  history. This is enforced by test, not just by convention.

### 3.4 Why the safety gate is a policy engine, not an LLM judge

An LLM-as-judge would be more flexible and less brittle to paraphrase. It was
rejected because it is non-deterministic: the same output could be approved on
one run and blocked on the next, which makes the audit log meaningless and the
demonstration unreproducible. A YAML rule set (`safety_policies.yaml`,
versioned) trades coverage for the properties that matter here — determinism,
inspectability, and a policy version recorded on every audit row.

The tradeoff is stated plainly in the limitations: keyword-and-rule matching is
bypassable by paraphrase and is not regulatory-grade review.

---

## 4. Implementation

| Layer | Technology |
|---|---|
| Backend | FastAPI + Uvicorn, 16 API operations |
| Orchestration | LangGraph `StateGraph` |
| Datastore | SQLite via SQLAlchemy (embedded, zero-install) |
| ML | scikit-learn |
| RAG | sentence-transformers `all-MiniLM-L6-v2` + ChromaDB, keyword fallback |
| What-if input | Structured deltas, or a deterministic free-text parser |
| LLM | Mistral API (optional) → Ollama (local) → rule-based |
| Frontend | React 19 + Vite + TypeScript + Recharts, 7 pages |
| Testing | pytest (89 tests), Vitest (5 tests) |

**Size:** ~3,630 lines of backend Python across 36 modules, ~878 lines of
tests, ~1,669 lines of frontend TypeScript across 14 files.

### 4.1 Graceful degradation

Every optional dependency has a working fallback, so the project runs on a
clean machine with `pip install` and `npm install` alone:

| Component | Preferred | Fallback |
|---|---|---|
| Evidence retrieval | ChromaDB + embeddings | Deterministic keyword ranker (synonym expansion + light stemming) |
| Conversational agent | Mistral / Ollama | Rule-based responder over the same cited KB |

Which path is live is reported by `/api/health` and displayed in the UI
sidebar, so a fallback is never silently mistaken for the primary path.

### 4.2 Knowledge base

17 chunks — 11 from CDC "Diabetes Basics" (US government work, public domain)
and 6 from the WHO diabetes fact sheet. WHO material is **copyrighted, not
public domain**; source URL, access date, licence and attribution are stored
in chunk metadata and the attribution notice is rendered alongside every
WHO-derived excerpt in the UI.

---

## 5. Results

### 5.1 Model performance (served model)

Trained on the CDC's 2015 BRFSS Diabetes Health Indicators survey — see §5.7
for why this replaced the project's original Pima-based model. Random
forest, selected over logistic regression by cross-validated ROC-AUC.
202,944 training / 50,736 test rows, stratified split, `class_weight=
"balanced"`.

| Metric | Value |
|---|---|
| ROC-AUC (test) | **0.818** |
| ROC-AUC (5-fold CV) | 0.819 |
| Accuracy | 0.716 |
| Precision | 0.330 |
| Recall | **0.774** |
| F1 | 0.463 |

Recall is prioritised over precision here — a deliberate, disclosed tradeoff
from class-balancing, appropriate for a *screening* tool where missing a
positive case is worse than a false alarm, but with a real cost: **most
"elevated risk" flags are false positives**, stated plainly rather than
hidden behind the headline ROC-AUC.

Learned feature importances are clinically plausible — self-rated general
health, `GenHlth` (0.245), and high blood pressure, `HighBP` (0.236), lead,
followed by BMI (0.128), high cholesterol (0.115), and age (0.090). No single
feature dominates implausibly, and the response is monotonic in the expected
direction for BMI, general health, and age (verified before shipping, not
assumed) — the same discipline that caught the leak in §5.2 and the broken
RAG metric in §5.7.

### 5.2 A historical finding: target leakage in the original pipeline

This finding was made on the project's **original Pima-based training
pipeline**, before the dataset switch described in §5.7. The dataset that
replaced Pima has zero nulls and needs no imputation step, so this specific
mechanism no longer applies to the served model — the finding is kept in
full because the general lesson is not dataset-specific.

The project was originally specified to use **per-outcome median imputation**
for the dataset's zero-encoded missing values, fitted on the training split
only. The split hygiene was correct, but the strategy leaks the target.

`Insulin` is missing in 374 of 768 rows (48.7%). Imputing from the median *of
the row's own outcome class* assigns every missing value exactly `100.0`
(non-diabetic) or `168.0` (diabetic). The imputed value **is** the label,
re-encoded as a feature.

| Imputation | Insulin importance | Test ROC-AUC |
|---|---|---|
| Per-outcome (as specified) | 0.409 | 0.941 |
| Plain train-median (**served**) | 0.066 | **0.813** |

Three independent signals identified the leak:

1. **Implausible score.** A 0.13 ROC-AUC gain from an imputation change alone
   is not a modelling improvement.
2. **Importance inversion.** The column with ~49% missingness became the single
   most predictive feature, a 6× rise, while clinically dominant features
   receded.
3. **Non-monotonic response.** Sweeping insulin produced `100 → Low risk`,
   `120 → High risk`, `165 → High risk` — the model had learned the imputation
   constants as landmarks, not a dose-response relationship.

The strategy is also undeployable independent of the metric: at inference time
the outcome is the quantity being predicted, so the imputation cannot be
reproduced — a train/serve mismatch stacked on the leak.

**Resolution at the time:** the training script fit both strategies, wrote
the comparison into model metadata as a teaching artifact, and always served
the leak-free model, defended by a monotonicity regression test. The current
codebase carries forward the same defensive pattern against the present
model (§5.1) rather than the specific imputation-comparison mechanism, which
no longer applies. Full analysis in [LEAKAGE.md](LEAKAGE.md).

**Generalised lesson:** splitting before preprocessing prevents *test-set*
leakage; it does nothing about *target* leakage. Any preprocessing step that
consults the target variable leaks it, even when correctly fitted on the
training split alone.

### 5.3 Data completeness: refusing to answer

The screening model needs all 21 of its trained BRFSS features. Unlike the
project's original Pima-based model — which hard-gated on sex because Pima
covers only one demographic — BRFSS surveys the general adult population, so
there is no population restriction to gate on (the one real constraint left
is that BRFSS's Sex question was coded binary, so a patient recorded as
anything other than female/male has no encoding the model can use). What
replaced the population gate is a **data-completeness check**: before
scoring, the agent confirms every required field is on file, and refuses
with a structured `unavailable_for_profile` response naming exactly what's
missing rather than substituting a value.

The concrete justification: demo patient C ships with a deliberately
incomplete history (missing `no_doc_bc_cost`, `education`, and `income`). If
those gaps are silently force-filled — with zeros, or with plausible
mid-range values instead — the model returns a confident **High-risk**
verdict either way (86% and 85% respectively). Two different guesses landing
on the same tier isn't reassurance that the guess was "close enough" — it's
exactly the failure mode refusal avoids: an incomplete profile produces a
specific, stable-looking number regardless of what fills the gaps. A silent
wrong answer is worse than a refusal, so refusal is the designed behaviour
and is surfaced prominently in the UI rather than hidden as an error.

### 5.4 Safety gate behaviour

Policy v1.0.0: 28 blocking patterns across 3 rule classes, 3 flagging rules,
and a disclaimer requirement on 4 output kinds.

| Rule class | Patterns | Verdict |
|---|---|---|
| `diagnostic_claim` | 10 | BLOCKED |
| `medication_advice` | 13 | BLOCKED |
| `false_certainty` | 5 | BLOCKED |
| `high_risk_tier` | — | FLAGGED |
| `large_simulation_swing` (>0.30 abs) | — | FLAGGED |
| `urgent_symptoms` | 9 | FLAGGED |
| Missing educational-scope marker | — | FLAGGED + disclaimer attached |

Verified by adversarial test: a simulated rogue LLM emitting *"You have
diabetes and should start taking metformin 500 mg daily"* is `BLOCKED`, the
text is replaced with a safe fallback, and the transcript is asserted never to
contain the unsafe string. This matters because the conversational agent's own
prompt restrictions are only a first line of defence — a 3B-parameter local
model cannot be trusted to police itself.

### 5.5 Simulation behaviour

BRFSS has no blood-glucose field (it's a survey, not a lab panel), so
`glucose_delta` — a hypothesis dimension in the project's original
Pima-based simulator — was retired; see §5.7. Forking the moderate-risk demo
patient (baseline 59.4%, Moderate) with a scenario of −8 kg plus becoming
physically active over 16 weeks produces a monotonic decline:

| Week | Risk | Tier |
|---|---|---|
| 0 | 59.4% | Moderate |
| 4 | 56.6% | Moderate |
| 8 | 56.6% | Moderate |
| 12 | 50.3% | Moderate |
| 16 | 49.6% | Moderate |

This particular scenario doesn't cross a tier boundary at this baseline — a
real, honestly-reported result rather than a cherry-picked one; the random
forest model's response to BMI is flatter in places than the earlier
logistic-regression Pima model's was. Every assumption applied is returned
with the projection and displayed beside the chart, including the
weight→BMI conversion, the assumed height when none is recorded, and — new
since the dataset switch — that physical activity and smoking status are
binary flags in the trained model, not continuous quantities: a hypothesis
to change either moves a display proxy toward 0 or 1 rather than scaling a
number.

### 5.6 Verification

- **107 backend tests** covering safety policy behaviour (block/flag/approve,
  determinism, word-boundary false positives, audit logging), eligibility
  gating, twin append-only semantics, simulation isolation from the real
  timeline, delta-model assumptions (including the binary-flag mechanics in
  §5.7), the free-text hypothesis parser, the evidence retrieval backends
  (including a regression guard on the cosine-similarity fix), and an
  end-to-end API smoke test over both a screening-eligible patient and one
  with an incomplete recorded history.
- **5 frontend tests** on safety banner and disclaimer rendering.
- **Browser verification:** all 7 pages driven end-to-end in Chromium with zero
  console or network errors.
- **Cold-boot reproducibility:** deleting the model artifacts and the database
  file, retraining, and restarting reproduces the full system — 8 tables
  auto-create and the complete pipeline runs.

### 5.7 Two enhancements, and a second finding along the way

Two follow-on enhancements were built after initial delivery: the semantic
RAG backend (originally implemented but never installed) and the free-text
what-if parser named in §4.5 of the architecture doc but not yet built.

**Enabling semantic RAG surfaced a second leak-shaped bug.** Once
`sentence-transformers` and `chromadb` were actually installed and exercised,
retrieval scores were implausible — deeply negative for objectively correct
top-1 matches (e.g. -0.605). The cause: Chroma creates new collections with
raw squared-L2 distance by default, not cosine similarity, and the existing
code computed `1.0 - distance` as if it were cosine — correct arithmetic,
wrong metric. Chroma's internal ranking (computed from its own distance
metric regardless of that score) still returned sensible top results for easy
queries, which is exactly why the bug wasn't visible until scores were
inspected directly rather than just ranked order. Fixed by setting
`{"hnsw:space": "cosine"}` explicitly at collection creation.

With the metric fixed, a 12-query head-to-head against the keyword ranker (6
with literal keyword overlap, 6 rephrased with none) gave an honest, modest
result:

| | Top-1 correct | Top-3 recall |
|---|---|---|
| Keyword ranker | 10/12 | 11/12 |
| Semantic (Chroma, cosine) | 10/12 | 12/12 |

Top-1 precision tied exactly. The real difference is recall: semantic search
never produced a total miss, including for the query with zero literal
keyword overlap with its source text ("what are the warning signs I should
watch for" → *Symptoms*) — the class of failure no amount of synonym-table
tuning can fix for a keyword ranker. It also has a genuine weakness the
keyword ranker doesn't share: "should I check my blood sugar at home" ranked
*Diagnosis and screening* above the more specific *Blood sugar monitoring*,
which literal keyword matching got right immediately. Neither backend
dominates; both now run for real, selected automatically by which import
succeeds.

**The what-if parser** (`app/agents/simulation_nlp.py`) is a deterministic
regex/keyword extractor, deliberately not an LLM — consistent with the
agent's existing principle that every projected number traces to an
inspectable rule. When a clause names a topic ("lost weight") without a
magnitude, the parser substitutes a fixed, documented default rather than
inventing one, and discloses the substitution in the same `assumptions` list
the delta model already returns. Text matching no recognizable topic-plus-
direction pattern is reported as such, with guidance toward the preset
scenarios, rather than silently defaulting to an empty simulation.

One ordering bug was caught by its own test suite before shipping: the
horizon phrase must be stripped from the input *before* per-topic magnitude
parsing runs, or "what if I exercised more over 12 weeks" reads the
horizon's "12" as an activity-minutes magnitude, since both extraction passes
would compete for the same number in the same string.

### 5.8 A follow-on request triggered a full dataset switch

After §5.7's enhancements shipped, a request came to add "10,000 more
entries" to the training data. Investigating it surfaced a fact the request
didn't anticipate: the Pima Indians Diabetes Dataset is fixed at exactly 768
rows — a specific historical collection, not something with an official
larger version. Any addition would have had to be fabricated. Doing that
quietly would have falsified the project's own claims about training on
real, unmodified public data — including the leakage analysis in §5.2 and
the "matches published Pima baselines" framing, both built on Pima being
exactly what the report says it is.

The dataset was switched instead, to a different, larger, **still-real**
public dataset: the CDC's 2015 BRFSS Diabetes Health Indicators survey
(253,680 responses, UCI ML Repository #891), public domain as a U.S.
government work. `pima.csv` has been removed from the repository.

This cascaded into three redesigns beyond the model itself, each verified
against the retrained model before being written down:

1. **Eligibility gating** (§5.3) — Pima's population restriction doesn't
   exist for BRFSS, replaced by the data-completeness check described there.
2. **The simulation hypothesis space** (§5.5) — no glucose field exists in
   BRFSS; `PhysActivity` and `Smoker` are binary flags, not continuous
   quantities, changing how two of four hypothesis dimensions are applied.
3. **The feature set and demo profiles** — 21 BRFSS columns replace Pima's
   eight; the intake form and all three demo profiles were rebuilt and
   re-tuned against the actual retrained model.

| | Pima (768 rows, 8 features) | BRFSS (253,680 rows, 21 features) |
|---|---|---|
| Algorithm selected | logistic regression | random forest |
| Test ROC-AUC | 0.813 | 0.818 |
| Test recall | 0.500 | 0.774 |
| Test precision | 0.600 | 0.330 |
| Top feature | Glucose | GenHlth |

Recall improved substantially; precision dropped in exchange — real
positives are a smaller share of BRFSS (~16%) than of Pima (~35%), and
`class_weight="balanced"` trades one for the other. Reported plainly rather
than picking whichever number looks best. Full writeup, including the exact
reasoning behind each redesign choice:
[ARCHITECTURE.md §13.7](ARCHITECTURE.md#137-the-training-dataset-was-switched-from-pima-to-cdc-brfss).

---

## 6. Limitations

Stated plainly, because several of them are structural rather than incidental.

1. **BRFSS is self-reported survey data, not lab measurements or a
   diagnosis.** Every field is a telephone-survey answer, subject to recall
   accuracy, non-response, and telephone-survey coverage bias. The model is
   an educational baseline demonstrating an interpretable ML pipeline, not a
   clinical or general T2D predictor, and the system says so rather than
   pretending otherwise.

2. **Low precision, by design tradeoff.** ROC-AUC 0.818, recall 0.774, but
   precision only 0.330 — most "elevated risk" flags would be false
   positives. This comes from class-balancing toward not missing positive
   cases (§5.1), a defensible choice for a screening tool, but a real cost
   stated plainly rather than buried under the headline ROC-AUC.

3. **23,899 duplicate rows (~9.4%) were kept, not dropped.** With 17 of 21
   features binary and the rest small-cardinality buckets, distinct real
   respondents sharing an identical answer profile is expected; there's no
   principled way to separate a "real" duplicate from a collection artifact.

4. **Two binary lifestyle levers have a genuinely small measured effect.**
   Flipping `PhysActivity` or `Smoker` alone moves the model's risk score by
   roughly 0.005–0.01 — far smaller than a comparable BMI change (§5.5). This
   is the model's honest behaviour on real survey data, not a bug; the
   simulator shows it as-is rather than exaggerating it.

5. **The simulation delta model is a heuristic**, not a validated
   physiological model. A trajectory shows the *sensitivity of the trained
   model* to changed inputs — it is not a forecast of clinical outcomes for a
   real person. Linear BMI accrual and the binary-flag interpolation (§5.5)
   are documented, defensible simplifications, not established clinical
   constants.

6. **The safety agent is a teaching implementation** of a governance pattern.
   Deterministic keyword and rule matching is bypassable by paraphrase, has no
   semantic understanding, and is not a substitute for regulatory clinical-AI
   review. It demonstrates the *architecture* of a governance layer — gate
   placement, verdict taxonomy, audit trail — not production-grade coverage.

7. **The local LLM is small** (3–4B parameters), so phrasing quality is limited
   relative to a large hosted model. Mitigated by RAG grounding, narrow topical
   scope, and independent safety gating.

8. **SQLite rather than PostgreSQL.** Postgres with `JSONB` was considered and
   initially specified: it would give indexable, queryable JSON payloads and
   real concurrent access, which is what a production event-sourced timeline
   would want. SQLite was chosen so the project runs with `pip install` alone —
   no server, no container runtime, no credentials for a grader to configure.
   The cost is accepted knowingly: JSON payloads are stored as TEXT and cannot
   be queried by key (the application reads whole payloads and folds them in
   Python), and concurrent writers would contend on a single file lock at
   scale. Neither bites for a single-user prototype, and because the schema is
   plain SQLAlchemy, migrating would mean changing a connection string and one
   column type — not the model layer.

9. **One optional non-free dependency.** The hosted Mistral chat backend is a
   paid API and the only component departing from the free/open-source
   constraint. It is disabled by default and entirely optional; every other
   agent is deterministic and runs fully offline.

10. **Not a clinical tool.** Coursework and demonstration only.

---

## 7. Reflection and Future Work

The project's most valuable output was not the model. Training a classifier on
a public health-survey dataset is a well-trodden exercise, and 0.818 ROC-AUC
is an ordinary result. What proved instructive was the recurring pattern of
catching a *specification* that was wrong — sometimes the model's, sometimes
the project's own — by refusing to accept a good-looking number, or a literal
reading of a request, at face value:

- A 0.94 ROC-AUC looked like success and was actually a leak (§5.2).
- A confident "Low risk" for a male patient looked like a working feature and
  was actually a category error about who the original Pima model applied to
  (superseded by §5.3's data-completeness redesign).
- Deeply negative "relevance" scores looked like bad semantic matches and
  were actually a distance metric mislabelled as a similarity (§5.7).
- A request to add "10,000 more entries" looked like routine data work and
  would, taken literally, have required fabricating data and quietly
  falsifying the project's own honesty claims (§5.8).

All four share a shape: the system — or the project itself — produced
output that was well-formed, plausible, and wrong. That is the failure mode
that matters in a health context, and the architectural response — a gate
that cannot be routed around, an eligibility check that prefers refusal, and
an audit trail that records every decision — is the part of this project
most worth carrying forward.

**Future work, in descending order of value:**

1. **Strengthen the safety gate semantically** — an embedding-based classifier
   for out-of-scope claims layered *behind* the deterministic rules, so the
   reproducible floor is preserved while coverage improves.
2. **Calibrate the model** (Platt scaling or isotonic regression) so displayed
   probabilities are interpretable as likelihoods rather than raw scores, and
   consider a decision threshold tuned to balance §5.1's precision/recall
   tradeoff more deliberately than the default 0.5 cutoff.
3. **Ground the delta model in published effect sizes** with cited sources and
   uncertainty bands, rather than the current transparent-but-unvalidated
   coefficients — particularly for the two low-effect binary levers noted in
   Limitations #4.
4. **Add clinician-in-the-loop review**, turning `FLAGGED_FOR_CLINICIAN_REVIEW`
   from a banner into an actual review queue with sign-off recorded in the
   audit log.
5. **Re-run training against a deduplicated split** (see Limitations #3) to
   check whether the 23,899 kept duplicate rows materially affect the
   reported metrics either way.

---

## 8. References

- CDC BRFSS 2015 Diabetes Health Indicators — UCI Machine Learning Repository
  #891 / Centers for Disease Control and Prevention Behavioral Risk Factor
  Surveillance System (U.S. government work, public domain). The project's
  active training source — see §5.8.
- Pima Indians Diabetes Dataset — UCI Machine Learning Repository / National
  Institute of Diabetes and Digestive and Kidney Diseases. The project's
  original training source (§5.8); its target-leakage finding is preserved
  in [LEAKAGE.md](LEAKAGE.md).
- CDC, "Diabetes Basics" — https://www.cdc.gov/diabetes/about/index.html
  (U.S. government work, public domain under 17 U.S.C. §105)
- WHO, "Diabetes" fact sheet —
  https://www.who.int/news-room/fact-sheets/detail/diabetes
  (© WHO; used with attribution under WHO's copyright and permissions policy:
  https://www.who.int/about/policies/publishing/copyright — not public domain)
- LangGraph documentation — https://langchain-ai.github.io/langgraph/
- Ollama — https://ollama.com

**Project documents:** [README.md](../README.md) ·
[ARCHITECTURE.md](ARCHITECTURE.md) · [LEAKAGE.md](LEAKAGE.md)
