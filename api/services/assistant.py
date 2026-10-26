"""Ask Meridian: a grounded answer to a plain question about the tenant's data quality.

Grounded means every answer is assembled from figures Meridian already computed, and carries them as its proof:

* **Intents.** A question is matched by keywords to one of a set of intents, each answered from the services the
  Insights, Fix work and Progress pages already use, with the plain-speech builders of ``report_commentary``.
* **Facts.** Every answer lists the ``facts`` it was assembled from (statement, value, source, link, and the rule
  checks a fact speaks to), and ``grounded`` is true only when every number in the answer appears in those facts
  (``numbers_grounded``). An answer whose numbers no fact backs is not given: it becomes a plain refusal.
* **Citations.** ``citations`` lists the check ids the facts name, each linked to its failing records, so the
  reader can open exactly what an answer rests on.
* **Retrieval, not invention.** When no intent fits, the question's words are matched against the figures of
  every intent (``retrieve``). Enough overlap answers from the matching figures, with ``coverage`` saying how much
  of the question they cover; too little refuses honestly and suggests what to ask.
* **The model only rewords.** When an LLM is configured, it may reword a retrieval answer from its facts. The
  reword is kept only if it adds no number the facts lack (``phrased``); otherwise the assembled facts stand. The
  model sees the fact statements only, never a record key or a field value. Every call writes ``llm_audit_log``.

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

#: Shown on an empty panel and in the answer when nothing fits.
EXAMPLES = (
    "How has the score moved?",
    "Which objects are weakest?",
    "What are the top failing rules in material master?",
    "Who has the most open work?",
    "How many records fail MM045?",
    "When will the open records be fixed?",
    "What is the value at risk?",
    "What will the score be in 30 days?",
)

INTENTS = ("help", "score", "weakest_objects", "top_rules", "critical", "readiness", "root_causes", "fixes",
           "owners", "changes", "rule", "value_at_risk", "forecast", "progress", "retrieval", "refused")

#: Retrieval answers from the matching figures only when they cover at least this share of the question's words.
MIN_COVERAGE = 0.5
MAX_FACTS = 3
#: An answer cites at most this many checks (the critical answer may rest on hundreds).
MAX_CITATIONS = 10

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
_VALUE = _rx(r"\b(value at risk|money|cost(s|ing)?|worth|financial|revenue|rand|euros?|dollars?|exposure|at stake)\b")
_FORECAST = _rx(r"\b(forecast\w*|predict\w*|projected|projection|in \d+ days|next (week|month|quarter)|will (the )?score|"
                r"going to be|expected (score|dqs))\b")
_PROGRESS = _rx(r"\b(when will|finish(ed)?|done by|burn[- ]?down|pace|how (fast|quickly)|on track|open records|"
                r"backlog|fixed (this|last) week|completion)\b")
#: A rule id as the app shows it: two to five letters then digits (MM045, XREC001), or a snake-case check id.
_RULE_ID = re.compile(r"\b([A-Za-z]{2,5}\d{2,4})\b|\b([a-z]{2,8}(?:_[a-z0-9]+){1,6})\b")

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


def find_rule_id(question: str) -> Optional[str]:
    """A rule id named in the question (MM045, XREC001, mm_bad_uom), or None. A module id (fi_gl) is not a rule."""
    mods = known_modules()
    for m in _RULE_ID.finditer(question):
        cid = m.group(1) or m.group(2)
        if m.group(1):
            return cid.upper()
        if cid not in mods:
            return cid
    return None


@dataclass
class Match:
    intent: Optional[str]
    module: Optional[str] = None
    severity: Optional[str] = None
    question: str = ""
    #: the page shows the current state, not one run
    current: bool = False


def match(question: str, module: Optional[str] = None) -> Match:
    """The intent a question asks for, with the object and severity it names. ``module`` is the caller's context,
    used when the question names no object. ``intent`` is None when nothing fits."""
    q = question.strip()
    named = find_module(q)
    mod = named or (module if module in known_modules() else None)
    sev = find_severity(q)
    has_rule = bool(_RULE_WORD.search(q))

    def m(intent: str, severity: Optional[str] = None) -> Match:
        return Match(intent, mod, severity, q)

    if _HELP.search(q):
        return m("help")
    if find_rule_id(q):
        return m("rule")
    if _FORECAST.search(q):
        return m("forecast")
    if _PROGRESS.search(q):
        return m("progress")
    if _VALUE.search(q):
        return m("value_at_risk")
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
    return Match(None, mod, sev, q)


# ── sources: the existing services, behind one small interface ───────────────

class Sources(Protocol):
    async def overview(self, vid: Optional[str], module: Optional[str], current: bool = False) -> Optional[dict]: ...
    async def rules(self, vid: Optional[str], module: Optional[str], severity: Optional[str],
                    limit: int) -> Optional[dict]: ...
    async def heatmap(self, vid: Optional[str]) -> Optional[dict]: ...
    async def trends(self, vid: Optional[str]) -> Optional[dict]: ...
    async def root_causes(self, vid: Optional[str], module: Optional[str]) -> Optional[dict]: ...
    async def cleansing(self, vid: Optional[str], module: Optional[str]) -> Optional[dict]: ...
    async def readiness(self, vid: Optional[str]) -> dict: ...
    async def owners(self) -> dict: ...
    async def impact(self, vid: Optional[str]) -> Optional[dict]: ...
    async def forecast(self, module: Optional[str]) -> dict: ...
    async def burndown(self, vid: Optional[str], module: Optional[str]) -> Optional[dict]: ...


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

    async def overview(self, vid: Optional[str], module: Optional[str], current: bool = False) -> Optional[dict]:
        from api.services import insights_aggregate as agg

        if current:
            from api.routes.insights import _current

            out = await _current(self.db, self.tenant, agg.current_overview, None, module)
            # a day-one tenant's current state is empty: no run to answer from
            return out if (out.get("dqs") or {}).get("composite") is not None else None
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

    async def impact(self, vid: Optional[str]) -> Optional[dict]:
        """Value at risk per SAP feature (the Impact page), with the tenant's currency."""
        import uuid

        from sqlalchemy import text

        from api.routes.insights import get_impact
        from api.services.insights_impact import tenant_currency

        out = await get_impact(uuid.UUID(vid) if vid else None, self.db, self.tenant)
        cost_model = (await self.db.execute(text("SELECT cost_model FROM tenants WHERE id = :t"),
                                            {"t": str(self.tenant.id)})).scalar()
        return {**out, "currency": tenant_currency(cost_model)}

    async def forecast(self, module: Optional[str]) -> dict:
        from api.routes.analytics import get_predictive_analytics

        return await get_predictive_analytics(module, self.db, self.tenant)

    async def burndown(self, vid: Optional[str], module: Optional[str]) -> Optional[dict]:
        from api.services import work_analytics

        return await work_analytics.burndown(self.db, self.tenant.id, vid, module)


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


