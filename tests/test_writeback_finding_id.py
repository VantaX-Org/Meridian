"""POST /writeback with a finding id that is not a UUID answers 422, not a 500 (acceptance run, October 2026)."""

import pytest
from pydantic import ValidationError

from api.routes.writeback import WriteBackRequest

_CONN = {"host": "sap.invalid", "client": "100", "user": "RFC", "password": "x", "sysnr": "00"}


def test_a_rule_id_is_refused_as_finding_id() -> None:
    with pytest.raises(ValidationError):
        WriteBackRequest(finding_id="BP019", record_fixes=[], sap_connection=_CONN)


def test_a_uuid_is_accepted() -> None:
    body = WriteBackRequest(finding_id="6bcca553-c45d-460f-8aa7-5b64388f3661", record_fixes=[], sap_connection=_CONN)
    assert str(body.finding_id) == "6bcca553-c45d-460f-8aa7-5b64388f3661" and body.dry_run is True
