"""Learned monitors: a baseline learned from the system's own run history, and the breaks from it.

For each object (module) of a run, these metrics are compared with the same system's earlier finished runs:

  records     records checked              volume_drop / volume_spike
  score       composite DQ score           score_drop
  fail_rate   per rule, failed / checked   fail_rate_jump
  blank_pct   per TABLE.FIELD, blank share field_emptied (populated before, empty now)
  distinct_pct per TABLE.FIELD, distinct values as a share of the filled rows   cardinality_shift (either way)
  pattern_pct  per TABLE.FIELD, share of filled rows whose shape is not one of the field's usual shapes (rise)
                                                                               pattern_shift
  unparse_pct  per TABLE.FIELD, numeric non_numeric or dates invalid over the filled rows (rise)   format_break
  num_mean, num_max, num_min, date_max, date_min   per numeric or date TABLE.FIELD      range_shift

Value patterns and ranges, how each is made stable. Usual shapes: the shapes (the profile's five commonest, letters
as A and digits as 9) that hold at least ``USUAL_SHAPE`` of the filled rows in at least half of the earlier runs; a
field whose usual shapes cover under ``SHAPE_COVER`` of its rows is free text or a key and is not watched. The pattern
share of a run is 100 minus the share of the usual shapes. Numeric mean: relative move from the median, either way.
Numeric max may only rise and min only fall (a new extreme, an outlier); date max may only fall back and date min only
move earlier. A date maximum that moves forward as new records arrive is normal and never fires; a dummy far-future
date does not parse and is counted by ``unparse_pct`` instead. Dates become days (proleptic Gregorian ordinal). A
sampled profile (``stats.sampled``) is a sample of the table: its min and max are not the table's, so they are left
out of all four extreme series, while its mean and shares stay. A field under MIN_ROWS filled rows is not watched.
Personal and sensitive fields (``mask_reason`` privacy, ``is_pii_field``, ``is_pii_header``) get no shape series and
no range series at all; their unparseable share is a count and stays. A range break stores one metric per field per run
(the strongest), as the table allows one break per kind and subject. The model is sent a range break's effect size only
(``facts``), never a figure from the field.

Baseline: median and MAD (``checks.anomaly.expected_range``, the same band the extraction anomalies use) over the last
``HISTORY`` earlier runs. Fewer than ``MIN_RUNS`` earlier runs of a metric: the monitor is learning and raises nothing.
With ``SEASON_MIN`` or more earlier runs and ``SEASON_POINTS`` of them on the same weekday as the run, the baseline is
those same-weekday runs only. A steward can mark a break expected: ``exclude`` drops that run from later baselines,
``accept`` makes that run the start of the baseline (the older runs are dropped and the monitor relearns).

Minimum effect, learned per monitor (module, metric, rule or field). A break is raised only when its effect is at least
the monitor's minimum effect. Effect: records |observed - median| / median, score median - observed (points), fail
rate observed - median (percentage points), empty share observed - median (percentage points), distinct share
|observed - median| (percentage points). The fixed constants VOLUME_REL, SCORE_MIN_DROP, RATE_MIN_RISE, EMPTY_AT -
POPULATED_BELOW and DISTINCT_MIN_SHIFT are the FLOOR. ``learn`` folds the steward decisions of the last ``LEARN_DAYS`` days on that monitor, oldest first, starting at
the floor:
  expected break of effect e   minimum = max(minimum, min(e * LEARN_MARGIN, ceiling))
  confirmed break (acknowledged) of effect e below the minimum    minimum = max(floor, e)
The ceiling is ``CEILING_MULT`` times the floor (empty share: 90 points, since 100 is the largest possible effect), so a
monitor can never be silenced; the minimum is never below the
floor. Decisions older than the window drop out, so a raised minimum relaxes by itself. Severity cut points scale with
minimum / floor, capped at ``SEV_SCALE_MAX`` (unchanged at the floor; ``field_emptied`` keeps its fixed critical/high rule
and is only filtered by the minimum). A break outside the usual range but below a raised minimum is stored with status
``below_minimum``: it raises no alert and is not counted as open, and a steward can confirm it (the acknowledge action),
which feeds ``learn`` as a confirmed break and lowers the minimum. Still not done: the minimum is one number per monitor,
learned from decisions alone, not a model of the monitor's noise. Value patterns and ranges are watched only in part:
the usual shapes come from the profile's top five shapes (a field they cover under 80% of is skipped), a date moving
forward is never a break (a dummy far-future date does not parse, so it shows in unparse_pct, not in date_max), a
sampled profile gives no min or max, a personal field is watched for its unparseable share alone, and one range_shift
is kept per field and run (the strongest of its metrics).

Aggregates only: the input is ``analysis_versions.dqs_summary``, ``findings`` counts and ``field_profiles`` row, blank
and distinct counts, never a record value. Deterministic; the explanation text lives at the bottom of this file and is the fallback
for the model's (api/routes/learned_monitors.py), whose output is checked against the figures before it is shown.
"""

