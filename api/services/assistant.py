"""Ask Meridian: answers a plain question about the tenant's data quality from the figures.

Deterministic first. A question is matched by keywords to one of a small set of intents, and each intent is
answered from the services the Insights pages already use (``insights_aggregate``, the readiness and owner
routes, ``insights_readiness``) with the plain-speech sentence builders of ``report_commentary``. No new SQL.

Only when no intent matches, and an LLM is configured, the model is asked, and it sees the question plus an
aggregated context: the overview narrative, the object scores and the top failing rules by id, object, severity
and affected count. Never a record key or a field value. Every model call writes one ``llm_audit_log`` row.

Nothing raises to the caller: a failure becomes a polite answer and a ``logger.exception``.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Optional, Protocol

from api.services import report_commentary as rc

logger = logging.getLogger("meridian.assistant")

SERVICE_NAME = "assistant"
LLM_TIMEOUT_S = 30
MAX_SENTENCES = 3
TOP_N = 5
CONTEXT_RULES = 10

#: Shown on an empty panel and in the answer when nothing fits.
EXAMPLES = (
    "How has the score moved?",
    "Which objects are weakest?",
    "What are the top failing rules in material master?",
    "Who has the most open work?",
)

INTENTS = ("help", "score", "weakest_objects", "top_rules", "critical", "readiness", "root_causes", "fixes",
           "owners", "changes")

SEVERITIES = ("critical", "high", "medium", "low")


# ── intent matching ──────────────────────────────────────────────────────────

def _rx(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


_HELP = _rx(r"\b(help|what can you|what do you (know|answer)|what (questions|can i ask)|examples?)\b")
_CHANGES = _rx(r"\b(what('s| has| have)? changed|changes?|since (the )?(last|previous|prior|earlier)|newly|"
               r"started failing|new(ly)? failing|regress\w*|compared? (to|with)|last run|previous run)\b")
_FIX_FIRST = _rx(r"\b(fix|start|tackle|work on) (first|next)\b|\bwhere (do|should) (i|we) start\b")
_FIXES = _rx(r"\b(fix(es)?|proposed|proposals?|approved|applied|cleans(e|ing)|auto[- ]?fix\w*|remediat\w*|"
             r"corrections?)\b")
_OWNERS = _rx(r"\b(owners?|owned|who\b|assignees?|assigned|workload|open work|open items|stewards?)")
_READINESS = _rx(r"\b(block(er|ers|ing|ed)?|readiness|ready|waves?|go[- ]?live|migrat\w*|cut[- ]?over|no[- ]go|"
                 r"load(able)?)\b")
_ROOT = _rx(r"\b(root[- ]?causes?|causes?|caused|why|origins?|where does .* come from)\b")
_CRITICAL = _rx(r"\bcritical\b")
_RULE_WORD = _rx(r"\b(rules?|checks?)\b")
_RANK = _rx(r"\b(worst|top|most|biggest|largest|main|failing|fail(s|ed)?|ranked|rank)\b")
_OBJECT_WORD = _rx(r"\b(objects?|modules?|areas?|domains?)\b")
_WEAK = _rx(r"\b(weak(est)?|worst|lowest|poorest|bottom|best|strongest|lagging|behind)\b")
_SCORE = _rx(r"\b(score|dqs|quality|health(y)?|how (are|is|did|has) (we|it|our|the)|trend\w*|moved?|movement|"
             r"improv\w*|better|worse|overall|summary|status)\b")
_SEVERITY = _rx(r"\b(critical|high|medium|low)\b")

#: Partial names too generic to stand for one object on their own.
_GENERIC = frozenset({"master data", "process events"})


def _labels() -> dict[str, str]:
    from api.routes.sync_trigger import MODULE_LABELS

    return MODULE_LABELS


def module_name(module: str) -> str:
    """An object's display name, as the app shows it (frontend/lib/format.ts formatModuleName)."""
    from api.routes.sync_trigger import module_label

    return module_label(module)


def known_modules() -> frozenset[str]:
    """Every module the rule catalogue knows about, plus every named module."""
    from api.services.pdf_reports import _modules

    try:
        mods = set(_modules())
    except Exception:  # catalogue unreadable: names alone still match
        logger.exception("rule catalogue unreadable for the assistant's module list")
        mods = set()
    return frozenset(mods | set(_labels()))


