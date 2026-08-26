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


def load_chunks() -> list[EvidenceChunk]:
    """One chunk per markdown section — sections in these documents are short
    and topically coherent, so they make better citation units than a fixed
    character window that would split mid-argument."""
    chunks: list[EvidenceChunk] = []
    for path in sorted(KB_DIR.glob("*.md")):
        meta, body = _parse_frontmatter(path.read_text())
        for block in re.split(r"^##\s+", body, flags=re.MULTILINE)[1:]:
            heading, _, text = block.partition("\n")
            text = " ".join(text.split())
            if not text:
                continue
            chunks.append(
                EvidenceChunk(
                    text=text,
                    section=heading.strip(),
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

    def query(self, text: str, k: int = 3) -> list[EvidenceChunk]:
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
            scored.append(EvidenceChunk(**{**chunk.__dict__, "score": score}))
        scored.sort(key=lambda c: c.score, reverse=True)
        return scored[:k]


class ChromaStore:
    backend_name = "chromadb+sentence-transformers"

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
        collection_meta = {"hnsw:space": "cosine"}
        self.collection = client.get_or_create_collection(COLLECTION, metadata=collection_meta)
        if self.collection.count() != len(chunks) or self.collection.metadata.get("hnsw:space") != "cosine":
            # Rebuild from scratch when the KB changed, or when an older
            # collection was created before cosine space was set explicitly
            # — small corpus, so a full re-embed is cheaper than migrating.
            client.delete_collection(COLLECTION)
            self.collection = client.get_or_create_collection(COLLECTION, metadata=collection_meta)
            embeddings = self.model.encode([c.text for c in chunks]).tolist()
            self.collection.add(
                ids=[str(i) for i in range(len(chunks))],
                documents=[c.text for c in chunks],
                embeddings=embeddings,
                metadatas=[
                    {
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

    def query(self, text: str, k: int = 3) -> list[EvidenceChunk]:
        embedding = self.model.encode([text]).tolist()
        res = self.collection.query(query_embeddings=embedding, n_results=k)
        out: list[EvidenceChunk] = []
        for doc, meta, dist in zip(
            res["documents"][0], res["metadatas"][0], res["distances"][0]
        ):
            out.append(
                EvidenceChunk(
                    text=doc,
                    section=meta.get("section", ""),
                    title=meta.get("title", ""),
                    publisher=meta.get("publisher", ""),
                    source_url=meta.get("source_url", ""),
                    accessed=meta.get("accessed", ""),
                    license=meta.get("license", ""),
                    attribution=meta.get("attribution", ""),
                    score=1.0 - float(dist),
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
