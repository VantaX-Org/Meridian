"""The OpenAPI document an integrator reads: a one-line summary per operation and a description per tag.

FastAPI titles an operation after its function name ("Get Owners"). Most endpoints carry a docstring whose
first sentence says what the call does; that sentence becomes the summary and the full docstring stays the
description. Tags group the routers; the ones an integrator is most likely to script against are described.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

TAG_DESCRIPTIONS: dict[str, str] = {
    "health": "Liveness and readiness of the API.",
    "auth": "Sign in, sign out, password changes and session tokens.",
    "upload": "Load an SAP extract from a file (CSV or Excel) and start a run.",
    "versions": "Runs (analysis versions): list, read, compare and delete.",
    "findings": "Rule results of a run, per object and per rule.",
    "work": "The Work ledger: failing records, decisions, fix proposals and exceptions.",
    "remediation": "Fix batches: approve, send back, and write back to SAP.",
    "writeback": "Write approved fixes back to the SAP system.",
    "reports": "PDF and workbook reports of a run.",
    "report-library": "Generated reports and report schedules.",
    "users": "Users of the tenant.",
    "rbac": "Roles and permissions.",
    "scim": "SCIM 2.0 user and group provisioning from an identity provider (on once an administrator issues a SCIM token).",
    "scim-admin": "The SCIM bearer token and the group to role mappings.",
    "theme": "The tenant's brand: logo, accent and product name on screens and reports.",
    "status": "The public status page: component health and incidents.",
    "webhooks": "Outbound webhooks: endpoints, events, signing secret and test sends.",
    "digests": "Scheduled digests by email or alert channel, with preview and send now.",
    "sandbox": "Sandbox mode: copy a run, try decisions and fixes, then discard them; deliveries are held.",
    "policy-packs": "Regulatory policy packs (data classes mapped to rules) and their evidence.",
    "record-history": "A record across runs and its decisions, and an object as of a past run.",
    "run-prediction": "Expected duration, cost and queue position of a run before it starts.",
    "command": "The command line: search across the landscape and questions in plain words.",
    "fix-simulation": "What a fix would do to an object's score, caps, verdict and wave gates, before it is made.",
    "readiness-certificates": "Signed readiness certificates of a migration wave.",
    "impact-money": "Feature-level impact of findings expressed in money.",
    "drift-alerts": "Alerts when SAP configuration drifts between snapshots.",
    "mining": "Rules mined from the data, duplicates, anomalies and relationships.",
    "contract-enforcement": "Breaches of data contracts by a run.",
    "delta-extraction": "What changed between two extractions (delta runs).",
    "landscape": "The landscape: systems, objects and their scores.",
    "people": "Owners and stewards and the work assigned to them.",
}

_SENTENCE = re.compile(r"^(.+?[.!?])(\s|$)", re.S)


def summary_of(doc: str | None) -> str | None:
    """The docstring's first sentence on one line, at most 120 characters; None when there is no docstring."""
    if not doc or not doc.strip():
        return None
    first = doc.strip().split("\n\n", 1)[0]
    first = " ".join(first.split())
    m = _SENTENCE.match(first)
    s = m.group(1) if m else first
    s = s.rstrip(".")
    if len(s) > 120:
        s = s[:117].rstrip() + "..."
    return s


def build(app: FastAPI) -> dict[str, Any]:
    """The OpenAPI document with docstring summaries and tag descriptions."""
    spec = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)
    used: set[str] = set()
    for item in spec.get("paths", {}).values():
        for op in item.values():
            if not isinstance(op, dict):
                continue
            used.update(op.get("tags", []))
            s = summary_of(op.get("description"))
            if s:
                op["summary"] = s
    spec["tags"] = [{"name": t, "description": d} for t, d in TAG_DESCRIPTIONS.items() if t in used] + [
        {"name": t} for t in sorted(used - set(TAG_DESCRIPTIONS))
    ]
    return spec


def install(app: FastAPI) -> None:
    """Replace app.openapi with the cached builder above."""

    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            app.openapi_schema = build(app)
        return app.openapi_schema

    setter: Callable[[], dict[str, Any]] = openapi
    app.openapi = setter  # type: ignore[method-assign]