def check(check_id: Any, module: Any = None) -> dict:
    """One rule check a fact speaks to: its id and, when the fact names one, the object it fails in."""
    return {"check_id": str(check_id), "module": str(module) if module else None}


def fact(statement: str, source: str, href: Optional[str] = None, value: Optional[float] = None,
         checks: Optional[list[dict]] = None) -> dict:
    """One figure an answer is assembled from: what it says, where it comes from, the page that shows it and the
    rule checks it speaks to (``check``)."""
    return {"statement": " ".join(str(statement).split()), "value": value, "source": source, "href": href,
            "checks": [c for c in (checks or []) if c.get("check_id")][:MAX_CITATIONS]}


def citation_href(c: dict, run: Optional[str]) -> str:
    """Where a cited check's failing records are: the object's records filtered to the check (the drill every
    score explainer uses), else the rule's own page when the fact names no object."""
    if c.get("module"):
        return _href(f"/objects/{c['module']}", run, tab="records", check_id=c["check_id"])
    return _href(f"/rules/{c['check_id']}", run)


def citations(facts: list[dict], run: Optional[str]) -> list[dict]:
    """The checks the facts name, first mention first, one per (check, object), each linked to its records."""
    out: list[dict] = []
    seen: set[tuple[str, Optional[str]]] = set()
    for f in facts:
        for c in f.get("checks") or []:
            key = (c["check_id"], c.get("module"))
            if key in seen:
                continue
            seen.add(key)
            out.append({**c, "href": citation_href(c, run)})
    return out[:MAX_CITATIONS]


def _data_facts(data: Optional[list[dict]], source: str, href: Optional[str]) -> list[dict]:
    return [fact(f"{d['label']}: {_num(d['value'])}", source, href, float(d["value"])) for d in data or []]


#: A number as prose writes it (1,200 / 72.4 / 40%), not one inside an id (MM003) or a word (S4).
_NUMBER = re.compile(r"(?<![A-Za-z0-9_.])\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9_])")


