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

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

KB_DIR = Path(__file__).resolve().parents[2] / "data" / "knowledge_base"
CHROMA_DIR = Path(__file__).resolve().parents[2] / "data" / "chroma"
EMBED_MODEL = "all-MiniLM-L6-v2"
COLLECTION = "medgenesis_evidence"
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
        this is additive, not a replacement."""
        return (
            f"Title: {self.title}\n"
            f"Source: {self.publisher}\n"
            f"Document: {self.document_id}\n"
            f"Section: {self.section}\n"
            f"URL: {self.source_url or '(none)'}\n"
            f"Retrieval score: {round(self.score, 4)}"
        )


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
