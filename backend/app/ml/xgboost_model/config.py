"""Configuration for the XGBoost screening-risk candidate model.

SCAFFOLDING ONLY — see docs/ARCHITECTURE.md for what's implemented vs.
planned. No training has happened yet; this module defines where things
will live and what they'll be called once it does.

Design intent: XGBoost is trained as a SECOND CANDIDATE against the same
task the existing RandomForest solves (app/ml/train_screening_model.py) —
same CDC BRFSS 2015 dataset, same 21 features, same train/test split
convention — so the two are genuinely comparable. Its own `ARTIFACT_DIR` is
kept separate from the RandomForest's `app/ml/artifacts/` so training or
retraining one model can never overwrite the other's artifacts.
"""

from __future__ import annotations

from pathlib import Path

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

MODEL_VERSION = "xgboost-candidate-v1-brfss2015"

# Not yet populated — will be filled in during the XGBoost training phase
# once the actual model is trained.
DEFAULT_HYPERPARAMETERS: dict = {}
