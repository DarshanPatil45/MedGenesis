# MedGenesis — Privacy & Security (Phase 8 validation)

What actually exists, verified against the current code and its test
suite during Phase 8, and what genuinely does not exist. This project has
**no authentication or authorization layer** — that is stated here plainly,
not minimized, and is tracked as the top future-work priority (see
[FINAL_REPORT.md](FINAL_REPORT.md) §20).

## 1. What was audited

- Secrets (API keys) never reaching the browser or an API response.
- Patient identifiers never entering a PubMed query.
- Patient identifiers never entering an LLM prompt.
- Patient pseudonyms/raw values never entering application logs.
- Browser-side storage (frontend) — what it holds and where it's scoped.
- Error messages — no stack traces or internal paths exposed to the client.

All of the above are covered by real, currently-passing automated tests
(`backend/tests/test_privacy.py`, plus related tests in
`test_clinical_agent.py` and the frontend suite), not only by manual
inspection — though manual inspection of the actual code paths was also
done, and is recorded below.

## 2. Secrets

- `PUBMED_API_KEY`, `PUBMED_EMAIL`, `MISTRAL_API_KEY` are read from
  environment variables only (`os.environ.get(...)`), never hard-coded.
- `backend/.env.example` contains only placeholders/blank values, is
  tracked in git; `backend/.env` (the real file, if a developer creates
  one) is gitignored. Confirmed via `git ls-files` that no `.env` file
  (only `.env.example`) is tracked anywhere in the repository.
- `tests/test_privacy.py::TestSecretsNeverReachTheClient` — three tests
  monkeypatch fake secret values into `MISTRAL_API_KEY` and
  `PUBMED_API_KEY` and assert they do not appear in `/api/health`,
  `/api/evidence/search`, or `/api/clinical/analyze` response bodies. All
  pass currently.
- `httpx`'s own request-line logger is explicitly capped at `WARNING` in
  `app/services/pubmed.py` (module import time), specifically because
  `api_key` is a URL query parameter for NCBI E-utilities and httpx's
  default `INFO`-level logging would otherwise print the full request URL
  — including the key — in plaintext. This is a real, already-applied fix
  with an inline comment recording that it previously failed
  (`test_api_key_not_logged`) when the application's root logger was
  raised to `INFO` by `app/main.py`'s startup, despite passing when the
  test file ran in isolation. Frontend: no API key, secret, or credential
  is referenced anywhere in `frontend/src/**` — confirmed by a Phase 8
  grep across every changed/relevant frontend file, and the Vite env var
  used (`VITE_API_BASE_URL`) is a plain backend URL, not a secret.

## 3. Patient identifiers vs. PubMed

`app/agents/clinical_agent.py::_build_evidence_query` — its own docstring
states "Clinical concepts only — never patient_id, name, or raw values,"
and the implementation matches: it builds a query from clinical concept
*labels* (mapped from feature names via `_FIELD_LABELS`) and the user's
free-text question only. No patient ID, pseudonym, or database key is
concatenated into the query at any point in the call chain from
`clinical_agent.py` through `rag.py::search_evidence` to
`pubmed.py::EutilsPubMedClient.search`.

`tests/test_privacy.py::TestPubMedQueryNeverContainsPatientIdentifiers`
injects a tracking PubMed client, runs a real `/api/clinical/analyze`
request with `include_pubmed=true`, captures the literal query string sent,
and asserts neither the patient's numeric ID nor pseudonym appears in it.
Currently passing.

**Named boundary, not silently ignored:** the free-text *question* field
itself is user-supplied and passed through to the evidence query mostly
verbatim (concept-expanded, not identifier-stripped). If a user manually
types an identifying string into the question box, that string could reach
the PubMed query — the system does not scrub arbitrary free text for PII.
This is inherent to any system that accepts a free-text research question
and is not remediated here; general-purpose PII scrubbing of open-ended
text was correctly out of scope for a validation phase (see
[LIMITATIONS.md](LIMITATIONS.md)).

## 4. Patient identifiers vs. LLM prompts

