# MedGenesis — Safety (Phase 8 validation)

What the Safety Agent actually does, verified against the current code and
its test suite during Phase 8. This is a validation document, not a design
proposal — every claim below traces to a specific file and, where relevant,
a specific passing test.

## 1. What it is

`app/agents/safety_agent.py` + `app/agents/safety_policies.yaml`: a
**deterministic, declarative policy engine**, not an LLM judging free text.
Same input text always produces the same decision (`policy_version:
"1.1.0"`, asserted by `tests/test_safety_agent.py::test_decisions_are_
deterministic`). This is a deliberate tradeoff, stated in the policy
file's own header comment: determinism and a reproducible audit log over
the flexibility an LLM-based judge would offer.

Three possible verdicts (`app/agents/safety_agent.py`):

| Verdict | Behavior |
|---|---|
| `APPROVED` | Output shown unchanged |
| `FLAGGED_FOR_CLINICIAN_REVIEW` | Output shown, with a banner and the specific reason(s) attached |
| `BLOCKED` | Output replaced entirely with a safe fallback message; the original text is discarded, never returned to the client, never persisted |

## 2. Where it runs in the pipeline

Confirmed by reading `app/agents/orchestrator.py`: every one of the four
LangGraph routes (`intake`, `simulation`, `chat`, `clinical`) has a fixed,
unconditional edge into `safety_node`, and `safety_node` is the only node
with an edge to `END`. There is no route that can reach the API response
without passing through the safety gate — this is enforced by the graph's
edge structure, not by convention.

