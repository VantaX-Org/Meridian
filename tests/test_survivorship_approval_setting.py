"""The survivorship_ai_approval tenant setting: read, write and audit through the Aletheia survivorship routes."""
import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError

from api.routes import aletheia_survivorship as r

TENANT = SimpleNamespace(id=uuid.uuid4())
DB = SimpleNamespace(commit=AsyncMock())


def _patched(stored):
    return patch.multiple(r, set_rls=AsyncMock(), get_setting=AsyncMock(return_value=stored), put_setting=AsyncMock(),
                          write_audit=AsyncMock(), current_user_id=lambda _r: "u1")


def test_get_defaults_to_required():
    with _patched(None):
        assert asyncio.run(r.get_approval_setting(DB, TENANT)).required is True


def test_get_reads_required():
    with _patched({"required": True}):
        assert asyncio.run(r.get_approval_setting(DB, TENANT)).required is True


def test_put_stores_audits_and_commits():
    with _patched({"required": False}):
        out = asyncio.run(r.put_approval_setting(r.ApprovalSetting(required=True), object(), DB, TENANT))
        assert out.required is True
        r.put_setting.assert_awaited_once_with(DB, TENANT.id, "survivorship_ai_approval", {"required": True}, "u1")
        r.write_audit.assert_awaited_once()


def test_body_rejects_unknown_keys():
    with pytest.raises(ValidationError):
        r.ApprovalSetting(required=True, other=1)