def _num(v: Any) -> str:
    f = float(v)
    return f"{int(f):,}" if f.is_integer() else f"{f:,.1f}"


def numbers_in(text: str) -> set[float]:
    """Every number written in ``text``, as absolute values (a "+2.4" and a "2.4 points down" are both 2.4)."""
    out: set[float] = set()
    for m in _NUMBER.finditer(text or ""):
        try:
            out.add(abs(round(float(m.group(0).replace(",", "")), 1)))
        except ValueError:
            continue
    return out


def numbers_grounded(text: str, facts: list[dict]) -> bool:
    """True when every number in ``text`` appears in a fact's statement or value."""
    known: set[float] = set()
    for f in facts:
        known |= numbers_in(f.get("statement") or "") | numbers_in(f.get("source") or "")
        if f.get("value") is not None:
            known.add(abs(round(float(f["value"]), 1)))
    return numbers_in(text) <= known


def _answer(intent: str, text: str, version_id: Optional[str], *, data: Optional[list[dict]] = None,
            chart: Optional[str] = None, links: Optional[list[dict]] = None, ai: bool = False,
            facts: Optional[list[dict]] = None, coverage: float = 1.0) -> dict:
    # report_commentary sentence-cases an object name, which would capitalise eWMS (DESIGN.md "Object names").
    text = _sentences(re.sub(r"\bEWMS\b", "eWMS", text))
    facts = facts or []
    grounded = numbers_grounded(text, facts)
    if not grounded:
        logger.warning("assistant answer for intent %s holds a number no fact backs: %r", intent, text)
    return {"answer": text, "intent": intent, "data": data or None,
            "chart": chart if data else None, "links": links or [], "ai": ai, "phrased": ai,
            "version_id": version_id, "facts": facts, "coverage": round(coverage, 2), "grounded": grounded,
            "citations": citations(facts, version_id)}


def _need(payload: Optional[dict]) -> dict:
    if payload is None:
        raise NoRun
    return payload


def _vid(payload: Optional[dict], fallback: Optional[str]) -> Optional[str]:
    v = (payload or {}).get("version_id")
    return str(v) if v else fallback


# ── intents ──────────────────────────────────────────────────────────────────

async def _score(src: Sources, vid: Optional[str], m: Match) -> dict:
    ov = _need(await src.overview(vid, m.module, current=m.current))
    run = _vid(ov, vid)
    dqs = ov.get("dqs") or {}
    narrative = ov.get("narrative") or []
    text = narrative[0]["text"] if narrative else "No object has been scored in this run."
    facts = [fact(narrative[0]["text"], "Insights summary", narrative[0].get("href") or _href("/insights", run))] if narrative else []
    if m.module and dqs.get("composite") is not None:
        text = f"{module_name(m.module)} scores {dqs['composite']:.1f}."
        facts = [fact(text, f"{module_name(m.module)} score", _href(f"/objects/{m.module}", run), dqs["composite"])]
        if dqs.get("delta") is not None:
            d = dqs["delta"]
            text += (f" That is {abs(d):.1f} points {'up' if d > 0 else 'down'} on the previous run." if d
                     else " That is unchanged from the previous run.")
            facts.append(fact(f"Change on the previous run: {d:+.1f} points", "Trends", _href("/insights/trends", run), d))
    if dqs.get("capped") and dqs.get("cap_reason"):
        text += f" A critical failure caps it: {str(dqs['cap_reason']).rstrip('.')}."
        facts.append(fact(f"Capped: {dqs['cap_reason']}", "Score cap", _href("/insights", run)))
    data, chart = None, None
    if not m.module and not m.current:
        tr = await src.trends(run)
        runs = [r for r in (tr or {}).get("runs") or [] if r.get("composite") is not None]
        if len(runs) > 1:
            data = [{"label": (r.get("run_at") or "")[:10] or (r.get("label") or ""), "value": r["composite"]}
                    for r in runs]
            chart = "line"
            facts += _data_facts(data, "Score per run", _href("/insights/trends", run))
    links = [{"label": "Open trends", "href": _href("/insights/trends", run)}]
    if m.module:
        links.insert(0, {"label": f"Open {module_name(m.module)}", "href": _href(f"/objects/{m.module}", run)})
    else:
        links.append({"label": "Open the summary", "href": _href("/insights", run)})
    return _answer("score", text, run, data=data, chart=chart, links=links, facts=facts)


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
    facts = _data_facts(data, "Object scores", _href("/objects", run))
    facts.append(fact(f"{meets} of {len(rows)} scored objects meet the target", "Object verdicts", _href("/objects", run)))
    if crit:
        facts.append(fact(f"{len(crit)} objects carry a critical failure", "Critical findings",
                          _href("/insights/rules", run, severity="critical"), len(crit)))
    return _answer("weakest_objects", text, run, data=data, chart="bar", links=links, facts=facts)


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
    facts = [fact(f"{r['check_id']} ({rc._short(r.get('name'), r['check_id'])}) fails on {_n(r.get('affected'))} records in "
                  f"{module_name(r['module'])}, severity {r.get('severity')}", "Rule ranking",
                  _href(f"/rules/{r['check_id']}", run), int(r.get("affected") or 0),
                  checks=[check(r["check_id"], r.get("module"))]) for r in rows]
    top = rows[0]
    text = f"The {sev}rule that costs most{where} is {_rule_phrase(top)}"
    name = rc._short(top.get("name"), "")
    text += f": {_lower_first(name)}." if name and name != top["check_id"] else "."
    if len(rows) > 1:
        text += f" Next {'is' if len(rows) == 2 else 'are'} {_oxford([_rule_phrase(r) for r in rows[1:3]])}."
    text += " Rules are ranked by failing records weighted by severity."
    data = [{"label": r["check_id"], "value": int(r.get("affected") or 0)} for r in rows]
    links = [link, {"label": f"Open {top['check_id']}", "href": _href(f"/objects/{top['module']}", run, rule=top["check_id"])}]
    return _answer("top_rules", text, run, data=data, chart="bar", links=links, facts=facts)


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
    facts = [fact(text, "Critical findings", links[0]["href"], len(rows),
                  checks=[check(r["check_id"], r.get("module")) for r in rows])] + _data_facts(data, "Critical rules per object", links[0]["href"])
    return _answer("critical", text, run, data=data, chart="bar", links=links, facts=facts)


