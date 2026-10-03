import pandas as pd

import workers.celery_app  # noqa: F401 — registers tasks, avoids the mining import cycle
from workers.tasks.mining.dedup import _find_potential_duplicates


def test_dedup_pairs_only_repeated_blocking_keys():
    df = pd.DataFrame({"MARA.MATNR": ["A", "B", "A", "C", "C", "C"], "MARA.MTART": ["FERT"] * 6})
    dups = _find_potential_duplicates(df, "material_master")
    assert len(dups) == 1 + 3  # one A pair, three C pairs
