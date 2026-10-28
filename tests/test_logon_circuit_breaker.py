"""A locked SAP user must not be retried by Meridian, whatever triggers the attempt.

The pilot sandbox user was locked twice. The mechanism was not a wrong password: the extraction
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


# ── sessions must be closed when the process is asked to stop ──────────────────────────────────
def test_sigterm_closes_the_sap_sessions(monkeypatch):
    """SIGKILL cannot be caught, but SIGTERM must not leave SAP sessions dangling.

    connector.close() sits in a `finally`, which Python's default SIGTERM handler never reaches
    (it exits without unwinding). Dangling RFC sessions are counted by SAP against the user, so a
    stopped extraction can lock a healthy account - which is how it happened the second time.
    """
    import signal

    from api.services import connectivity_manager as cm

    closed = []
    installed = {}

    class Conn:
        def close(self):
            closed.append(True)

    def fake_signal(sig, handler):
        installed[sig] = handler

    monkeypatch.setattr(signal, "signal", fake_signal)
    monkeypatch.setattr(signal, "getsignal", lambda sig: signal.SIG_DFL)

    cm._install_close_on_signal(Conn())

    sigterm = installed.get(signal.SIGTERM)
    assert sigterm is not None, "no SIGTERM handler was installed"

    with pytest.raises(SystemExit):
        sigterm(signal.SIGTERM, None)
    assert closed == [True], "the handler must close the SAP sessions before exiting"


def test_install_and_restore_do_not_raise_outside_the_main_thread():
    """Workers run in prefork children; signal registration there must not break extraction."""
    import threading

    from api.services import connectivity_manager as cm

    class Conn:
        def close(self):
            pass

    result = {}

    def run():
        try:
            prev = cm._install_close_on_signal(Conn())
            cm._restore_signal_handlers(prev)
            result["ok"] = True
        except Exception as e:  # pragma: no cover
            result["err"] = e

    t = threading.Thread(target=run)
    t.start()
    t.join()
    assert result.get("ok") is True, result


def test_a_successful_logon_lifts_the_cooldown():
    """Unlocking in SU01 must take effect immediately, not after our own 15-minute window."""
    from sap.rfc import clear_logon_block

    _note_logon_failure(_Params(), "too many failed attempts")
    assert logon_blocked_for(_Params()) > 0
    clear_logon_block(_Params())  # what connect() calls on success
    assert logon_blocked_for(_Params()) == 0
