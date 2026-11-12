"""SAProuter and SNC: logon kwargs, row mapping, route validation, and secret redaction in the audit body."""

from types import SimpleNamespace

import pytest

from api.middleware.audit import _redact
from api.routes.systems import RegisterSystemRequest, UpdateSystemRequest, _route_values, rfc_route_error
from sap.base import SAPConnectionParams, rfc_logon_kwargs, rfc_route_params

BASE = dict(host="h", client="100", sysnr="00", user="U", password="p")


def test_plain_logon_has_no_router_or_snc(monkeypatch):
    monkeypatch.delenv("SNC_LIB", raising=False)
    assert rfc_logon_kwargs(SAPConnectionParams(**BASE)) == {
        "ashost": "h", "client": "100", "user": "U", "passwd": "p", "sysnr": "00"}


def test_router_and_snc_are_passed(monkeypatch):
    monkeypatch.setenv("SNC_LIB", "/usr/sap/libsapcrypto.so")
    kw = rfc_logon_kwargs(SAPConnectionParams(**BASE, saprouter="/H/r.example.com/S/3299/H/", snc_mode=True,
                                              snc_partnername="p:CN=P01", snc_qop="9", snc_myname=""))
    assert kw["saprouter"] == "/H/r.example.com/S/3299/H/"
    assert kw["snc_mode"] == "1" and kw["snc_partnername"] == "p:CN=P01" and kw["snc_qop"] == "9"
    assert kw["snc_lib"] == "/usr/sap/libsapcrypto.so" and "snc_myname" not in kw


def test_snc_off_ignores_partner():
    kw = rfc_logon_kwargs(SAPConnectionParams(**BASE, snc_partnername="p:CN=P01"))
    assert "snc_mode" not in kw and "snc_partnername" not in kw


def test_route_params_from_dict_and_row():
    assert rfc_route_params({}) == {"saprouter": "", "snc_mode": False, "snc_partnername": "", "snc_qop": "",
                                    "snc_myname": ""}
    row = SimpleNamespace(saprouter="/H/a/H/", snc_mode=True, snc_partnername="p:CN=X", snc_qop=None, snc_myname=None)
    assert rfc_route_params(row)["snc_mode"] is True and rfc_route_params(row)["saprouter"] == "/H/a/H/"


@pytest.mark.parametrize("args,ok", [
    (("ecc", "/H/router.example.com/S/3299/H/", False, None), True),
    (("ecc", "/H/a/H/b/S/3299", False, None), True),
    (("ecc", "", True, "p:CN=P01, O=Example"), True),
    (("ecc", "router.example.com", False, None), False),
    (("ecc", "/H/a/W/secret/H/", False, None), False),
    (("ecc", "", True, ""), False),
    (("successfactors", "/H/a/H/", False, None), False),
    (("successfactors", "", False, None), True),
])
def test_route_validation(args, ok):
    assert (rfc_route_error(*args) is None) is ok


def test_register_body_stores_snc_only_when_on():
    body = RegisterSystemRequest(name="n", system_type="ecc", host="h", client="100", sysnr="00",
                                 saprouter=" /H/a/H/ ", snc_partnername="p:CN=X")
    assert _route_values(body, True) == {"saprouter": "/H/a/H/", "snc_mode": False, "snc_partnername": None,
                                         "snc_qop": None, "snc_myname": None}
    assert _route_values(body, False)["saprouter"] is None


def test_qop_is_limited():
    with pytest.raises(Exception):
        UpdateSystemRequest(snc_qop="5")
    assert UpdateSystemRequest(snc_qop="8").snc_qop == "8"


def test_audit_body_masks_secrets():
    got = _redact({"credentials": {"password": "x"}, "new_password": "y", "items": [{"api_key": "z"}],
                   "username": "RFC", "password": ""})
    assert got == {"credentials": "****", "new_password": "****", "items": [{"api_key": "****"}],
                   "username": "RFC", "password": ""}
