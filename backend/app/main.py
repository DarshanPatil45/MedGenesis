from __future__ import annotations

import logging
from contextlib import asynccontextmanager

# Must be imported before torch/sentence-transformers (pulled in lazily by
# the RAG evidence store on first use, and by app.routers.ml at import
# time). On macOS, xgboost links Homebrew's libomp while torch bundles its
# own OpenMP runtime; whichever loads second segfaults the whole process
# instead of just warning. This is a REAL crash, reproduced live: hitting
# POST /api/clinical/analyze with include_model_comparison=True (the first
# code path in a running server that imports xgboost) killed the entire
# uvicorn process once sentence-transformers had already loaded torch for
# an earlier request. tests/conftest.py already carries the identical fix
# for the pytest process; this is the same fix for the actual application
# entrypoint, since a live server has no equivalent conftest.py to rely on.
import xgboost  # noqa: E402,F401

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.agents.safety_agent import get_safety_agent
from app.database import DATABASE_URL, engine, init_db
from app.routers import agents, evidence, ml, patients, safety, twin
from app.schemas import HealthOut
from app.services.llm import get_llm

DESCRIPTION = """
MedGenesis — an agentic AI healthcare system for Type 2 Diabetes education.

**Educational prototype. Not medical advice, not a diagnostic device.**

The screening model is an educational screening-risk baseline trained on the
CDC's 2015 BRFSS Diabetes Health Indicators survey — self-reported data, not
a diagnosis. Every clinically-sensitive output is gated by the
Safety/Clinician-Review Agent before it is returned.
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s", force=True
    )
    init_db()
    # Makes it obvious during grading/demo whether the hosted LLM, local
    # Ollama, or the rule-based fallback is the active chat path.
    get_llm().log_startup_status()
    yield


app = FastAPI(
    title="MedGenesis API",
    description=DESCRIPTION,
    version="1.0.0",
    lifespan=lifespan,
)

# Local dev origins only — this prototype is not intended for deployment.
# Any localhost port is allowed so a dev server on an alternate port (when
# 5173 is taken) still works; the regex keeps this to loopback only.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(patients.router)
app.include_router(twin.router)
app.include_router(agents.router)
app.include_router(safety.router)
app.include_router(ml.router)
app.include_router(evidence.router)


@app.get("/api/health", response_model=HealthOut, tags=["meta"])
def health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = f"sqlite ({DATABASE_URL.rsplit('/', 1)[-1]})"
    except Exception as exc:
        db_status = f"unavailable: {exc}"

    try:
        from app.agents.screening_agent import _load_artifacts

        _, _, metadata = _load_artifacts()
        model_status = metadata.get("model_version", "loaded")
    except Exception:
        model_status = "missing — run: python -m app.ml.train_screening_model"

    try:
        from app.services.rag import get_store

        rag_status = get_store().backend_name
    except Exception as exc:
        rag_status = f"unavailable: {exc}"

    llm_status = get_llm().describe()

    return HealthOut(
        status="ok",
        database=db_status,
        screening_model=model_status,
        rag_backend=rag_status,
        llm=llm_status,
        policy_version=get_safety_agent().policy_version,
    )


@app.get("/", tags=["meta"])
def root():
    return {
        "name": "MedGenesis API",
        "docs": "/docs",
        "health": "/api/health",
        "disclaimer": "Educational prototype — not medical advice, not a diagnostic device.",
    }
