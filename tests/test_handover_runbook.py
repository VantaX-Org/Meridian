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


@pytest.mark.parametrize("runbook", RUNBOOKS, ids=lambda p: p.name)
def test_documented_paths_exist(runbook: Path) -> None:
    from api.main import app

    known = {r.path for r in app.routes if hasattr(r, "path")}
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