from __future__ import annotations

import json
import re
import statistics
from datetime import date, datetime, timedelta, timezone
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
DISTINCT_MIN_SHIFT = 20.0                       # distinct share of filled rows must move this many percentage points
PATTERN_MIN_RISE = 10.0                         # percentage points more rows outside the usual shapes
UNPARSE_MIN_RISE = 5.0                          # percentage points more unparseable values among the filled rows
RANGE_MIN_PCT = 50.0                            # numeric mean / max / min moves this percent of the median
RANGE_MIN_DAYS = 365.0                          # date max / min moves this many days
USUAL_SHAPE = 0.05                              # a shape is usual when it holds this share of the filled rows ...
SHAPE_COVER = 0.80                              # ... and the usual shapes together hold at least this much
NUM_RANGE = ("num_mean", "num_max", "num_min")
DATE_RANGE = ("date_max", "date_min")
RANGE = NUM_RANGE + DATE_RANGE

LEARN_DAYS = 90       # steward decisions older than this no longer move a minimum effect
LEARN_MARGIN = 1.05   # the minimum sits 5% above the largest effect marked expected
CEILING_MULT = 3.0    # a minimum effect never exceeds this multiple of its floor
SEV_SCALE_MAX = 1.5   # severity cuts stretch at most this far, so losing every record is still critical
# blank_pct: a field fires only when it is >= EMPTY_AT now and < POPULATED_BELOW before, so its effect is always above
# EMPTY_AT - POPULATED_BELOW; that is the floor, and firing at the floor is exactly the old rule.
FLOOR = {"records": VOLUME_REL, "score": SCORE_MIN_DROP, "fail_rate": RATE_MIN_RISE,
         "blank_pct": EMPTY_AT - POPULATED_BELOW, "distinct_pct": DISTINCT_MIN_SHIFT,
         "pattern_pct": PATTERN_MIN_RISE, "unparse_pct": UNPARSE_MIN_RISE,
         **{m: RANGE_MIN_PCT for m in NUM_RANGE}, **{m: RANGE_MIN_DAYS for m in DATE_RANGE}}
CEILING = {"blank_pct": 90.0}  # an effect cannot exceed 100 points, so three times the floor would silence the monitor

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


def effect_of(metric: str, observed: float, median: float) -> float:
    """The size of a break in the metric's own unit (see the module docstring)."""
    if metric == "records":
        return abs(observed - median) / median if median else 1.0
    if metric == "distinct_pct" or metric in DATE_RANGE:
        return abs(observed - median)
    if metric in NUM_RANGE:  # percent of the median; a zero median has no relative size, so it never counts
        return abs(observed - median) / abs(median) * 100 if median else 0.0
    return median - observed if metric == "score" else observed - median


