"""A locked SAP user must not be retried by Meridian, whatever triggers the attempt.

The Komatsu sandbox user was locked twice. The mechanism was not a wrong password: the extraction
task is declared ``acks_late=True, reject_on_worker_lost=True``, so every worker restart (every
deploy) requeued a running extraction. The redelivered task logged on again, and each additional
attempt is another failed logon as far as SAP is concerned until the user locks.

Two independent guards are tested here:

  * a per-system cooldown, so once SAP says "locked" nothing reconnects for a while;
  * a per-version lock, so a redelivered extraction exits instead of starting a second read.
"""

import time

import pytest

from sap.rfc import (_LOGON_BLOCKED, _logon_key, _note_logon_failure, clear_logon_block,
                     logon_blocked_for)


class _Params:
    host, sysnr, client, user = "10.106.205.90", "28", "220", "RESHIGANG"


@pytest.fixture(autouse=True)
def _clean():
    _LOGON_BLOCKED.clear()
    yield
    _LOGON_BLOCKED.clear()


def test_a_lock_reply_blocks_further_logons():
    assert logon_blocked_for(_Params()) == 0
    _note_logon_failure(_Params(), "Password logon no longer possible - too many failed attempts")
    wait = logon_blocked_for(_Params())
    assert 0 < wait <= 15 * 60


@pytest.mark.parametrize("message", [
    "Password logon no longer possible - too many failed attempts",
    "user is locked",
    "logon currently not possible",
])
def test_every_lock_wording_blocks(message: str) -> None:
    _note_logon_failure(_Params(), message)
    assert logon_blocked_for(_Params()) > 0


def test_an_ordinary_failure_does_not_block():
    """A network blip must not stop the next attempt - only a lock does."""
    _note_logon_failure(_Params(), "host unreachable")
    assert logon_blocked_for(_Params()) == 0


def test_the_block_is_per_system():
    _note_logon_failure(_Params(), "user is locked")

    class Other(_Params):
        user = "SOMEONE_ELSE"

    assert logon_blocked_for(_Params()) > 0
    assert logon_blocked_for(Other()) == 0


def test_an_operator_action_clears_the_block():
    """A successful connection test after a password reset must take effect immediately."""
    _note_logon_failure(_Params(), "user is locked")
    assert logon_blocked_for(_Params()) > 0
    clear_logon_block(_Params())
    assert logon_blocked_for(_Params()) == 0


def test_connect_refuses_without_touching_sap_while_blocked():
    """The refusal has to happen before pyrfc is called, or it is not a guard at all."""
    from sap.rfc import RFCConnector

    _note_logon_failure(_Params(), "too many failed attempts")
    conn = RFCConnector()
    with pytest.raises(Exception) as exc:
        conn.connect(_Params())
    assert "SU01" in str(exc.value) or "locked" in str(exc.value)
    assert _logon_key(_Params()) in str(exc.value) or "not attempting logon" in str(exc.value)


# ── the per-version lock ────────────────────────────────────────────────────────────────────────
def test_a_second_copy_of_the_same_version_does_not_run(monkeypatch):
    from workers.tasks import run_extraction as re_mod

    class FakeRedis:
        def __init__(self):
            self.keys = set()

        def set(self, key, value, nx=False, ex=None):
            if nx and key in self.keys:
                return False
            self.keys.add(key)
            return True

    fake = FakeRedis()
    monkeypatch.setattr("redis.from_url", lambda url: fake, raising=False)
    monkeypatch.setattr(re_mod, "_acquire_version_lock", _real_lock(fake))

    assert re_mod._acquire_version_lock("v-1") is True
    assert re_mod._acquire_version_lock("v-1") is False, "a redelivered copy must not start a read"
    assert re_mod._acquire_version_lock("v-2") is True, "a different version is unaffected"


def _real_lock(fake):
    """The real implementation, bound to the fake client."""
    def lock(version_id: str) -> bool:
        return bool(fake.set(f"extract-lock:{version_id}", "1", nx=True, ex=9999))
    return lock
