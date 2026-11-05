"""Credential rotation — unit tests.

- decrypt_password falls back to CREDENTIAL_MASTER_KEY_PREV when the
  current key fails, so the sync worker doesn't break during the
  rotation window.
- decrypt_with_key + encrypt_with_key round-trip correctly using an
  explicit master key (the rotation tool's entry points).

These tests drive the pure crypto — no DB, no rotation script end-to-end.
The full rotation integration test (against Postgres) lives next to the
RLS tests and runs in the same CI lane.
"""

from __future__ import annotations

import pytest

from api.services.credential_store import (
    decrypt_password,
    decrypt_with_key,
    encrypt_password,
    encrypt_with_key,
)


TENANT_A = "00000000-0000-0000-0000-000000000001"


def test_current_key_round_trip(monkeypatch):
    monkeypatch.setenv("CREDENTIAL_MASTER_KEY", "key-one")
    monkeypatch.delenv("CREDENTIAL_MASTER_KEY_PREV", raising=False)

    ct = encrypt_password(TENANT_A, "hunter2")
    assert decrypt_password(TENANT_A, ct) == "hunter2"


def test_decrypt_falls_back_to_prev_during_rotation(monkeypatch):
    # 1. Encrypt under the OLD key
    monkeypatch.setenv("CREDENTIAL_MASTER_KEY", "key-old")
    ct = encrypt_password(TENANT_A, "s3cret")

    # 2. Simulate rotation: swap env so new is primary, old is prev
    monkeypatch.setenv("CREDENTIAL_MASTER_KEY", "key-new")
    monkeypatch.setenv("CREDENTIAL_MASTER_KEY_PREV", "key-old")

    # 3. Decrypt MUST still succeed — the worker can't wait for the
    #    rotation script to touch every row before it keeps running.
    assert decrypt_password(TENANT_A, ct) == "s3cret"


def test_decrypt_fails_when_both_keys_wrong(monkeypatch):
    monkeypatch.setenv("CREDENTIAL_MASTER_KEY", "key-old")
    ct = encrypt_password(TENANT_A, "s3cret")

    monkeypatch.setenv("CREDENTIAL_MASTER_KEY", "wrong-one")
    monkeypatch.setenv("CREDENTIAL_MASTER_KEY_PREV", "wrong-two")

    with pytest.raises(Exception):
        decrypt_password(TENANT_A, ct)


def test_explicit_key_round_trip():
    """decrypt_with_key / encrypt_with_key are the rotation tool's workhorse."""
    ct = encrypt_with_key("key-new", TENANT_A, "s3cret")
    assert decrypt_with_key("key-new", TENANT_A, ct) == "s3cret"


def test_explicit_keys_are_tenant_scoped():
    """Same plaintext + same master secret but different tenants → different key."""
    tenant_b = "11111111-1111-1111-1111-111111111111"
    ct_a = encrypt_with_key("key-new", TENANT_A, "s3cret")
    with pytest.raises(Exception):
        decrypt_with_key("key-new", tenant_b, ct_a)


def test_rotation_flow_simulated():
    """Simulate the rotation script's inner loop: decrypt-old, encrypt-new."""
    # Under-the-hood crypto the rotation script uses.
    old_key = "pre-rotation-master-key"
    new_key = "post-rotation-master-key"

    ct_old = encrypt_with_key(old_key, TENANT_A, "the-password")
    plaintext = decrypt_with_key(old_key, TENANT_A, ct_old)
    assert plaintext == "the-password"

    ct_new = encrypt_with_key(new_key, TENANT_A, plaintext)
    # Old key can no longer decrypt the new ciphertext
    with pytest.raises(Exception):
        decrypt_with_key(old_key, TENANT_A, ct_new)
    # New key can
    assert decrypt_with_key(new_key, TENANT_A, ct_new) == "the-password"


def test_rotation_script_is_idempotent(monkeypatch):
    """Calling the rotator twice shouldn't re-encrypt rows already at the
    target version — that's what the key_version column is for."""
    import importlib.util
    import os
    import types

    # Load the script as a module without executing main().
    spec = importlib.util.spec_from_file_location(
        "rotate_cred",
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "scripts",
            "rotate-credential-key.py",
        ),
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    # Register before exec so @dataclass can look up the module via sys.modules.
    import sys as _sys

    _sys.modules[spec.name] = module
    spec.loader.exec_module(module)  # safe — module has `if __name__ == '__main__'` guard

    # The rotation helper internally calls create_engine; we stub it.
    old_key = "old-k"
    new_key = "new-k"

    ct_v1 = encrypt_with_key(old_key, TENANT_A, "pw1")
    ct_v2 = encrypt_with_key(new_key, TENANT_A, "pw2")

    # Build a fake SQLAlchemy connection that yields two rows — one already
    # at v2 (should skip), one at v1 (should rotate to v2).
    rows = [
        ("cred-1", "sys-1", TENANT_A, ct_v1, 1),
        ("cred-2", "sys-2", TENANT_A, ct_v2, 2),
    ]
    updates: list[dict] = []

    class _FakeResult:
        def __init__(self, data=None):
            self._data = data or []

        def fetchall(self):
            return self._data

        def scalar(self):
            return 0

    class _FakeConn:
        def execute(self, stmt, params=None):
            sql = str(stmt)
            if "FROM system_credentials sc" in sql:
                return _FakeResult(rows)
            if "UPDATE system_credentials" in sql:
                updates.append(params or {})
                return _FakeResult()
            return _FakeResult()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class _FakeEngine:
        def begin(self):
            return _FakeConn()

        def connect(self):
            return _FakeConn()

        def dispose(self):
            pass

    monkeypatch.setattr(module, "create_engine", lambda *a, **kw: _FakeEngine())

    result = module.rotate(
        db_url="postgresql://fake",
        old_key=old_key,
        new_key=new_key,
        dry_run=False,
        target_version=2,
    )
    assert result.rotated == 1, f"expected 1 rotated, got {result.rotated}"
    assert result.already_new == 1, f"expected 1 already-new, got {result.already_new}"
    assert len(updates) == 1
    assert updates[0]["ver"] == 2
    assert updates[0]["cid"] == "cred-1"  # only the v1 row is touched


