#!/usr/bin/env python3
"""Generate realistic SAP test CSVs for the end-to-end pipeline run.

Emits three module-shaped CSVs under seed/ that can be POSTed to
/api/v1/upload. Uses the existing synthetic generator so shape matches
the standard column map (see api/services/column_mapper.py).

Usage:
    python scripts/e2e-seed-data.py         # defaults: 5000 BP, 5000 Material, 2000 GL
    python scripts/e2e-seed-data.py --rows 20000
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.fixtures.synthetic_sap_data import (
    generate_business_partner,
    generate_fi_gl,
    generate_material_master,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=5_000, help="rows per module (default 5000)")
    parser.add_argument("--out", default="seed", help="output dir (default ./seed)")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    n = args.rows
    gl_n = min(2_000, n)  # GL is usually smaller

    generators = {
        "business_partner": generate_business_partner(n=n),
        "material_master": generate_material_master(n=n),
        "fi_gl": generate_fi_gl(n=gl_n),
    }

    for module, df in generators.items():
        path = out / f"{module}.csv"
        df.to_csv(path, index=False)
        print(f"  {module:20}  {len(df):>6} rows  {path}")

    print(f"\nWrote {len(generators)} CSVs under {out.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