@lru_cache(maxsize=1)
def _aliases() -> tuple[tuple[str, str], ...]:
    """(alias, module) pairs, longest alias first: the display name, the id, the id with spaces, and the name
    without its leading SAP acronym when that still has two words ("customer master" for SD customer master)."""
    out: dict[str, str] = {}
    labels = _labels()
    for m in sorted(known_modules()):
        label = labels.get(m) or module_name(m)
        for a in (label.lower(), m.lower(), m.lower().replace("_", " ")):
            out.setdefault(a, m)
        words = label.split()
        if len(words) >= 3 and words[0].isalpha() and words[0].isupper():
            tail = " ".join(words[1:]).lower()
            if tail not in _GENERIC:
                out.setdefault(tail, m)
    return tuple(sorted(out.items(), key=lambda kv: (-len(kv[0]), kv[0])))


def find_module(question: str) -> Optional[str]:
    q = question.lower()
    for alias, module in _aliases():
        if re.search(r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])", q):
            return module
    return None


def find_severity(question: str) -> Optional[str]:
    m = _SEVERITY.search(question)
    return m.group(1).lower() if m else None


@dataclass
class Match:
    intent: Optional[str]
    module: Optional[str] = None
    severity: Optional[str] = None


def match(question: str, module: Optional[str] = None) -> Match:
    """The intent a question asks for, with the object and severity it names. ``module`` is the caller's context,
    used when the question names no object. ``intent`` is None when nothing fits."""
    q = question.strip()
    named = find_module(q)
    mod = named or (module if module in known_modules() else None)
    sev = find_severity(q)
    has_rule = bool(_RULE_WORD.search(q))

    def m(intent: str, severity: Optional[str] = None) -> Match:
        return Match(intent, mod, severity)

    if _HELP.search(q):
        return m("help")
    if _CHANGES.search(q):
        return m("changes")
    if _FIX_FIRST.search(q):
        return m("top_rules", sev)
    if _FIXES.search(q):
        return m("fixes")
    if _OWNERS.search(q):
        return m("owners")
    if _READINESS.search(q):
        return m("readiness")
    if _ROOT.search(q):
        return m("root_causes")
    if _CRITICAL.search(q) and not has_rule:
        return m("critical")
    if has_rule and (_RANK.search(q) or sev):
        return m("top_rules", sev)
    if _WEAK.search(q) and (_OBJECT_WORD.search(q) or not named):
        return m("weakest_objects")
    if has_rule:
        return m("top_rules", sev)
    if _SCORE.search(q) or named:
        return m("score")
    return Match(None, mod, sev)


# ── sources: the existing services, behind one small interface ───────────────

class Sources(Protocol):
    async def overview(self, vid: Optional[str], module: Optional[str]) -> Optional[dict]: ...
    async def rules(self, vid: Optional[str], module: Optional[str], severity: Optional[str],
                    limit: int) -> Optional[dict]: ...
    async def heatmap(self, vid: Optional[str]) -> Optional[dict]: ...
    async def trends(self, vid: Optional[str]) -> Optional[dict]: ...
    async def root_causes(self, vid: Optional[str], module: Optional[str]) -> Optional[dict]: ...
    async def cleansing(self, vid: Optional[str], module: Optional[str]) -> Optional[dict]: ...
    async def readiness(self, vid: Optional[str]) -> dict: ...
    async def owners(self) -> dict: ...


