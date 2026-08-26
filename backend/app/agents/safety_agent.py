"""Safety / Clinician-Review Agent — the policy-driven gate every
clinically-sensitive output passes through before reaching a user.

Deliberately NOT an LLM judge. Rules live in `safety_policies.yaml` and are
applied deterministically, so the same output always yields the same
decision and the audit log is reproducible — see docs/ARCHITECTURE.md §4.8.

Decisions:
  APPROVED                      — passes through unchanged
  FLAGGED_FOR_CLINICIAN_REVIEW  — shown, but with a banner + reasons
  BLOCKED                       — content replaced with a safe fallback
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy.orm import Session

from app.models.safety import SafetyAuditLog

POLICY_PATH = Path(__file__).resolve().parent / "safety_policies.yaml"

APPROVED = "APPROVED"
FLAGGED = "FLAGGED_FOR_CLINICIAN_REVIEW"
BLOCKED = "BLOCKED"


@dataclass
class SafetyDecision:
    status: str
    reasons: list[str] = field(default_factory=list)
    text: str = ""
    disclaimer: str | None = None
    banner: str | None = None
    policy_version: str = ""

    @property
    def is_blocked(self) -> bool:
        return self.status == BLOCKED

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "reasons": self.reasons,
            "text": self.text,
            "disclaimer": self.disclaimer,
            "banner": self.banner,
            "policy_version": self.policy_version,
        }


def load_policy(path: Path = POLICY_PATH) -> dict[str, Any]:
    with open(path) as f:
        return yaml.safe_load(f)


class SafetyAgent:
    def __init__(self, policy: dict[str, Any] | None = None):
        self.policy = policy or load_policy()
        self.policy_version = self.policy.get("policy_version", "unknown")

    def review(
        self,
        *,
        output_kind: str,
        text: str,
        scope: str | None = None,
        risk_tier: str | None = None,
        trajectory: list[dict[str, Any]] | None = None,
        user_text: str | None = None,
    ) -> SafetyDecision:
        """Gate one output. `text` is what the user would see; the structured
        fields let the policy reason about things plain text can't express
        (risk tier, projected swing) without parsing prose."""
        reasons: list[str] = []
        haystack = (text or "").lower()

        for rule in self.policy.get("blocked_patterns", []):
            for pattern in rule.get("patterns", []):
                if self._contains(haystack, pattern):
                    reasons.append(f"[{rule['id']}] {rule['reason']} (matched: '{pattern}')")
                    return SafetyDecision(
                        status=BLOCKED,
                        reasons=reasons,
                        text=self.policy["blocked_fallback_text"].strip(),
                        policy_version=self.policy_version,
                    )

        flag_rules = self.policy.get("flag_rules", {})

        high_risk = flag_rules.get("high_risk_tier", {})
        if high_risk.get("enabled") and (risk_tier or "").lower() == "high":
            reasons.append(high_risk["reason"])

        swing_rule = flag_rules.get("large_simulation_swing", {})
        if swing_rule.get("enabled") and trajectory:
            swing = self._max_probability_swing(trajectory)
            threshold = float(swing_rule.get("max_abs_probability_swing", 0.30))
            if swing > threshold:
                reasons.append(f"{swing_rule['reason'].strip()} (swing {swing:.2f} > {threshold:.2f})")

        urgent = flag_rules.get("urgent_symptoms", {})
        if urgent.get("enabled"):
            symptom_haystack = f"{haystack} {(user_text or '').lower()}"
            for pattern in urgent.get("patterns", []):
                if self._contains(symptom_haystack, pattern):
                    reasons.append(f"{urgent['reason']} (matched: '{pattern}')")
                    break

        disclaimer = None
        if output_kind in self.policy.get("disclaimer_required_for", []):
            disclaimer = self.policy["disclaimer_text"].strip()
            required_scope = self.policy.get("required_scope")
            if scope != required_scope:
                # Repaired rather than blocked: the disclaimer is attached
                # here regardless, but the omission is recorded so the audit
                # log shows the upstream agent failed to declare its scope.
                reasons.append(
                    f"Missing or incorrect scope marker (expected '{required_scope}', got '{scope}') "
                    "— educational-scope disclaimer enforced by the safety gate."
                )

        status = FLAGGED if reasons else APPROVED
        banner = self.policy["clinician_review_banner"].strip() if status == FLAGGED else None

        return SafetyDecision(
            status=status,
            reasons=reasons,
            text=text,
            disclaimer=disclaimer,
            banner=banner,
            policy_version=self.policy_version,
        )

    def review_and_log(
        self,
        db: Session,
        *,
        target_type: str,
        target_id: str | int,
        output_kind: str,
        text: str,
        scope: str | None = None,
        risk_tier: str | None = None,
        trajectory: list[dict[str, Any]] | None = None,
        user_text: str | None = None,
    ) -> SafetyDecision:
        decision = self.review(
            output_kind=output_kind,
            text=text,
            scope=scope,
            risk_tier=risk_tier,
            trajectory=trajectory,
            user_text=user_text,
        )
        db.add(
            SafetyAuditLog(
                target_type=target_type,
                target_id=str(target_id),
                status=decision.status,
                reasons=decision.reasons,
                policy_version=decision.policy_version,
            )
        )
        db.commit()
        return decision

    @staticmethod
    def _contains(haystack: str, pattern: str) -> bool:
        # Word-boundary matching so "prescribe" doesn't fire on
        # "prescribed exercise" discussions of the word inside a longer token.
        return re.search(rf"(?<!\w){re.escape(pattern.lower())}(?!\w)", haystack) is not None

    @staticmethod
    def _max_probability_swing(trajectory: list[dict[str, Any]]) -> float:
        probs = [
            p["risk_probability"]
            for p in trajectory
            if isinstance(p, dict) and p.get("risk_probability") is not None
        ]
        if len(probs) < 2:
            return 0.0
        return max(probs) - min(probs)


_default_agent: SafetyAgent | None = None


def get_safety_agent() -> SafetyAgent:
    global _default_agent
    if _default_agent is None:
        _default_agent = SafetyAgent()
    return _default_agent
