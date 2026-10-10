"""Pair-cap sampling in relationship mining must be deterministic (same input, same output)."""
import random

import pandas as pd

import workers.celery_app  # noqa: F401 — registers tasks, avoids the mining import cycle
from workers.tasks.mining import relationship


def test_pair_cap_does_not_depend_on_random_state():
    df = pd.DataFrame(
        {f"T_ID{i}": [str(j % (i + 2)) for j in range(60)] for i in range(12)}
        | {f"T_C{i}": [str(j % 3) for j in range(60)] for i in range(25)}
    )
    random.seed(1)
    a = relationship._detect_relationships(df, "m", max_pairs=7)
    random.seed(2)
    b = relationship._detect_relationships(df, "m", max_pairs=7)
    assert a == b
