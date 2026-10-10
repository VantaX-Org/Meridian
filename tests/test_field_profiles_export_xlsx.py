"""Field profile export (T10): /systems/{system_id}/versions/{version_id}/profile/export.

No DB fixture — checks signature and the masked-value guard (masked fields
must render "masked", never their raw top values, even if top_values is
somehow populated alongside masked=True).
"""

import inspect

from api.routes.field_profiles import FieldStats, ValueCount, _top_values_cell, export_version_profile


def test_export_signature() -> None:
    sig = inspect.signature(export_version_profile)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"


def test_masked_field_shows_masked_not_raw_values() -> None:
    stats = FieldStats(rows=10, table_rows=10, blank=0, blank_pct=0.0, distinct=3,
                       masked=True, top_values=[ValueCount(value="1234567890", count=5)])
    assert _top_values_cell(stats) == "masked"


def test_unmasked_field_shows_values() -> None:
    stats = FieldStats(rows=10, table_rows=10, blank=0, blank_pct=0.0, distinct=2,
                       masked=False, top_values=[ValueCount(value="ACTIVE", count=7)])
    assert "ACTIVE" in _top_values_cell(stats)