async def _readiness(src: Sources, vid: Optional[str], m: Match) -> dict:
    from api.services.insights_readiness import ReadinessCell, wave_verdict

    ov = _need(await src.overview(vid, m.module))
    run = _vid(ov, vid)
    narrative = ov.get("narrative") or []
    text = narrative[1]["text"] if len(narrative) > 1 else rc.blockers([], (ov.get("blockers") or {}).get("count") or 0)
    rd = await src.readiness(run)
    data = None
    facts = [fact(text, "Insights summary", _href("/insights/readiness", run))]
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
            facts += [fact(v, "Wave readiness", _href("/insights/readiness", run)) for v in verdicts]
            facts += _data_facts(data, "Blocking rules per wave", _href("/insights/readiness", run))
    else:
        text += " No migration wave is set up, so readiness is read per object only."
    links = [{"label": "Open readiness", "href": _href("/insights/readiness", run)}]
    return _answer("readiness", text, run, data=data, chart="bar", links=links, facts=facts)


async def _root_causes(src: Sources, vid: Optional[str], m: Match) -> dict:
    res = _need(await src.root_causes(vid, m.module))
    run = _vid(res, vid)
    clusters = res.get("clusters") or []
    text = rc.clusters(_named(clusters)) or "No failing rule shares a field in this run, so there is no root cause to group."

    def label(c: dict) -> str:
        return f"{module_name(c['module'])} {c['field']}" if c.get("field") else f"{module_name(c['module'])}, no named field"

    data = [{"label": label(c), "value": int(c.get("records") or 0)} for c in clusters[:TOP_N]]
    links = [{"label": "Open rules by field", "href": _href("/insights/rules", run, module=m.module, axis="field")}]
    facts = [fact(f"{label(c)}: {_n(c.get('records'))} failing records across {len(c.get('rules') or [])} rules "
                  f"({', '.join(c.get('rules') or [])})", "Root causes", links[0]["href"], int(c.get("records") or 0),
                  checks=[check(cid, c.get("module")) for cid in c.get("rules") or []])
             for c in clusters[:TOP_N]]
    facts += [fact(text, "Root causes", links[0]["href"])] if clusters else []
    return _answer("root_causes", text, run, data=data, chart="bar", links=links, facts=facts)


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
    facts = _data_facts(data, "Fix funnel", "/fix") + [fact(rc.funnel(steps), "Fix funnel", "/fix")]
    return _answer("fixes", text, run, data=data, chart="bar", links=links, facts=facts)


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
    facts = _data_facts(data, "Open items per owner", "/insights/owners")
    facts += [fact(f"{len(rows)} owners have assigned items and {holding} hold open work", "Owners", "/insights/owners"),
              fact(rc.owner({**top, "open": open_n(top), "trend": "improved" if d > 0 else "slipped" if d < 0 else None}),
                   "Owners", "/insights/owners")]
    return _answer("owners", text, vid, data=data, chart="bar", links=link, facts=facts)


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
    cmp_href = f"/runs/{run}/vs/{prev}"
    facts = [fact(f"Score now {dqs['composite']:.1f}, change {delta:+.1f} points on the previous run", "Run comparison",
                  cmp_href, dqs["composite"])] if delta is not None and dqs.get("composite") is not None else []
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
        facts += _data_facts(data, "Run comparison", cmp_href)
    res = await src.rules(run, m.module, None, 500)
    worse = sorted((r for r in (res or {}).get("rows") or [] if (r.get("delta_affected") or 0) > 0),
                   key=lambda r: (-r["delta_affected"], r["check_id"]))
    if worse:
        w = worse[0]
        text += f" The biggest rise is {w['check_id']} in {module_name(w['module'])}, up {_n(w['delta_affected'])} records."
        facts.append(fact(f"{w['check_id']} in {module_name(w['module'])}: {_n(w['delta_affected'])} more failing records",
                          "Rule ranking", _href(f"/rules/{w['check_id']}", run), w["delta_affected"],
                          checks=[check(w["check_id"], w.get("module"))]))
    links = [{"label": "Compare the two runs", "href": cmp_href},
             {"label": "Open trends", "href": _href("/insights/trends", run)}]
    return _answer("changes", text, run, data=data, chart="bar", links=links, facts=facts)


