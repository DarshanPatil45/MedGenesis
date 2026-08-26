"""
Database configuration.

MedGenesis uses **SQLite** as its primary datastore. The whole project is a
single-user educational prototype that has to be runnable — and gradeable —
with nothing more than `pip install -r requirements.txt`, so an embedded,
zero-install, zero-configuration database is the right fit. There is no
separate database server to start and no container runtime required.

The database file is created automatically on first run (see `init_db`).

`DATABASE_URL` is still read from the environment so the path can be moved
(tests point it at a temporary file, for example):

    sqlite:///./medgenesis.db        (default — relative to the backend dir)
    sqlite:////absolute/path/app.db  (absolute path; note the four slashes)
"""

from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DEFAULT_DATABASE_URL = "sqlite:///./medgenesis.db"
DATABASE_URL = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)

IS_SQLITE = DATABASE_URL.startswith("sqlite")

# FastAPI serves requests from a threadpool, so a connection created on one
# thread can be used on another. SQLite guards against this by default;
# SQLAlchemy's session-per-request scoping already makes it safe here.
connect_args = {"check_same_thread": False} if IS_SQLITE else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Creates any missing tables. Called on application startup, which is
    what makes a cold boot against a deleted database file just work."""
    # Import models so they're registered on Base.metadata before create_all.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
