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

## PubMed Integration (Phase 5)

`app/services/pubmed.py` was Phase 1 scaffolding (a `PubMedClient` protocol
and a `NotConfiguredPubMedClient` that raised `NotImplementedError` — see
`docs/ARCHITECTURE.md` §13.8). Phase 5 added a real implementation,
`EutilsPubMedClient`, behind the exact same protocol — no second client
abstraction, and `PubMedArticle` (already real code since Phase 1) is
extended, not replaced.

**API used**: NCBI E-utilities, two endpoints, called in sequence for one
`search(query, max_results)`:

1. **ESearch** (`esearch.fcgi`, `retmode=json`) — `term=query` →
   `esearchresult.idlist`, a list of PMIDs already ranked by relevance.
   ESearch provides **no numeric relevance score**, rank order only — this
   is what drove the ranking-strategy choice below.
2. **EFetch** (`efetch.fcgi`, `retmode=xml`, `rettype=abstract`) —
   `id={pmid1,pmid2,...}` → full article XML for those PMIDs in one batch
   call (not one call per PMID). Results are re-ordered to match ESearch's
   ranking, since EFetch doesn't guarantee it preserves input order.

Both calls send `tool=medgenesis` and `email=PUBMED_EMAIL` (NCBI's usage
policy asks for an identifying email on every request) and
`api_key=PUBMED_API_KEY` only when set — the key stays optional, exactly
as Phase 1's scaffolding comments already promised; it only raises the
per-second rate limit.

**Query flow**: `EvidenceAgent.retrieve(query, source="pubmed")` →
`app/services/rag.py::_query_pubmed()` → `get_pubmed_client().search()` →
ESearch → EFetch → `dict[pmid, PubMedArticle]` → re-ordered list →
normalized to `EvidenceChunk` → returned. `get_pubmed_client()` returns
`EutilsPubMedClient` when `PUBMED_EMAIL` is set, otherwise the same
`NotConfiguredPubMedClient` as before — callers never see a different
interface either way.

**PMID handling**: PMIDs are treated as opaque strings throughout (never
parsed as integers) — NCBI's own representation. `document_id` for a
PubMed-derived chunk is `f"pubmed#{pmid}"`, so it can never collide with a
local-KB `document_id` (`{file_stem}#{section-slug}`).

**Metadata mapping** (`PubMedArticle`, extended this phase):

| Field | Source | Notes |
|---|---|---|
| `pmid` | `<PMID>` | existing |
| `title` | `<ArticleTitle>` | existing |
| `journal` | `<Journal/Title>`, falls back to `<Journal/ISOAbbreviation>` | existing |
| `year` | `<PubDate/Year>`, falls back to `<PubDate/MedlineDate>` | existing |
| `authors` | `<AuthorList/Author>` → `"{LastName} {Initials}"`, falls back to `<CollectiveName>` for group-authored papers | existing |
| `abstract` | `<Abstract/AbstractText>` — all sections joined; a `Label` attribute (e.g. `BACKGROUND`) is preserved inline as `"LABEL: text"` rather than fabricating a section split (see "EvidenceChunk mapping" below) | existing field, richer content |
| `doi` | `<ArticleIdList/ArticleId IdType="doi">` | **new, Phase 5** |
| `article_type` | `<PublicationTypeList/PublicationType>`, e.g. `["Review"]` | **new, Phase 5** |

**Abstract handling (Step 22)**: if `<Abstract>` is absent or empty,
`abstract` is `None` — never a placeholder string. `_query_pubmed()` then
drops that article entirely rather than returning an `EvidenceChunk` with
empty `text`: there is nothing for a text-retrieval system to rank or
cite. The underlying `PubMedArticle` (with its real title/journal/PMID/DOI
metadata, even without an abstract) is still what `EutilsPubMedClient.
search()` itself returns — the "no chunk without text" decision is made
one layer up, in `services/rag.py`, not inside the PubMed client.

**Full text (Step 23)**: not implemented and not assumed. E-utilities'
`efetch` with `rettype=abstract` returns title/abstract/metadata only —
that is the actual access level available through this API without a
separate, article-specific full-text license. No scraping, no bypassing
access controls.

**Article type (Step 21)**: preserved verbatim from
`<PublicationTypeList>` when present (e.g. `["Review", "Journal Article"]`)
— never inferred from the title, and no evidence-hierarchy ranking is
built on top of it this phase.

## EvidenceChunk mapping

```
PubMedArticle                          EvidenceChunk
──────────────                         ─────────────
pmid                        ────────►  document_id = f"pubmed#{pmid}"
url (property)              ────────►  source_url
title                       ────────►  title
journal                     ────────►  publisher
abstract or ""              ────────►  text
doi or ""                   ────────►  doi
(none — see below)          ────────►  section = "Abstract"  (fixed convention)
(fetch time)                ────────►  accessed = today's date (ISO)
(n/a)                       ────────►  license = "", attribution = ""
rank in ESearch order       ────────►  score = 1 / rank   (reciprocal rank — see "Ranking")
(fixed)                     ────────►  source_type = "pubmed"
```

