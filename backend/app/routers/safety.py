from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.safety_agent import get_safety_agent
from app.database import get_db
from app.models.safety import SafetyAuditLog
from app.schemas import AuditLogOut

router = APIRouter(prefix="/api/safety", tags=["safety"])


@router.get("/audit-log", response_model=list[AuditLogOut])
def get_audit_log(
    limit: int = Query(100, ge=1, le=1000),
    target_type: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(SafetyAuditLog).order_by(SafetyAuditLog.id.desc()).limit(limit)
    if target_type:
        stmt = stmt.where(SafetyAuditLog.target_type == target_type)
    if status:
        stmt = stmt.where(SafetyAuditLog.status == status)
    return list(db.execute(stmt).scalars().all())


@router.get("/policy")
def get_policy():
    """Exposes the active policy so the UI can show what the gate enforces
    rather than asking the user to trust an opaque decision."""
    policy = get_safety_agent().policy
    return {
        "policy_version": policy.get("policy_version"),
        "blocked_rule_ids": [r["id"] for r in policy.get("blocked_patterns", [])],
        "blocked_rules": [
            {"id": r["id"], "reason": r["reason"], "pattern_count": len(r.get("patterns", []))}
            for r in policy.get("blocked_patterns", [])
        ],
        "flag_rules": policy.get("flag_rules", {}),
        "disclaimer_required_for": policy.get("disclaimer_required_for", []),
        "required_scope": policy.get("required_scope"),
        "disclaimer_text": (policy.get("disclaimer_text") or "").strip(),
    }
