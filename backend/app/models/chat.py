from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.types import JSONColumn


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user | agent
    agent_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sources: Mapped[list] = mapped_column(JSONColumn, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