class DbSources:
    """The Insights services over the request's session, run as ``api/routes/insights.py`` runs them: the
    tenant set on the session (``_rls``), then ``db.run_sync``. A tenant with no finished run reads None."""

    def __init__(self, db: Any, tenant: Any) -> None:
        self.db, self.tenant = db, tenant

    async def _agg(self, fn: Any, *args: Any, **kw: Any) -> Optional[dict]:
        from fastapi import HTTPException

        from api.routes.insights import _agg

        try:
            return await _agg(self.db, self.tenant, fn, *args, **kw)
        except HTTPException as e:
            if e.status_code == 404:
                return None
            raise

    async def overview(self, vid: Optional[str], module: Optional[str]) -> Optional[dict]:
        from api.services import insights_aggregate as agg

        return await self._agg(agg.overview, vid, module)

    async def rules(self, vid: Optional[str], module: Optional[str], severity: Optional[str],
                    limit: int) -> Optional[dict]:
        from api.services import insights_aggregate as agg

        return await self._agg(agg.rules, vid, module, severity=severity, limit=limit)

    async def heatmap(self, vid: Optional[str]) -> Optional[dict]:
        from api.services import insights_aggregate as agg

        return await self._agg(agg.heatmap, vid, None)

    async def trends(self, vid: Optional[str]) -> Optional[dict]:
        from api.services import insights_aggregate as agg

        return await self._agg(agg.trends, vid, None, 12)

    async def root_causes(self, vid: Optional[str], module: Optional[str]) -> Optional[dict]:
        from api.services import insights_aggregate as agg

        return await self._agg(agg.root_causes, vid, module)

    async def cleansing(self, vid: Optional[str], module: Optional[str]) -> Optional[dict]:
        from api.services import insights_aggregate as agg

        return await self._agg(agg.cleansing, vid, module)

    async def readiness(self, vid: Optional[str]) -> dict:
        import uuid

        from api.routes.insights import get_readiness

        return await get_readiness(uuid.UUID(vid) if vid else None, self.db, self.tenant)

    async def owners(self) -> dict:
        from api.routes.insights import get_owners

        return await get_owners(self.db, self.tenant)


# ── answer helpers ───────────────────────────────────────────────────────────

class NoRun(Exception):
    """The tenant has no finished run to answer from."""


def _href(path: str, run: Optional[str] = None, **params: Optional[str]) -> str:
    q = "&".join(f"{k}={v}" for k, v in (("run", run), *params.items()) if v)
    return f"{path}?{q}" if q else path


def _sentences(text: str, n: int = MAX_SENTENCES) -> str:
    """At most ``n`` sentences of ``text``."""
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", " ".join(text.split()))
    return " ".join(p for p in parts[:n] if p).strip()


def _n(v: Any) -> str:
    return f"{int(v or 0):,}"


def _plural(n: int, one: str, many: Optional[str] = None) -> str:
    return one if n == 1 else (many or one + "s")


def _oxford(items: list[str]) -> str:
    return rc._oxford(items)


def _named(rows: list[dict]) -> list[dict]:
    """Rows for the ``report_commentary`` builders with each object already named as the app names it."""
    return [{**r, "module": module_name(str(r.get("module")))} for r in rows]


def _lower_first(s: str) -> str:
    """'Material type is mandatory' -> 'material type is mandatory'; an acronym ('BP category') stays."""
    return s[:1].lower() + s[1:] if s[1:2].islower() else s


def _answer(intent: str, text: str, version_id: Optional[str], *, data: Optional[list[dict]] = None,
            chart: Optional[str] = None, links: Optional[list[dict]] = None, ai: bool = False) -> dict:
    # report_commentary sentence-cases an object name, which would capitalise eWMS (DESIGN.md "Object names").
    text = re.sub(r"\bEWMS\b", "eWMS", text)
    return {"answer": _sentences(text), "intent": intent, "data": data or None,
            "chart": chart if data else None, "links": links or [], "ai": ai, "version_id": version_id}


def _need(payload: Optional[dict]) -> dict:
    if payload is None:
        raise NoRun
    return payload


def _vid(payload: Optional[dict], fallback: Optional[str]) -> Optional[str]:
    v = (payload or {}).get("version_id")
    return str(v) if v else fallback


# ── intents ──────────────────────────────────────────────────────────────────