async def _rule(src: Sources, vid: Optional[str], m: Match) -> dict:
    cid = find_rule_id(m.question or "") or ""
    res = _need(await src.rules(vid, None, None, 500))
    run = _vid(res, vid)
    row = next((r for r in res.get("rows") or [] if str(r.get("check_id")).lower() == cid.lower()), None)
    link = {"label": f"Open {cid}", "href": _href(f"/rules/{cid}", run)}
    if row is None:
        return _answer("rule", f"{cid} does not fail in this run.", run, links=[link],
                       facts=[fact(f"{cid} has no failing records in this run", "Rule ranking", link["href"],
                                   checks=[check(cid)])])
    name = rc._short(row.get("name"), cid)
    n, total = int(row.get("affected") or 0), int(row.get("total") or 0)
    text = f"{cid} fails on {_n(n)} records in {module_name(row['module'])}"
    text += f", out of {_n(total)} checked." if total else "."
    if name and name != cid:
        text += f" It checks that {_lower_first(name).rstrip('.')}."
    d = row.get("delta_affected")
    if d:
        text += f" That is {_n(abs(d))} {'more' if d > 0 else 'fewer'} than in the previous run."
    facts = [fact(f"{cid} fails on {_n(n)} of {_n(total)} records in {module_name(row['module'])}, severity "
                  f"{row.get('severity')}", "Rule ranking", link["href"], n)]
    if total:
        facts.append(fact(f"Records checked by {cid}: {_n(total)}", "Rule ranking", link["href"], total))
    if name and name != cid:
        facts.append(fact(f"{cid} checks that {_lower_first(name)}", "Rule catalogue", link["href"]))
    if d:
        facts.append(fact(f"Change on the previous run: {d:+,} failing records", "Run comparison", link["href"], d))
    if row.get("auto_fix_pct"):
        facts.append(fact(f"{row['auto_fix_pct']:.0f}% of its failing records have a proposed fix", "Fix funnel",
                          f"/fix?check={cid}", row["auto_fix_pct"]))
    cited = [check(cid, row.get("module"))]
    facts = [{**f, "checks": cited} for f in facts]
    links = [{"label": "Open its records", "href": _href(f"/objects/{row['module']}", run, rule=cid)}, link]
    return _answer("rule", text, run, links=links, facts=facts)


