"""Every API path the handover runbook tells a human to call must exist.

The runbook is executed by someone else, at a customer site, without this repository or anyone
who has read it. A path that does not exist fails there - after the purge, with the analysis
history already deleted - and the failure looks like a broken product rather than a typo in a
document.

This is not hypothetical: the runbook said `POST /api/v1/extract`, which has never existed (the
route is `/api/v1/connectivity/extract`), and its curl examples carried no Authorization header
at all, so every one of them would have returned 401.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RUNBOOKS = [
    ROOT / "docs" / "handover-purge-and-baseline.md",
    ROOT / "docs" / "successfactors-parity.md",
]
# Every documented call must be authenticated. The API rejects an unauthenticated request on
# every one of these routes, so a curl block without a token is wrong however good the path is.
AUTH_MARKERS = ("Authorization: Bearer", "mn_auth_token", "-u ", "X-Updater-Secret")


def _paths(text: str) -> set[str]:
    return set(re.findall(r"http://127\.0\.0\.1(/[A-Za-z0-9_/{}.\-]*)", text))


def _curl_blocks(text: str) -> list[str]:
    """Each `curl ...` invocation, continuation lines included."""
    blocks, cur = [], []
    for line in text.splitlines():
        if line.lstrip().startswith("curl "):
            if cur:
                blocks.append("\n".join(cur))
            cur = [line]
        elif cur and (line.rstrip().endswith("\\") or line.startswith(("  ", "\t"))):
            cur.append(line)
        elif cur:
            blocks.append("\n".join(cur))
            cur = []
    if cur:
        blocks.append("\n".join(cur))
    return blocks


def _route_paths(routes) -> set[str]:
    """Every route path, descending into included routers.

    Newer FastAPI keeps an included router as one entry whose own routes sit on
    ``original_router`` instead of flattening them into ``app.routes``."""
    out: set[str] = set()
    for r in routes:
        if hasattr(r, "path") and r.path:
            out.add(r.path)
        if hasattr(r, "original_router"):
            out |= _route_paths(r.original_router.routes)
    return out


@pytest.mark.parametrize("runbook", RUNBOOKS, ids=lambda p: p.name)
def test_documented_paths_exist(runbook: Path) -> None:
    from api.main import app

    known = _route_paths(app.routes)
    missing = sorted(p for p in _paths(runbook.read_text(encoding="utf-8")) if p not in known)
    assert not missing, (
        f"{runbook.name} tells the operator to call paths that do not exist: {missing}. "
        f"The runbook is executed without this repository - check the route in api/routes/."
    )


@pytest.mark.parametrize("runbook", RUNBOOKS, ids=lambda p: p.name)
def test_documented_curl_calls_are_authenticated(runbook: Path) -> None:
    """A documented call against a protected route needs a token, or it 401s at the customer."""
    unauthenticated = []
    for block in _curl_blocks(runbook.read_text(encoding="utf-8")):
        # only judge calls that carry a body or target a documented API path
        if not any(m in block for m in AUTH_MARKERS) and "/api/" in block:
            unauthenticated.append(block.splitlines()[0].strip()[:100])
    assert not unauthenticated, (
        f"{runbook.name} documents API calls with no credential:\n  "
        + "\n  ".join(unauthenticated)
    )


def test_the_login_example_names_the_field_the_api_returns() -> None:
    """The runbook parses `.token`; the response model must actually call it that."""
    from api.routes.auth import LoginResponse

    assert "token" in LoginResponse.model_fields


# ── the SQL the operator runs must name tables and columns that exist ───────────────────────────
# Same reasoning as the paths: a psql statement that references a column this release renamed fails
# at the customer, after the purge, in front of the client.

_SQL_NOISE = {
    "select", "from", "where", "count", "as", "is", "not", "null", "order", "by", "desc", "asc",
    "and", "or", "distinct", "limit", "versions", "creds", "scored", "true", "false",
}


def _sql_statements(text: str) -> list[str]:
    return re.findall(r'"\s*(SELECT .*?)"', text, re.S)


@pytest.mark.parametrize("runbook", RUNBOOKS, ids=lambda p: p.name)
def test_documented_sql_names_real_tables_and_columns(runbook: Path) -> None:
    from db.schema import Base

    tables = Base.metadata.tables
    problems = []
    for stmt in _sql_statements(runbook.read_text(encoding="utf-8")):
        flat = stmt.replace("\n", " ")
        m = re.search(r"\bFROM\s+([a-z_][a-z_0-9]*)", flat)
        if not m:
            continue
        table = m.group(1)
        # judge only the select list and the where clause, not the table name itself
        stmt = flat[:m.start()] + " " + flat[m.end():]
        if table not in tables:
            problems.append(f"no such table: {table}")
            continue
        have = {c.name for c in tables[table].columns}
        for ident in re.findall(r"\b([a-z_][a-z_0-9]*)\b", stmt):
            if ident in have or ident in _SQL_NOISE or ident.isdigit():
                continue
            # a column alias or a function name is fine; only flag things that look like columns
            if "." in ident:
                continue
            problems.append(f"{table}.{ident}?")
    assert not problems, (
        f"{runbook.name} runs SQL against columns this release does not have: {sorted(set(problems))}. "
        f"A rename makes the operator's verification step fail at the customer."
    )


# ── every script the handover tells the operator to run must be in the release ──────────────────
@pytest.mark.parametrize("runbook", RUNBOOKS, ids=lambda p: p.name)
def test_documented_scripts_exist(runbook: Path) -> None:
    text = runbook.read_text(encoding="utf-8")
    refs = set(re.findall(r"\b(scripts/[A-Za-z0-9_.\-]+\.(?:sh|py))", text))
    missing = sorted(r for r in refs if not (ROOT / r).exists())
    assert not missing, f"{runbook.name} tells the operator to run files that are not shipped: {missing}"