async def _score(src: Sources, vid: Optional[str], m: Match) -> dict:
    ov = _need(await src.overview(vid, m.module))
    run = _vid(ov, vid)
    dqs = ov.get("dqs") or {}
    narrative = ov.get("narrative") or []
    text = narrative[0]["text"] if narrative else "No object has been scored in this run."
    if m.module and dqs.get("composite") is not None:
        text = f"{module_name(m.module)} scores {dqs['composite']:.1f}."
        if dqs.get("delta") is not None:
            d = dqs["delta"]
            text += (f" That is {abs(d):.1f} points {'up' if d > 0 else 'down'} on the previous run." if d
                     else " That is unchanged from the previous run.")
    if dqs.get("capped") and dqs.get("cap_reason"):
        text += f" A critical failure caps it: {str(dqs['cap_reason']).rstrip('.')}."
    data, chart = None, None
    if not m.module:
        tr = await src.trends(run)
        runs = [r for r in (tr or {}).get("runs") or [] if r.get("composite") is not None]
        if len(runs) > 1:
            data = [{"label": (r.get("run_at") or "")[:10] or (r.get("label") or ""), "value": r["composite"]}
                    for r in runs]
            chart = "line"
    links = [{"label": "Open trends", "href": _href("/insights/trends", run)}]
    if m.module:
        links.insert(0, {"label": f"Open {module_name(m.module)}", "href": _href(f"/objects/{m.module}", run)})
    else:
        links.append({"label": "Open the summary", "href": _href("/insights", run)})
    return _answer("score", text, run, data=data, chart=chart, links=links)


async def _weakest(src: Sources, vid: Optional[str], m: Match) -> dict:
    hm = _need(await src.heatmap(vid))
    run = _vid(hm, vid)
    rows = sorted((r for r in hm.get("rows") or [] if (r.get("scores") or {}).get("composite") is not None),
                  key=lambda r: (r["scores"]["composite"], r["module"]))
    if not rows:
        return _answer("weakest_objects", "No object has a score in this run yet.", run,
                       links=[{"label": "Open objects", "href": _href("/objects", run)}])
    worst = rows[:TOP_N]
    names = [f"{module_name(r['module'])} at {r['scores']['composite']:.1f}" for r in worst[:3]]
    text = f"The weakest {_plural(len(names), 'object is', 'objects are')} {_oxford(names)}."
    meets = sum(1 for r in rows if (r.get("tier") or {}).get("composite") == "pass")
    text += f" {meets} of {len(rows)} scored {_plural(len(rows), 'object')} {'meets' if meets == 1 else 'meet'} the target."
    crit = [r for r in rows if r.get("critical")]
    if crit:
        text += (f" {len(crit)} {_plural(len(crit), 'object carries', 'objects carry')} a critical failure, "
                 f"led by {module_name(crit[0]['module'])}.")
    data = [{"label": module_name(r["module"]), "value": r["scores"]["composite"]} for r in worst]
    links = [{"label": f"Open {module_name(worst[0]['module'])}", "href": _href(f"/objects/{worst[0]['module']}", run)},
             {"label": "Open all objects", "href": _href("/objects", run)}]
    return _answer("weakest_objects", text, run, data=data, chart="bar", links=links)


def _rule_phrase(r: dict) -> str:
    return f"{r['check_id']} in {module_name(r['module'])} on {_n(r.get('affected'))} records"


async def _top_rules(src: Sources, vid: Optional[str], m: Match) -> dict:
    res = _need(await src.rules(vid, m.module, m.severity, TOP_N))
    run = _vid(res, vid)
    rows = res.get("rows") or []
    where = f" in {module_name(m.module)}" if m.module else ""
    sev = f"{m.severity} " if m.severity else ""
    link = {"label": "Open the rule ranking", "href": _href("/insights/rules", run, module=m.module, severity=m.severity)}
    if not rows:
        return _answer("top_rules", f"No {sev}rule fails{where} in this run.", run, links=[link])
    top = rows[0]
    text = f"The {sev}rule that costs most{where} is {_rule_phrase(top)}"
    name = rc._short(top.get("name"), "")
    text += f": {_lower_first(name)}." if name and name != top["check_id"] else "."
    if len(rows) > 1:
        text += f" Next {'is' if len(rows) == 2 else 'are'} {_oxford([_rule_phrase(r) for r in rows[1:3]])}."
    text += " Rules are ranked by failing records weighted by severity."
    data = [{"label": r["check_id"], "value": int(r.get("affected") or 0)} for r in rows]
    links = [link, {"label": f"Open {top['check_id']}", "href": _href(f"/objects/{top['module']}", run, rule=top["check_id"])}]
    return _answer("top_rules", text, run, data=data, chart="bar", links=links)