`tests/test_privacy.py::TestLLMPromptBoundary::test_clinical_agent_llm_
prompt_never_contains_patient_id` builds a real prompt via
`ClinicalAnalysisAgent._llm_prompt(...)` and asserts neither `"patient_id"`
nor a sample numeric ID (`"987654"`) appears anywhere in the resulting
text. The prompt is built from the same pre-computed claim objects
(`patient_summary`, `model_analysis`) and evidence chunks that are already
scoped to clinical concepts and evidence text — no raw patient-table row or
database key is interpolated into it.

Separately, the prompt-injection boundary (`SOURCES_DELIMITER_START`/`_END`,
shared between the Conversational and Clinical Analysis agents) ensures
retrieved evidence text — local or PubMed, neither of which this project
controls the content of — is wrapped as data the LLM is instructed never to
treat as an instruction. See [SAFETY.md](SAFETY.md) and
[tests/test_rag_boundaries.py::TestPromptInjectionBoundary].

## 5. Application logs

`tests/test_privacy.py::TestPatientDataNeverLogged` — two tests, both
passing:
- Runs a real Clinical Analysis request for a real demo patient with
  `caplog` at `DEBUG` level, and asserts the patient's pseudonym (a
  realistic, identifying-shaped synthetic string) does not appear anywhere
  in the captured logs, even though the API response itself legitimately
  contains related data.
- Posts a distinctive evidence-search query string and asserts the raw
  query text does not appear in logs (PubMed/RAG query logging records
  latency and query *length*, not query *content* —
  `logger.info("PubMed %s ok (latency=%.3fs, query_len=%d)", ...)` in
  `pubmed.py`, confirmed by direct code reading).

## 6. Frontend: browser state and console

Audited during the immediately preceding frontend-polish phase and
re-confirmed unchanged in Phase 8 (no frontend files were modified this
phase):

- `localStorage` use is limited to one key
  (`medgenesis.selectedPatientId`, in `PatientContext.tsx`) — a numeric
  patient ID for restoring the active-patient selection across reloads,
  not a name, pseudonym, or clinical value.
- Zero `console.log`/`console.debug`/`console.info`/`console.warn` calls
  exist anywhere in `frontend/src/pages/ClinicalAnalysisPage.tsx`,
  `frontend/src/components/EvidenceCitation.tsx`, `frontend/src/App.tsx`,
  or `frontend/src/api/client.ts` (grepped directly).
- Error messages shown to the user come from `ApiError`'s message (the
  backend's own `detail` field, or a generic "cannot reach the API"
  string) — never a raw stack trace or internal file path.

## 7. Error messages (backend)

FastAPI's default validation/error responses are used — a malformed
request body returns `422` with a Pydantic-generated field-level error, an
unknown patient ID returns `404` with a plain message, neither of which
exposes a stack trace, file path, or internal exception detail beyond what
FastAPI's standard `HTTPException`/`RequestValidationError` handling
already provides. `tests/test_error_resilience.py::TestInvalidRequestsAtTheAPI`
confirms these are `404`/`422`, not `500`s that could leak a traceback.

## 8. What genuinely does not exist (the real gap)

- **No login, no session, no user identity of any kind.** Any client that
  can reach the API (which, per `app/main.py`'s CORS policy, is restricted
  to `localhost`/`127.0.0.1` origins in a browser context, but *not*
  restricted for a direct API client such as `curl` or Swagger UI) can
  read or write any patient's data.
- **No per-patient access scoping.** There is no concept of "this
  clinician may only see these patients" anywhere in the schema or the
  API layer.
- **The audit log records safety decisions, not requester identity** —
  useful for reviewing what content was approved/flagged/blocked and under
  which policy version, not useful as an access log, because there is no
  identity to record.
- This is unchanged by Phase 8. Per this phase's explicit brief, a
  superficial authentication layer was not added without a genuine
  security design behind it — the gap is documented here and prioritized
  in [FINAL_REPORT.md](FINAL_REPORT.md)'s future-work roadmap instead.

## 9. Data itself

All patient data reachable in this repository's default state is
synthetic, generated by `app/ml/synthetic_patients.py` (three demo
profiles) or created via the Intake page's manual-entry form, which
produces a fresh synthetic record with a user-chosen pseudonym — never
real patient data. The training dataset (BRFSS 2015) is public,
government, de-identified survey data by its own design (CDC), not
individually identifiable.
