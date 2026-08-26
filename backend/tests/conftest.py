import os
import tempfile
from pathlib import Path

import pytest

# Must be set before app.database is imported, since the engine is built at
# module import time.
_TMP_DB = Path(tempfile.mkdtemp()) / "test_medgenesis.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DB}"
# Keep tests deterministic and offline: never call a hosted or local LLM.
os.environ["MEDGENESIS_DISABLE_LLM"] = "true"
os.environ.pop("MISTRAL_API_KEY", None)

# Must be imported before torch/sentence-transformers (pulled in later via
# app.main -> the RAG evidence agent). On macOS, xgboost links Homebrew's
# libomp while torch bundles its own OpenMP runtime; whichever loads second
# segfaults the process instead of just warning (verified: reproduces with
# `import torch; import xgboost` in that order, silent with the reverse
# order). Importing it first here — once, for the whole test session —
# avoids the crash regardless of which test file pytest collects first.
import xgboost  # noqa: E402,F401

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def db_session():
    from app.database import SessionLocal

    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def eligible_patient(client):
    return client.post("/api/patients/demo", json={"profile": "moderate_risk"}).json()


@pytest.fixture()
def incomplete_patient(client):
    """A patient with a genuinely incomplete recorded history — the
    screening agent's eligibility gate is a data-completeness check (see
    docs/ARCHITECTURE.md §13.7), not a population restriction, so this is
    what exercises the refusal path now."""
    return client.post("/api/patients/demo", json={"profile": "incomplete_history"}).json()
