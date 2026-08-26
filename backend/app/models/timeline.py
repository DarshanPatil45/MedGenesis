from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import JSONColumn

EVENT_TYPES = ("measurement", "lifestyle_log", "screening", "care_plan", "chat", "note")
EVENT_SOURCES = ("real", "synthetic")


class TimelineEvent(Base):
    """The Patient Digital Twin: an append-only, timestamped log. Nothing is
    ever overwritten here — a patient's "current state" is always computed
    by reading the latest relevant event(s), not by mutating a row. This is
    what lets every screening/care-plan/simulation output stay traceable to
    the exact twin state it was produced from."""

    __tablename__ = "timeline_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSONColumn, nullable=False, default=dict)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="real")
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )

    patient = relationship("Patient", back_populates="timeline_events")
