"""Regression guard for a real, severe bug found via live browser testing
in Phase 7: on macOS, xgboost and torch (pulled in transitively by the RAG
evidence store's sentence-transformers backend) ship incompatible bundled
OpenMP runtimes. Whichever loads second segfaults the *entire process* —
not a caught exception, the whole uvicorn worker dies. Reproduced live:
POST /api/clinical/analyze with include_model_comparison=True (the first
code path in a running server that imports xgboost) killed the server
after an earlier request had already loaded sentence-transformers/torch.

tests/conftest.py already imports xgboost first for the pytest process
(a Phase 5 fix) — which means this specific class of regression can NOT be
caught by an ordinary test running inside this suite; conftest.py's own
fix neutralizes it for every test here regardless of app/main.py's import
order. This test instead directly guards the fix's actual location:
app/main.py must still import xgboost before the routers that transitively
pull in torch via the RAG evidence store, since that file — not
conftest.py — is what protects a real running server process.
"""

from __future__ import annotations

import re
from pathlib import Path


def test_main_imports_xgboost_before_routers():
    source = Path(__file__).resolve().parents[1].joinpath("app", "main.py").read_text()
    xgboost_import = re.search(r"^import xgboost\b", source, re.MULTILINE)
    routers_import = re.search(r"^from app\.routers import\b", source, re.MULTILINE)
    assert xgboost_import, "app/main.py must import xgboost directly (see this file's docstring)"
    assert routers_import, "expected app/main.py to import the routers package"
    assert xgboost_import.start() < routers_import.start(), (
        "xgboost must be imported before app.routers (which transitively imports the RAG "
        "evidence store's sentence-transformers/torch backend) — reordering this reintroduces "
        "a real macOS OpenMP segfault, previously reproduced live via POST /api/clinical/analyze"
    )


def test_app_imports_without_crashing():
    """A weaker but still real guard: at minimum, importing the app module
    in a fresh interpreter state within this test run must not raise."""
    import app.main  # noqa: F401
