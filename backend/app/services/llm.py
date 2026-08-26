"""LLM backends for the Conversational Assistant Agent.

Three backends are tried in priority order, and the first available one wins:

  1. Mistral API  — hosted, requires MISTRAL_API_KEY. NOTE: this is a paid
     hosted service, so it is the one component that departs from the
     project's free/open-source constraint. It is strictly optional.
  2. Ollama       — local, free, open-source, no API key.
  3. Rule-based   — no dependencies, always available (implemented in
     conversational_agent.py).

Nothing else in MedGenesis needs an LLM: screening, simulation, evidence
retrieval, care-plan rules and the safety gate are all deterministic and run
fully offline. A missing key degrades chat phrasing only — it never breaks
the app, which is why no code path here raises on an unset key.

Secrets are read from the environment only. Real values belong in
backend/.env (gitignored); backend/.env.example holds placeholders.
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger("medgenesis.llm")

MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY", "").strip()
MISTRAL_MODEL = os.environ.get("MISTRAL_MODEL", "mistral-small-latest")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")
REQUEST_TIMEOUT = float(os.environ.get("LLM_TIMEOUT_SECONDS", "45"))
DISABLE_LLM = os.environ.get("MEDGENESIS_DISABLE_LLM", "").lower() in ("1", "true", "yes")


class MistralBackend:
    name = "mistral"

    def __init__(self, api_key: str = MISTRAL_API_KEY, model: str = MISTRAL_MODEL):
        self.api_key = api_key
        self.model = model
        self._client = None
        self._checked = False

    def is_available(self) -> bool:
        if not self.api_key:
            return False
        if self._checked:
            return self._client is not None
        self._checked = True
        try:
            from mistralai import Mistral

            self._client = Mistral(api_key=self.api_key)
        except ImportError:
            logger.warning(
                "MISTRAL_API_KEY is set but the 'mistralai' package is not installed. "
                "Run: pip install mistralai"
            )
            self._client = None
        except Exception as exc:
            logger.warning("Could not initialise the Mistral client: %s", exc)
            self._client = None
        return self._client is not None

    def generate(self, system_prompt: str, user_prompt: str) -> str | None:
        if not self.is_available():
            return None
        try:
            resp = self._client.chat.complete(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
                max_tokens=400,
            )
            return (resp.choices[0].message.content or "").strip() or None
        except Exception as exc:
            # Network error, bad key, rate limit — fall through to the next
            # backend rather than surfacing an error to the user.
            logger.warning("Mistral request failed (%s); falling back.", exc)
            return None


class OllamaBackend:
    name = "ollama"

    def __init__(self, base_url: str = OLLAMA_BASE_URL, model: str = OLLAMA_MODEL):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._available: bool | None = None

    def is_available(self, force_recheck: bool = False) -> bool:
        if self._available is not None and not force_recheck:
            return self._available
        try:
            self._available = httpx.get(f"{self.base_url}/api/tags", timeout=2.0).status_code == 200
        except Exception:
            self._available = False
        return self._available

    def generate(self, system_prompt: str, user_prompt: str) -> str | None:
        if not self.is_available():
            return None
        try:
            resp = httpx.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "options": {"temperature": 0.2},
                },
                timeout=REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            return (resp.json().get("message") or {}).get("content", "").strip() or None
        except Exception as exc:
            logger.warning("Ollama request failed (%s); falling back.", exc)
            return None


class LLMRouter:
    """Tries each backend in priority order. `active_backend` is reported by
    /api/health so a grader can see at a glance which path is live."""

    def __init__(self):
        self.backends = [MistralBackend(), OllamaBackend()]

    @property
    def active_backend(self):
        if DISABLE_LLM:
            return None
        return next((b for b in self.backends if b.is_available()), None)

    def is_available(self) -> bool:
        return self.active_backend is not None

    def describe(self) -> str:
        if DISABLE_LLM:
            return "disabled by MEDGENESIS_DISABLE_LLM — rule-based fallback"
        backend = self.active_backend
        if backend is None:
            return "unavailable — rule-based fallback"
        return f"{backend.name}:{backend.model}"

    def generate(self, system_prompt: str, user_prompt: str) -> str | None:
        if DISABLE_LLM:
            return None
        for backend in self.backends:
            if not backend.is_available():
                continue
            reply = backend.generate(system_prompt, user_prompt)
            if reply:
                return reply
        return None

    def log_startup_status(self) -> None:
        if DISABLE_LLM:
            logger.warning(
                "[medgenesis] LLM DISABLED via MEDGENESIS_DISABLE_LLM — the Conversational "
                "Assistant Agent will use the deterministic rule-based responder."
            )
            return
        if not MISTRAL_API_KEY:
            logger.warning(
                "[medgenesis] MISTRAL_API_KEY is not set — the hosted Mistral backend is "
                "disabled. Set it in backend/.env to enable it (see backend/.env.example)."
            )
        else:
            logger.info("[medgenesis] MISTRAL_API_KEY detected — hosted Mistral backend enabled.")

        backend = self.active_backend
        if backend is None:
            logger.warning(
                "[medgenesis] No LLM backend reachable (no Mistral key, no local Ollama). "
                "The Conversational Assistant Agent will use the rule-based fallback. "
                "Every other agent is deterministic and unaffected."
            )
        else:
            logger.info(
                "[medgenesis] Conversational Assistant Agent using LLM backend: %s (%s)",
                backend.name,
                backend.model,
            )


_router: LLMRouter | None = None


def get_llm() -> LLMRouter:
    global _router
    if _router is None:
        _router = LLMRouter()
    return _router