async def _critical(src: Sources, vid: Optional[str], m: Match) -> dict:
    res = _need(await src.rules(vid, m.module, "critical", 500))
    run = _vid(res, vid)
    rows = res.get("rows") or []
    text = rc.critical_findings(_named(rows))
    by_mod: dict[str, int] = {}
    for r in rows:
        by_mod[r["module"]] = by_mod.get(r["module"], 0) + 1
    data = [{"label": module_name(k), "value": v}
            for k, v in sorted(by_mod.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_N]]
    links = [{"label": "Open critical rules", "href": _href("/insights/rules", run, module=m.module, severity="critical")}]
    return _answer("critical", text, run, data=data, chart="bar", links=links)


async def _readiness(src: Sources, vid: Optional[str], m: Match) -> dict:
    from api.services.insights_readiness import ReadinessCell, wave_verdict

    ov = _need(await src.overview(vid, m.module))
    run = _vid(ov, vid)
    narrative = ov.get("narrative") or []
    text = narrative[1]["text"] if len(narrative) > 1 else rc.blockers([], (ov.get("blockers") or {}).get("count") or 0)
    rd = await src.readiness(run)
    data = None
    if rd.get("configured"):
        cells: dict[str, list[ReadinessCell]] = {}
        for c in rd.get("cells") or []:
            if m.module and c.get("module") != m.module:
                continue
            cells.setdefault(c["wave"], []).append(ReadinessCell(**{k: c.get(k) for k in (
                "module", "wave", "verdict", "blocker_count", "dqs", "score", "records_blocked")}))
        word = {"go": "go", "at_risk": "at risk", "no_go": "no-go"}
        verdicts = [f"{w} is {word.get(wave_verdict(cs), 'no-go')}" for w, cs in cells.items()]
        if verdicts:
            text += f" By wave, {_oxford(verdicts[:4])}" + (f", and {len(verdicts) - 4} more" if len(verdicts) > 4 else "") + "."
            data = [{"label": w, "value": sum(int(c.blocker_count or 0) for c in cs)} for w, cs in cells.items()]
    else:
        text += " No migration wave is set up, so readiness is read per object only."
    links = [{"label": "Open readiness", "href": _href("/insights/readiness", run)}]
    return _answer("readiness", text, run, data=data, chart="bar", links=links)


async def _root_causes(src: Sources, vid: Optional[str], m: Match) -> dict:
    res = _need(await src.root_causes(vid, m.module))
    run = _vid(res, vid)
    clusters = res.get("clusters") or []
    text = rc.clusters(_named(clusters)) or "No failing rule shares a field in this run, so there is no root cause to group."

    def label(c: dict) -> str:
        return f"{module_name(c['module'])} {c['field']}" if c.get("field") else f"{module_name(c['module'])}, no named field"

    data = [{"label": label(c), "value": int(c.get("records") or 0)} for c in clusters[:TOP_N]]
    links = [{"label": "Open rules by field", "href": _href("/insights/rules", run, module=m.module, axis="field")}]
    return _answer("root_causes", text, run, data=data, chart="bar", links=links)


async def _fixes(src: Sources, vid: Optional[str], m: Match) -> dict:
    res = _need(await src.cleansing(vid, m.module))
    run = _vid(res, vid)
    steps = res.get("steps") or []
    by = {s["key"]: int(s.get("records") or 0) for s in steps}
    where = f" in {module_name(m.module)}" if m.module else ""
    if by.get("failing"):
        text = (f"Of {_n(by.get('failing'))} failing records{where}, {_n(by.get('proposed'))} have a proposed fix, "
                f"{_n(by.get('approved'))} are approved and {_n(by.get('applied'))} are applied. ")
        text += rc.funnel(steps)
    else:
        text = rc.funnel(steps)
    data = [{"label": s["label"], "value": int(s.get("records") or 0)} for s in steps]
    links = [{"label": "Open Fix", "href": "/fix"},
             {"label": "Open rules with a proposed fix", "href": _href("/insights/rules", run, module=m.module, auto="yes")}]
    return _answer("fixes", text, run, data=data, chart="bar", links=links)