def learn(metric: str, events: list[dict]) -> dict:
    """The learned minimum effect from ``events`` (oldest first): {id, decision 'expected'|'confirmed', effect, ...}.
    Returns {min_effect, floor, ceiling, moves}; each move is its event plus ``result`` raised|lowered|kept and the
    minimum after it."""
    floor = FLOOR[metric]
    ceiling = CEILING.get(metric, floor * CEILING_MULT)
    cur, moves = floor, []
    for e in events:
        was = cur
        if e["decision"] == "expected":
            cur = max(cur, min(e["effect"] * LEARN_MARGIN, ceiling))
        elif e["effect"] < cur:
            cur = max(floor, e["effect"])
        moves.append({**e, "result": "raised" if cur > was else "lowered" if cur < was else "kept", "min_effect": cur})
    return {"min_effect": cur, "floor": floor, "ceiling": ceiling, "moves": moves}


EVENTS_SQL = """
    SELECT b.id::text, v.run_number, b.module, b.metric, b.subject_code, b.status, b.observed, b.median, b.decided_by,
           b.decided_at
      FROM learned_monitor_breaks b JOIN analysis_versions v ON v.id = b.version_id AND v.tenant_id = b.tenant_id
     WHERE b.tenant_id = :tid AND b.status IN ('expected', 'acknowledged')
       AND b.metric IN ({metrics})
       AND b.median IS NOT NULL AND b.decided_at >= :since AND (CAST(:m AS text) IS NULL OR b.module = :m)
     ORDER BY b.decided_at, b.id""".replace("{metrics}", ", ".join(f"'{m}'" for m in FLOOR))


def monitor_events(rows: Any) -> dict[tuple[str, str, str], list[dict]]:
    """Rows of EVENTS_SQL as learn() events per (module, metric, subject)."""
    out: dict[tuple[str, str, str], list[dict]] = {}
    for r in rows:
        out.setdefault((r[2], r[3], r[4]), []).append({
            "id": r[0], "run_number": r[1], "decision": "expected" if r[5] == "expected" else "confirmed",
            "effect": effect_of(r[3], r[6], r[7]), "decided_by": r[8], "decided_at": r[9]})
    return out


def _sev(step: float, cuts: tuple[float, float], scale: float = 1.0) -> str:
    cuts = (cuts[0] * scale, cuts[1] * scale)
    return "critical" if step >= cuts[1] else "high" if step >= cuts[0] else "medium"


def judge(metric: str, subject: str, obs: float, base: dict, min_effect: Optional[float] = None,
          keep_suppressed: bool = False) -> Optional[dict]:
    """The break, if ``obs`` is outside the band in the direction that matters for ``metric`` and its effect reaches
    ``min_effect`` (default: the floor). With ``keep_suppressed`` a break outside the band whose effect is below
    ``min_effect`` is returned with ``below_minimum`` True instead of None."""
    low, high, med = base["low"], base["high"], base["median"]
    floor = FLOOR.get(metric, 0.0)
    me = floor if min_effect is None else min_effect
    scale = min(me / floor, SEV_SCALE_MAX) if floor else 1.0
    kind = sev = None
    if metric == "records":
        if obs < low or obs > high:
            kind = "volume_drop" if obs < low else "volume_spike"
            sev = _sev(effect_of(metric, obs, med), (0.25, 0.5), scale)
    elif metric == "score":
        if obs < low:
            kind, sev = "score_drop", _sev(med - obs, (5, 10), scale)
    elif metric == "fail_rate":
        if obs > high:
            kind, sev = "fail_rate_jump", _sev(obs - med, (10, 25), scale)
    elif metric == "blank_pct":
        if obs >= EMPTY_AT and med < POPULATED_BELOW and obs > high:
            kind, sev = "field_emptied", "critical" if med < 10 else "high"
    elif metric == "distinct_pct":
        if obs < low or obs > high:
            kind, sev = "cardinality_shift", _sev(abs(obs - med), (35, 50), scale)
    elif metric == "pattern_pct":
        if obs > high:
            kind, sev = "pattern_shift", _sev(obs - med, (25, 50), scale)
    elif metric == "unparse_pct":
        if obs > high:
            kind, sev = "format_break", _sev(obs - med, (15, 30), scale)
    elif metric in RANGE:
        # one direction each, so a maximum that grows with new records (dates) or a minimum that rises never fires
        out = {"num_mean": obs < low or obs > high, "num_max": obs > high, "num_min": obs < low,
               "date_max": obs < low, "date_min": obs < low}[metric]
        if out:
            kind = "range_shift"
            sev = _sev(effect_of(metric, obs, med), (100, 200) if metric in NUM_RANGE else (1095, 3650), scale)
    if not kind:
        return None
    below = effect_of(metric, obs, med) < me
    if below and not keep_suppressed:
        return None
    return {"kind": kind, "metric": metric, "subject_code": subject, "severity": sev, "observed": obs,
            "low": low, "high": high, "median": med, "method": base["method"], "baseline_runs": base["runs"],
            "baseline_run_ids": base["run_ids"], "below_minimum": below}


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


