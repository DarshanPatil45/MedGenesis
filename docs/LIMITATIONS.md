# MedGenesis — Limitations

Phase 8 deliverable. This is the single, consolidated list of every
material limitation in the current repository, written plainly and without
hedging. Individual docs ([ML.md](ML.md), [RAG.md](RAG.md),
[CLINICAL_ANALYSIS.md](CLINICAL_ANALYSIS.md), [ARCHITECTURE.md](ARCHITECTURE.md))
discuss most of these in more depth where relevant; this file exists so a
reviewer does not have to hunt across eight documents to get the full list.

MedGenesis is a research/decision-support prototype. It is not a clinical
tool, has not been clinically validated, and none of the limitations below
are hidden elsewhere in the documentation.

## Clinical scope

- **No clinical validation.** No component — the RandomForest baseline, the
  XGBoost candidate, the Clinical Analysis Agent's synthesis, or the What-if
  Simulation — has been validated against real clinical outcomes, reviewed
  by a clinician, or evaluated in a clinical setting.
- **No diagnosis capability.** The system never states whether a patient
  has, does not have, or will/will not develop diabetes or prediabetes. The
  Safety Agent blocks diagnostic phrasing outright (`safety_policies.yaml`,
  `diagnostic_claim` rule).
- **No treatment authority.** The system never recommends starting,
  stopping, or changing a medication or dose. Recorded medication history is
  displayed as fact ("Current medication history includes: Metformin"),
  never as a recommendation — the exact wording is asserted by tests
  (`tests/test_clinical_analysis_api.py`).
- **Prototype, not a production clinical system.** No deployment
  architecture, no uptime/availability guarantees, single-process SQLite,
  local-only CORS.

## Dataset

