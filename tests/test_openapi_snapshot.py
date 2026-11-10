"""The frontend's contract test validates fixtures against a committed OpenAPI snapshot.

This test fails when that snapshot no longer matches the live app, so a route or schema
change cannot leave the fixtures checked against a stale contract.
"""

import json
from pathlib import Path

SNAPSHOT = Path(__file__).resolve().parent.parent / "frontend/lib/api/v2/fixtures/openapi.json"
REGEN = (
    "MERIDIAN_ENV=development PYTHONPATH=$PWD python -c \"import json; from api.main import app; "
    f'print(json.dumps(app.openapi()))" > {SNAPSHOT.relative_to(SNAPSHOT.parents[4])}'
)


def test_openapi_snapshot_matches_app():
    from api.main import app

    live = json.loads(json.dumps(app.openapi()))
    saved = json.loads(SNAPSHOT.read_text())
    missing = sorted(set(live["paths"]) - set(saved["paths"]))
    stale = sorted(set(saved["paths"]) - set(live["paths"]))
    assert live == saved, f"openapi.json has drifted (new routes {missing}, gone routes {stale}). Regenerate: {REGEN}"