**Section convention**: always `"Abstract"`, never `"Abstract:<subsection>"`.
Structured NCBI abstracts (e.g. `BACKGROUND`/`METHODS`/`RESULTS`/
`CONCLUSIONS` labels) are real and preserved — but *inline*, as
`"BACKGROUND: ... METHODS: ..."` within one `text` field, rather than
split into one `EvidenceChunk` per labeled subsection. This was a
deliberate simplicity choice (Phase 5 Step 7 explicitly offers `"Abstract"`
as the base convention and only asks for the finer `Abstract:<section>`
split "if the actual article content supports such a distinction" as an
optional escalation): splitting would multiply chunk count per article,
add a second per-article fan-out concept alongside the local KB's
per-document-section one, and — critically — break Reciprocal Rank
Fusion's implicit one-chunk-per-source-unit assumption below. Structure is
preserved in the text; it just isn't a second axis of chunking.

`license`/`attribution` are left empty for PubMed chunks — unlike the
local KB (CDC public-domain / WHO copyrighted-with-attribution, both
declared in each file's frontmatter), there is no single blanket license
string that applies to arbitrary PubMed abstracts, and inventing one would
violate Step 6's "never invent a field" rule.

## Source type

`EvidenceChunk.source_type` (`"local"` default / `"pubmed"`) is the field
Phase 5 Step 8 asked for — added directly to the existing `EvidenceChunk`
dataclass with a backwards-compatible default, not a second evidence
model. Every existing local-KB chunk (and every existing test/call site
that constructs one without specifying it) is `"local"` automatically.

## Multi-Source Evidence Architecture

```
                    EvidenceAgent.retrieve(query, k, source)
                                    │
                    source="local"   source="pubmed"   source="all"
                          │                │                │
                          ▼                ▼                ▼
                   get_store().query   _query_pubmed    both, then:
                   (ChromaStore or     (EutilsPubMedClient   Reciprocal Rank Fusion
                    KeywordStore)       or gracefully        (by rank, not raw score)
                          │             empty on failure)         │
                          │                │                      ▼
                          │                │              Cross-source dedup
                          │                │              (document_id / DOI /
                          │                │               PubMed-title only)
                          ▼                ▼                      ▼
                    list[EvidenceChunk], all normalized, citation-preserved
```

All of this lives in `app/services/rag.py` — the existing evidence-
retrieval module — not a new `medical_evidence_service.py` (Phase 5
Step 10). `EvidenceAgent` (`app/agents/evidence_agent.py`) remains the
single Evidence Agent; it gained one new parameter
(`source: str = "local"`) on `retrieve()`/`retrieve_as_dicts()`, nothing
else changed about it.

## Source selection

`source` ∈ `{"local", "pubmed", "all"}`, default `"local"`:

- **`"local"`** (default): identical to pre-Phase-5 behavior. Every
  existing caller (`ConversationalAgent`, `CarePlanAgent`, the
  orchestrator's `evidence_node`) calls `EvidenceAgent.retrieve()`/
  `search_evidence()` without a `source` argument and is completely
  unaffected — regression-tested in `tests/test_multi_source_evidence.py::
  TestSourceSelection::test_default_source_is_local_and_unchanged` and
  `test_pubmed_never_called_for_default_local_source`.
- **`"pubmed"`**: PubMed only. A configuration or network failure degrades
  to an empty list, never an exception (see "Failure behavior" below).
- **`"all"`**: both sources, fused by Reciprocal Rank Fusion and
  deduplicated (see "Ranking"/"Deduplication").

Nothing in this project *automatically* upgrades an existing caller from
`"local"` to `"pubmed"`/`"all"` — that remains a decision for whichever
future phase builds the Clinical Analysis Agent (Phase 5 Step 12/37: this
phase explicitly does not wire PubMed into the Digital Twin or any
existing agent's default behavior).

## Deduplication

`app/services/rag.py::_deduplicate()`. Same `document_id`, same DOI, or
the same normalized title are treated as one piece of evidence — only the
highest-ranked occurrence survives. DOI/title matching is scoped to
PubMed-origin chunks only: local KB chunks intentionally share one `title`
per source document across many distinct sections (every "Diabetes
Basics" section has the title "Diabetes Basics"), so applying title-based
dedup universally would wrongly collapse unrelated local sections into
one. This exact failure mode is regression-tested
(`test_local_chunks_sharing_one_document_title_are_never_collapsed`).
Distinct studies discussing the same topic are never deduplicated — only
genuine same-record duplicates are (Phase 5 Step 16).

## Ranking

`source="all"` merges two independently-ranked lists using **Reciprocal
Rank Fusion (RRF)**, not raw score blending. Formula, per candidate
document *d*: `score(d) = Σ 1/(60 + rank_s(d))` summed over every source
*s* where *d* appears, `rank_s(d)` its 1-indexed position in that source's
own result list. 60 is the constant from the original RRF paper (Cormack
et al., 2009) — not tuned for this corpus.

**Why RRF and not normalized-score fusion**: ChromaDB's cosine similarity
and PubMed's relevance ranking are not on a comparable scale — and
ESearch provides no numeric score at all, only a rank-ordered PMID list.
Any score-normalization approach would have to *invent* a plausible-
looking numeric score for PubMed results to blend with Chroma's real
cosine values; RRF sidesteps that entirely by using only rank position,
which both sources genuinely have. This is the "simplest defensible
method" Phase 5 Step 17 asks for, chosen specifically to avoid fabricating
a comparability that doesn't exist.

A standalone `source="pubmed"` query (no fusion involved) reports `score`
as plain reciprocal rank (`1/rank`) — the same underlying quantity RRF
uses — rather than inventing a different, one-off scoring scheme for the
single-source case.

## Failure behavior (local RAG survives PubMed failure)

`_query_pubmed()` never raises. `NotImplementedError` (PubMed not
configured) and `PubMedUnavailableError` (network failure, NCBI 5xx/429
after one retry, malformed JSON) are both caught and logged, and treated
identically to "PubMed found nothing relevant" — an empty list. For
`source="all"`, this means local results are always returned even when
PubMed is completely unreachable
(`test_pubmed_failure_does_not_break_local_results_in_all_mode`). For
`source="pubmed"` alone, an unreachable PubMed returns an empty result
list with HTTP 200 (not a 503) — consistent with this project's existing
"empty means no evidence, not a crash" convention for every other
retrieval path. **PubMed evidence is never fabricated to paper over a
failure** — the alternative to "found nothing" is always "found nothing,"
never a made-up citation.

## Rate limiting / retries

One retry only, after a fixed 1-second delay, for a transient failure
(connection error, HTTP 5xx, HTTP 429) — never a retry loop. A genuine
client error (e.g. HTTP 400) is not retried at all, since retrying an
already-malformed request just fails the same way again
(`EutilsPubMedClient._get()`). `search()` makes exactly two HTTP calls per
invocation (one ESearch, one EFetch, batched across all requested PMIDs in
that single EFetch call rather than one call per article) — there is no
loop that could accidentally hammer NCBI.

## Caching

**Not implemented — a deliberate decision, not an oversight.** This is an
educational prototype with low expected query volume; the two-call,
no-loop request pattern above already respects NCBI's rate limits without
needing a cache to avoid violating them at this usage scale; and there is
no existing caching infrastructure in this project to extend (adding one
now would be new architecture introduced without a concrete driving need
— the same reasoning `docs/DIGITAL_TWIN.md` already used to decline adding
speculative fields). If a future phase's Clinical Agent starts issuing
many repeated PubMed queries, caching should be added then, sized and
scoped to that actual access pattern.

## Full-text limitations

See "PubMed Integration" → "Full text" above: abstract + metadata only,
by the E-utilities API's own scope — no full-text guarantee, and this
project does not attempt to work around that.

## Privacy boundary

No call site in this codebase constructs a PubMed query from patient data
at all — Phase 5 does not wire PubMed into `ConversationalAgent`,
`CarePlanAgent`, or the orchestrator (all three still call
`EvidenceAgent.retrieve()` with no `source` argument, defaulting to
`"local"`, exactly as before). The only ways to reach `source="pubmed"`/
`"all"` right now are a direct `EvidenceAgent.retrieve()` call or
`POST /api/evidence/search` — both take a caller-supplied `query` string
with no automatic patient-data injection. Tested with generic clinical
queries only (e.g. "type 2 diabetes physical activity prevention"), per
Phase 5 Step 27. A future Clinical Analysis Agent, when built, is
responsible for constructing an appropriately de-identified clinical
query from the Digital Twin before ever calling `source="pubmed"` — that
boundary is explicitly not this phase's to build (Phase 5 Step 37).

## Logging

`app/services/pubmed.py` logs endpoint, HTTP status, latency, and (on
success) an approximate query-length signal — never the full query text,
never `PUBMED_API_KEY`, never patient data
(`tests/test_pubmed.py::TestNoAPIKeyLoggedOrHardcoded::
test_api_key_not_logged` regression-guards the key specifically).

## Evaluation (PubMed / multi-source)

**Not extended this phase, and documented as a deliberate scope
boundary, not an oversight.** Phase 5 Step 31 explicitly requires either
live PubMed access or a recorded, clearly-labelled fixture set with
non-fabricated expected PMIDs to build a PubMed retrieval evaluation set —
and Step 32's multi-source evaluation depends on that same data. This
phase *did* verify live PubMed access works (see "Live verification"
below) and confirmed the full pipeline returns real, correctly-normalized
results — but building a *trustworthy* expected-PMID ground truth set
requires deciding, for a handful of real clinical queries, which of
NCBI's actual (and can change over time as its index updates) results
should count as "correct" — a judgment call requiring domain expertise
this phase does not have grounds to make up. Fabricating expected PMIDs to
produce a Hit Rate/MRR number would be exactly the "manufactured
impressive numbers" Step 24/32 explicitly prohibit. The existing local-KB
evaluation set and its measured numbers (`## Evaluation` above) are
unchanged and remain valid for the local-only path.

## Live verification

A live, network-based smoke test was run against the real NCBI API during
this phase's development (not part of the required test suite —
`tests/test_pubmed_live.py`, skipped unless explicitly opted into). It
succeeded: a real query ("type 2 diabetes physical activity") returned
real PMIDs, titles, journals, and DOIs — e.g. PMID 42654187, "Association
Between Prudent Dietary Pattern and Cardiometabolic Indicators in a
Healthy Qatari Population: Evidence from the Qatar Biobank (QBB)",
*Nutrients*, DOI 10.3390/nu18162607. This confirms the ESearch → EFetch →
`PubMedArticle` → `EvidenceChunk` pipeline genuinely works end to end
against the live API, not just against mocked responses. These specific
PMIDs are **live query results observed during development, not a
recorded fixture and not an evaluation ground truth** — real papers
matching a real query at the time this phase was built, not something to
assert on in the test suite (NCBI's index changes over time).

## Performance

Approximate, measured during live verification (not a rigorous benchmark
— see "Do not optimize prematurely," Step 33):

- **Local retrieval** (`KeywordStore`/`ChromaStore`): sub-100ms, as
  already characterized in Phase 4.
- **PubMed retrieval** (`source="pubmed"`, 2 results): ~1-2 seconds for
  the ESearch + EFetch round trip to NCBI — dominated entirely by network
  latency, not by this project's own code.
- **Combined (`source="all"`)**: local and PubMed queries run
  **sequentially, not in parallel** — a deliberate choice, not an
  oversight. The local store is fast enough (sub-100ms) that its
  contribution to total latency is negligible next to PubMed's ~1-2
  seconds; introducing threading/async here would be the *first*
  concurrency primitive in an otherwise fully synchronous codebase (no
  other part of MedGenesis uses asyncio or a thread pool), a materially
  bigger architectural footprint than the sub-100ms it would save. If
  PubMed latency becomes a real bottleneck for a future caller, this
  should be revisited then, against that caller's actual requirements.

## Limitations

- **Corpus size**: local KB is still 2 documents, 17 chunks. PubMed
  extends reach to the live literature, but only when explicitly
  requested (`source="pubmed"`/`"all"`) — the default remains the small
  local corpus.
- **No clinical reasoning**: the Evidence Agent retrieves and normalizes;
  nothing synthesizes retrieved evidence (local or PubMed) into a clinical
  judgment (the future Clinical Analysis Agent, `docs/ARCHITECTURE.md`
  §13.8/§13.9, still not built).
- **No clinical validation**: neither the local Hit Rate@k/MRR numbers nor
  PubMed's real, live retrieval quality have been clinically validated —
  both are information-retrieval measurements, not medical-accuracy ones.
- **No evidence grading**: `article_type` (e.g. "Review", "Randomized
  Controlled Trial") is preserved verbatim where NCBI provides it, but
  nothing ranks or weights evidence by study design/quality — no
  evidence-hierarchy logic was built (Phase 5 Step 19/21 explicitly
  prohibit inventing one).
- **Abstract/metadata only**: no full-text access, by the E-utilities
  API's own scope (see "Full-text limitations").
- **Network dependency**: PubMed retrieval requires live network access to
  NCBI; unavailable in an offline/air-gapped deployment (degrades to
  empty PubMed results, never fabricated ones — see "Failure behavior").
- **Rate limits**: NCBI allows ~3 requests/second without an API key, ~10
  with one — not a practical constraint at this prototype's expected
  query volume (2 calls per `search()`, no loop), but would need real
  attention under sustained concurrent load.
- **No PubMed retrieval evaluation set**: see "Evaluation (PubMed /
  multi-source)" above — deliberately not built this phase rather than
  built on fabricated ground truth.
- **Prompt-injection testing scope** (unchanged from Phase 4): verified
  the boundary is correctly constructed, not a live-model adversarial
  red-team.
