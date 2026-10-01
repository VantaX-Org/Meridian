"""Peer outliers — values far from what comparable records hold. Reported
separately and never scored: an outlier is a question, not a defect.

Values are compared in log10 space (weights and prices are log-normal, and
the errors that matter are orders of magnitude: a shifted decimal, grams
entered as kilograms), within peer groups that share the unit and currency,
using the modified z-score (median / MAD; mean absolute deviation when MAD is
0). Only groups of ≥ MIN_GROUP records are judged; |z| > THRESHOLD flags.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from checks.base import record_keys, sap_number
from checks.frames import TableFrames

MIN_GROUP = 10
THRESHOLD = 5.0
MIN_FACTOR = 3.0  # and at least 3x off the peer median: a 1 % difference in a uniform group is not an outlier
MAX_REPORTED = 200

# value (numerator [/ denominator]) compared within `per`
SPECS = (
    {"id": "OUT-MARA-NTGEW", "module": "material_master", "value": ["MARA.NTGEW"], "per": ["MARA.MATKL", "MARA.GEWEI"],
     "grain": "MARA", "label": "Net weight vs. materials of the same material group and weight unit"},
    {"id": "OUT-MARA-BRGEW", "module": "material_master", "value": ["MARA.BRGEW"], "per": ["MARA.MATKL", "MARA.GEWEI"],
     "grain": "MARA", "label": "Gross weight vs. materials of the same material group and weight unit"},
    {"id": "OUT-MARA-VOLUM", "module": "material_master", "value": ["MARA.VOLUM"], "per": ["MARA.MATKL", "MARA.VOLEH"],
     "grain": "MARA", "label": "Volume vs. materials of the same material group and volume unit"},
    {"id": "OUT-MBEW-STPRS", "module": "material_master", "value": ["MBEW.STPRS", "MBEW.PEINH"],
     "per": ["MARA.MATKL", "MARA.MEINS", "MBEW.BWKEY"], "grain": "MBEW", "when": {"MBEW.VPRSV": "S"},
     "label": "Standard price per unit vs. materials of the same group, base unit and valuation area"},
    {"id": "OUT-MBEW-VERPR", "module": "material_master", "value": ["MBEW.VERPR", "MBEW.PEINH"],
     "per": ["MARA.MATKL", "MARA.MEINS", "MBEW.BWKEY"], "grain": "MBEW", "when": {"MBEW.VPRSV": "V"},
     "label": "Moving average price per unit vs. materials of the same group, base unit and valuation area"},
    {"id": "OUT-EKPO-NETPR", "module": "mm_purchasing", "value": ["EKPO.NETPR", "EKPO.PEINH"],
     "per": ["EKPO.MATNR", "EKPO.MEINS", "EKKO.WAERS"], "grain": "EKPO",
     "label": "PO net price per unit vs. other PO items for the same material, order unit and currency"},
)


def _modified_z(x: pd.Series) -> pd.Series:
    med = x.median()
    mad = (x - med).abs().median()
    if mad > 0:
        return 0.6745 * (x - med) / mad
    mean_ad = (x - med).abs().mean()
    return (x - med) / (1.253314 * mean_ad) if mean_ad > 0 else x * 0.0


def find(module: str, frames: TableFrames) -> dict[str, dict]:
    out = {}
    for spec in (s for s in SPECS if s["module"] == module):
        cols = spec["value"] + spec["per"] + list(spec.get("when", {}))
        try:
            built = frames.frame_for(cols, grain=spec["grain"])
        except ValueError:
            built = None
        if built is None or any(c not in built[0].columns for c in cols):
            continue  # a field the spec needs was not extracted
        df, _, key_cols = built
        for c, v in spec.get("when", {}).items():
            df = df[df[c].astype("string").str.strip() == v]
        value = sap_number(df[spec["value"][0]])
        if len(spec["value"]) > 1:
            value = value / sap_number(df[spec["value"][1]]).where(lambda d: d > 0)
        keys = df[spec["per"]].astype("string").apply(lambda s: s.str.strip()).fillna("")
        ok = value.gt(0) & keys.ne("").all(axis=1)
        logv = np.log10(value[ok])
        z = logv.groupby([keys.loc[ok, c] for c in spec["per"]]).transform(
            lambda g: _modified_z(g) if len(g) >= MIN_GROUP else g * 0.0)
        median = value[ok].groupby([keys.loc[ok, c] for c in spec["per"]]).transform("median")
        size = value[ok].groupby([keys.loc[ok, c] for c in spec["per"]]).transform("size")
        ratio = value[ok] / median
        flagged = (z.abs() > THRESHOLD) & ((ratio >= MIN_FACTOR) | (ratio <= 1 / MIN_FACTOR))
        rk = record_keys(df.loc[flagged[flagged].index], key_cols)
        rows = [{"record_key": str(rk.at[i]), "value": round(float(value.at[i]), 4),
                 "peer_median": round(float(median.at[i]), 4), "factor": float(f"{ratio.at[i]:.4g}"),
                 "peers": int(size.at[i]), "group": {c: str(keys.at[i, c]) for c in spec["per"]}}
                for i in flagged[flagged].index]
        rows.sort(key=lambda r: -abs(np.log10(r["factor"])))  # furthest off first, below or above
        out[spec["id"]] = {"label": spec["label"], "checked": int((size >= MIN_GROUP).sum()),
                           "outliers": len(rows), "top": rows[:MAX_REPORTED]}
    return out
