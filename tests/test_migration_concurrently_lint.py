"""CONCURRENTLY migrations must be safe to re-run.

A concurrent index build runs outside a transaction, so a failure (deadlock, cancel, an update killed
mid-build) leaves the migration half done and the index behind marked INVALID. The re-run must skip
what exists and repair what is invalid: IF NOT EXISTS / IF EXISTS on every statement, and
db.migration_lock.drop_invalid_index before every create, because IF NOT EXISTS alone skips an
invalid index for ever.
"""
import ast
import re
from pathlib import Path
from unittest import mock

VERSIONS = Path(__file__).resolve().parents[1] / "db" / "migrations" / "versions"


def _code_strings(path: Path) -> tuple[list[str], str]:
    """String literals outside docstrings (f-string parts joined), and the source."""
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    docs = {id(n.body[0].value) for n in ast.walk(tree)
            if isinstance(n, (ast.Module, ast.FunctionDef, ast.ClassDef)) and n.body
            and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)}
    docs |= {id(v) for n in ast.walk(tree) if isinstance(n, ast.JoinedStr) for v in n.values}  # joined below
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.JoinedStr):
            out.append("".join(v.value if isinstance(v, ast.Constant) else "{}" for v in n.values))
        elif isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docs:
            out.append(n.value)
    return out, src


def _problems(path: Path) -> list[str]:
    strings, src = _code_strings(path)
    sql = " ".join(" ".join(strings).split()).upper()
    bad = []
    for m in re.finditer(r"CREATE (UNIQUE )?INDEX CONCURRENTLY (?!IF NOT EXISTS)", sql):
        bad.append(f"CREATE INDEX CONCURRENTLY without IF NOT EXISTS at ...{sql[m.start():m.start() + 60]}")
    for m in re.finditer(r"DROP INDEX CONCURRENTLY (?!IF EXISTS)", sql):
        bad.append(f"DROP INDEX CONCURRENTLY without IF EXISTS at ...{sql[m.start():m.start() + 60]}")
    if "postgresql_concurrently=True" in src and not re.search(r"if_(not_)?exists=True", src):
        bad.append("postgresql_concurrently=True without if_not_exists/if_exists")
    creates = re.search(r"CREATE (UNIQUE )?INDEX CONCURRENTLY", sql) or "postgresql_concurrently=True" in src
    if creates and "drop_invalid_index(" not in src:
        bad.append("builds an index CONCURRENTLY without calling drop_invalid_index first")
    return bad


def test_concurrent_migrations_are_rerunnable():
    bad = {p.name: probs for p in sorted(VERSIONS.glob("*.py")) if (probs := _problems(p))}
    assert not bad, bad


def test_lint_catches_an_unsafe_migration(tmp_path):
    p = tmp_path / "m.py"
    p.write_text('"""CREATE INDEX CONCURRENTLY in a docstring is fine."""\n'
                 'def upgrade():\n    op.execute(f"CREATE INDEX CONCURRENTLY {n} ON t (a)")\n'
                 '    op.execute("DROP INDEX CONCURRENTLY ix")\n')
    probs = _problems(p)
    assert len(probs) == 3, probs
    p.write_text('"""CREATE INDEX CONCURRENTLY ix ON t (a)"""\n')
    assert _problems(p) == []


def test_drop_invalid_index_drops_only_an_invalid_index():
    from db.migration_lock import drop_invalid_index

    for found, dropped in ((object(), True), (None, False)):
        op = mock.MagicMock()
        op.get_bind.return_value.execute.return_value.first.return_value = found
        with mock.patch("alembic.op", op):
            drop_invalid_index("ix_a")
        assert op.get_bind.return_value.execute.call_args.args[1] == {"n": "ix_a"}
        assert (mock.call("DROP INDEX CONCURRENTLY IF EXISTS ix_a") in op.execute.call_args_list) is dropped
