# RAG / Evidence Retrieval

Phase 4. Audited the existing implementation first (Step 1) — everything
described as "existing" below predates this phase and was found by reading
`app/services/rag.py`, `app/agents/evidence_agent.py`,
`data/knowledge_base/*.md`, `app/services/llm.py`, `app/schemas.py`, and
`tests/test_rag.py`, not assumed. Phase 4 strengthened this one existing
implementation — no second RAG system, no second Evidence Agent.

## Architecture

```
Patient Digital Twin (a few concepts, e.g. risk_tier) ──┐
                                                          ├──> query (str)
Model Output (a risk tier string only, never a raw score object) ─┘
                                                          │
                                                          v
                                          EvidenceAgent.retrieve(query, k)
                                                          │
                                                          v
                                    RAG store (ChromaStore or KeywordStore)
                                                          │
                                              embed / rank / threshold / top-k
                                                          │
                                                          v
                                     list[EvidenceChunk] (citation-preserved)
                                                          │
                                    ┌─────────────────────┼─────────────────────┐
                                    v                     v                     v
                        ChatOut.sources      CarePlanOut.sources      (future) Clinical Agent
                     (+ delimited LLM prompt,                          (docs/DIGITAL_TWIN.md,
                      DATA not instructions)                              not built yet)
```

**Data / Model Output / Evidence / Synthesis stay four separate things**
(Step 16): patient data lives in the Digital Twin; model output is a
plain string or number passed into a query template, never evidence-shaped;
retrieved evidence is always an `EvidenceChunk` sourced only from the
knowledge base directory; LLM/rule-based synthesis is the reply text
handed back to a user, never written into the vector store. See "Model
output boundary" and "Generated text is never indexed" below for how each
boundary is actually enforced and tested, not just asserted.

## Existing RAG (audited, Step 1)

### 1. Vector store

ChromaDB, embedded/persistent mode (`chromadb.PersistentClient`), on-disk
at `backend/data/chroma/`. Collection name `medgenesis_evidence`, created
with `metadata={"hnsw:space": "cosine"}` set explicitly — Chroma defaults
new collections to raw L2 distance, which is meaningless for
sentence-transformer embeddings (trained for cosine comparison); this was
a real bug found and fixed before this phase (see `docs/ARCHITECTURE.md`
§13.5) and is regression-guarded by `tests/test_rag.py::TestChromaStore`.

### 2. Embedding model

`sentence-transformers`, model `all-MiniLM-L6-v2` — local CPU inference,
free, no API key.

### 3. Chunking strategy