def test_rotation_script_covers_external_db_connections(monkeypatch):
    """external_db_connections rows are rotated per tenant (row level security) and skipped when already rotated."""
    import importlib.util
    import os
    import sys as _sys

    spec = importlib.util.spec_from_file_location(
        "rotate_cred_ext", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                        "scripts", "rotate-credential-key.py"))
    module = importlib.util.module_from_spec(spec)
    _sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    ext = [("c-1", "warehouse", TENANT_A, encrypt_with_key("old-k", TENANT_A, "pw1"), 1),
           ("c-2", "reporting", TENANT_A, encrypt_with_key("new-k", TENANT_A, "pw2"), 2)]
    calls: list[tuple[str, dict]] = []

    class _Res:
        def __init__(self, data=None):
            self._d = data or []

        def fetchall(self):
            return self._d

    class _Conn:
        def execute(self, stmt, params=None):
            sql = str(stmt)
            calls.append((sql, params or {}))
            if "FROM tenants" in sql:
                return _Res([(TENANT_A,)])
            if "FROM external_db_connections" in sql:
                return _Res(ext)
            return _Res()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class _Eng:
        def begin(self):
            return _Conn()

    monkeypatch.setattr(module, "create_engine", lambda *a, **kw: _Eng())
    r = module.rotate("postgresql://fake", "old-k", "new-k", dry_run=False, target_version=2)
    assert (r.rotated, r.already_new, r.failed) == (1, 1, [])
    sql_list = [c[0] for c in calls]
    assert any("set_config('app.tenant_id'" in q for q in sql_list)  # tenant set before the table is read
    upd = [c for c in calls if "UPDATE external_db_connections" in c[0]]
    assert len(upd) == 1 and upd[0][1]["cid"] == "c-1" and upd[0][1]["ver"] == 2
    assert decrypt_with_key("new-k", TENANT_A, upd[0][1]["ct"]) == "pw1"


def _load_rotate_script(name):
    import importlib.util
    import os
    import sys as _sys

    spec = importlib.util.spec_from_file_location(
        name, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "scripts", "rotate-credential-key.py"))
    module = importlib.util.module_from_spec(spec)
    _sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class _Rows:
    def __init__(self, rows=(), value=None):
        self._rows, self._value = list(rows), value

    def fetchall(self):
        return self._rows

    def scalar(self):
        return self._value


def test_rotation_reads_system_credentials_before_any_tenant_is_set(monkeypatch):
    """Once app.tenant_id is set, row level security would hide other tenants' system credentials."""
    module = _load_rotate_script("rotate_cred_order")
    cred = ("cred-1", "sys-1", TENANT_A, encrypt_with_key("old-k", TENANT_A, "pw"), 1)
    sql: list[str] = []

    class _Conn:
        def execute(self, stmt, params=None):
            q = str(stmt)
            sql.append(q)
            if "FROM tenants" in q:
                return _Rows([(TENANT_A,)])
            if "FROM system_credentials" in q:
                return _Rows([cred])
            return _Rows()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class _Eng:
        def begin(self):
            return _Conn()

    monkeypatch.setattr(module, "create_engine", lambda *a, **kw: _Eng())
    r = module.rotate("postgresql://fake", "old-k", "new-k", dry_run=False, target_version=2)
    assert r.rotated == 1
    first_tenant = next(i for i, q in enumerate(sql) if "set_config" in q)
    update = next(i for i, q in enumerate(sql) if "UPDATE system_credentials" in q)
    assert update < first_tenant


def test_highest_version_looks_at_both_tables():
    """An external password above every system password still sets the target."""
    module = _load_rotate_script("rotate_cred_top")
    tenant: list[str] = []

    class _Conn:
        def execute(self, stmt, params=None):
            q = str(stmt)
            if "FROM tenants" in q:
                return _Rows([(TENANT_A,), ("other",)])
            if "set_config" in q:
                tenant.append(params["t"])
                return _Rows()
            if "FROM external_db_connections" in q:
                return _Rows(value=5 if tenant[-1] == TENANT_A else 3)
            return _Rows(value=2)

    assert module._highest_version(_Conn()) == 5
