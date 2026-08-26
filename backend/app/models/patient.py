from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

VALID_SEX_VALUES = ("female", "male", "other", "unspecified")


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pseudonym: Mapped[str] = mapped_column(String(120), nullable=False)
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    sex: Mapped[str] = mapped_column(String(20), nullable=False, default="unspecified")
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    timeline_events = relationship(
        "TimelineEvent", back_populates="patient", cascade="all, delete-orphan"
    )

    @property
    def screening_eligible(self) -> bool:
        """Structural eligibility for the Screening Risk Baseline Agent.

        The model is trained on the CDC's 2015 BRFSS Diabetes Health
        Indicators survey (see docs/ARCHITECTURE.md §13.7), which applies to
        the general adult population — unlike this project's original
        Pima-based model, there is no narrow demographic restriction here.
        The one real structural constraint is that BRFSS's "Sex" question was
        coded as binary (female/male) with no other option recorded, so the
        trained model has no encoding for "other"/"unspecified" and cannot
        produce a meaningful score for those patients. This is a genuine
        limitation of the source data, not an arbitrary gate. (A further,
        per-request check confirms the remaining trained features are
        actually on file; see app/agents/screening_agent.py.)
        """
        return self.sex in ("female", "male")