One chunk per markdown `##` section. Not a fixed-size character window —
the two source documents are short (11 and 6 sections respectively) and
each section is already a coherent, self-contained claim (e.g. "Physical
activity", "Blood sugar monitoring"), so section boundaries are also
citation-unit boundaries. This avoids exactly the failure modes Phase 4
Step 8 asks to guard against: no claim gets separated from its context, no
section heading gets separated from its content, because the heading *is*
the chunk's `section` metadata and the body text stays attached to it as
one unit. Neither source document contains tables or inline references, so
those specific risks don't currently apply to this corpus.

### 4. Metadata structure

Per chunk (`EvidenceChunk`, `app/services/rag.py`):

| Field | Meaning | Phase |
|---|---|---|
| `text` | The chunk's body text | existing |
| `document_id` | Stable id, `{file_stem}#{section-slug}` (e.g. `cdc_diabetes_basics#physical-activity`) | **new, Phase 4** |
| `section` | The `##` heading | existing |
| `title` | Document title, from frontmatter | existing |
| `publisher` | e.g. "Centers for Disease Control and Prevention (CDC)" | existing |
| `source_url` | Canonical URL | existing |
| `accessed` | Date the source was accessed | existing |
| `license` | License/copyright status | existing |
| `attribution` | Required attribution text (WHO content is copyrighted) | existing |
| `score` | Retrieval score for this query (not stored — computed per query) | existing |

`document_id` was the one real gap found during the Step 1 audit: chunks
were previously identified only by their position in a Python list (stable
in practice, since load order is deterministic, but not an explicit,
citable identifier). Adding it is a single new field on the existing
dataclass — not a new metadata system.

### 5. Document ingestion

Two real markdown files, `backend/data/knowledge_base/{cdc_diabetes_basics,
who_diabetes_factsheet}.md`. Each starts with a YAML-ish frontmatter block
(`title`, `publisher`, `source_url`, `accessed`, `license`, `attribution`,
parsed by `_parse_frontmatter`) followed by `##`-delimited sections. No
external fetching, no scraping — these are hand-curated, already in the
repository. `load_chunks()` is the single ingestion function; both store
backends call it, so there is exactly one ingestion path.

### 6. Retrieval method

Two interchangeable backends behind one interface
(`ChromaStore`/`KeywordStore`, chosen automatically by `get_store()`, which
one is active reported via `backend_name` and never hidden from callers):

- **`ChromaStore`** (preferred): the query is embedded with the same
  `all-MiniLM-L6-v2` model, nearest neighbors retrieved from Chroma by
  cosine similarity.
- **`KeywordStore`** (dependency-free fallback, used when
  `chromadb`/`sentence-transformers` aren't installed or fail to load):
  deterministic token-overlap scoring with light stemming and a hand-built
  domain synonym table (so "workout" matches text that says "physical
  activity"). This is also the backend used in most tests, since it's
  fully deterministic.

### 7. Number/type of currently indexed sources

Verified directly, not assumed: **2 source documents, 17 chunks total**
(11 from the CDC "Diabetes Basics" page, 6 from the WHO "Diabetes" fact
sheet). One is US-government public-domain content; the other is WHO
copyrighted content used under WHO's permissions policy with attribution
carried on every chunk (`tests/test_rag.py::
test_who_chunks_carry_attribution_metadata` regression-guards this).

### 8. Similarity / search method

Cosine similarity (ChromaStore) or a normalized token-overlap ratio with
literal-match/synonym-match/section-title weighting (KeywordStore) — see
`KeywordStore.query()` for the exact scoring formula. Both are documented
above as "existing," unchanged in method by this phase (Step 9: preserve
unless there's a demonstrated problem — there wasn't one in the ranking
method itself).

### 9. Existing Evidence Agent interaction

`app/agents/evidence_agent.py::EvidenceAgent` — the single Evidence Agent,
extended (not replaced) this phase. `.retrieve()`/`.retrieve_as_dicts()`
call `get_store().query()`; three call sites use it:
`ConversationalAgent.run()`, `CarePlanAgent.run()`, and the orchestrator's
`evidence_node`.

### 10. Existing citation behavior

`EvidenceChunk.citation` — a short inline string,
`f'{publisher}, "{title}" — {section} ({source_url})'`, already used in
chat replies and care-plan narratives. Preserved unchanged; a second,
more structured representation was added alongside it (see "Citation
preservation" below), not in place of it.

### 11. Current limitations (as found)

Tiny corpus (2 documents), English-only, no live updates (static files),
no relevance threshold before this phase (every query returned its
top-k nearest neighbors regardless of how irrelevant), no stable citable
document identifier before this phase, no dedicated retrieval-only API
endpoint, no retrieval evaluation set, no explicit prompt-injection framing
around the one place retrieved text reaches an LLM.

## What Phase 4 changed

All additive, on the one existing implementation:

1. **`document_id`** added to `EvidenceChunk` (`app/services/rag.py`) —
   stable, citable identifier; propagated through both store backends and
   the Chroma metadata schema (bumped `SCHEMA_VERSION` so an old on-disk
   collection is detected as stale and rebuilt with the new field, the
   same mechanism already used for the earlier cosine-space fix).
2. **Centralized `DEFAULT_TOP_K = 3`** (`app/services/rag.py`) — the three
   call sites that used to each hard-code `k=3` now inherit one shared
   constant.
3. **Relevance thresholds**, one per backend, both empirically calibrated
   against this exact corpus and embedding model (see "Relevance
   threshold" below) — `ChromaStore.MIN_RELEVANCE_SCORE = 0.15`,
   `KeywordStore.MIN_RELEVANCE_SCORE = 0.5`.
4. **`EvidenceChunk.citation_block`** and
   **`EvidenceAgent.format_citation_block()`** — the Step 19 `[E1]/[E2]…`
   structured citation format, additive alongside the existing short
   `citation` string.
5. **Prompt-injection data/instruction boundary**
   (`app/agents/conversational_agent.py`) — explicit delimiters
   (`<<<RETRIEVED_SOURCES_BEGIN/END>>>`) around the retrieved-sources block
   in the LLM prompt, and a new system-prompt paragraph telling the model
   directly that delimited text is data, never an instruction to obey.
6. **`app/services/retrieval_evaluation.py`** *(new file)* — a 14-query
   deterministic evaluation set and Hit Rate@k / Precision@k / Recall@k /
   MRR computation (see "Evaluation" below).
7. **`POST /api/evidence/search`** *(new endpoint, `app/routers/evidence.py`)*
   — the first way to query the Evidence Agent directly over the API,
   independent of chat/care-plan/orchestrator.
8. **`docs/RAG.md`** *(this file, new)*.

Nothing about the ingestion pipeline, the chunking strategy, the ranking
formulas, or which backend is preferred changed — Step 7's "if the
existing pipeline is sound, reuse it" applied to all of those.

## Data flow

See "Architecture" above. In detail, per call site:

- **`ConversationalAgent.run(message, patient_context, ...)`**: query =
  the user's raw chat message (never the twin state). `patient_context`,
  when provided, is `{"risk_tier": "Moderate"}` — one string, appended to
  the LLM prompt as context, never sent into the retrieval query itself.
- **`CarePlanAgent.run(state, risk_tier, ...)`**: query =
  `f"type 2 diabetes {risk_tier} risk lifestyle diet physical activity monitoring"`
  — a fixed template with only `risk_tier` (a model-output string)
  interpolated in; `state` (the full twin dict) is never touched for this
  purpose.
- **Orchestrator `evidence_node`**: query =
  `f"type 2 diabetes {tier} risk prevention diet activity monitoring"` —
  same pattern, `tier` pulled from the screening result already computed
  earlier in the same graph run.

All three were already correct on inspection (Step 14) — none serializes
the Digital Twin into the query. `tests/test_rag_boundaries.py::
TestPatientContextBoundary` locks this in as a regression guard.

## Vector store

See "1. Vector store" above (unchanged this phase, beyond the
`schema_version` metadata bump needed to accommodate `document_id`).

## Embeddings

See "2. Embedding model" above (unchanged).

## Chunking

See "3. Chunking strategy" above (unchanged — evaluated per Step 8 and
found sound for this corpus, so not modified).

## Metadata

See "4. Metadata structure" above.

## Retrieval

See "6. Retrieval method" / "8. Similarity method" above (methods
unchanged; thresholding and centralized top-k are new — see below).

## Top-K

`DEFAULT_TOP_K = 3` in `app/services/rag.py`, imported by
`EvidenceAgent.retrieve()`/`retrieve_as_dicts()` as their default. All
three existing call sites (chat, care plan, orchestrator) now omit an
explicit `k=` entirely and inherit this one value; `POST
/api/evidence/search` accepts an optional `k` (1-20) to override it
per-request.

## Relevance threshold

**Implemented now**, one constant per backend (different score scales
can't share one number):

- **`ChromaStore.MIN_RELEVANCE_SCORE = 0.15`** — calibrated by measuring
  real top-1 cosine similarity on this exact corpus/model for 16 on-topic
  queries (including deliberately hard, near-zero-literal-overlap
  paraphrases, e.g. "what are the warning signs I should watch for" —
  the existing regression test for exactly this class of query) and 8
  clearly off-topic queries (e.g. "What is the capital of France?"). The
  hard paraphrases scored much lower than easy direct questions (0.197 vs.
  0.68+); off-topic noise topped out at 0.103. 0.15 sits in that narrow
  but real gap. A first calibration pass using only 5 easy probe queries
  suggested a much higher threshold (~0.3) and was caught as wrong when it
  broke the existing hard-paraphrase regression test — corrected before
  being kept, not shipped as originally measured.
- **`KeywordStore.MIN_RELEVANCE_SCORE = 0.5`** — the store already
  excludes zero-token-overlap chunks; this adds a floor above the low
  nonzero score an off-topic query can occasionally get from an incidental
  partial-word stem match (observed: 0.167 for "best programming language
  for web development", against a genuine on-topic floor of 1.4+).

Both are **retrieval-quality cutoffs only** — neither claims medical
relevance, and neither was invented; both came from measuring this
project's actual corpus and embedding model. An unmet threshold returns an
empty list — "no sufficiently relevant evidence was retrieved" — rather
than the nearest chunks regardless of how irrelevant, matching Step 11.

## Citation preservation

Every `EvidenceChunk` returned by either backend carries `document_id`,
`title`, `publisher`, `section`, `source_url`, `accessed`, `license`, and
`attribution` — retrieval never reduces evidence to anonymous text. Two
citation representations, both derived only from those fields (never
fabricated):

- **`chunk.citation`** (existing): a short inline string used in chat
  replies and care-plan narratives today.
- **`chunk.citation_block`** / **`EvidenceAgent.format_citation_block()`**
  (new): the Step 19 structured form —
  ```
  [E1]
  Title: Diabetes Basics
  Source: Centers for Disease Control and Prevention (CDC)
  Document: cdc_diabetes_basics#healthy-eating
  Section: Healthy eating
  URL: https://www.cdc.gov/diabetes/about/index.html
  Retrieval score: 0.683
  ```
  Intended for a future Clinical Agent to attach one specific claim to one
  specific evidence ID and source — not built this phase (Step 20
  explicitly excludes the full Clinical Analysis Agent).

## Evidence Agent

`app/agents/evidence_agent.py::EvidenceAgent` remains the single Evidence
Agent. Extended with `format_citation_block()`; `retrieve()`/
`retrieve_as_dicts()` now default to the centralized `DEFAULT_TOP_K`. Its
five eventual responsibilities per the Phase 4 spec:

1. receive clinical question — **implemented** (`retrieve(query, k)`)
2. retrieve evidence — **implemented**
3. preserve source metadata — **implemented** (`document_id` + existing fields)
4. return structured evidence — **implemented** (`EvidenceChunk`/`.to_dict()`)
5. optionally prepare evidence context for future synthesis — **partially
   implemented** (`format_citation_block()` produces the future Clinical
   Agent's expected input shape); actually consuming it is **planned for
   a later phase**, not built now.

## Patient context boundary

See "Data flow" above — already correct on every call site; locked in by
`tests/test_rag_boundaries.py::TestPatientContextBoundary`. A formal
`{question, topic, patient_context, model_context}` structured-query
object (as sketched in the Phase 4 spec) was deliberately **not**
introduced: every current caller already builds a plain short string from
at most one model-output field, so a new abstraction would have nothing
real to wrap — it would be structure for its own sake. If a future caller
needs genuinely structured query input, it should be added then, justified
by that caller, following this project's established pattern of not
building ahead of an actual consumer (`docs/DIGITAL_TWIN.md` made the same
call for `diabetes_type`/`daily_steps`/etc.).

## Model output boundary

Model output (a risk tier string, in the only three places it currently
reaches the RAG layer) is interpolated into a query *string* — it never
becomes or is stored as an `EvidenceChunk`. This is a structural guarantee,
not just a convention: `load_chunks()` — the only function that produces
`EvidenceChunk`s — reads exclusively from the fixed
`data/knowledge_base/*.md` directory, with no code path from
`ScreeningResult`, `XGBoostPredictionResult`, or any other model-output
type. Verified by
`tests/test_rag_boundaries.py::TestModelOutputBoundary` (inspects
`load_chunks`'s actual source for any model-related reference at all, and
confirms the real corpus's `document_id`s are exactly the two known KB
files — nothing else).

## Security / prompt-injection boundary

Retrieved text is DATA, never instructions (Step 18). The knowledge base is
a fixed, hand-curated, two-file corpus, so this is deliberate
defense-in-depth against a hypothetical future less-trusted corpus (e.g. a
Phase 5 PubMed abstract), not a response to anything found in the current
one.

**Where retrieved text reaches an LLM at all**: only
`ConversationalAgent`. `CarePlanAgent`'s LLM call never sees chunk text —
it only rephrases an already-decided plan; citations are appended
afterward, entirely outside the LLM. So `ConversationalAgent` is the one
place this boundary needed reinforcing:

1. Retrieved sources are wrapped in explicit delimiters
   (`<<<RETRIEVED_SOURCES_BEGIN>>>` / `<<<RETRIEVED_SOURCES_END>>>`) inside
   the prompt sent to the LLM.
2. `CHAT_SYSTEM_PROMPT` explicitly instructs the model that text between
   those delimiters is retrieved reference material, not instructions —
   and that anything inside that looks like a command ("ignore previous
   instructions", "you are now...") must be treated as ordinary quoted
   content, never obeyed.
3. The rule-based fallback path (`_fallback_reply`) never interprets or
   executes chunk text at all — it only ever string-formats it into the
   reply, which is a structural guarantee, not a prompt-level one.

Tested in `tests/test_rag_boundaries.py::TestPromptInjectionBoundary` with
a synthetic, clearly-labelled injection-shaped fixture chunk (never
presented as a real source) — confirms the injected text lands strictly
inside the delimited block in the constructed prompt, and that the
fallback path echoes it as inert quoted text rather than acting on it.
This is **not** a claim that a live LLM is guaranteed to obey the
delimiting instruction (that depends on the model, and can't be verified
offline — the test suite runs with `MEDGENESIS_DISABLE_LLM=true`) — it
verifies the boundary is correctly *constructed and framed*, which is what
this phase's scope covers. Full adversarial red-teaming of a live model's
actual compliance is out of scope here (Step 18: "do not over-engineer
this phase").

## Evaluation

**Implemented now.** `app/services/retrieval_evaluation.py`:
`EVALUATION_QUERIES` — 14 hand-written queries, each naming one
`expected_document_id` that genuinely exists in the real 17-chunk corpus
(verified by test, not assumed). One relevant document per query by
construction, so Precision@k is mechanically `1/k` on a hit; Hit Rate@k and
MRR are the metrics that actually carry information here.

Measured (not fabricated), `k=3`:

| Backend | Hit Rate@3 | MRR | Misses |
|---|---:|---:|---|
| `ChromaStore` (semantic) | 1.00 (14/14) | 0.929 | none |
| `KeywordStore` (fallback) | 0.857 (12/14) | 0.821 | "What are the warning signs of diabetes I should watch for?", "How is diabetes diagnosed by a doctor?" (both WHO-document queries the keyword ranker's literal/synonym matching didn't connect as strongly as the CDC document's denser vocabulary) |

This is a genuine, live measurement — rerunning
`python -m app.services.retrieval_evaluation` reproduces it exactly (both
backends are deterministic for a fixed corpus and query set). It also
demonstrates the semantic backend's real, measured advantage on hard
paraphrases, not just an assumed one (`tests/test_rag_boundaries.py::
test_semantic_backend_measurably_outperforms_keyword_fallback_on_hard_paraphrases`).

**Limitation**: 14 queries over a 17-chunk, 2-document corpus is a small
evaluation set — enough to catch a real regression (as it did during this
phase's own threshold calibration) and to honestly characterize both
backends' current behavior, not enough to generalize a confident numeric
score to a larger future corpus (e.g. once PubMed sources are added).

## Limitations

- **Corpus size**: 2 documents, 17 chunks — CDC "Diabetes Basics" and one
  WHO fact sheet. No original medical literature, no PubMed, no clinical
  guidelines beyond these two general-education sources.
- **No external literature**: everything retrievable today is general
  public-health education content, not primary research.
- **No clinical reasoning**: the Evidence Agent retrieves; nothing
  synthesizes retrieved evidence into a clinical judgment (that's the
  future Clinical Analysis Agent, `docs/ARCHITECTURE.md` §13.8/§13.9, not
  built).
- **No clinical validation**: retrieval quality (Hit Rate@k, MRR above) is
  an information-retrieval measurement, not a clinical-accuracy one.
- **English-only, static corpus**: no live updates, no multi-language
  support.
- **Prompt-injection testing scope**: verified the boundary is correctly
  constructed (delimiters, system-prompt framing, structural non-execution
  in the fallback path) — not a live-model adversarial red-team, which
  needs a reachable LLM backend and is out of this phase's scope.

## Future PubMed extension (Phase 5+, not built now)

The Evidence Agent's interface (`retrieve()` returning `list[EvidenceChunk]`)
was already source-agnostic before this phase — nothing in it assumes
"local markdown file." The intended future shape:

```
Evidence Sources
    ├── Local RAG   (this phase — ChromaStore/KeywordStore over data/knowledge_base/)
    └── PubMed      (Phase 5 — app/services/pubmed.py, currently a scaffolded
                      stub per docs/ARCHITECTURE.md §13.8; NOT called this phase)
```

Both would need to produce the same normalized `EvidenceChunk` shape so
`EvidenceAgent.retrieve()`'s callers (chat, care plan, orchestrator, the
new `/api/evidence/search` endpoint) never need to know which source
answered a given query. Concretely, for whoever builds Phase 5:

- `app/services/pubmed.py::PubMedArticle` (already real, working code —
  only retrieval is stubbed) would need a small adapter to
  `EvidenceChunk` — `document_id` maps naturally to `f"pubmed#{pmid}"`,
  `source_url` to `PubMedArticle.url` (already a real property), `title`/
  `publisher` (as "PubMed"/the journal name) map directly; `section` has
  no PubMed equivalent and would need a documented convention (e.g.
  "Abstract").
- `get_store()`'s try-a-backend-then-fall-back pattern is the existing
  precedent for combining multiple sources behind one interface — a
  Phase 5 `MultiSourceStore` (or similar) could query both `ChromaStore`
  and a real `PubMedClient` and merge+re-rank results, without either
  `EvidenceAgent` or its three callers changing at all.
- The relevance-threshold and citation-preservation work this phase did is
  what a PubMed source would need to meet too — real DOI/PMID/author
  fields would populate real values instead of the empty-string
  placeholders `EvidenceChunk` currently carries for fields the local KB
  doesn't have (Step 6: never invent them; PubMed responses would actually
  provide them for real, once implemented).

None of this was implemented — `services/pubmed.py` was not touched, no
live PubMed call was made, per this phase's explicit constraints.
