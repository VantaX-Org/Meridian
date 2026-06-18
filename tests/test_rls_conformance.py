"""Static RLS conformance: every tenant-scoped table must have an RLS migration.

This is a *static* guard. It imports the SQLAlchemy schema to find every table
carrying a ``tenant_id`` column, and scans the Alembic migrations to find every
table that gets ``ENABLE ROW LEVEL SECURITY``. It needs no database connection.

Its job is to fail the build the moment a new ``tenant_id`` model is added
without a matching RLS-enabling migration — exactly the gap migration 043 closed
for 15 tables (cleaning/exception/config/z-object). It does **not** assert the
policy is *correct* (the ``USING`` clause, ``FORCE``, the session GUC); proving
that needs a live Postgres and lives in the integration RLS tests. Here we only
prove that no tenant-scoped table ships with RLS entirely absent — i.e. that
tenant isolation never silently degrades to app-level ``WHERE`` filtering alone.

The migration scan handles every shape the codebase uses to enable RLS:

  * literal single-line ``op.execute("ALTER TABLE x ENABLE ROW LEVEL SECURITY")``
  * multi-line raw-SQL blocks (``ALTER TABLE x ENABLE ROW LEVEL SECURITY;``)
  * ``for t in ["a", "b"]: op.execute(f"ALTER TABLE {t} ENABLE ...")`` — inline
    list/tuple of literals
  * ``for t in _RLS_TABLES: ...`` — a tuple of literals, module-level (043) or
    function-local
  * ``def _enable_rls(t): ... f"ALTER TABLE {t} ENABLE ..."`` then
    ``_enable_rls("x")`` — a per-table helper called with literal args (037)

The literal forms fall out of a regex; the loop and helper forms need the AST so
we resolve the loop's iterable, or the helper's literal call-args, back to the
string table names. ``test_rls_collector_resolves_indirect_migrations`` guards
those resolvers so the conformance check can never pass vacuously by simply
finding nothing behind the indirection.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from db.schema import Base

MIGRATIONS_DIR = Path(__file__).parent.parent / "db" / "migrations" / "versions"

# Catches both single-line and multi-line raw-SQL literal ENABLE statements.
_LITERAL_ENABLE = re.compile(
    r"ALTER TABLE\s+(\w+)\s+ENABLE ROW LEVEL SECURITY", re.IGNORECASE
)
_RLS_MARKER = "ENABLE ROW LEVEL SECURITY"


def _list_literals(value: ast.expr) -> list[str]:
    """String members of a ``[...]`` / ``(...)`` literal, else ``[]``."""
    if isinstance(value, (ast.Tuple, ast.List)):
        return [
            e.value
            for e in value.elts
            if isinstance(e, ast.Constant) and isinstance(e.value, str)
        ]
    return []


def _string_list_vars(tree: ast.Module) -> dict[str, list[str]]:
    """Map every ``NAME = (...)`` / ``[...]`` string-literal collection in the file.

    Walks the whole tree (not just module body) so a loop iterating a
    *function-local* list resolves too, and covers both plain ``Assign`` and
    annotated ``AnnAssign`` (``_RLS_TABLES: tuple[str, ...] = (...)``). Name
    collisions across functions are harmless here: the only names we later
    resolve are those iterated by an ENABLE loop, and every such list in a given
    migration carries the same table set.
    """
    out: dict[str, list[str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            strings = _list_literals(node.value)
            if strings:
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        out[target.id] = strings
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            strings = _list_literals(node.value)
            if strings and isinstance(node.target, ast.Name):
                out[node.target.id] = strings
    return out


def _rls_helper_names(tree: ast.Module, src: str) -> set[str]:
    """Names of functions that take an arg and whose body enables RLS.

    Catches the per-table helper idiom (037's ``_enable_rls(table)``): the table
    name is not in the function, it arrives as a literal call argument, so we
    flag the function here and harvest its call-site args separately. ``upgrade``
    /``downgrade`` are excluded — they take no args.
    """
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.args.args:
            segment = ast.get_source_segment(src, node) or ""
            if _RLS_MARKER in segment:
                names.add(node.name)
    return names


def _resolve_iter(iter_node: ast.expr, module_lists: dict[str, list[str]]) -> list[str]:
    """Resolve a ``for`` loop's iterable to its string members, if it is one."""
    if isinstance(iter_node, ast.Name):
        return module_lists.get(iter_node.id, [])
    if isinstance(iter_node, (ast.List, ast.Tuple)):
        return [
            e.value
            for e in iter_node.elts
            if isinstance(e, ast.Constant) and isinstance(e.value, str)
        ]
    return []


def _rls_enabled_tables() -> set[str]:
    """Every table granted ``ENABLE ROW LEVEL SECURITY`` by any migration."""
    enabled: set[str] = set()
    for path in MIGRATIONS_DIR.glob("*.py"):
        src = path.read_text(encoding="utf-8")
        if _RLS_MARKER not in src:
            continue
        # Literal ALTER TABLE <name> ENABLE — single-line and multi-line SQL.
        enabled.update(name.lower() for name in _LITERAL_ENABLE.findall(src))

        tree = ast.parse(src)
        string_lists = _string_list_vars(tree)
        helpers = _rls_helper_names(tree, src)

        for node in ast.walk(tree):
            # Loop forms: resolve the iterable when the loop body enables RLS.
            if isinstance(node, ast.For):
                segment = ast.get_source_segment(src, node) or ""
                if _RLS_MARKER in segment:
                    enabled.update(
                        t.lower() for t in _resolve_iter(node.iter, string_lists)
                    )
            # Helper form: literal table args passed to an RLS-enabling helper.
            elif (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id in helpers
            ):
                enabled.update(
                    a.value.lower()
                    for a in node.args
                    if isinstance(a, ast.Constant) and isinstance(a.value, str)
                )
    return enabled


def _tenant_scoped_tables() -> set[str]:
    """Every table whose model declares a ``tenant_id`` column."""
    return {
        table.name
        for table in Base.metadata.tables.values()
        if "tenant_id" in table.columns
    }


def test_every_tenant_scoped_table_has_rls_migration() -> None:
    tenant_tables = _tenant_scoped_tables()
    assert tenant_tables, "no tenant_id tables found — schema import is broken"

    enabled = _rls_enabled_tables()
    missing = sorted(tenant_tables - enabled)
    assert not missing, (
        "tenant_id tables with NO 'ENABLE ROW LEVEL SECURITY' migration — tenant "
        "isolation on these depends on application-level WHERE filtering alone. "
        f"Add an RLS migration (see 043 for the pattern): {missing}"
    )


def test_rls_collector_resolves_indirect_migrations() -> None:
    """Guard the AST resolvers: indirect ENABLE migrations must be detected.

    Without this, a regression in the loop/helper resolution would let the
    conformance test pass vacuously — a table whose RLS is only enabled behind
    indirection would look un-enabled, and if the resolver degraded to returning
    nothing it could mask a real gap. These span every indirection shape:
    inline list (006 ``exceptions``), the per-table helper (037
    ``llm_decision_cache``), and the module tuple (043 ``config_inventory`` /
    ``z_object_registry``).
    """
    enabled = _rls_enabled_tables()
    for table in ("exceptions", "llm_decision_cache", "config_inventory", "z_object_registry"):
        assert table in enabled, f"RLS collector missed indirectly-enabled table {table!r}"