async def _value_at_risk(src: Sources, vid: Optional[str], m: Match) -> dict:
    res = _need(await src.impact(vid))
    run = _vid(res, vid)
    cur = res.get("currency") or ""
    rows = sorted((r for r in res.get("rows") or [] if r.get("value_at_risk")), key=lambda r: -float(r["value_at_risk"]))
    link = {"label": "Open value at risk", "href": _href("/insights/impact", run)}
    if not rows:
        return _answer("value_at_risk", "No priced SAP feature is affected in this run, so no value is at risk.", run,
                       links=[link], facts=[fact("No priced feature is affected", "Value at risk", link["href"])])
    total = sum(float(r["value_at_risk"]) for r in rows)
    top = rows[0]

    def money(v: float) -> str:
        return f"{v:,.0f} {cur}".strip()

    text = (f"{money(total)} is at risk across {len(rows)} priced {_plural(len(rows), 'feature')}. "
            f"The largest is {_lower_first(str(top['feature']).replace('_', ' '))} at {money(float(top['value_at_risk']))}, "
            f"on {_n(top.get('record_count'))} records.")
    def causes(r: dict) -> list[dict]:
        return [check(cid) for cid in r.get("causing_rules") or []]

    facts = [fact(f"Total value at risk: {money(total)} across {len(rows)} priced {_plural(len(rows), 'feature')}",
                  "Value at risk", link["href"], total, checks=[c for r in rows for c in causes(r)])]
    facts += [fact(f"{str(r['feature']).replace('_', ' ')}: {money(float(r['value_at_risk']))} on {_n(r.get('record_count'))} "
                   f"records ({r.get('status')})", "Value at risk", link["href"], float(r["value_at_risk"]),
                   checks=causes(r))
              for r in rows[:TOP_N]]
    data = [{"label": str(r["feature"]).replace("_", " "), "value": round(float(r["value_at_risk"]))} for r in rows[:TOP_N]]
    return _answer("value_at_risk", text, run, data=data, chart="bar", links=[link], facts=facts)


async def _forecast(src: Sources, vid: Optional[str], m: Match) -> dict:
    res = await src.forecast(m.module)
    rows = res.get("forecasts") or []
    link = {"label": "Open forecast", "href": "/insights/forecast"}
    if not rows:
        days = res.get("days_seen") or 0
        return _answer("forecast", f"A forecast needs runs on three different days; the runs so far cover {days} "
                       f"{_plural(days, 'day')}.", vid, links=[link, {"label": "Open runs", "href": "/runs"}],
                       facts=[fact(f"Days with a run: {days}", "Forecast", link["href"], days)])
    # The API leaves a horizon out (None) when the history is too short to project that far: speak to the
    # furthest one it gives.
    def furthest(r: dict) -> tuple[str, str]:
        return ("30 days", "30d") if r.get("forecast_30d") is not None else ("7 days", "7d")
    f = rows[0] if m.module else min(rows, key=lambda r: float(r[f"forecast_{furthest(r)[1]}"]))
    name = module_name(str(f["module_id"]))
    when, key = furthest(f)
    value = float(f[f"forecast_{key}"])
    low, high = f.get(f"forecast_{key}_low"), f.get(f"forecast_{key}_high")
    rng = f" (likely between {float(low):.1f} and {float(high):.1f})" if low is not None and high is not None else ""
    text = (f"{name} is forecast at {value:.1f} in {when}{rng}, from {float(f['current_score']):.1f} now, "
            f"projected from {f.get('points')} {_plural(int(f.get('points') or 0), 'run')}.")
    if not m.module and len(rows) > 1:
        text += f" It is the lowest of {len(rows)} forecast objects."
    later = f", {value:.1f} in {when}" if when != "7 days" else ""
    facts = [fact(f"{name}: {float(f['current_score']):.1f} now, {float(f['forecast_7d']):.1f} in 7 days{later}",
                  "Forecast", link["href"], value),
             fact(f"Projected from {f.get('points')} runs", "Forecast", link["href"], f.get("points")),
             fact(f"Objects forecast: {len(rows)}", "Forecast", link["href"], len(rows))]
    if rng:
        facts.insert(1, fact(f"{when} range: {float(low):.1f} to {float(high):.1f}", "Forecast", link["href"], value))
    data = [{"label": "Now", "value": float(f["current_score"])}, {"label": "7 days", "value": float(f["forecast_7d"])}]
    if when != "7 days":
        data.append({"label": when, "value": value})
    return _answer("forecast", text, vid, data=data, chart="line", links=[link], facts=facts)


