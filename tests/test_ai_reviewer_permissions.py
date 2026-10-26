"""The AI reviewer (review_ai_rules) can do its job end to end, and nobody is offered a move
the API then refuses.

- checks/lifecycle.py: in_review -> active / draft accept approve or review_ai_rules; draft ->
  in_review and active -> retired still need manage_rules.
- api/routes/learned_rules.py: approve accepts approve or review_ai_rules; reject accepts
  manage_rules, approve or review_ai_rules (the checker who may approve may also reject).
- api/routes/ai_feedback.py: the proposed-rule list, approve and reject need review_ai_rules;
  a reject reason is written to the audit log.
"""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import ai_feedback, learned_rules
from api.services.rbac import has_permission
from checks import lifecycle

TID = uuid.uuid4()
PID = uuid.uuid4()


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


# ── lifecycle ────────────────────────────────────────────────────────────────


def _can(role: str):
    return lambda a: has_permission(role, a)


@pytest.mark.parametrize("move", [("in_review", "active"), ("in_review", "draft")])
def test_ai_reviewer_may_decide_a_review(move):
    assert lifecycle.may_transition(*move, _can("ai_reviewer"))
    assert lifecycle.may_transition(*move, _can("approver"))


@pytest.mark.parametrize("move", [("draft", "in_review"), ("active", "retired")])
def test_maker_moves_still_need_manage_rules(move):
    assert not lifecycle.may_transition(*move, _can("ai_reviewer"))
    assert not lifecycle.may_transition(*move, _can("approver"))
    assert lifecycle.may_transition(*move, _can("admin"))


def test_unknown_move_is_never_allowed():
    assert not lifecycle.may_transition("retired", "active", lambda a: True)
    assert all(isinstance(v, tuple) and v for v in lifecycle.TRANSITIONS.values())


# ── learned rules ────────────────────────────────────────────────────────────


class _NoDB:
    """No query should run when the permission check refuses; one that passes reaches run_sync."""

    def __init__(self):
        self.reached = False

    async def execute(self, stmt, params=None):
        return None

    async def run_sync(self, fn):
        self.reached = True
        raise LookupError("not pending")

    async def commit(self):
        pass


def _client(router, db) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    return TestClient(app)


@pytest.mark.parametrize("role,action,allowed", [
    ("ai_reviewer", "approve", True),
    ("ai_reviewer", "reject", True),
    ("approver", "approve", True),
    ("approver", "reject", True),
    ("analyst", "approve", False),
    ("viewer", "reject", False),
])
def test_learned_rule_decisions_by_permission(role, action, allowed):
    db = _NoDB()
    body = {"severity": "medium"} if action == "approve" else {}
    r = _client(learned_rules.router, db).post(f"/api/v1/learned-rules/{PID}/{action}", json=body,
                                               headers={"X-User-Role": role})
    if allowed:
        # Past the permission check: the fake proposal is "already decided".
        assert r.status_code == 409, r.text
        assert db.reached
    else:
        assert r.status_code == 403, r.text
        assert not db.reached


def test_approver_can_reject_whenever_they_can_approve():
    for role in ("approver", "ai_reviewer", "steward", "admin"):
        if has_permission(role, "approve") or has_permission(role, "review_ai_rules"):
            r = _client(learned_rules.router, _NoDB()).post(f"/api/v1/learned-rules/{PID}/reject", json={},
                                                            headers={"X-User-Role": role})
            assert r.status_code != 403, (role, r.text)


# ── AI proposed rules ────────────────────────────────────────────────────────


class _Row:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row

    def fetchall(self):
        return [self._row] if self._row else []


class _ProposalDB:
    def __init__(self, status="pending"):
        self.status = status
        self.sql: list[tuple[str, dict | None]] = []
        self.committed = False

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.sql.append((sql, params))
        if sql.startswith("SELECT id, status FROM ai_proposed_rules"):
            return _Row((str(PID), self.status))
        return _Row(None)

    async def commit(self):
        self.committed = True


@pytest.mark.parametrize("role,code", [("ai_reviewer", 200), ("analyst", 403), ("viewer", 403)])
def test_proposed_rule_list_needs_review_ai_rules(role, code):
    r = _client(ai_feedback.router, _ProposalDB()).get("/api/v1/ai/proposed-rules", headers={"X-User-Role": role})
    assert r.status_code == code, r.text


def test_reject_records_the_reason_in_the_audit_log():
    db = _ProposalDB()
    r = _client(ai_feedback.router, db).post(f"/api/v1/ai/proposed-rules/{PID}/reject",
                                             json={"reason": "  Field too sparse to match on  "},
                                             headers={"X-User-Role": "ai_reviewer"})
    assert r.status_code == 200, r.text
    assert r.json() == {"id": str(PID), "status": "rejected"}
    assert any("SET status = 'rejected'" in s for s, _ in db.sql)
    audit = [p for s, p in db.sql if s.startswith("INSERT INTO audit_log")]
    assert len(audit) == 1
    assert audit[0]["a"] == "ai_proposed_rule.reject" and audit[0]["ei"] == str(PID)
    assert '"reason": "Field too sparse to match on"' in audit[0]["af"]
    assert db.committed


def test_reject_without_a_body_still_works():
    db = _ProposalDB()
    r = _client(ai_feedback.router, db).post(f"/api/v1/ai/proposed-rules/{PID}/reject",
                                             headers={"X-User-Role": "ai_reviewer"})
    assert r.status_code == 200, r.text


def test_reject_needs_review_ai_rules():
    db = _ProposalDB()
    r = _client(ai_feedback.router, db).post(f"/api/v1/ai/proposed-rules/{PID}/reject", json={"reason": "x"},
                                             headers={"X-User-Role": "analyst"})
    assert r.status_code == 403
    assert not any("ai_proposed_rules" in s for s, _ in db.sql)
