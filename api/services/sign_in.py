"""Whether a system's sign-in is the problem, and SAP Basis's next step on the landscape (F20).

A connection test, a health check or an extraction that SAP refused for its credentials (HTTP 401 or 403, an RFC
logon failure, an OAuth token refused) is a sign-in failure: retrying or extracting fails the same way until someone
fixes the credentials. ``failure_status`` classifies an error message; ``basis_next_step`` puts "Fix the sign-in for
<system>" ahead of extracting or analysing, so the landscape's main action never leads into a refusal. Pure functions:
the landscape route and the health check share them.
"""
from __future__ import annotations

import re
from typing import Any, Iterable, Optional

from api.services import app_links

_AUTH = re.compile(
    r"(\b(401|403)\b|unauthori[sz]ed|forbidden|credential|logon|log on|log-on|login|password|\bauth|token|"
    r"invalid_client|invalid_grant|not authori[sz]ed|access denied)", re.IGNORECASE)


def is_auth_failure(message: Optional[str]) -> bool:
    """SAP (or its gateway) refused the credentials, as opposed to being unreachable."""
    return bool(message) and bool(_AUTH.search(str(message)))


def failure_status(message: Optional[str]) -> str:
    """The health status of a failed check: ``auth_failed`` for refused credentials, else ``unreachable``."""
    return "auth_failed" if is_auth_failure(message) else "unreachable"


def failed_sign_ins(jobs: Iterable[dict]) -> set[str]:
    """Systems whose latest extraction or configuration job failed on its credentials (jobs newest first)."""
    seen: set[str] = set()
    out: set[str] = set()
    for j in jobs:
        sid = j.get("system_id")
        if not sid or j.get("kind") not in ("extraction", "config_sync") or sid in seen:
            continue
        if j.get("status") not in ("failed", "completed"):
            continue
        seen.add(sid)
        if j.get("status") == "failed" and is_auth_failure(j.get("error") or j.get("message")):
            out.add(str(sid))
    return out


def basis_next_step(systems: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """SAP Basis's one next step over the landscape's systems (each with ``sign_in_failed`` and ``state``): fix a
    refused sign-in first, then extract a system never extracted, then analyse an extracted one, else open the first
    system. None without systems."""
    if not systems:
        return None
    s = next((x for x in systems if x.get("sign_in_failed")), None)
    if s is not None:
        return {"kind": "fix_sign_in", "system_id": s["id"], "system_name": s["name"],
                "label": f"Fix the sign-in for {s['name']}",
                "href": app_links.opened(app_links.system(s["id"]), "connection", s["id"])}
    for state, kind, verb in (("not_extracted", "extract", "Extract"), ("extracted", "analyse", "Run analysis on")):
        s = next((x for x in systems if x.get("state") == state), None)
        if s is not None:
            return {"kind": kind, "system_id": s["id"], "system_name": s["name"], "label": f"{verb} {s['name']}",
                    "href": app_links.opened(app_links.LANDSCAPE, "system", s["id"])}
    s = systems[0]
    return {"kind": "open", "system_id": s["id"], "system_name": s["name"], "label": f"Open {s['name']}",
            "href": app_links.opened(app_links.LANDSCAPE, "system", s["id"])}