For the `clinical` route specifically (the one Phase 8's spec calls out):
`graph.add_edge("clinical", "safety")` — the Clinical Analysis Agent's
output is *always* reviewed after it is generated, never before, and never
skipped. Verified live: `orchestrator.py`'s `clinical_node` docstring
states this explicitly, and the graph wiring matches.

## 3. What gets blocked, and why

From `safety_policies.yaml`, three block rules, matched case-insensitively
against the output's user-visible text:

- **`diagnostic_claim`** — phrases like "you have diabetes," "your
  diagnosis is," "you do not have diabetes." Educational screening tools
  do not diagnose; this is enforced regardless of what the underlying model
  score was.
- **`medication_advice`** — phrase-level patterns only: "start taking,"
  "stop taking," "increase your dose," "mg daily," "prescribe," "units of
  insulin," etc. — see §5 below for why this is phrase-level and not a
  drug-name list.
- **`false_certainty`** — "guaranteed to prevent," "you will definitely
  develop," "cures diabetes." No absolute clinical guarantee is permitted.

A block clears the offending text entirely and substitutes
`blocked_fallback_text` (a fixed, policy-defined message explaining why,
and what the user can still ask about).

## 4. What gets flagged (shown, with a warning)

- **`high_risk_tier`** — a High screening-risk result is shown, with
  "recommended: review with a clinician" attached. Flagging, not blocking,
  because a legitimate elevated-risk result is exactly the kind of output
  this system exists to surface — it just must not be presented without a
  clinician-review recommendation.
- **`large_simulation_swing`** — a What-if projection whose risk
  probability changes by more than 0.30 across the trajectory is flagged as
  exceeding "the plausibility threshold for this heuristic delta model,"
  since the simulator is a documented heuristic, not a validated
  physiological model.
- **`urgent_symptoms`** — if the user's own message mentions "chest pain,"
  "can't breathe," "fainted," "blurred vision," etc., the reply is flagged
  regardless of its own content, directing the user toward care.
- **Missing scope marker** — if upstream code fails to attach the
  educational-scope disclaimer, the gate attaches it itself and records
  this as a flag reason (`test_missing_scope_marker_is_flagged_and_
  disclaimer_still_attached`) rather than silently letting undisclaimed
  output through.

## 5. The metformin false-positive — a real, already-fixed bug

Phase 8's brief specifically asked for attention here. This is a genuine,
historical bug, already found and fixed in an earlier phase, with a
regression comment and test still in place:

**The bug:** an earlier version of `medication_advice` blocked on the bare
drug name "metformin" anywhere in the output. The Clinical Analysis Agent
is explicitly required (Phase 6/7) to be able to state a patient's own
recorded medication history as neutral fact — e.g. "Current medication
history includes: Metformin." — because that is what the Digital Twin's
event log actually contains, and displaying it is not advice. The bare-name
rule blocked this factual statement, indistinguishable from actual advice
("you should start taking metformin").

**The fix (already in place, verified during Phase 8):** every pattern
under `medication_advice` in `safety_policies.yaml` is phrase-level and
drug-name-agnostic — "start taking," "mg daily," "prescribe," etc. — so
genuine advice is still caught regardless of which drug is named ("start
taking metformin" still matches "start taking"), while a bare mention of a
recorded medication name passes through untouched. The YAML file carries an
inline comment recording exactly this history.

**Verified still correct in Phase 8:**
- `tests/test_clinical_agent.py` — a fixture patient with a recorded
  Metformin history; `TestPrivacyBoundary`/related tests confirm
  "Metformin" reaches `patient_summary` as a claim.
- `tests/test_clinical_analysis_api.py` (line ~57) — an explicit comment
  and test asserting that displaying Metformin history is not blocked,
  while a mocked LLM claim of "You should start taking metformin
  immediately" *is* stripped before reaching the response
  (`assert "metformin" not in ... integrated_analysis`).
- `tests/test_e2e_smoke.py` — a mocked chat reply "You have diabetes and
  should start taking metformin 500 mg daily" is asserted blocked
  end-to-end via the real API.
- `tests/test_safety_agent.py::test_word_boundary_prevents_false_positive`
  — a related, adjacent regression: "a prescribed exercise programme" must
  not match the `prescribe` pattern via substring; word-boundary matching
  is used, not naive substring search.

All of the above pass in the current test suite (part of the 390 backend
passes recorded in the Phase 8 baseline). No safety rule was weakened to
make any test pass — the fix works by making the *advice-detection*
patterns broader and drug-name-independent, not by removing detection.

## 6. Blocked-output leak prevention, specifically for Clinical Analysis

Read directly from `orchestrator.py::safety_node`'s `clinical` branch: when
a clinical-analysis decision is `BLOCKED`, the handler clears
`patient_summary`, `model_analysis`, `evidence_findings`, and `citations`
entirely, and replaces `integrated_analysis` with a single claim containing
only the safety fallback text. This is deliberate defense against a
partial leak — a structured response has several fields any one of which
could otherwise still carry the withheld content even if only one field
were "fixed." Frontend behavior matches: `ClinicalAnalysisPage.tsx` renders
an "Analysis withheld" card and nothing else when `safety.status ===
'BLOCKED'`; the automated frontend test
`renders a blocked analysis without leaking withheld content` asserts the
withheld text never appears in the DOM.

## 7. What this is not

- **Not a semantic content judge.** The gate matches literal phrases
  (word-boundary-aware, case-insensitive), not meaning. Genuinely unsafe
  content phrased to avoid every listed pattern would not be caught. This
  is a named limitation, not implied to be otherwise anywhere in this
  project's documentation (see [LIMITATIONS.md](LIMITATIONS.md)).
- **Not regulatory-grade clinical-AI review.** This is, in the policy
  file's own words, a teaching implementation of a governance pattern:
  deterministic, auditable, and reproducible for grading — not a substitute
  for a real clinical-safety review process.
- **Not authentication or access control.** The safety gate reviews
  *content*, not *who is asking*. See [PRIVACY.md](PRIVACY.md) for the
  separate, real gap around authentication/authorization.

## 8. Audit trail

Every safety decision is written to the append-only `safety_audit_log`
table (`agent.review_and_log()`), recording target type/id, status,
reasons, and policy version — visible on the frontend's "Agent Trace &
Safety" page. `tests/test_safety_agent.py::test_review_and_log_writes_
audit_row` confirms a row is actually written, not just decided in memory.
