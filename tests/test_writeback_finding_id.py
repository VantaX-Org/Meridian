"""POST /writeback with a finding id that is not a UUID answers 422, not a 500 (acceptance run, October 2026)."""

import pytest
from pydantic import ValidationError

from api.routes.writeback import WriteBackRequest

_SYS = "0b6f3c1e-6a59-4d1e-9a52-6f1f0c2d9e11"


def test_a_rule_id_is_refused_as_finding_id() -> None:
    with pytest.raises(ValidationError):
        WriteBackRequest(finding_id="BP019", record_fixes=[], system_id=_SYS)


def test_a_uuid_is_accepted() -> None:
    body = WriteBackRequest(finding_id="6bcca553-c45d-460f-8aa7-5b64388f3661", record_fixes=[], system_id=_SYS)
    assert str(body.finding_id) == "6bcca553-c45d-460f-8aa7-5b64388f3661" and body.dry_run is True


def test_credentials_in_the_body_are_refused() -> None:
    """The request names a registered system; a plaintext user or password has no field to land in."""
    assert "sap_connection" not in WriteBackRequest.model_fields
    with pytest.raises(ValidationError):  # without a system id the request is incomplete
        WriteBackRequest(finding_id="6bcca553-c45d-460f-8aa7-5b64388f3661", record_fixes=[],
                         sap_connection={"host": "h", "client": "100", "user": "u", "password": "p", "sysnr": "00"})
