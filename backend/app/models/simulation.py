from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.types import JSONColumn


class Simulation(Base):
    """What-if Simulation Agent output. Forked from a Digital Twin snapshot
    (base_timeline_event_id) — never writes back into the real timeline."""

    __tablename__ = "simulations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    base_timeline_event_id: Mapped[int | None] = mapped_column(
        ForeignKey("timeline_events.id"), nullable=True
    )
    hypothesis: Mapped[dict] = mapped_column(JSONColumn, nullable=False, default=dict)
    projected_trajectory: Mapped[list] = mapped_column(JSONColumn, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