async def _owners(src: Sources, vid: Optional[str], m: Match) -> dict:
    rows = (await src.owners()).get("owners") or []
    link = [{"label": "Open owners", "href": "/insights/owners"}]
    if not rows:
        return _answer("owners", "No open item is assigned to anyone yet, so there is no owner workload to compare.",
                       vid, links=link)

    def open_n(o: dict) -> int:
        return sum(int(v or 0) for v in (o.get("open_by_severity") or {}).values())

    ranked = sorted(rows, key=lambda o: (-open_n(o), str(o.get("owner"))))
    top = ranked[0]
    holding = sum(1 for o in rows if open_n(o))
    text = (f"{len(rows)} {_plural(len(rows), 'owner has', 'owners have')} assigned items and {holding} "
            f"{'holds' if holding == 1 else 'hold'} open work. ")
    d = top.get("delta") or 0
    text += rc.owner({**top, "open": open_n(top), "trend": "improved" if d > 0 else "slipped" if d < 0 else None})
    data = [{"label": str(o.get("owner")), "value": open_n(o)} for o in ranked[:TOP_N]]
    return _answer("owners", text, vid, data=data, chart="bar", links=link)


async def _changes(src: Sources, vid: Optional[str], m: Match) -> dict:
    ov = _need(await src.overview(vid, None))
    run = _vid(ov, vid)
    prev = ov.get("previous_version_id")
    if not prev:
        return _answer("changes", "This is the first run of its system, so there is no earlier run to compare it with.",
                       run, links=[{"label": "Open runs", "href": "/runs"}])
    tr = await src.trends(run)
    this = next((r for r in (tr or {}).get("runs") or [] if r.get("version_id") == run), None)
    dqs = ov.get("dqs") or {}
    delta = dqs.get("delta")
    if delta is None:
        text = "The score cannot be compared with the previous run."
    elif delta:
        text = f"Since the previous run the score {'rose' if delta > 0 else 'fell'} {abs(delta):.1f} points to {dqs['composite']:.1f}."
    else:
        text = f"Since the previous run the score held at {dqs['composite']:.1f}."
    data = None
    if this and this.get("rules_fixed") is not None:
        fixed, new = int(this["rules_fixed"] or 0), int(this["rules_new"] or 0)
        text += (f" {fixed} {_plural(fixed, 'rule')} that failed before {'passes' if fixed == 1 else 'pass'} now and "
                 f"{new} {_plural(new, 'rule')} started failing.")
        data = [{"label": "Rules fixed", "value": fixed}, {"label": "Newly failing", "value": new}]
    res = await src.rules(run, m.module, None, 500)
    worse = sorted((r for r in (res or {}).get("rows") or [] if (r.get("delta_affected") or 0) > 0),
                   key=lambda r: (-r["delta_affected"], r["check_id"]))
    if worse:
        w = worse[0]
        text += f" The biggest rise is {w['check_id']} in {module_name(w['module'])}, up {_n(w['delta_affected'])} records."
    links = [{"label": "Compare the two runs", "href": f"/runs/{run}/vs/{prev}"},
             {"label": "Open trends", "href": _href("/insights/trends", run)}]
    return _answer("changes", text, run, data=data, chart="bar", links=links)


def help_answer(version_id: Optional[str], intent: str = "help", lead: str = "") -> dict:
    """What Ask Meridian answers, with the four example questions."""
    text = (f"{lead} " if lead else "") + (
        "I answer from the figures of your runs: the score and how it moved, the weakest objects, the top failing "
        "rules, critical findings, readiness, root causes, fixes, owners and what changed. ")
    text += "Try " + ", ".join(f'"{q}"' for q in EXAMPLES[:-1]) + f' or "{EXAMPLES[-1]}".'
    return _answer(intent, text, version_id, links=[{"label": "Open Insights", "href": _href("/insights", version_id)}])


_HANDLERS = {
    "score": _score, "weakest_objects": _weakest, "top_rules": _top_rules, "critical": _critical,
    "readiness": _readiness, "root_causes": _root_causes, "fixes": _fixes, "owners": _owners, "changes": _changes,
}


# ── the model, only as the fallback ──────────────────────────────────────────

_RULE_KEYS = ("check_id", "module", "severity", "affected")


