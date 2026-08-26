"""Data loading/preprocessing for the XGBoost candidate model.

SCAFFOLDING ONLY — not implemented yet. When built, this will reuse the same
CDC BRFSS 2015 dataset and loading approach as
app/ml/train_screening_model.py::load_data() rather than duplicating it, so
the RandomForest and XGBoost candidates are trained on identical inputs and
any metric difference reflects the algorithm, not the data.
"""

from __future__ import annotations

import pandas as pd


def load_data() -> pd.DataFrame:
    """Will load and prepare the CDC BRFSS 2015 dataset for XGBoost training.

    Not implemented in this phase — no training happens yet.
    """
    raise NotImplementedError(
        "XGBoost preprocessing is scaffolding only in this phase. "
        "See docs/ARCHITECTURE.md for the planned implementation."
    )
