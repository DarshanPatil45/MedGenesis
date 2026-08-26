from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.types import JSONColumn

EDUCATIONAL_SCOPE = "educational_screening_only"


class ScreeningAssessment(Base):
    __tablename__ = "screening_assessments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    timeline_event_id: Mapped[int | None] = mapped_column(
        ForeignKey("timeline_events.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False)  # scored | unavailable_for_profile
    risk_probability: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_tier: Mapped[str | None] = mapped_column(String(20), nullable=True)
    unavailable_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    top_features: Mapped[dict] = mapped_column(JSONColumn, nullable=False, default=dict)
    model_version: Mapped[str] = mapped_column(String(50), nullable=False)
    scope: Mapped[str] = mapped_column(String(50), nullable=False, default=EDUCATIONAL_SCOPE)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