- **Self-reported survey data, not lab measurements.** The screening
  baseline and XGBoost candidate both train on the CDC's 2015 BRFSS Diabetes
  Health Indicators survey (UCI ML Repository #891) — 253,680 responses to a
  telephone survey. Every field is what a respondent said, not a measured
  lab value, and carries the biases inherent to self-report and telephone-
  survey coverage.
- **Binary target transformation.** The source label (`Diabetes_012`) is
  three-class: no diabetes (84.3%), prediabetes (1.8%), diabetes (13.9%).
  Both models train on this collapsed to binary (0 vs. {1, 2}) so an
  educational screening tool flags elevated risk, prediabetes included, not
  only a diagnosed case. This is a deliberate, documented choice
  (`app/ml/train_screening_model.py`), not an oversight — but it does mean
  "positive" is a coarser category than "diagnosed diabetes."
- **Known train/test duplicate characteristic.** The source CSV contains
  exact-duplicate rows: 23,899 when counted against the original three-class
  label + 21 features (RandomForest's count), 23,968 when counted against
  the binarized target instead (XGBoost's count) — both ~9.4% of the data.
  These are kept, not dropped: with 17 of 21 features binary and the rest
  small-cardinality buckets, two respondents legitimately sharing an
  identical answer profile is expected, not a collection error, and
  dropping them would arbitrarily bias the sample toward less-common
  profiles. See [LEAKAGE.md](LEAKAGE.md) for the related, distinct
  target-leakage finding from the project's original (now-removed) Pima
  dataset.
- **Single held-out split.** Both models are evaluated on one fixed 80/20
  stratified split (`random_state=42`), not repeated resampling or nested
  cross-validation. The RandomForest additionally reports 5-fold CV
  ROC-AUC on the training split during model selection
  (`screening_model_metadata.json`); the reported test metrics themselves
  come from the one held-out split.
- **No lab-aware model.** Neither model takes an HbA1c value, a fasting
  glucose value, or any other lab result as an input feature — the Digital
  Twin records lab history, but no current model consumes it. BRFSS has no
  such field to train against.

## Machine learning

- **Low precision, by design tradeoff.** RandomForest: accuracy 0.7164,
  precision 0.3297, recall 0.7745, F1 0.4625, ROC-AUC 0.8185. XGBoost:
  accuracy 0.7206, precision 0.3352, recall 0.7865, F1 0.4701, ROC-AUC
  0.8255 (both reproduced from stored artifacts during Phase 8 — see
  [ML_VALIDATION.md](ML_VALIDATION.md)). Precision this low means most
  "elevated risk" flags would be false positives at a population level;
  this follows directly from class-weight-balancing toward not missing
  positive cases, a defensible tradeoff for a screening tool but a real
  cost, stated plainly rather than buried behind the headline ROC-AUC.
- **XGBoost is a candidate, not the production model**, and this phase does
  not change that. It scores marginally higher on every reported metric
  (+0.004 to +0.012) but has not been promoted; nothing in the codebase
  treats it as authoritative, and the frontend visually and textually
  distinguishes "Production" from "Candidate" throughout.
- **No external validation dataset.** Both models are trained and tested
  on partitions of the same BRFSS 2015 file. Performance on a different
  year's survey, a different population, or real clinical data is unknown.
- **No calibration check.** Predicted probabilities are used to assign risk
  tiers (Low/Moderate/High via fixed 0.33/0.66 cutoffs) but have not been
  checked for calibration (e.g. a reliability diagram) — a "0.6" score is
  not verified to correspond to an actual ~60% empirical event rate.
- **No subgroup evaluation.** Metrics are reported in aggregate only. No
  breakdown by age, sex, or other subgroup has been computed, so
  differential performance across populations is unknown and unclaimed.

## Explainability

- **SHAP and native feature importance describe the model, not the
  patient's biology.** Every place these values are surfaced — API schema,
  Clinical Analysis Agent claims, frontend copy — states this explicitly.
  Neither is, or is presented as, a cause of the patient's risk.
- **RandomForest exposes aggregate importance only.** Its feature
  contributions are trained-model-level, not specific to any one patient —
  the Clinical Analysis Agent's own generated text says so ("aggregate,
  trained-model-level, not specific to this patient"). Only the XGBoost
  candidate computes true per-patient SHAP values (`explain.py`,
  `TreeExplainer` on the single feature vector).

## Evidence / RAG

- **Small local corpus.** The local knowledge base is two source documents
  (CDC "Diabetes Basics", WHO "Diabetes" fact sheet), chunked by markdown
  section. It is sufficient for the project's educational scope, not a
  comprehensive medical literature base.
- **PubMed is abstract/metadata scope only.** The system retrieves title,
  abstract, journal, year, authors, PMID, DOI, and article type via NCBI
  E-utilities — never full text, which E-utilities does not provide for
  most articles.
- **No expert-labelled PubMed evaluation set.** Retrieval-quality
  infrastructure (Hit@K, MRR) exists and is tested
  (`app/services/retrieval_evaluation.py`,
  `tests/test_pubmed_evaluation.py`), but the expert-labelled ground-truth
  set (`PUBMED_EXPERT_EVALUATION_SET`) ships empty by design — no domain
  expert has labelled query/result relevance. No PubMed retrieval-accuracy
  number is claimed anywhere in this project, and none should be inferred
  from the presence of the evaluation machinery.
- **Relevance thresholds are retrieval-quality cutoffs, not medical
  judgments.** Both the keyword fallback's `MIN_RELEVANCE_SCORE = 0.5` and
  the embedding backend's `MIN_RELEVANCE_SCORE = 0.15` were calibrated
  empirically against a small probe set of on-topic/off-topic queries
  (documented inline in `app/services/rag.py`), not against any clinical
  relevance standard.

## Grounding / hallucination defense

- **Grounding controls reduce specific classes of unsupported output — they
  do not guarantee the system cannot hallucinate.** What is actually
  implemented and tested: fabricated `[E#]` evidence citations are stripped
  and flagged (`_validate_citations`); a claimed model name that wasn't
  actually used is flagged; a claimed numeric model score that doesn't
  match the real computed score (outside a small rounding tolerance) is
  flagged. See [tests/test_hallucination_defense.py] and
  [tests/test_clinical_agent.py::TestHallucinationDefense].
- **Patient-value hallucination is not fully validated.** There is no
  automated check that every specific patient value (e.g. a stated BMI or
  blood-pressure figure) mentioned in LLM-generated prose was actually
  present in the supplied patient data, distinct from the evidence-ID and
  model-score checks above, which do exist. This is a real, named boundary
  of current grounding coverage, not a claim that it doesn't matter.
- **The rule-based (non-LLM) synthesis path used when no LLM backend is
  configured is template-driven and inherently cannot hallucinate free
  text** — but it also cannot produce natural-language synthesis; it
  produces the same structured claims either way.

## Safety

- **The safety gate is a teaching implementation of a governance pattern**,
  not regulatory-grade clinical-AI review. It is a deterministic keyword/
  phrase policy engine (`safety_policies.yaml`), not a model that
  understands meaning — genuinely dangerous content phrased to avoid every
  listed pattern would not be caught. Determinism and auditability were
  chosen deliberately over more flexible (but non-reproducible) LLM-based
  moderation.
- **The local LLM (when configured) is small** (3–4B parameters via
  Ollama), so phrasing quality is limited; this is mitigated by RAG
  grounding, a narrow system prompt, and independent safety-gate review of
  its output — the LLM's own prompt instructions are not trusted alone.

## Privacy / security

- **No authentication or authorization layer exists.** Any client that can
  reach the API can read and write any patient's data; there is no login,
  no session, no per-user access control, and no concept of "whose patient"
  a record is. CORS is restricted to localhost origins only
  (`app/main.py`), which limits browser-based cross-origin access in
  practice but is not an authorization mechanism.
- **No audit trail of who accessed what** — the existing
  `safety_audit_log` records every safety decision (useful for reviewing
  what the system approved/blocked and why) but does not record a
  requesting user's identity, because no such identity exists in the
  system.
- **All patient data in this repository is synthetic or explicitly
  demo-generated** (`app/ml/synthetic_patients.py`); nothing here has been
  used with real patient data, and the project should not be pointed at
  real patient data without first adding the access-control layer above.

## Frontend

- **No redesign attempted or needed this phase** — Phase 8 validated the
  existing UI (built and polished across Phases 6/7 and a dedicated
  frontend-polish phase, commit `222ac6a`) and found it consistent,
  responsive (1440/1024/768/390px, no horizontal scroll), and accessible
  (labelled controls, visible focus states, no color-only distinctions).
  No frontend code changed in Phase 8.
- **Bundle size warning.** The production build emits one ~671KB JS chunk
  (recharts is the primary contributor), above Vite's default 500KB
  warning threshold. Functional, not a defect, but code-splitting is listed
  as future work rather than fixed here (see
  [Future work](FINAL_REPORT.md#20-future-work)).

## Performance

- **Runtime measurements in this project are prototype, single-machine
  observations, not a rigorous benchmark** — single process, no load
  testing, no percentile distributions, small sample sizes. See
  [EVALUATION.md](EVALUATION.md) §11 for the actual numbers and
  methodology.
- **`GET /api/ml/comparison` and any Clinical Analysis request with
  `include_model_comparison=true` cost roughly 0.55–0.68s consistently**
  (no warm-cache improvement across repeated calls), because
  `model_comparison.compare()` re-evaluates the RandomForest against the
  full 50,736-row held-out test set on every call rather than caching the
  result, and XGBoost's per-patient SHAP path constructs a new
  `TreeExplainer` per request. Both are legitimate, measured costs, not
  bugs; caching either is listed as future work.

## Deferred by explicit instruction

- **MCP** was evaluated and deliberately deferred (see
  [CLINICAL_ANALYSIS.md § MCP decision](CLINICAL_ANALYSIS.md)); Phase 8
  does not revisit that decision.
- **Authentication/authorization** is documented here as a real gap, not
  implemented — adding a superficial auth layer without a genuine security
  design was explicitly out of scope for this phase.

## Not measured

The following are explicitly **not measured** anywhere in this project, and
no number for them appears in any document:

- Clinical accuracy or clinical validity of any kind.
- Expert-labelled PubMed relevance / retrieval accuracy.
- Hallucination rate (a rate implies a denominator and a labelled ground
  truth this project does not have; specific, tested failure modes are
  listed above instead).
- User-study results of any kind — no user study has been conducted.
- LLM response latency, when no LLM backend is configured in the
  environment (the deterministic rule-based fallback path was what was
  actually measured — see [EVALUATION.md](EVALUATION.md)).