async def _progress(src: Sources, vid: Optional[str], m: Match) -> dict:
    res = _need(await src.burndown(vid, m.module))
    link = {"label": "Open progress", "href": _href("/insights/progress", vid, module=m.module)}
    open_now, fixed = int(res.get("open_now") or 0), int(res.get("fixed_7d") or 0)
    pace, finish = res.get("pace_per_day"), res.get("projected_finish")
    where = f" in {module_name(m.module)}" if m.module else ""
    text = f"{_n(open_now)} records{where} are open to fix, and {_n(fixed)} were fixed in the last 7 days."
    if finish:
        text += f" At {float(pace):.1f} records a day, the list is clear by {finish}."
    else:
        text += " The list is not shrinking, so there is no finish date at the current pace."
    facts = [fact(f"Open records to fix: {_n(open_now)}", "Fix work burn-down", link["href"], open_now),
             fact(f"Fixed in the last 7 days: {_n(fixed)}", "Fix work burn-down", link["href"], fixed)]
    if pace is not None:
        facts.append(fact(f"Pace over the last {res.get('pace_window_days')} days: {float(pace):.1f} records a day",
                          "Fix work burn-down", link["href"], float(pace)))
    if finish:
        facts.append(fact(f"Projected finish: {finish}", "Fix work burn-down", link["href"]))
    data = [{"label": d["day"], "value": int(d["open"])} for d in (res.get("days") or [])[-14:]]
    return _answer("progress", text, vid, data=data, chart="line", links=[link, {"label": "Open Fix work", "href": "/fix"}],
                   facts=facts)


def help_answer(version_id: Optional[str], intent: str = "help", lead: str = "") -> dict:
    """What Ask Meridian answers, with example questions."""
    text = (f"{lead} " if lead else "") + (
        "I answer from the figures of your runs: the score and how it moved, the weakest objects, the top failing "
        "rules and any one rule, critical findings, readiness, root causes, fixes and their pace, owners, value at "
        "risk, the forecast and what changed. ")
    text += "Try " + ", ".join(f'"{q}"' for q in EXAMPLES[:3]) + f' or "{EXAMPLES[4]}".'
    out = _answer(intent, text, version_id, links=[{"label": "Open Insights", "href": _href("/insights", version_id)}])
    # The examples are suggestions, not figures: a help answer is grounded by construction.
    return {**out, "grounded": True, "coverage": 0.0 if intent in ("refused", "unknown") else 1.0}


_HANDLERS = {
    "score": _score, "weakest_objects": _weakest, "top_rules": _top_rules, "critical": _critical,
    "readiness": _readiness, "root_causes": _root_causes, "fixes": _fixes, "owners": _owners, "changes": _changes,
    "rule": _rule, "value_at_risk": _value_at_risk, "forecast": _forecast, "progress": _progress,
}


# ── retrieval: when no intent fits, answer from the figures that match ───────

_STOP = frozenset("""a about all an and any are as at be been by can could did do does for from had has have how i if
in is it its me my no not of on or our please show so tell than that the their them there these they this to us was
we were what when where which who why will with would you your""".split())

#: The intents whose figures a retrieval answer may draw on (each cheap, each from the run's aggregates).
_POOL = ("score", "weakest_objects", "top_rules", "critical", "readiness", "root_causes", "fixes", "owners",
         "changes", "value_at_risk", "progress")


def _stems(text: str) -> set[str]:
    return {w[:6] for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOP and len(w) > 1}


def retrieve(question: str, facts: list[dict]) -> tuple[list[dict], float]:
    """The facts that share the most words with the question, best first, and the share of the question's words
    they cover (0 to 1). Deterministic: word stems, no model."""
    q = _stems(question)
    if not q:
        return [], 0.0
    scored = sorted(((len(q & _stems(f["statement"] + " " + f["source"])), i, f) for i, f in enumerate(facts)),
                    key=lambda t: (-t[0], t[1]))
    picked = [f for n, _, f in scored if n > 0][:MAX_FACTS]
    covered = set().union(*(q & _stems(f["statement"] + " " + f["source"]) for f in picked)) if picked else set()
    return picked, len(covered) / len(q)


