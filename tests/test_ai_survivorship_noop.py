"""AI survivorship with no LLM configured: skipped up front, logged once per run.

With ``LLM_PROVIDER=none`` the provider is the ``_NoopLLM`` sentinel, which has no
``.bind``; the golden record engine once called it for every undecided field of every
record and warned "AI survivorship failed for field 'X'" each time. Now the decision is
made once (``ai_survivorship_enabled``) and the deterministic chain alone decides."""

import logging
import uuid

import pytest

from api.services import ai_survivorship, golden_record_engine as gre
from llm import provider


class _Rows:
    def __init__(self, rows=None, row=None):
        self._rows, self._row = rows or [], row

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._row


class _DB:
    def __init__(self):
        self.sql = []
        self.commits = 0

    async def execute(self, stmt, params=None):
        self.sql.append(" ".join(str(stmt).split()))
        return _Rows()

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        pytest.fail("engine rolled back: a field evaluation raised")


class _Undecided:
    """A deterministic chain that cannot pick a winner, so the AI path would be consulted."""

    def __init__(self, **kw):
        pass

    def evaluate(self, contributions):
        return None


@pytest.fixture
def noop_env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "none")
    monkeypatch.delenv("MERIDIAN_SURVIVORSHIP_LLM", raising=False)
    monkeypatch.setattr(provider, "_load_db_config", lambda: None)
    provider.clear_llm_cache()
    yield
    provider.clear_llm_cache()


@pytest.fixture
def noop_admin_config(monkeypatch):
    """The env says ollama but the admin's saved config says none: the sentinel is built."""
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.delenv("MERIDIAN_SURVIVORSHIP_LLM", raising=False)
    monkeypatch.setattr(provider, "_load_db_config", lambda: {"provider": "none"})
    provider.clear_llm_cache()
    yield
    provider.clear_llm_cache()


def _records():
    return [
        {"source_system": "ECC", "extracted_at": "2024-01-01T00:00:00+00:00", "fields": {"NAME1": "A", "ORT01": "X"}},
        {"source_system": "CRM", "extracted_at": "2024-02-01T00:00:00+00:00", "fields": {"NAME1": "B", "ORT01": "Y"}},
    ]


def test_provider_sentinel_is_detected_from_env_and_from_admin_config(noop_env, monkeypatch):
    assert provider.llm_is_noop() is True
    assert ai_survivorship.ai_survivorship_available() is False
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setattr(provider, "_load_db_config", lambda: {"provider": "none"})
    provider.clear_llm_cache()
    assert isinstance(provider.get_llm(), provider._NoopLLM)
    assert provider.llm_is_noop() is True


def test_propose_field_winner_skips_without_a_warning(noop_env, caplog):
    caplog.set_level(logging.DEBUG, logger="meridian.ai_survivorship")
    contributions = [{"source_system": "ECC", "extracted_at": "2024-01-01", "confidence": 1.0, "value": "A"},
                     {"source_system": "CRM", "extracted_at": "2024-02-01", "confidence": 1.0, "value": "B"}]
    assert ai_survivorship.propose_field_winner(str(uuid.uuid4()), "NAME1", "business_partner", contributions) is None
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]


@pytest.mark.asyncio
@pytest.mark.parametrize("fixture", ["noop_env", "noop_admin_config"])
async def test_engine_runs_deterministic_only_and_logs_once_per_run(fixture, request, monkeypatch, caplog):
    request.getfixturevalue(fixture)
    monkeypatch.setattr(gre, "SurvivorshipChain", _Undecided)
    monkeypatch.setattr(gre, "propose_field_winner", lambda **kw: pytest.fail("AI survivorship was called"))
    caplog.set_level(logging.DEBUG)

    use_ai = gre.ai_survivorship_enabled(context="golden records business_partner")  # once per run
    assert use_ai is False
    db = _DB()
    for key in ("1000", "1001", "1002"):
        rid = await gre.process_sync_batch(db, str(uuid.uuid4()), "business_partner", key, _records(), use_ai=use_ai)
        assert rid is not None
    assert db.commits == 3
    assert any("INSERT INTO master_records" in s for s in db.sql)

    off = [r for r in caplog.records if "AI survivorship off" in r.getMessage()]
    assert len(off) == 1 and off[0].levelno == logging.INFO
    assert "golden records business_partner" in off[0].getMessage()
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING], \
        [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]


@pytest.mark.asyncio
async def test_engine_resolves_the_decision_itself_when_the_caller_does_not(noop_env, monkeypatch, caplog):
    monkeypatch.setattr(gre, "SurvivorshipChain", _Undecided)
    monkeypatch.setattr(gre, "propose_field_winner", lambda **kw: pytest.fail("AI survivorship was called"))
    caplog.set_level(logging.INFO)
    assert await gre.process_sync_batch(_DB(), str(uuid.uuid4()), "business_partner", "1", _records()) is not None
    assert len([r for r in caplog.records if "AI survivorship off" in r.getMessage()]) == 1


def test_feature_flag_off_is_silent(noop_env, monkeypatch, caplog):
    monkeypatch.setenv("MERIDIAN_SURVIVORSHIP_LLM", "off")
    caplog.set_level(logging.INFO)
    assert gre.ai_survivorship_enabled() is False
    assert not [r for r in caplog.records if "AI survivorship" in r.getMessage()]