def _day(x: Any) -> Optional[float]:
    """An ISO date as days (proleptic Gregorian ordinal), None when it is not one."""
    try:
        return float(date.fromisoformat(x).toordinal())
    except (TypeError, ValueError):
        return None


def _personal(qualified: str, field: str, st: dict) -> bool:
    from api.utils.pii_fields import is_pii_field, is_pii_header
    return st.get("mask_reason") == "privacy" or is_pii_field(qualified) or is_pii_header(field)


def _pattern_series(by_run: dict[str, dict[str, float]], vid: str) -> dict[str, float]:
    """{run id: share of the filled rows (percent) outside the usual shapes} for a field, or {} when it has under
    MIN_RUNS earlier runs, no usual shape, or usual shapes that cover under SHAPE_COVER of its rows (free text, a key)."""
    earlier = [r for r in by_run if r != vid]
    if len(earlier) < MIN_RUNS:
        return {}
    seen = {s for r in earlier for s in by_run[r]}
    usual = {s for s in seen if 2 * sum(by_run[r].get(s, 0.0) >= USUAL_SHAPE for r in earlier) >= len(earlier)}
    cover = {r: sum(by_run[r].get(s, 0.0) for s in usual) for r in by_run}
    if not usual or statistics.median(cover[r] for r in earlier) < SHAPE_COVER:
        return {}
    return {r: max(0.0, 100.0 * (1.0 - c)) for r, c in cover.items()}


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
    shapes: dict[str, dict[str, dict[str, float]]] = {}  # field -> run -> {shape: share of the filled rows}
    for r in session.execute(text("""
            SELECT version_id::text, table_name, field, stats FROM field_profiles
             WHERE tenant_id = :tid AND version_id = ANY(CAST(:ids AS uuid[])) AND module = :m"""), {**p, "ids": ids}):
        rid, q, st = r[0], f"{r[1]}.{r[2]}", (json.loads(r[3]) if isinstance(r[3], str) else r[3]) or {}
        rows, blank, pct, distinct = (_num(st.get(k)) for k in ("rows", "blank", "blank_pct", "distinct"))
        if rows is not None and pct is not None and rows >= MIN_ROWS:
            put(rid, at_of(rid), f"blank_pct|{q}", pct)
        filled = rows - blank if rows is not None and blank is not None else 0.0
        if distinct is not None and filled >= MIN_ROWS:  # distinct values as a share of the filled rows: a count, no value
            put(rid, at_of(rid), f"distinct_pct|{q}", 100.0 * distinct / filled)
        if filled < MIN_ROWS:
            continue
        num, dat = st.get("numeric"), st.get("dates")
        bad = _num((num or {}).get("non_numeric")) if isinstance(num, dict) else _num((dat or {}).get("invalid")) if isinstance(dat, dict) else None
        put(rid, at_of(rid), f"unparse_pct|{q}", None if bad is None else 100.0 * bad / filled)  # a count, no value
        if _personal(q, r[2], st):
            continue  # the stats row is fetched whole, but no shape and no figure of a personal field is used
        if isinstance(st.get("shapes"), list):
            shapes.setdefault(q, {})[rid] = {x["shape"]: float(x["share"]) for x in st["shapes"] if "shape" in x and _num(x.get("share")) is not None}
        extreme = not st.get("sampled")  # a sample's min and max are not the table's
        if isinstance(num, dict):
            put(rid, at_of(rid), f"num_mean|{q}", _num(num.get("mean")))
            if extreme:
                put(rid, at_of(rid), f"num_max|{q}", _num(num.get("max")))
                put(rid, at_of(rid), f"num_min|{q}", _num(num.get("min")))
        if isinstance(dat, dict) and extreme:
            put(rid, at_of(rid), f"date_max|{q}", _day(dat.get("max")))
            put(rid, at_of(rid), f"date_min|{q}", _day(dat.get("min")))
    for q, by_run in shapes.items():
        for rid, pct in _pattern_series(by_run, vid).items():
            put(rid, at_of(rid), f"pattern_pct|{q}", pct)
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


