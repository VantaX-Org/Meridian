"""A move always reads a full-history download of the source (synthetic, no database or SAP)."""
import asyncio
import uuid
from types import SimpleNamespace
from unittest import mock

import pytest
from pydantic import ValidationError

from api.routes import instance_move as route
from workers.tasks import run_instance_move as task

SRC, TGT = str(uuid.uuid4()), str(uuid.uuid4())


def test_plan_body_history_is_full_by_default_and_only_full():
    b = route.PlanBody(source_system_id=SRC, target_system_id=TGT, modules=["employee_central"])
    assert b.history == "full"
    with pytest.raises(ValidationError):
        route.PlanBody(source_system_id=SRC, target_system_id=TGT, modules=["employee_central"], history="current")


def test_full_history_version_asks_for_history_full_covering_the_modules():
    session = mock.Mock()
    session.execute.return_value.scalar.return_value = "v1"
    assert task.full_history_version(session, SRC, ["employee_central"]) == "v1"
    sql, params = str(session.execute.call_args[0][0]), session.execute.call_args[0][1]
    assert "metadata->>'history' = 'full'" in sql and "@>" in sql
    assert params == {"sid": SRC, "mods": '["employee_central"]'}


def test_prepare_refuses_without_a_full_history_download():
    session = mock.Mock()
    session.execute.return_value.scalar.return_value = None
    with pytest.raises(ValueError, match="full-history"):
        task._prepare(session, None, "t", {"source_system_id": SRC, "modules": ["employee_central"]})


def _db(have):
    db = mock.AsyncMock()
    db.execute.return_value = SimpleNamespace(scalar=lambda: have)
    return db


def test_queue_plan_downloads_full_history_first_when_none_exists():
    body = route.PlanBody(source_system_id=SRC, target_system_id=TGT, modules=["employee_central"])
    with mock.patch("celery.chain") as chain, mock.patch("api.services.jobs.start_job"), \
            mock.patch("api.services.jobs.ensure_no_extraction"), \
            mock.patch.object(task.plan_move, "delay") as plan_delay:
        asyncio.run(route._queue_plan(_db(None), SimpleNamespace(id="t"), body, "p1"))
    plan_delay.assert_not_called()
    extract_sig = chain.call_args[0][0]
    assert extract_sig.kwargs == {"history": "full"} and extract_sig.args[1] == SRC
    chain.return_value.delay.assert_called_once()


def test_queue_plan_builds_at_once_from_an_existing_full_history_download():
    body = route.PlanBody(source_system_id=SRC, target_system_id=TGT, modules=["employee_central"])
    with mock.patch("celery.chain") as chain, mock.patch.object(task.plan_move, "delay") as plan_delay:
        asyncio.run(route._queue_plan(_db("v1"), SimpleNamespace(id="t"), body, "p1"))
    plan_delay.assert_called_once_with("t", "p1")
    chain.assert_not_called()
