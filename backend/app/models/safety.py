from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.types import JSONColumn

SAFETY_STATUSES = ("APPROVED", "FLAGGED_FOR_CLINICIAN_REVIEW", "BLOCKED")


class SafetyAuditLog(Base):
    """Append-only log written by the Safety/Clinician-Review Agent for
    every high-stakes output it gates. Never updated or deleted — this is
    the audit trail referenced in docs/ARCHITECTURE.md section 4.8."""

    __tablename__ = "safety_audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    reasons: Mapped[list] = mapped_column(JSONColumn, nullable=False, default=list)
    policy_version: Mapped[str] = mapped_column(String(30), nullable=False)
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
