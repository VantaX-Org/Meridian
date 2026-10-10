"""Sync profiles choose full or delta downloads."""

import pytest
from pydantic import ValidationError

from api.routes.systems import CreateSyncProfileRequest, SyncProfileResponse, UpdateSyncProfileRequest


def test_mode_defaults_to_full_and_accepts_delta():
    assert CreateSyncProfileRequest(system_id="s", domain="material_master", tables=[]).extraction_mode == "full"
    assert UpdateSyncProfileRequest(extraction_mode="delta").extraction_mode == "delta"


def test_unknown_mode_is_rejected():
    with pytest.raises(ValidationError):
        UpdateSyncProfileRequest(extraction_mode="sample")


def test_response_carries_the_mode():
    r = SyncProfileResponse(id="p", system_id="s", domain="d", tables=[], schedule_cron="0 2 * * *", active=True,
                            last_run_at=None, next_run_at=None, extraction_mode="delta")
    assert r.extraction_mode == "delta"
