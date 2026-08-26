"""Conversational Assistant Agent.

Local open-source LLM via Ollama, restricted by system prompt to
lifestyle/education topics and required to cite Evidence Agent snippets.
Falls back to a rule-based FAQ responder when Ollama isn't installed, so the
chat page works on a clean machine.

Note the layering: this agent's prompt restrictions are a first line of
defence only. The Safety Agent independently gates whatever comes back —
a small local model cannot be trusted to police itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.agents.evidence_agent import get_evidence_agent
from app.services.llm import get_llm

CHAT_SYSTEM_PROMPT = """You are MedGenesis, a diabetes health-education assistant in an \
educational prototype. You are NOT a doctor and must never behave like one.

Strict rules:
- Answer ONLY questions about general diabetes education, diet, physical activity, sleep, \
stress, and monitoring habits.
- Base factual claims on the SOURCES provided in the user message and refer to them.
- NEVER diagnose. Never say the user has, does not have, or might have diabetes or prediabetes.
- NEVER discuss specific medications, dosages, or changes to prescribed treatment. Redirect \
those to a clinician.
- Never promise or guarantee a health outcome.
- If asked something outside this scope, say it is outside what this educational tool covers \
and suggest speaking with a clinician.
- Be concise: 150 words maximum, plain language."""

FALLBACK_INTRO = (
    "Ollama is not running, so this reply comes from MedGenesis's built-in rule-based responder "
    "using the same cited knowledge base."
)

OUT_OF_SCOPE_REPLY = (
    "That question is outside what this educational prototype covers. MedGenesis can help with "
    "general information about diabetes, diet, physical activity, monitoring habits, sleep and "
    "stress. For anything involving diagnosis, medication or your specific treatment, please "
    "speak with a qualified clinician."
)


@dataclass
class ChatResult:
    reply_text: str
    sources: list[dict[str, Any]] = field(default_factory=list)
    generated_by: str = "rules"
    tools_used: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "reply_text": self.reply_text,
            "sources": self.sources,
            "generated_by": self.generated_by,
            "tools_used": self.tools_used,
        }


class ConversationalAgent:
    name = "ConversationalAssistantAgent"

    def run(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
        patient_context: dict[str, Any] | None = None,
        use_llm: bool = True,
    ) -> ChatResult:
        evidence = get_evidence_agent()
        chunks = evidence.retrieve(message, k=3)
        tools_used = ["EvidenceRetrievalAgent"]

        if not chunks:
            return ChatResult(reply_text=OUT_OF_SCOPE_REPLY, tools_used=tools_used)

        sources = [c.to_dict() for c in chunks]

        if use_llm:
            reply = get_llm().generate(
                CHAT_SYSTEM_PROMPT, self._llm_prompt(message, history, patient_context, chunks)
            )
            if reply:
                citations = "\n\nSources: " + "; ".join(c.citation for c in chunks)
                return ChatResult(
                    reply_text=reply + citations,
                    sources=sources,
                    generated_by="ollama",
                    tools_used=tools_used,
                )

        return ChatResult(
            reply_text=self._fallback_reply(chunks),
            sources=sources,
            generated_by="rules-fallback",
            tools_used=tools_used,
        )

    @staticmethod
    def _llm_prompt(message, history, patient_context, chunks) -> str:
        parts = []
        if patient_context:
            tier = patient_context.get("risk_tier")
            if tier:
                parts.append(
                    f"CONTEXT: this user's educational screening-risk tier is {tier}. "
                    "Do not restate it as a diagnosis."
                )
        if history:
            recent = "\n".join(f"{m['role']}: {m['content']}" for m in history[-4:])
            parts.append(f"RECENT CONVERSATION:\n{recent}")
        sources_block = "\n\n".join(
            f"[{i + 1}] {c.publisher} — {c.section}: {c.text}" for i, c in enumerate(chunks)
        )
        parts.append(f"SOURCES:\n{sources_block}")
        parts.append(f"USER QUESTION: {message}")
        return "\n\n".join(parts)

    @staticmethod
    def _fallback_reply(chunks) -> str:
        body = "\n\n".join(f"{c.section} ({c.publisher}): {c.text}" for c in chunks)
        citations = "; ".join(c.citation for c in chunks)
        return (
            f"{FALLBACK_INTRO}\n\nHere is what the knowledge base says on this topic:\n\n{body}\n\n"
            f"Sources: {citations}"
        )


_agent: ConversationalAgent | None = None


def get_conversational_agent() -> ConversationalAgent:
    global _agent
    if _agent is None:
        _agent = ConversationalAgent()
    return _agent