def llm_context(overview: Optional[dict], heatmap: Optional[dict], rules: Optional[dict]) -> str:
    """The only data the model sees: the overview narrative, each object's score and the top failing rules by id,
    object, severity and affected count. Fields are whitelisted, so nothing else in a row can leak."""
    lines: list[str] = []
    for s in (overview or {}).get("narrative") or []:
        if isinstance(s, dict) and s.get("text"):
            lines.append(f"- {s['text']}")
    out = ["Summary:", *(lines or ["- No summary."]), "", "Object scores (0 to 100):"]
    for r in (heatmap or {}).get("rows") or []:
        score = (r.get("scores") or {}).get("composite")
        if score is not None:
            out.append(f"- {module_name(str(r.get('module')))}: {float(score):.1f}")
    out += ["", "Top failing rules (rule id, object, severity, failing records):"]
    for r in ((rules or {}).get("rows") or [])[:CONTEXT_RULES]:
        cid, mod, sev, n = (r.get(k) for k in _RULE_KEYS)
        out.append(f"- {cid}, {module_name(str(mod))}, {sev}, {int(n or 0)}")
    return "\n".join(out)


SYSTEM_PROMPT = (
    "You are Ask Meridian, the assistant inside an SAP data quality product. Answer the user's question in plain "
    "British English, in one to three short sentences, using only the figures given. Do not invent numbers, "
    "records or field values. If the figures do not answer the question, say so in one sentence and suggest "
    "what the user could ask instead. No markdown, no lists."
)


async def _log_call(tenant_id: str, prompt: str, model: str, latency_ms: int, success: bool) -> None:
    from api.utils.llm_logger import log_llm_call

    try:
        await asyncio.to_thread(log_llm_call, tenant_id, SERVICE_NAME, prompt, model, len(prompt) // 4,
                                latency_ms, success)
    except Exception:
        logger.exception("assistant could not write llm_audit_log")


async def _ask_llm(src: Sources, question: str, vid: Optional[str], m: Match, tenant_id: str) -> Optional[dict]:
    """The model's answer, or None when no model is configured or the call fails."""
    from llm import provider

    if await asyncio.to_thread(provider.llm_is_noop):
        return None
    ov = await src.overview(vid, m.module)
    if ov is None:
        raise NoRun
    run = _vid(ov, vid)
    context = llm_context(ov, await src.heatmap(run), await src.rules(run, m.module, None, CONTEXT_RULES))
    user = f"Figures:\n{context}\n\nQuestion: {question.strip()}"
    llm = provider.get_llm_safe()
    if llm is None:
        return None
    t0 = time.monotonic()
    text = await provider.safe_ainvoke(llm, [{"role": "system", "content": SYSTEM_PROMPT},
                                             {"role": "user", "content": user}], timeout_seconds=LLM_TIMEOUT_S)
    await _log_call(tenant_id, SYSTEM_PROMPT + "\n" + user, str(getattr(llm, "model", None) or
                                                              getattr(llm, "model_name", None) or "unknown"),
                    int((time.monotonic() - t0) * 1000), bool(text))
    if not text or not text.strip():
        return None
    links = [{"label": "Open Insights", "href": _href("/insights", run)}]
    return _answer("ai", text.strip(), run, links=links, ai=True)


# ── entry point ──────────────────────────────────────────────────────────────

_NO_RUN = ("There is no finished run yet, so there are no figures to answer from. "
           "Import a file or extract from a system, then ask again.")
_FAILED = "I could not work that out just now. Try again in a moment, or open Insights for the full picture."


async def ask(question: str, version_id: Optional[str], module: Optional[str], src: Sources,
              tenant_id: str) -> dict:
    """Answer ``question`` for the run ``version_id`` (default the latest finished run). Never raises."""
    m = match(question, module)
    try:
        if m.intent == "help":
            return help_answer(version_id)
        if m.intent in _HANDLERS:
            return await _HANDLERS[m.intent](src, version_id, m)
        got = await _ask_llm(src, question, version_id, m, tenant_id)
        if got:
            return got
        return help_answer(version_id, intent="unknown",
                           lead="I do not have a built-in answer for that.")
    except NoRun:
        return _answer(m.intent or "unknown", _NO_RUN, version_id,
                       links=[{"label": "Import a file", "href": "/import"}, {"label": "Open runs", "href": "/runs"}])
    except Exception:
        logger.exception("assistant failed to answer (intent %s)", m.intent)
        return _answer(m.intent or "unknown", _FAILED, version_id,
                       links=[{"label": "Open Insights", "href": _href("/insights", version_id)}])
