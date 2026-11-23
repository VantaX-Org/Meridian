"""Z-object feedback and custom rules record the signed-in user, never the tenant id."""
import uuid
from unittest.mock import patch

from api.routes import z_object_intelligence as z


def test_signed_in_user_is_recorded():
    uid = str(uuid.uuid4())
    with patch.object(z, "current_user_id", return_value=uid):
        assert z._acting_user_uuid() == uid


def test_api_key_or_background_caller_records_none():
    with patch.object(z, "current_user_id", return_value=None):
        assert z._acting_user_uuid() is None
    with patch.object(z, "current_user_id", return_value="apikey:abc"):
        assert z._acting_user_uuid() is None


def test_tenant_id_is_never_used_as_user():
    src = open(z.__file__).read()
    assert "user_id = str(tenant.id)" not in src
