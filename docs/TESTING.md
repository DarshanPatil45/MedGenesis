# MedGenesis — Testing (Phase 8)

Exact counts, not estimates — collected live during Phase 8 via
`pytest --collect-only -q` and `vitest run --reporter=verbose`. No test was
deleted, weakened, or given a reason to skip during this phase.

## 1. Backend — 391 tests total (390 passed, 1 skipped by design, 0 failed)

```
cd backend && source venv/bin/activate && python -m pytest -q
```

Runtime: ~65-70s on the machine this was validated on (includes one live
retraining of the XGBoost candidate — see §4).

| File | Tests | What it covers |
|---|---:|---|
| `test_app_startup.py` | 2 | App boots, routers mount |
| `test_clinical_agent.py` | 34 | Clinical Analysis Agent: claim construction, model composition, hallucination defense, privacy boundary |
| `test_clinical_analysis_api.py` | 18 | `POST /api/clinical/analyze` — request/response contract, production-vs-candidate labeling, medication-history-is-not-advice |
| `test_digital_twin_api.py` | 16 | Digital Twin HTTP endpoints |
| `test_digital_twin_phase2.py` | 36 | Lab/medication materialization, trend labels (0/1/2/3+ points), stopped/restarted medications, structured twin shape |
| `test_e2e_smoke.py` | 8 | End-to-end smoke over the real API, including the metformin-block regression |
| `test_end_to_end_integration.py` | 2 | Full-pipeline integration |
| `test_error_resilience.py` | 10 | Missing artifacts, Chroma failure, PubMed failure, LLM unavailable, unparseable simulation, malformed/invalid requests |
| `test_evidence_api.py` | 11 | `POST /api/evidence/search` |
| `test_hallucination_defense.py` | 17 | Model-name mismatch, numeric-score mismatch, end-to-end flag propagation |
| `test_ml_api.py` | 8 | `GET /api/ml/comparison`, `POST /api/ml/xgboost/predict` |
| `test_multi_source_evidence.py` | 23 | `source="local"/"pubmed"/"all"`, RRF fusion, cross-source dedup |
| `test_phase1_scaffolding.py` | 11 | RF artifact loading, scoring |
| `test_privacy.py` | 8 | Secrets never reach the client, patient IDs never reach PubMed/LLM prompts, no patient data in logs |
| `test_pubmed.py` | 27 | `EutilsPubMedClient` — ESearch/EFetch parsing, retry, malformed XML, API-key-not-logged |
| `test_pubmed_evaluation.py` | 6 | Retrieval-evaluation infrastructure; confirms the expert-labelled set ships empty by design |
| `test_pubmed_live.py` | 1 | Live NCBI round-trip — **skipped by default**, opt-in only |
| `test_rag.py` | 13 | Local retrieval (both backends) |
| `test_rag_boundaries.py` | 22 | Relevance thresholds, prompt-injection data/instruction boundary |
| `test_safety_agent.py` | 17 | Block/flag/approve rules, determinism, word-boundary false positives, audit logging |
| `test_screening_agent.py` | 29 | Screening baseline, eligibility gating |
| `test_simulation_nlp.py` | 24 | Free-text what-if parsing |
| `test_twin_and_simulation.py` | 16 | Twin fork/simulation isolation from the real timeline |
| `test_xgboost_model.py` | 32 | XGBoost training pipeline, metrics, explainability |
| **Total** | **391** | |

The one skip is `test_pubmed_live.py::test_live_search_returns_real_pmid_
and_title` — deliberately opt-in (`MEDGENESIS_RUN_LIVE_PUBMED_TEST=true` +
`PUBMED_EMAIL` required) because it makes a real network call to NCBI.
**Manually run during Phase 8** (see [EVALUATION.md](EVALUATION.md) §5) —
passed, returning two real PMIDs. It is not part of the default/required
suite and is not counted toward the "390 passed."

## 2. Frontend — 26 tests total, 3 files, all passed, 0 failed, 0 skipped

```
cd frontend && npx vitest run
```

| File | Tests |
|---|---:|
| `src/components/SafetyBanner.test.tsx` | 5 |
| `src/components/EvidenceCitation.test.tsx` | 7 |
| `src/pages/ClinicalAnalysisPage.test.tsx` | 15 |
| **Total** | **26** |

## 3. Before / after this phase

Backend was not modified in Phase 8 (validation found no genuine bug
requiring a code change), so before and after are identical:

| | Before Phase 8 | After Phase 8 |
|---|---:|---:|
| Backend passed | 390 | 390 |
| Backend skipped | 1 | 1 |
| Backend failed | 0 | 0 |
| Frontend passed | 26 | 26 |
| Frontend failed | 0 | 0 |

Frontend was also not modified in Phase 8 — its 18 → 26 growth happened in
the immediately preceding frontend-polish phase (commit `222ac6a`), before
Phase 8 began; Phase 8's own baseline (recorded first, before any Phase 8
work) already showed 26. No test was added, removed, or changed during
Phase 8 itself — this phase's job was to validate the existing suite is
accurate and passing, and it is.

## 4. A test-suite side effect worth knowing about

Running the backend suite **retrains the XGBoost candidate model live**:
`test_xgboost_model.py` uses a module-scoped fixture that calls
`train_module.train_and_evaluate()` for real, not just loading a persisted
artifact — this is why
`app/ml/xgboost_model/artifacts/xgboost_model_metadata.json` (and its
`.joblib` files) show a fresh `trained_at` timestamp and slightly different
timing numbers after every test run. The RandomForest, by contrast, is
**never** retrained by any test — every test that touches it loads the
persisted artifact.

Because the hyperparameter grid and `random_state=42` are fixed, this
retraining is deterministic: the reported metrics (accuracy, precision,
recall, F1, ROC-AUC, confusion matrix, feature importances) are identical
across runs — only wall-clock timing fields and the timestamp differ. This
was confirmed directly during Phase 8 by diffing the metadata file before
and after a test run. It means the timestamp/timing-only diff in that one
file is expected after running tests and is correctly excluded from
commits (matching the convention already established in every prior phase
of this project).

## 5. Build

```
cd frontend && npm run build
```

Passes: `tsc -b && vite build` completes with no errors. One pre-existing
warning (one JS chunk over Vite's 500KB default threshold, driven by
`recharts`) — not a defect, not new to this phase, tracked in
[LIMITATIONS.md](LIMITATIONS.md).

## 6. What is not automated

- Live PubMed connectivity (§1 — opt-in, network-dependent by nature).
- Browser-driven visual QA (alignment, responsive breakpoints, focus
  states) — done manually with a live-driven browser in the frontend-polish
  phase and spot-checked again in Phase 8 (see
  [EVALUATION.md](EVALUATION.md) §9); not part of the `vitest`/`pytest`
  suites, and not claimed to be.
- Any form of clinical-accuracy or expert-relevance testing — no such
  ground truth exists in this project (see [LIMITATIONS.md](LIMITATIONS.md)).