def settings(metric: str, min_effect: Optional[float] = None) -> dict:
    """Band settings of ``metric``; the band's own minimum width follows the learned minimum effect."""
    me = FLOOR.get(metric, 0.0) if min_effect is None else min_effect
    table: dict[str, dict] = {"records": dict(rel=me, min_spread=VOLUME_SPREAD),
                              "score": dict(min_spread=SCORE_SPREAD),
                              "fail_rate": dict(abs_=me, min_spread=RATE_SPREAD, relative_floor=False),
                              "blank_pct": dict(abs_=10.0, min_spread=RATE_SPREAD, relative_floor=False),
                              "distinct_pct": dict(abs_=me, min_spread=RATE_SPREAD, relative_floor=False),
                              "pattern_pct": dict(abs_=me, min_spread=RATE_SPREAD, relative_floor=False),
                              "unparse_pct": dict(abs_=me, min_spread=RATE_SPREAD, relative_floor=False),
                              **{m: dict(rel=me / 100, min_spread=VOLUME_SPREAD) for m in NUM_RANGE},
                              **{m: dict(abs_=me, min_spread=RATE_SPREAD, relative_floor=False) for m in DATE_RANGE}}
    return table[metric]


def learned_minimums(session: Session, tid: str, module: str, now: datetime) -> dict[tuple[str, str], float]:
    """{(metric, subject): learned minimum effect} for the monitors of ``module`` that stewards' decisions moved."""
    since = now - timedelta(days=LEARN_DAYS)
    ev = monitor_events(session.execute(text(EVENTS_SQL), {"tid": tid, "m": module, "since": since}))
    return {(me, sub): learn(me, e)["min_effect"] for (_, me, sub), e in ev.items()}


