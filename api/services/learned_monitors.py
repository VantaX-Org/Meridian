"""Learned monitors: a baseline learned from the system's own run history, and the breaks from it.

For each object (module) of a run, four kinds of metric are compared with the same system's earlier finished runs:

  records     records checked              volume_drop / volume_spike
  score       composite DQ score           score_drop
  fail_rate   per rule, failed / checked   fail_rate_jump
  blank_pct   per TABLE.FIELD, blank share field_emptied (populated before, empty now)

Baseline: median and MAD (``checks.anomaly.expected_range``, the same band the extraction anomalies use) over the last
``HISTORY`` earlier runs. Fewer than ``MIN_RUNS`` earlier runs of a metric: the monitor is learning and raises nothing.
With ``SEASON_MIN`` or more earlier runs and ``SEASON_POINTS`` of them on the same weekday as the run, the baseline is
those same-weekday runs only. A steward can mark a break expected: ``exclude`` drops that run from later baselines,
``accept`` makes that run the start of the baseline (the older runs are dropped and the monitor relearns).

Aggregates only: the input is ``analysis_versions.dqs_summary``, ``findings`` counts and ``field_profiles`` blank
shares, never a record value. Deterministic; the explanation text lives at the bottom of this file and is the fallback
for the model's (api/routes/learned_monitors.py), whose output is checked against the figures before it is shown.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services.version_status import finished_sql
from checks.anomaly import expected_range

MIN_RUNS = 5          # earlier runs a baseline needs before it may alert
HISTORY = 30          # earlier runs considered
SEASON_MIN = 28       # earlier runs (about four weeks of daily runs) before weekday seasonality is tried
SEASON_POINTS = 4     # same-weekday runs needed to use it
MIN_POP = 50          # a rule on fewer records has no stable fail rate
MIN_ROWS = 100        # a field profile on fewer rows has no stable blank share
VOLUME_REL, VOLUME_SPREAD = 0.30, 0.02
SCORE_SPREAD, SCORE_MIN_DROP = 0.005, 1.0       # points
RATE_SPREAD, RATE_MIN_RISE = 1.0, 2.0           # percentage points
EMPTY_AT, POPULATED_BELOW = 95.0, 50.0          # blank share now / median blank share before

Point = tuple[str, datetime, float]  # (run id, run_at, value), oldest first


# -- baseline -----------------------------------------------------------------------------------------------------------

def baseline(points: list[Point], at: datetime, *, rel: float = 0.0, abs_: float = 0.0, min_spread: float = 0.0,
             relative_floor: bool = True) -> Optional[dict]:
    """The expected band for a run at ``at`` from ``points`` (earlier runs, oldest first), or None when there are fewer
    than MIN_RUNS: a baseline that thin raises no alert. ``runs`` and ``run_ids`` say what it used."""
    if len(points) < MIN_RUNS:
        return None
    window = points[-HISTORY:]
    method = "mad"
    if len(window) >= SEASON_MIN:
        same = [p for p in window if p[1].weekday() == at.weekday()]
        if len(same) >= SEASON_POINTS:
            window, method = same, "mad_weekday"
    vals = [p[2] for p in window]
    low, high, m = expected_range(vals, rel=rel, abs_=abs_, min_spread=min_spread, relative_floor=relative_floor)
    vs = sorted(vals)
    mid = len(vs) // 2
    median = vs[mid] if len(vs) % 2 else (vs[mid - 1] + vs[mid]) / 2
    return {"low": low, "high": high, "median": median, "method": method if m == "mad" else m,
            "runs": len(window), "run_ids": [p[0] for p in window]}


def _sev(step: float, cuts: tuple[float, float]) -> str:
    return "critical" if step >= cuts[1] else "high" if step >= cuts[0] else "medium"


def judge(metric: str, subject: str, obs: float, base: dict) -> Optional[dict]:
    """The break, if ``obs`` is outside the band in the direction that matters for ``metric``."""
    low, high, med = base["low"], base["high"], base["median"]
    kind = sev = None
    if metric == "records":
        if obs < low or obs > high:
            kind = "volume_drop" if obs < low else "volume_spike"
            sev = _sev(abs(obs - med) / med if med else 1.0, (0.25, 0.5))
    elif metric == "score":
        if obs < low and med - obs >= SCORE_MIN_DROP:
            kind, sev = "score_drop", _sev(med - obs, (5, 10))
    elif metric == "fail_rate":
        if obs > high and obs - med >= RATE_MIN_RISE:
            kind, sev = "fail_rate_jump", _sev(obs - med, (10, 25))
    elif metric == "blank_pct":
        if obs >= EMPTY_AT and med < POPULATED_BELOW and obs > high:
            kind, sev = "field_emptied", "critical" if med < 10 else "high"
    if not kind:
        return None
    return {"kind": kind, "metric": metric, "subject_code": subject, "severity": sev, "observed": obs,
            "low": low, "high": high, "median": med, "method": base["method"], "baseline_runs": base["runs"],
            "baseline_run_ids": base["run_ids"]}


def apply_decisions(points: list[Point], decisions: list[tuple[str, str]], when: dict[str, datetime]) -> list[Point]:
    """Stewards' 'expected' marks for this metric and subject: (run id, 'exclude'|'accept'). Exclude drops that run's
    point. Accept drops every point older than that run (a new normal: the baseline restarts there)."""
    for rid, effect in decisions:
        if effect == "exclude":
            points = [p for p in points if p[0] != rid]
        elif effect == "accept" and rid in when:
            points = [p for p in points if p[1] >= when[rid]]
    return points


# -- reading history ----------------------------------------------------------------------------------------------------

def _num(x: Any) -> Optional[float]:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def collect(session: Session, tid: str, vid: str, module: str) -> tuple[Optional[dict], dict[str, list[Point]], dict[str, dict]]:
    """(the run, the earlier runs' points per series key, the run's own values per series key). Series keys are
    ``metric|subject``. The run is {run_at, run_number}; None when it is not found."""
    from api.services.receipt_math import records_checked_of
    p = {"tid": tid, "vid": vid, "m": module}
    cur = session.execute(text("SELECT run_at, run_number, metadata->>'system_id' FROM analysis_versions "
                               "WHERE id = :vid AND tenant_id = :tid"), p).fetchone()
    if not cur:
        return None, {}, {}
    runs = session.execute(text(f"""
        SELECT id::text, run_at, run_number, dqs_summary->:m FROM analysis_versions
         WHERE tenant_id = :tid AND {finished_sql()} AND id <> :vid AND run_at < :at
           AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
           AND metadata->>'archived' IS DISTINCT FROM 'true'
           AND metadata->>'system_id' IS NOT DISTINCT FROM CAST(:sid AS text)
           AND dqs_summary ? :m
         ORDER BY run_at DESC LIMIT :n"""), {**p, "at": cur[0], "sid": cur[2], "n": HISTORY}).fetchall()
    runs = list(reversed(runs))
    ids = [r[0] for r in runs] + [vid]
    series: dict[str, list[Point]] = {}
    mine: dict[str, dict] = {}

    def put(rid: str, at: datetime, key: str, val: Optional[float]) -> None:
        if val is None:
            return
        if rid == vid:
            mine[key] = {"value": val}
        else:
            series.setdefault(key, []).append((rid, at, val))

    def at_of(rid: str) -> datetime:
        return cur[0] if rid == vid else next(r[1] for r in runs if r[0] == rid)

    summ = {r[0]: (r[3] if isinstance(r[3], dict) else {}) for r in runs}
    summ[vid] = session.execute(text("SELECT dqs_summary->:m FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
                                p).scalar() or {}
    widest = {r[0]: int(r[1]) for r in session.execute(text(
        "SELECT version_id::text, max(total_count) FROM findings WHERE tenant_id = :tid "
        "AND version_id = ANY(CAST(:ids AS uuid[])) AND module = :m GROUP BY 1"), {**p, "ids": ids}) if r[1]}
    for rid in ids:
        s = summ.get(rid) if isinstance(summ.get(rid), dict) else {}
        put(rid, at_of(rid), "score|", _num(s.get("composite_score")))
        n = records_checked_of(s, widest.get(rid))
        put(rid, at_of(rid), "records|", float(n) if n else None)
    for r in session.execute(text("""
            SELECT version_id::text, check_id, sum(affected_count), sum(total_count) FROM findings
             WHERE tenant_id = :tid AND version_id = ANY(CAST(:ids AS uuid[])) AND module = :m
             GROUP BY 1, 2"""), {**p, "ids": ids}):
        if r[3] and int(r[3]) >= MIN_POP:
            put(r[0], at_of(r[0]), f"fail_rate|{r[1]}", 100.0 * int(r[2]) / int(r[3]))
    for r in session.execute(text("""
            SELECT version_id::text, table_name, field, (stats->>'rows')::float, (stats->>'blank_pct')::float
              FROM field_profiles WHERE tenant_id = :tid AND version_id = ANY(CAST(:ids AS uuid[])) AND module = :m"""),
                             {**p, "ids": ids}):
        if r[3] is not None and r[4] is not None and r[3] >= MIN_ROWS:
            put(r[0], at_of(r[0]), f"blank_pct|{r[1]}.{r[2]}", float(r[4]))
    for pts in series.values():
        pts.sort(key=lambda x: x[1])
    return {"run_at": cur[0], "run_number": cur[1]}, series, mine


def _decisions(session: Session, tid: str, module: str) -> dict[str, list[tuple[str, str]]]:
    out: dict[str, list[tuple[str, str]]] = {}
    for r in session.execute(text("""
            SELECT version_id::text, metric, subject_code, baseline_effect FROM learned_monitor_breaks
             WHERE tenant_id = :tid AND module = :m AND status = 'expected' AND baseline_effect IS NOT NULL"""),
                             {"tid": tid, "m": module}):
        out.setdefault(f"{r[1]}|{r[2]}", []).append((r[0], r[3]))
    return out


SETTINGS = {
    "records": dict(rel=VOLUME_REL, min_spread=VOLUME_SPREAD),
    "score": dict(min_spread=SCORE_SPREAD),
    "fail_rate": dict(abs_=RATE_MIN_RISE, min_spread=RATE_SPREAD, relative_floor=False),
    "blank_pct": dict(abs_=10.0, min_spread=RATE_SPREAD, relative_floor=False),
}


def detect(session: Session, tid: str, vid: str, module: str) -> dict:
    """{"breaks": [...], "series": n watched, "learning": n with too few earlier runs, "runs": earlier runs of the object}.
    Read only; the caller set ``app.tenant_id``."""
    run, series, mine = collect(session, tid, vid, module)
    if not run:
        return {"breaks": [], "series": 0, "learning": 0, "runs": 0}
    decided = _decisions(session, tid, module)
    when = {pt[0]: pt[1] for pts in series.values() for pt in pts}
    breaks, learning = [], 0
    for key, cur in sorted(mine.items()):
        metric, _, subject = key.partition("|")
        pts = apply_decisions(series.get(key, []), decided.get(key, []), when)
        base = baseline(pts, run["run_at"], **SETTINGS[metric])
        if base is None:
            learning += 1
            continue
        b = judge(metric, subject, cur["value"], base)
        if b:
            breaks.append(b)
    return {"breaks": breaks, "series": len(mine), "learning": learning,
            "runs": max((len(p) for p in series.values()), default=0)}


def detect_and_store(session: Session, tid: str, vid: str, module: str) -> int:
    """Replace the run's open breaks of ``module`` (stewards' decisions are kept) and return how many were found.
    A break whose kind and subject a steward snoozed in an earlier run stays snoozed until that time."""
    res = detect(session, str(tid), str(vid), module)
    p = {"tid": str(tid), "vid": str(vid), "m": module}
    session.execute(text("DELETE FROM learned_monitor_breaks WHERE tenant_id = :tid AND version_id = :vid "
                         "AND module = :m AND status = 'open'"), p)
    rows = [{**p, "k": b["kind"], "me": b["metric"], "s": b["subject_code"], "sev": b["severity"], "lo": b["low"],
             "hi": b["high"], "md": b["median"], "o": b["observed"], "n": b["baseline_runs"],
             "ids": json.dumps(b["baseline_run_ids"]), "meth": b["method"]} for b in res["breaks"]]
    if rows:
        session.execute(text("""
            INSERT INTO learned_monitor_breaks (tenant_id, version_id, module, kind, metric, subject_code, severity,
                expected_low, expected_high, median, observed, baseline_runs, baseline_run_ids, method)
            VALUES (:tid, :vid, :m, :k, :me, :s, :sev, :lo, :hi, :md, :o, :n, CAST(:ids AS jsonb), :meth)
            ON CONFLICT ON CONSTRAINT uq_learned_monitor_breaks DO NOTHING"""), rows)
        session.execute(text("""
            UPDATE learned_monitor_breaks b SET status = 'snoozed', snoozed_until = s.until
              FROM (SELECT kind, subject_code, max(snoozed_until) AS until FROM learned_monitor_breaks
                     WHERE tenant_id = :tid AND module = :m AND status = 'snoozed' AND snoozed_until > now()
                     GROUP BY 1, 2) s
             WHERE b.tenant_id = :tid AND b.version_id = :vid AND b.module = :m AND b.status = 'open'
               AND b.kind = s.kind AND b.subject_code = s.subject_code"""), p)
    return len(rows)


# -- explanation --------------------------------------------------------------------------------------------------------

_NUM = re.compile(r"\d+(?:\.\d+)?")
_UNIT = {"records": "", "score": " points", "fail_rate": "%", "blank_pct": "%"}
_WHAT = {"volume_drop": "records checked fell", "volume_spike": "records checked rose",
         "fail_rate_jump": "the fail rate rose", "score_drop": "the score fell", "field_emptied": "the field is now empty"}


def _f(x: Optional[float], metric: str) -> str:
    if x is None:
        return "-"
    return f"{x:,.0f}" if metric == "records" else f"{x:.1f}"


def facts(b: dict, description: Optional[str]) -> dict:
    """Everything the explanation may rest on, and everything the model is sent: kind, subject code and its text, and
    the aggregate figures. No record, no field value."""
    return {"kind": b["kind"], "metric": b["metric"], "subject": b["subject_code"] or None, "description": description,
            "observed": b["observed"], "expected_low": b["expected_low"], "expected_high": b["expected_high"],
            "median": b["median"], "baseline_runs": b["baseline_runs"], "method": b["method"]}


def template_explanation(f: dict) -> list[str]:
    m, u = f["metric"], _UNIT[f["metric"]]
    who = f"{f['subject']} ({f['description']})" if f["subject"] and f["description"] else (f["subject"] or "The object")
    head = (f"{who}: {_WHAT[f['kind']]} to {_f(f['observed'], m)}{u}; the usual range is {_f(f['expected_low'], m)} to "
            f"{_f(f['expected_high'], m)}{u}.")
    tail = (f"The baseline is the median of {f['baseline_runs']} earlier runs"
            f"{' on the same weekday' if f['method'] == 'mad_weekday' else ''}, {_f(f['median'], m)}{u}.")
    return [head, tail]


def verify(sentences: list[str], f: dict) -> tuple[list[str], int]:
    """(sentences whose every number is one of the figures, how many were dropped). The subject code and its text are
    removed before numbers are read."""
    vals = [f[k] for k in ("observed", "expected_low", "expected_high", "median") if f[k] is not None]
    ok = {f"{v:.{d}f}" for v in vals for d in (0, 1, 2)} | {f"{v:,.0f}" for v in vals} | {str(f["baseline_runs"])}
    strip = sorted([t for t in (f["subject"], f["description"]) if t], key=len, reverse=True)
    keep, dropped = [], 0
    for s in sentences:
        bare = s
        for t in strip:
            bare = bare.replace(t, " ")
        bare = bare.replace(",", "")
        if all(n in {x.replace(",", "") for x in ok} for n in _NUM.findall(bare)):
            keep.append(s)
        else:
            dropped += 1
    return keep, dropped


def label_of(module: str, subject: str) -> str:
    return f"{module.replace('_', ' ')} {subject}".strip()


def ai_sentences(f: dict, label: str) -> Optional[list[str]]:
    """Up to three sentences from the model, or None when AI is unavailable. Sync: run in a threadpool."""
    from llm.provider import get_llm, llm_is_noop, safe_invoke
    if llm_is_noop():
        return None
    prompt = (f"A learned monitor on {label} found a break from its baseline. Kind: {f['kind'].replace('_', ' ')}. "
              f"Subject: {f['subject'] or 'the whole object'} ({f['description'] or 'n/a'}). Observed {f['observed']:.2f}; "
              f"usual range {f['expected_low']:.2f} to {f['expected_high']:.2f}; baseline median {f['median']:.2f} over "
              f"{f['baseline_runs']} earlier runs. Write at most 3 short plain sentences saying what changed and what a "
              "steward should check first. Use only these figures, copied exactly. Do not guess a cause that is not in them. "
              "One sentence per line, no bullets.")
    out = safe_invoke(get_llm(), prompt, timeout_seconds=45, max_tokens=300)
    if not out:
        return None
    return [ln.strip(" -*\t") for ln in out.splitlines() if ln.strip(" -*\t")]


def explanation(f: dict, generated: Optional[list[str]]) -> dict:
    """{source: ai|template, sentences, dropped}: the model's sentences that survive ``verify``, else the template."""
    dropped = 0
    if generated:
        keep, dropped = verify(generated, f)
        if keep:
            return {"source": "ai", "sentences": keep, "dropped": dropped}
    return {"source": "template", "sentences": template_explanation(f), "dropped": dropped}