async def _retrieval(src: Sources, question: str, vid: Optional[str], m: Match, tenant_id: str) -> dict:
    pool: list[dict] = []
    run = vid
    for intent in _POOL:
        try:
            out = await _HANDLERS[intent](src, vid, Match(intent, m.module, m.severity, question))
        except NoRun:
            raise
        except Exception:  # one source failing must not sink the answer
            logger.exception("assistant retrieval could not read %s", intent)
            continue
        run = run or out.get("version_id")
        pool += out.get("facts") or []
    picked, coverage = retrieve(question, pool)
    if coverage < MIN_COVERAGE:
        return help_answer(run, intent="refused", lead="Your figures do not answer that.")
    text = " ".join(f["statement"].rstrip(".") + "." for f in picked)
    links, seen = [], set()
    for f in picked:
        if f.get("href") and f["href"] not in seen:
            seen.add(f["href"])
            links.append({"label": f"Open {f['source'].lower()}", "href": f["href"]})
    phrased = await _phrase(text, picked, tenant_id)
    return _answer("retrieval", phrased or text, run, links=links[:3], facts=picked, coverage=coverage, ai=bool(phrased))


# ── the model, only to reword facts it is given ──────────────────────────────

SYSTEM_PROMPT = (
    "You are Ask Meridian, the assistant inside an SAP data quality product. Reword the facts you are given into "
    "one to three short sentences of plain British English that answer the question. Use only the facts: do not add, "
    "round, or change any number, and add no fact of your own. No markdown, no lists."
)


async def _log_call(tenant_id: str, prompt: str, model: str, latency_ms: int, success: bool) -> None:
    from api.utils.llm_logger import log_llm_call

    try:
        await asyncio.to_thread(log_llm_call, tenant_id, SERVICE_NAME, prompt, model, len(prompt) // 4,
                                latency_ms, success)
    except Exception:
        logger.exception("assistant could not write llm_audit_log")


async def _phrase(assembled: str, facts: list[dict], tenant_id: str) -> Optional[str]:
    """The model's reword of ``assembled``, kept only when every number in it is one the facts hold. None when no
    model is configured, the call fails, or the reword adds a number."""
    from llm import provider

    if await asyncio.to_thread(provider.llm_is_noop):
        return None
    llm = provider.get_llm_safe()
    if llm is None:
        return None
    user = "Facts:\n" + "\n".join(f"- {f['statement']}" for f in facts) + f"\n\nAssembled answer: {assembled}"
    t0 = time.monotonic()
    text = await provider.safe_ainvoke(llm, [{"role": "system", "content": SYSTEM_PROMPT},
                                             {"role": "user", "content": user}], timeout_seconds=LLM_TIMEOUT_S)
    ok = bool(text and text.strip()) and numbers_grounded(text, facts)
    await _log_call(tenant_id, SYSTEM_PROMPT + "\n" + user, str(getattr(llm, "model", None) or
                                                               getattr(llm, "model_name", None) or "unknown"),
                    int((time.monotonic() - t0) * 1000), ok)
    if text and not ok:
        logger.warning("assistant dropped a model reword that added a number: %r", text)
    return _sentences(text.strip()) if ok else None


# ── entry point ──────────────────────────────────────────────────────────────

_NO_RUN = ("There is no finished run yet, so there are no figures to answer from. "
           "Import a file or extract from a system, then ask again.")
_FAILED = "I could not work that out just now. Try again in a moment, or open Insights for the full picture."
_UNSUPPORTED = ("Nothing in your findings supports an answer to that, so I will not give one. "
                "Open the page behind it for the full picture.")


def _supported(out: dict) -> dict:
    """``out`` when every number in it is backed by a fact; else a plain refusal that states no figure."""
    if out.get("grounded", True):
        return out
    refusal = _answer("refused", _UNSUPPORTED, out.get("version_id"), links=out.get("links") or [])
    return {**refusal, "coverage": 0.0}


async def ask(question: str, version_id: Optional[str], module: Optional[str], src: Sources,
              tenant_id: str, current: bool = False) -> dict:
    """Answer ``question`` for the run ``version_id`` (default the latest finished run). ``current``: the page shows
    the current state, so the score is read across every object at its latest run, the number beside the panel.
    Never raises."""
    m = match(question, module)
    m.current = current and not version_id
    try:
        if m.intent == "help":
            return help_answer(version_id)
        if m.intent in _HANDLERS:
            return _supported(await _HANDLERS[m.intent](src, version_id, m))
        return _supported(await _retrieval(src, question, version_id, m, tenant_id))
    except NoRun:
        return _answer(m.intent or "unknown", _NO_RUN, version_id,
                       links=[{"label": "Import a file", "href": "/import"}, {"label": "Open runs", "href": "/runs"}])
    except Exception:
        logger.exception("assistant failed to answer (intent %s)", m.intent)
        return _answer(m.intent or "unknown", _FAILED, version_id,
                       links=[{"label": "Open Insights", "href": _href("/insights", version_id)}])