def detect(session: Session, tid: str, vid: str, module: str, now: Optional[datetime] = None) -> dict:
    """{"breaks": [...], "series": n watched, "learning": n with too few earlier runs, "runs": earlier runs of the object}.
    Read only; the caller set ``app.tenant_id``."""
    run, series, mine = collect(session, tid, vid, module)
    if not run:
        return {"breaks": [], "series": 0, "learning": 0, "runs": 0}
    decided = _decisions(session, tid, module)
    mins = learned_minimums(session, tid, module, now or datetime.now(timezone.utc))
    when = {pt[0]: pt[1] for pts in series.values() for pt in pts}
    breaks, learning = [], 0
    for key, cur in sorted(mine.items()):
        metric, _, subject = key.partition("|")
        pts = apply_decisions(series.get(key, []), decided.get(key, []), when)
        me = mins.get((metric, subject))
        base = baseline(pts, run["run_at"], **settings(metric, me))
        if base is None:
            learning += 1
            continue
        b = judge(metric, subject, cur["value"], base, me)
        if not b and me is not None and me > FLOOR[metric]:
            # Outside the usual range as it stood at the floor, but below the raised minimum: kept so a steward can
            # confirm it. A break the raised band still swallows stays unreported, as before.
            fb = baseline(pts, run["run_at"], **settings(metric))
            s = judge(metric, subject, cur["value"], fb, me, keep_suppressed=True) if fb else None
            b = s if s and s["below_minimum"] else None
        if b:
            breaks.append(b)
    best: dict[str, dict] = {}  # one range_shift per field and run: the table keeps one break per kind and subject
    for b in breaks:
        if b["kind"] == "range_shift":
            rank = lambda x: (not x["below_minimum"], effect_of(x["metric"], x["observed"], x["median"]) / FLOOR[x["metric"]])  # noqa: E731
            if b["subject_code"] not in best or rank(b) > rank(best[b["subject_code"]]):
                best[b["subject_code"]] = b
    breaks = [b for b in breaks if b["kind"] != "range_shift" or best[b["subject_code"]] is b]
    return {"breaks": breaks, "series": len(mine), "learning": learning,
            "runs": max((len(p) for p in series.values()), default=0)}


def detect_and_store(session: Session, tid: str, vid: str, module: str) -> int:
    """Replace the run's open and below-minimum breaks of ``module`` (stewards' decisions are kept) and return how many
    were raised (below-minimum ones are stored but raise nothing).
    A break whose kind and subject a steward snoozed in an earlier run stays snoozed until that time."""
    res = detect(session, str(tid), str(vid), module)
    p = {"tid": str(tid), "vid": str(vid), "m": module}
    session.execute(text("DELETE FROM learned_monitor_breaks WHERE tenant_id = :tid AND version_id = :vid "
                         "AND module = :m AND status IN ('open', 'below_minimum')"), p)
    rows = [{**p, "k": b["kind"], "me": b["metric"], "s": b["subject_code"], "sev": b["severity"], "lo": b["low"],
             "hi": b["high"], "md": b["median"], "o": b["observed"], "n": b["baseline_runs"],
             "ids": json.dumps(b["baseline_run_ids"]), "meth": b["method"],
             "st": "below_minimum" if b["below_minimum"] else "open"} for b in res["breaks"]]
    if rows:
        session.execute(text("""
            INSERT INTO learned_monitor_breaks (tenant_id, version_id, module, kind, metric, subject_code, severity,
                expected_low, expected_high, median, observed, baseline_runs, baseline_run_ids, method, status)
            VALUES (:tid, :vid, :m, :k, :me, :s, :sev, :lo, :hi, :md, :o, :n, CAST(:ids AS jsonb), :meth, :st)
            ON CONFLICT ON CONSTRAINT uq_learned_monitor_breaks DO NOTHING"""), rows)
        session.execute(text("""
            UPDATE learned_monitor_breaks b SET status = 'snoozed', snoozed_until = s.until
              FROM (SELECT kind, subject_code, max(snoozed_until) AS until FROM learned_monitor_breaks
                     WHERE tenant_id = :tid AND module = :m AND status = 'snoozed' AND snoozed_until > now()
                     GROUP BY 1, 2) s
             WHERE b.tenant_id = :tid AND b.version_id = :vid AND b.module = :m AND b.status = 'open'
               AND b.kind = s.kind AND b.subject_code = s.subject_code"""), p)
    return sum(1 for r in rows if r["st"] == "open")


# -- explanation --------------------------------------------------------------------------------------------------------

_NUM = re.compile(r"\d+(?:\.\d+)?")
_UNIT = {"records": "", "score": " points", "fail_rate": "%", "blank_pct": "%", "distinct_pct": "%", "pattern_pct": "%",
         "unparse_pct": "%", **{m: "%" for m in NUM_RANGE}, **{m: " days" for m in DATE_RANGE}}
