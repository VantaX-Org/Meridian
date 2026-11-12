"""Write-back and change-request posting sign on as the connected system's own stored user, with its router and
SNC settings; SAP_RFC_USER is only the fallback for a system that has no username stored."""
import asyncio
from types import SimpleNamespace

import pytest

from sap.base import rfc_logon_kwargs, rfc_user


class _Row(SimpleNamespace):
    """A sap_systems row: positional for host, client, sysnr, password; by name for the rest."""

    def __getitem__(self, i):
        return [self.host, self.client, self.sysnr, self.encrypted_password][i]


def _make(username):
    return _Row(host="sap.example.test", client="100", sysnr="00", encrypted_password="enc",
                saprouter="/H/router.example.test/S/3299/H/", snc_mode=False, snc_partnername=None,
                snc_qop=None, snc_myname=None, username=username)


class _Session:
    def __init__(self, row):
        self.row, self.sql = row, ""

    def execute(self, stmt, _params=None):
        self.sql = str(stmt)
        return SimpleNamespace(fetchone=lambda: self.row)


class _AsyncSession(_Session):
    async def execute(self, stmt, _params=None):
        return _Session.execute(self, stmt, _params)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("SAP_RFC_USER", "ENV_USER")
    monkeypatch.setattr("api.services.credential_store.decrypt_password", lambda _t, v: "pw-" + v)


def _callers():
    from api.routes import writeback
    from workers.tasks import change_requests, run_batch_writeback

    return [
        lambda s: change_requests._params(s, "t1", "s1"),
        lambda s: run_batch_writeback._system_params(s, "t1", "s1"),
        lambda s: asyncio.run(writeback._system_params(s, "t1", "s1")),
    ]


@pytest.mark.parametrize("i", range(3))
def test_stored_user_wins(i):
    sess = (_AsyncSession if i == 2 else _Session)(_make(" WB_USER "))
    params = _callers()[i](sess)
    assert "s.username" in sess.sql
    kw = rfc_logon_kwargs(params)
    assert kw["user"] == "WB_USER" and kw["passwd"] == "pw-enc"
    assert kw["saprouter"] == "/H/router.example.test/S/3299/H/"


@pytest.mark.parametrize("i", range(3))
@pytest.mark.parametrize("stored", [None, "", "  "])
def test_env_user_is_only_the_fallback(i, stored):
    sess = (_AsyncSession if i == 2 else _Session)(_make(stored))
    assert _callers()[i](sess).user == "ENV_USER"


def test_rfc_user_default(monkeypatch):
    monkeypatch.delenv("SAP_RFC_USER")
    assert rfc_user({"username": None}) == "RFC_USER"
    assert rfc_user({"username": "OWN"}) == "OWN"
