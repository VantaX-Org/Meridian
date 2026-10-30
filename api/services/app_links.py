"""Addresses in the web app that the API and the workers write into notifications, emails, webhooks, the command
line, the attention list and the assistant's answers.

One interface since the cut-over (Meridian 2, step 7): the landscape at ``/``, an object at ``/o/{system}/{module}``,
a rule at ``/r/{id}``, the Work ledger at ``/work``, a run at ``/run/{id}``, a system at ``/s/{id}``, People,
Reports and Administration at ``/admin/{section}``; anything selected opens in the inspector with ``?open=kind:id``.
The old addresses still redirect (frontend/next.config.ts, table in frontend/docs/guide/redirects.md), but nothing
new is written with them. Paths only: the caller prefixes the public base URL when the link leaves the app (email).
"""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import quote, urlencode

#: The system segment of an object address when the system is not known; the object canvas resolves it.
ANY_SYSTEM = "_"

LANDSCAPE = "/"
WAVES = "/?view=waves&open=waves"
PEOPLE = "/people"
REPORTS = "/reports"
RUNS = "/runs"
JOBS = "/runs?view=jobs"
RULES = "/rules"
RULE_DRAFTS = "/rules?view=drafts"
CONTRACTS = "/people?open=contracts"
INBOX = "/work?open=inbox"
PREFERENCES = "/?open=preferences"


def slug(value: str) -> str:
    """"ECC production" -> "ecc-production"; "material_master" -> "material-master" (the route segments)."""
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _with(path: str, params: list[tuple[str, str]]) -> str:
    return f"{path}?{urlencode(params)}" if params else path


def opened(path: str, kind: str, item_id: str = "") -> str:
    """``path`` with the inspector open on one thing: ``/?open=system:abc``."""
    sep = "&" if "?" in path else "?"
    return f"{path}{sep}open={quote(f'{kind}:{item_id}' if item_id else kind, safe=':')}"


def object_page(module: str, tab: Optional[str] = None, system_name: Optional[str] = None,
                run: Optional[str] = None) -> str:
    """One object, optionally one of its tabs (rules, records, fixes, runs, readiness, golden, glossary, ...)."""
    path = f"/o/{slug(system_name) if system_name else ANY_SYSTEM}/{slug(module)}{f'/{tab}' if tab else ''}"
    return _with(path, [("run", run)] if run else [])


def rule(check_id: str, tab: Optional[str] = None) -> str:
    return _with(f"/r/{quote(check_id, safe='')}", [("tab", tab)] if tab else [])


def run(version_id: str) -> str:
    return f"/run/{quote(str(version_id), safe='')}"


def compare(before: str, after: str) -> str:
    return f"/run/{quote(str(before), safe='')}/vs/{quote(str(after), safe='')}"


def system(system_id: str, tab: Optional[str] = None) -> str:
    return _with(f"/s/{quote(str(system_id), safe='')}", [("tab", tab)] if tab else [])


def admin(section: Optional[str] = None) -> str:
    return f"/admin/{section}" if section else "/admin"


def job(job_id: str) -> str:
    return opened(JOBS, "job", str(job_id))


def work(*, filter: Optional[str] = None, module: Optional[str] = None, rule_id: Optional[str] = None,
         severity: Optional[str] = None, assigned: Optional[str] = None, due: Optional[str] = None,
         batch: Optional[str] = None, export: bool = False, open_item: Optional[str] = None) -> str:
    """The Work ledger with the same filter the old Fix work and Inbox links carried (frontend/lib/v2/work.ts)."""
    q: list[tuple[str, str]] = []
    for k, v in (("filter", filter), ("module", module), ("rule", rule_id), ("severity", severity),
                 ("assigned", assigned), ("due", due), ("batch", batch)):
        if v:
            q.append((k, str(v)))
    if export:
        q.append(("export", "1"))
    path = _with("/work", q)
    return opened(path, open_item) if open_item else path


def record(module: str, record_key: str) -> str:
    """One failing record, open in the record inspector over the ledger of its object."""
    return opened(work(module=module), "record", f"{module}:{record_key}")


#: Old page addresses some services still compose (the assistant's answers, the insight sentences), and where each
#: job lives now. The same table as the frontend's redirects, for the paths these services write.
_OLD: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^/insights/(?:trends|forecast|progress)$"), RUNS),
    (re.compile(r"^/insights/readiness$"), "/?view=waves"),
    (re.compile(r"^/insights/rules$"), RULES),
    (re.compile(r"^/insights/owners$"), PEOPLE),
    (re.compile(r"^/insights/reports$"), REPORTS),
    (re.compile(r"^/insights(?:/exec|/impact)?$"), LANDSCAPE),
    (re.compile(r"^/objects$"), LANDSCAPE),
    (re.compile(r"^/fix$"), "/work"),
    (re.compile(r"^/import$"), admin("runs")),
)


def from_old(href: str) -> str:
    """An address written the old way (``/objects/material_master?run=R``) as the page that does the job now."""
    path, _, query = href.partition("?")
    if path == "/fix" and query:
        # Fix work's rule filter was `check`; the ledger's is `rule`.
        query = re.sub(r"(^|&)check=", r"\1rule=", query)
    m = re.match(r"^/objects/([^/]+)$", path)
    if m:
        path = object_page(m.group(1))
    elif (m := re.match(r"^/rules/([^/]+)$", path)) and m.group(1) not in ("contracts", "drafts", "dictionary", "learned", "scoring"):
        path = rule(m.group(1))
    elif m := re.match(r"^/runs/([^/]+)/vs/([^/]+)$", path):
        path = compare(m.group(1), m.group(2))
    elif m := re.match(r"^/runs/([^/]+)$", path):
        path = run(m.group(1))
    else:
        path = next((new for pat, new in _OLD if pat.match(path)), path)
    if query:
        path = f"{path}{'&' if '?' in path else '?'}{query}"
    return path
