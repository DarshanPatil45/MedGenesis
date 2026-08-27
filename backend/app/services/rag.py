"""RAG store for the Evidence Retrieval Agent.

Chunks the local knowledge base and retrieves top-k cited passages. Uses
sentence-transformers embeddings + embedded ChromaDB when those are
installed; otherwise falls back to a deterministic keyword-overlap ranker so
the system still runs (and stays gradeable) on a machine without the heavy
ML stack. Which backend is active is reported in `backend_name` and surfaced
in the API response, never hidden.

Every chunk carries its source attribution in metadata — required because
the WHO fact sheet is copyrighted, not public domain, and must be used with
attribution under WHO's permissions policy.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger("medgenesis.rag")

KB_DIR = Path(__file__).resolve().parents[2] / "data" / "knowledge_base"
CHROMA_DIR = Path(__file__).resolve().parents[2] / "data" / "chroma"
EMBED_MODEL = "all-MiniLM-L6-v2"
COLLECTION = "medgenesis_evidence"

# Evidence source identifiers (Phase 5, docs/RAG.md "Multi-Source Evidence
# Architecture"). LOCAL_SOURCE stays the default for every existing caller
# — PubMed is opt-in only, never silently called (Phase 5 Step 12).
LOCAL_SOURCE = "local"
PUBMED_SOURCE = "pubmed"
ALL_SOURCES = "all"
VALID_SOURCES = (LOCAL_SOURCE, PUBMED_SOURCE, ALL_SOURCES)

# Reciprocal Rank Fusion constant (Phase 5 Step 17) — the standard value
# from the original RRF paper (Cormack et al., 2009); not tuned for this
# corpus. Chosen over normalized-score fusion because PubMed's ESearch
# provides no numeric relevance score at all, only a relevance-ranked PMID
# list — RRF only needs rank position from each source, so it never has to
# invent a comparable score for PubMed the way score-normalization fusion
# would (docs/RAG.md "Ranking").
RRF_K = 60
# Bumped whenever a chunk's metadata *schema* changes (e.g. Phase 4 added
# document_id) so an existing on-disk collection from before the change is
# detected as stale and rebuilt — same mechanism already used for the
# cosine-space migration below.
SCHEMA_VERSION = "2"

# Centralized so every caller (EvidenceAgent, ConversationalAgent,
# CarePlanAgent, the orchestrator's evidence_node) gets one shared value
# instead of each hard-coding its own `k=3` (docs/RAG.md, Phase 4 Step 10).
DEFAULT_TOP_K = 3

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
    "for", "from", "has", "have", "how", "i", "if", "in", "is", "it", "my", "of", "on",
    "or", "should", "that", "the", "to", "was", "what", "when", "which", "who", "why",
    "will", "with", "you", "your",
}

# The keyword fallback matches on literal tokens, so everyday phrasing
# ("exercise", "workout") misses source text that says "physical activity".
# Expanding the query with domain synonyms closes that gap; the embedding
# backend handles it natively and ignores this table.
SYNONYMS = {
    "exercise": {"physical", "activity", "active", "walking", "moderate"},
    "workout": {"physical", "activity", "exercise", "moderate"},
    "exercising": {"physical", "activity", "moderate"},
    "gym": {"physical", "activity", "exercise"},
    "walk": {"walking", "activity", "physical"},
    "walking": {"activity", "physical", "moderate"},
    "diet": {"eating", "food", "nutrition", "healthy"},
    "eat": {"eating", "diet", "food", "healthy"},
    "eating": {"diet", "food", "nutrition"},
    "food": {"eating", "diet", "nutrition"},
    "sugar": {"glucose", "blood", "sweetened"},
    "sugars": {"glucose", "blood", "sweetened"},
    "glucose": {"sugar", "blood", "monitoring"},
    "weight": {"overweight", "body", "management", "loss"},
    "lose": {"weight", "loss", "management"},
    "losing": {"weight", "loss", "management"},
    "fat": {"weight", "body", "saturated"},
    "test": {"testing", "monitoring", "diagnosis", "screening"},
    "testing": {"monitoring", "diagnosis", "test"},
    "check": {"monitoring", "testing", "test"},
    "monitor": {"monitoring", "testing", "blood"},
    "smoke": {"smoking", "tobacco"},
    "smoking": {"tobacco", "quitting"},
    "drink": {"alcohol", "drinks", "sweetened"},
    "alcohol": {"drinks", "moderation"},
    "sleep": {"sleeping", "rest", "stress"},
    "stress": {"sleep", "relaxation"},
    "risk": {"factors", "prevention", "higher"},
    "prevent": {"prevention", "risk", "lower"},
    "prevention": {"prevent", "risk", "lower"},
    "symptom": {"symptoms", "thirsty", "blurred", "tired"},
    "symptoms": {"symptom", "thirsty", "blurred", "tired"},
}


@dataclass
class EvidenceChunk:
    text: str
    document_id: str
    section: str
    title: str
    publisher: str
    source_url: str
    accessed: str
    license: str
    attribution: str
    score: float = 0.0
    # Phase 5 additions — both backwards-compatible defaults, so every
    # existing local-KB chunk (and every existing call site/test) is
    # unaffected: source_type defaults to "local", doi defaults to empty
    # (the local KB has no DOIs; PubMed-derived chunks populate it).
    source_type: str = LOCAL_SOURCE
    doi: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "document_id": self.document_id,
            "section": self.section,
            "title": self.title,
            "publisher": self.publisher,
            "source_url": self.source_url,
            "accessed": self.accessed,
            "license": self.license,
            "attribution": self.attribution,
            "score": round(self.score, 4),
            "source_type": self.source_type,
            "doi": self.doi,
        }

    @property
    def citation(self) -> str:
        return f"{self.publisher}, \"{self.title}\" — {self.section} ({self.source_url})"

    @property
    def citation_block(self) -> str:
        """The Phase 4 Step 19 citation representation — verbose and
        structured, for a future Clinical Agent to attach to a specific
        claim (Claim -> Evidence ID -> Source). The short `citation`
        property above remains what chat/care-plan narratives use inline;
        this is additive, not a replacement. PMID/DOI are included only
        when actually present (PubMed-derived chunks) — never fabricated
        for local KB chunks (Phase 5 Step 24)."""
        lines = [
            f"Title: {self.title}",
            f"Source: {self.publisher}",
            f"Document: {self.document_id}",
        ]
        if self.source_type == PUBMED_SOURCE:
            lines.append(f"PMID: {self.document_id.split('#', 1)[-1]}")
            if self.doi:
                lines.append(f"DOI: {self.doi}")
        else:
            lines.append(f"Section: {self.section}")
        lines.append(f"URL: {self.source_url or '(none)'}")
        lines.append(f"Retrieval score: {round(self.score, 4)}")
        return "\n".join(lines)


def _parse_frontmatter(raw: str) -> tuple[dict[str, str], str]:
    if not raw.startswith("---"):
        return {}, raw
    _, fm, body = raw.split("---", 2)
    meta: dict[str, str] = {}
    key = None
    for line in fm.splitlines():
        if not line.strip():
            continue
        if re.match(r"^\s+", line) and key:
            meta[key] = f"{meta[key]} {line.strip()}".strip()
            continue
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            meta[key] = value.strip().strip('"').lstrip(">-").strip()
    return meta, body


def _slugify(heading: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")
    return slug or "section"


def load_chunks() -> list[EvidenceChunk]:
    """One chunk per markdown section — sections in these documents are short
    and topically coherent, so they make better citation units than a fixed
    character window that would split mid-argument.

    Malformed input degrades gracefully rather than crashing ingestion: a
    section with no body text is skipped (nothing to cite), and any
    frontmatter field this function doesn't find is left as an empty
    string/"unknown" rather than fabricated (Phase 4 Step 6 — never invent
    a publisher, URL, or license that isn't actually in the source file)."""
    chunks: list[EvidenceChunk] = []
    for path in sorted(KB_DIR.glob("*.md")):
        meta, body = _parse_frontmatter(path.read_text())
        for block in re.split(r"^##\s+", body, flags=re.MULTILINE)[1:]:
            heading, _, text = block.partition("\n")
            heading = heading.strip()
            text = " ".join(text.split())
            if not text:
                continue
            chunks.append(
                EvidenceChunk(
                    text=text,
                    document_id=f"{path.stem}#{_slugify(heading)}",
                    section=heading,
                    title=meta.get("title", path.stem),
                    publisher=meta.get("publisher", "unknown"),
                    source_url=meta.get("source_url", ""),
                    accessed=meta.get("accessed", ""),
                    license=meta.get("license", ""),
                    attribution=meta.get("attribution", ""),
                )
            )
    return chunks


class KeywordStore:
    """Dependency-free fallback ranker: token-overlap scoring with a light
    idf-ish weighting. Deterministic, which also makes it the store used in
    tests."""

    backend_name = "keyword-fallback"

    # A relevance floor beyond the built-in "zero token overlap -> excluded"
    # rule below (docs/RAG.md "Relevance threshold" — calibrated
    # empirically, not a medically meaningful number). On the actual
    # knowledge base, genuine on-topic queries score >= 1.4; a probe set of
    # off-topic queries occasionally scores a low nonzero value from an
    # incidental partial-word stem match (e.g. "development" partially
    # matching "develops") — 0.5 sits well above that noise floor and well
    # below every genuine on-topic score observed.
    MIN_RELEVANCE_SCORE = 0.5

    def __init__(self, chunks: list[EvidenceChunk]):
        self.chunks = chunks

    @staticmethod
    def _stem(token: str) -> str:
        # Crude suffix stripping so "sleeping"/"stressed"/"symptoms" match
        # "sleep"/"stress"/"symptom". Good enough for a fallback ranker over a
        # small corpus; the embedding backend needs none of this.
        for suffix in ("ing", "ed", "es", "s"):
            if len(token) > len(suffix) + 2 and token.endswith(suffix):
                return token[: -len(suffix)]
        return token

    @classmethod
    def _tokens(cls, text: str) -> set[str]:
        raw = [t for t in re.findall(r"[a-z]+", text.lower()) if t not in STOPWORDS and len(t) > 2]
        return {cls._stem(t) for t in raw} | set(raw)

    def query(self, text: str, k: int = DEFAULT_TOP_K) -> list[EvidenceChunk]:
        q = self._tokens(text)
        if not q:
            return []
        expanded = set(q)
        for token in q:
            expanded |= SYNONYMS.get(token, set())

        scored: list[EvidenceChunk] = []
        for chunk in self.chunks:
            section_tokens = self._tokens(chunk.section)
            body_tokens = self._tokens(chunk.text)
            all_tokens = section_tokens | body_tokens
            if not (expanded & all_tokens):
                continue
            # Literal query terms count full; synonym-only hits count less, so
            # an exact match still outranks an expansion match.
            direct = len(q & all_tokens)
            synonym_only = len((expanded - q) & all_tokens) * 0.4
            title_bonus = len(expanded & section_tokens) * 1.5
            score = (direct + synonym_only + title_bonus) / len(q)
            if score < self.MIN_RELEVANCE_SCORE:
                continue
            scored.append(EvidenceChunk(**{**chunk.__dict__, "score": score}))
        scored.sort(key=lambda c: c.score, reverse=True)
        return scored[:k]


class ChromaStore:
    backend_name = "chromadb+sentence-transformers"

    # Calibrated empirically (docs/RAG.md "Relevance threshold") against 16
    # on-topic queries — including deliberately hard, near-zero-literal-
    # overlap paraphrases such as "what are the warning signs I should
    # watch for" (the existing regression test for exactly this class of
    # query) — and 8 clearly off-topic queries, all scored against this
    # exact knowledge base and embedding model. The hard paraphrases score
    # much lower than an easy direct question (0.197 vs. 0.68+), which is
    # why this threshold sits far lower than a first pass using only easy
    # probe queries suggested: off-topic noise topped out at 0.103, the
    # hardest genuine on-topic paraphrase scored 0.197. 0.15 sits roughly
    # in the middle of that (narrow, but real) gap. This is a
    # retrieval-quality cutoff only, not a claim about medical relevance.
    MIN_RELEVANCE_SCORE = 0.15

    def __init__(self, chunks: list[EvidenceChunk]):
        import chromadb
        from sentence_transformers import SentenceTransformer

        self.chunks = chunks
        self.model = SentenceTransformer(EMBED_MODEL)
        CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        # sentence-transformers embeddings are trained to be compared by
        # cosine similarity. Chroma's default space is raw squared L2
        # distance, which is on a completely different, unbounded scale — a
        # score derived from it (as this class used to do) is not a
        # similarity at all, just noise that happens to be well-behaved for
        # the closest neighbor and not much else. Setting the space
        # explicitly at creation time is required; it cannot be changed on
        # an existing collection.
        collection_meta = {"hnsw:space": "cosine", "schema_version": SCHEMA_VERSION}
        self.collection = client.get_or_create_collection(COLLECTION, metadata=collection_meta)
        if (
            self.collection.count() != len(chunks)
            or self.collection.metadata.get("hnsw:space") != "cosine"
            or self.collection.metadata.get("schema_version") != SCHEMA_VERSION
        ):
            # Rebuild from scratch when the KB changed, when an older
            # collection was created before cosine space was set explicitly,
            # or when the metadata schema itself changed (e.g. Phase 4 added
            # document_id) — small corpus, so a full re-embed is cheaper
            # than migrating.
            client.delete_collection(COLLECTION)
            self.collection = client.get_or_create_collection(COLLECTION, metadata=collection_meta)
            embeddings = self.model.encode([c.text for c in chunks]).tolist()
            self.collection.add(
                ids=[str(i) for i in range(len(chunks))],
                documents=[c.text for c in chunks],
                embeddings=embeddings,
                metadatas=[
                    {
                        "document_id": c.document_id,
                        "section": c.section,
                        "title": c.title,
                        "publisher": c.publisher,
                        "source_url": c.source_url,
                        "accessed": c.accessed,
                        "license": c.license,
                        "attribution": c.attribution,
                    }
                    for c in chunks
                ],
            )

    def query(self, text: str, k: int = DEFAULT_TOP_K) -> list[EvidenceChunk]:
        embedding = self.model.encode([text]).tolist()
        res = self.collection.query(query_embeddings=embedding, n_results=k)
        out: list[EvidenceChunk] = []
        for doc, meta, dist in zip(
            res["documents"][0], res["metadatas"][0], res["distances"][0]
        ):
            score = 1.0 - float(dist)
            if score < self.MIN_RELEVANCE_SCORE:
                continue
            out.append(
                EvidenceChunk(
                    text=doc,
                    document_id=meta.get("document_id", ""),
                    section=meta.get("section", ""),
                    title=meta.get("title", ""),
                    publisher=meta.get("publisher", ""),
                    source_url=meta.get("source_url", ""),
                    accessed=meta.get("accessed", ""),
                    license=meta.get("license", ""),
                    attribution=meta.get("attribution", ""),
                    score=score,
                )
            )
        return out


@lru_cache(maxsize=1)
def get_store():
    chunks = load_chunks()
    try:
        return ChromaStore(chunks)
    except Exception:
        # Missing optional deps, or a corrupt local Chroma dir — either way
        # the fallback keeps evidence retrieval working.
        return KeywordStore(chunks)


# --- Phase 5: PubMed as a second evidence source (docs/RAG.md) ---
#
# PubMedArticle -> EvidenceChunk normalization, cross-source deduplication,
# and Reciprocal Rank Fusion all live here — the existing evidence-retrieval
# module — rather than in a new medical_evidence_service.py, per Phase 5
# Step 10. The Evidence Agent and every existing caller keep calling
# EvidenceAgent.retrieve()/search_evidence() exactly as before; only
# `source="pubmed"` or `source="all"` opts into any of this.


def _rank_to_score(rank: int) -> float:
    """PubMed's ESearch returns PMIDs in relevance order but with no
    numeric relevance score. Reciprocal rank (1/rank) turns that ordering
    into a bounded (0, 1] value that's honestly rank-derived, not a
    fabricated magnitude — and it's the same quantity Reciprocal Rank
    Fusion below uses, so a standalone PubMed-only query and a fused
    "all sources" query report `score` on one consistent basis."""
    return 1.0 / rank


def _pubmed_article_to_chunk(article: Any, rank: int) -> EvidenceChunk:
    """PubMedArticle -> EvidenceChunk (Phase 5 Step 7). `accessed` is the
    retrieval date (when MedGenesis actually fetched this record) — honest
    for a live API response, unlike the local KB's frontmatter `accessed`
    date which records when a human curator reviewed the source."""
    return EvidenceChunk(
        text=article.abstract or "",
        document_id=f"pubmed#{article.pmid}",
        section="Abstract",
        title=article.title,
        publisher=article.journal,
        source_url=article.url,
        accessed=datetime.now(timezone.utc).date().isoformat(),
        license="",
        attribution="",
        score=_rank_to_score(rank),
        source_type=PUBMED_SOURCE,
        doi=article.doi or "",
    )


def _query_pubmed(query: str, k: int) -> list[EvidenceChunk]:
    """Never raises — a PubMed failure (not configured, network error,
    NCBI outage) degrades to "no PubMed evidence" exactly like the local
    store already degrades ChromaDB init failures to the keyword fallback
    (Phase 5 Step 15). Articles with no abstract are dropped here (Phase 5
    Step 22): there is no text for them to contribute to a text-retrieval
    result, though the underlying PubMedArticle metadata was still
    genuinely fetched — this decision is `search_evidence`'s, not
    `services/pubmed.py`'s, which returns everything it found."""
    from app.services.pubmed import PubMedUnavailableError, get_pubmed_client

    try:
        articles = get_pubmed_client().search(query, max_results=k)
    except (NotImplementedError, PubMedUnavailableError) as exc:
        logger.warning("PubMed evidence source unavailable (%s) — continuing without it.", exc)
        return []
    return [_pubmed_article_to_chunk(a, rank) for rank, a in enumerate(articles, start=1) if a.abstract]


def _normalize_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def _deduplicate(chunks: list[EvidenceChunk]) -> list[EvidenceChunk]:
    """Cross-source dedup (Phase 5 Step 16): same document_id (catches an
    exact repeat, e.g. the same PMID appearing twice), same DOI, or the
    same normalized title are treated as one piece of evidence — only the
    first (highest fused-rank) occurrence is kept. Distinct studies on the
    same topic are NOT deduplicated; only genuine same-record duplicates
    are.

    DOI/title matching is scoped to PubMed-origin chunks only. Local KB
    chunks intentionally share one `title` per source document across many
    distinct sections (e.g. every "Diabetes Basics" section has the same
    title) — applying title-based dedup to them would wrongly collapse
    unrelated sections into one. PubMed titles are one-per-article, so this
    check is meaningful only there.
    """
    seen_ids: set[str] = set()
    seen_dois: set[str] = set()
    seen_pubmed_titles: set[str] = set()
    out: list[EvidenceChunk] = []
    for chunk in chunks:
        if chunk.document_id in seen_ids:
            continue
        if chunk.source_type == PUBMED_SOURCE:
            if chunk.doi and chunk.doi in seen_dois:
                continue
            title_key = _normalize_title(chunk.title)
            if title_key and title_key in seen_pubmed_titles:
                continue
            if chunk.doi:
                seen_dois.add(chunk.doi)
            if title_key:
                seen_pubmed_titles.add(title_key)
        seen_ids.add(chunk.document_id)
        out.append(chunk)
    return out


def _reciprocal_rank_fusion(
    local_chunks: list[EvidenceChunk], pubmed_chunks: list[EvidenceChunk]
) -> list[EvidenceChunk]:
    """Merges two independently-ranked result lists into one ranking using
    each item's RANK POSITION only (never a raw score) — see RRF_K's
    definition above for why. A document_id present in both lists
    accumulates both contributions, which also naturally dedupes an exact
    document_id repeat before `_deduplicate` even runs."""
    fused_scores: dict[str, float] = {}
    chunk_by_id: dict[str, EvidenceChunk] = {}
    for result_list in (local_chunks, pubmed_chunks):
        for rank, chunk in enumerate(result_list, start=1):
            fused_scores[chunk.document_id] = fused_scores.get(chunk.document_id, 0.0) + 1.0 / (RRF_K + rank)
            chunk_by_id.setdefault(chunk.document_id, chunk)
    ordered_ids = sorted(fused_scores, key=lambda doc_id: fused_scores[doc_id], reverse=True)
    return [
        EvidenceChunk(**{**chunk_by_id[doc_id].__dict__, "score": fused_scores[doc_id]})
        for doc_id in ordered_ids
    ]


def search_evidence(query: str, k: int = DEFAULT_TOP_K, source: str = LOCAL_SOURCE) -> list[EvidenceChunk]:
    """Multi-source evidence retrieval (Phase 5, docs/RAG.md). `source`
    defaults to "local" — exactly today's behavior — so every existing
    caller (ConversationalAgent, CarePlanAgent, the orchestrator's
    evidence_node, all of which call EvidenceAgent.retrieve() with no
    `source` argument) is completely unaffected; PubMed is opt-in only,
    never silently called (Phase 5 Step 12)."""
    if source not in VALID_SOURCES:
        raise ValueError(f"Unknown evidence source {source!r}; expected one of {VALID_SOURCES}")

    if source == LOCAL_SOURCE:
        return get_store().query(query, k=k)
    if source == PUBMED_SOURCE:
        return _query_pubmed(query, k)[:k]

    # source == ALL_SOURCES: retrieve from both, fuse by rank, dedupe.
    local_chunks = get_store().query(query, k=k)
    pubmed_chunks = _query_pubmed(query, k)
    fused = _reciprocal_rank_fusion(local_chunks, pubmed_chunks)
    return _deduplicate(fused)[:k]
