from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.types import JSONColumn


class CarePlan(Base):
    __tablename__ = "care_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False, index=True)
    screening_assessment_id: Mapped[int | None] = mapped_column(
        ForeignKey("screening_assessments.id"), nullable=True
    )
    simulation_id: Mapped[int | None] = mapped_column(ForeignKey("simulations.id"), nullable=True)
    diet_focus: Mapped[str] = mapped_column(String(200), nullable=False)
    activity_target: Mapped[str] = mapped_column(String(200), nullable=False)
    monitoring_frequency: Mapped[str] = mapped_column(String(200), nullable=False)
    follow_up_weeks: Mapped[int] = mapped_column(Integer, nullable=False)
    narrative_text: Mapped[str] = mapped_column(Text, nullable=False)
    sources: Mapped[list] = mapped_column(JSONColumn, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