_RANGE_WHAT = {"num_mean": "the mean moved", "num_max": "the largest value rose", "num_min": "the smallest value fell",
               "date_max": "the latest date fell back", "date_min": "the earliest date moved back"}
_WHAT = {"volume_drop": "records checked fell", "volume_spike": "records checked rose",
         "fail_rate_jump": "the fail rate rose", "score_drop": "the score fell", "field_emptied": "the field is now empty",
         "cardinality_shift": "the share of distinct values among the filled rows moved",
         "pattern_shift": "the share of values in an unusual shape rose",
         "format_break": "the share of values that do not parse rose"}


def _f(x: Optional[float], metric: str) -> str:
    if x is None:
        return "-"
    return f"{x:,.0f}" if metric == "records" else f"{x:.1f}"


def facts(b: dict, description: Optional[str]) -> dict:
    """Everything the explanation may rest on, and everything the model is sent: kind, subject code and its text, and
    the aggregate figures. No record, no field value. Shares are shares; a range break (a field's mean, largest or
    smallest value, latest or earliest date) carries its effect size only, never a figure from the field, and a shape
    is never a fact."""
    f = {"kind": b["kind"], "metric": b["metric"], "subject": b["subject_code"] or None, "description": description,
         "observed": b["observed"], "expected_low": b["expected_low"], "expected_high": b["expected_high"],
         "median": b["median"], "baseline_runs": b["baseline_runs"], "method": b["method"]}
    if b["metric"] in RANGE:
        f.update(observed=None, expected_low=None, expected_high=None, median=None,
                 effect=effect_of(b["metric"], b["observed"], b["median"]) or None)  # None: a zero median has no relative size
    return f


def template_explanation(f: dict) -> list[str]:
    m, u = f["metric"], _UNIT[f["metric"]]
    who = f"{f['subject']} ({f['description']})" if f["subject"] and f["description"] else (f["subject"] or "The object")
    if m in RANGE:
        tail = f"The baseline is the median of {f['baseline_runs']} earlier runs{' on the same weekday' if f['method'] == 'mad_weekday' else ''}."
        size = f"by {f['effect']:.1f}{u} from its usual level" if f["effect"] else "from a usual level of zero"
        return [f"{who}: {_RANGE_WHAT[m]} {size}.", tail]
    head = (f"{who}: {_WHAT[f['kind']]} to {_f(f['observed'], m)}{u}; the usual range is {_f(f['expected_low'], m)} to "
            f"{_f(f['expected_high'], m)}{u}.")
    tail = (f"The baseline is the median of {f['baseline_runs']} earlier runs"
            f"{' on the same weekday' if f['method'] == 'mad_weekday' else ''}, {_f(f['median'], m)}{u}.")
    return [head, tail]


def verify(sentences: list[str], f: dict) -> tuple[list[str], int]:
    """(sentences whose every number is one of the figures, how many were dropped). The subject code and its text are
    removed before numbers are read."""
    vals = [f[k] for k in ("observed", "expected_low", "expected_high", "median", "effect") if f.get(k) is not None]
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
    size = f"{f['effect']:.2f}{_UNIT[f['metric']]} from its usual level" if f.get("effect") else "from a usual level of zero"
    figs = (f"The {f['metric'].replace('_', ' ')} moved {size}, over {f['baseline_runs']} earlier runs" if f["metric"] in RANGE else
            f"Observed {f['observed']:.2f}; usual range {f['expected_low']:.2f} to {f['expected_high']:.2f}; baseline "
            f"median {f['median']:.2f} over {f['baseline_runs']} earlier runs")
    prompt = (f"A learned monitor on {label} found a break from its baseline. Kind: {f['kind'].replace('_', ' ')}. "
              f"Subject: {f['subject'] or 'the whole object'} ({f['description'] or 'n/a'}). {figs}. Write at most 3 short plain sentences saying what changed and what a "
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
