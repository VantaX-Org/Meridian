"""Plain-speech commentary for the PDF reports and the analyst workbook.

Every sentence here is written from the figures the report already shows: a dimension score, a rule's
failing count, a wave's blockers. No language model is involved, so the commentary is as deterministic
as the tables it explains and can be tested sentence by sentence. The voice is a careful analyst
talking to a reader who knows the business but not the scoring: say what the number is, what it means
for the data, and what to do about it. Never promise a score change; name the work.

Every builder returns a string (possibly empty) or a list of strings. Templates print a paragraph per
non-empty string under the section it explains.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from api.services.scoring import DEFAULT_THRESHOLDS

DIMENSIONS = ("completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity")

# What a weak score in each dimension means for the records, and the work that lifts it.
DIMENSION_MEANING: dict[str, tuple[str, str]] = {
    "completeness": ("required fields have been left empty",
                     "fill the missing values at source, starting with the fields the blocking rules name"),
    "accuracy": ("stored values do not match the reference they are checked against",
                 "correct the values against the reference lists and reconcile the exceptions"),
    "consistency": ("fields disagree with each other or with related records",
                    "align the dependent fields so each record tells one story"),
    "timeliness": ("records have not been maintained recently or carry stale dates",
                   "review the records nobody has touched and retire or refresh them"),
    "uniqueness": ("the same real-world thing is recorded more than once",
                   "merge the duplicate candidates and block new ones at entry"),
    "validity": ("values fall outside the allowed set or pattern",
                 "restrict the fields to their allowed values and correct the outliers"),
}

_SEV_ORDER = ("critical", "high", "medium", "low")


def _n(v: Any, dp: int = 0) -> str:
    if v is None:
        return "—"
    return f"{float(v):,.{dp}f}"


def _plural(n: int, one: str, many: Optional[str] = None) -> str:
    return one if n == 1 else (many or one + "s")


def _short(name: Optional[str], fallback: str = "") -> str:
    """A rule's name as it reads inside a sentence: the clause before any dash or full stop, at most 70
    characters, so 'Material type is mandatory - determines procurement…' becomes 'Material type is mandatory'."""
    text = (name or fallback or "").strip()
    for sep in (" - ", " – ", " — ", ": ", ". "):
        if sep in text:
            text = text.split(sep, 1)[0]
    text = text.rstrip(".")
    return text if len(text) <= 70 else text[:67].rsplit(" ", 1)[0] + "…"


def _mod(name: str) -> str:
    from api.services.pdf_reports import fmt_module

    return fmt_module(name)


def _th(thresholds: Optional[dict]) -> dict:
    return {**DEFAULT_THRESHOLDS, **(thresholds or {})}


def score_word(score: Optional[float], thresholds: Optional[dict] = None) -> str:
    """How a score reads against the tenant's bands: ``meets the target``, ``is below the target``,
    ``is in the warning band`` or ``is failing``."""
    t = _th(thresholds)
    if score is None:
        return "has no score"
    if score >= t["target"]:
        return "meets the target"
    if score >= t["warning"]:
        return "is below the target"
    if score >= t["critical"]:
        return "is in the warning band"
    return "is failing"


def _join(parts: Iterable[str]) -> str:
    return " ".join(p.strip() for p in parts if p and p.strip())


def _oxford(items: list[str]) -> str:
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


# ── scores and dimensions ────────────────────────────────────────────────────


def overall(score: Optional[float], delta: Optional[float], thresholds: Optional[dict] = None,
            capped: bool = False, critical: int = 0) -> str:
    """The score sentence a reader needs before any table: where it sits against the bands, how it
    moved, and whether a critical cap is holding it down."""
    if score is None:
        return "No module produced a score, so there is nothing to read against the target yet."
    t = _th(thresholds)
    s = f"A score of {score:.1f} {score_word(score, t)} of {t['target']:.0f}."
    if score < t["target"]:
        s += f" It needs {t['target'] - score:.1f} more points to meet it."
    if delta is not None and delta != 0:
        s += (f" That is {abs(delta):.1f} points {'better' if delta > 0 else 'worse'} than the earlier run, "
              + ("so the work since then is paying off." if delta > 0 else "so something has slipped since then."))
    elif delta == 0:
        s += " It is unchanged from the earlier run."
    one = critical == 1
    if critical and capped:
        s += (f" {critical} critical {_plural(critical, 'check')} {'fails' if one else 'fail'} and "
              f"{'it caps' if one else 'they cap'} the score however good the rest of the data is: clearing "
              f"{'it' if one else 'them'} is the fastest way to move the number.")
    elif critical:
        s += (f" {critical} critical {_plural(critical, 'check')} {'fails' if one else 'fail'}, within the tolerance "
              "that would cap the score, but each one marks records that cannot be used until it is fixed.")
    elif capped:
        s += " A critical failure caps the score however good the rest of the data is."
    return s


def dimensions(dims: dict[str, Optional[float]], prev: Optional[dict[str, Optional[float]]] = None,
               thresholds: Optional[dict] = None) -> str:
    """Which dimension drags the score, what that means for the records, and the one that moved most."""
    measured = {d: v for d, v in dims.items() if v is not None}
    if not measured:
        return "No dimension was measured, so the score cannot be explained by dimension."
    t = _th(thresholds)
    weakest = min(measured, key=lambda d: (measured[d], d))
    strongest = max(measured, key=lambda d: (measured[d], d))
    meaning, work = DIMENSION_MEANING.get(weakest, ("records fail this dimension's checks", "fix the failing records"))
    s = f"{weakest.capitalize()} is the weakest dimension at {measured[weakest]:.1f}"
    if weakest != strongest:
        s += f" and {strongest} the strongest at {measured[strongest]:.1f}"
    s += f". A low {weakest} score means {meaning}; to lift it, {work}."
    below = [d for d in DIMENSIONS if d in measured and measured[d] < t["target"]]
    if len(below) > 1:
        s += f" {len(below)} of {len(measured)} measured dimensions sit below the {t['target']:.0f} target."
    elif not below:
        s += " Every measured dimension meets the target."
    unmeasured = [d for d in DIMENSIONS if dims.get(d) is None]
    if unmeasured:
        names = _oxford(unmeasured)
        s += (f" {names[0].upper()}{names[1:]} {'was' if len(unmeasured) == 1 else 'were'} "
              f"not measured, so no claim is made about {'it' if len(unmeasured) == 1 else 'them'}.")
    if prev:
        moves = {d: round(measured[d] - prev[d], 1) for d in measured if prev.get(d) is not None and
                 round(measured[d] - prev[d], 1) != 0}
        if moves:
            d = max(moves, key=lambda k: (abs(moves[k]), k))
            s += (f" Since the earlier run {d} moved most, {'up' if moves[d] > 0 else 'down'} "
                  f"{abs(moves[d]):.1f} points.")
    return s


# ── rules and root causes ────────────────────────────────────────────────────


def fix_first(rows: list[dict], capped: bool = False) -> str:
    """Why the ranked list starts where it does, and how concentrated the work is. ``capped`` is the
    scorer's own verdict: only then does clearing a critical failure lift anything."""
    if not rows:
        return ""
    top = rows[0]
    total_impact = sum(_impact_of(r) for r in rows) or 1
    share = _impact_of(top) / total_impact
    s = (f"The first item alone, {_short(top.get('message'), top['check_id'])} in {_mod(top['module'])}, carries "
         f"{share * 100:.0f}% of the impact in this list, with {_n(top.get('affected'))} failing records")
    if top.get("field"):
        s += f" on {top['field']}"
    s += "."
    if top.get("why"):
        s += f" {top['why'].rstrip('.')}."
    crit = sum(1 for r in rows if r.get("severity") == "critical")
    if crit:
        s += f" {crit} of the {len(rows)} {'is' if crit == 1 else 'are'} critical"
        s += (f", so fixing {'it' if crit == 1 else 'them'} also lifts the cap on the score." if capped
              else f" and {'comes' if crit == 1 else 'come'} first whatever the count.")
    s += " Work the list top down: each item is worth more than everything below it."
    return s


def _impact_of(r: dict) -> float:
    if r.get("impact") is not None:
        return float(r["impact"])
    from api.services.scoring import impact

    return float(impact(r.get("affected") or r.get("affected_count") or 0, r.get("severity")))


def severity_mix(sev: dict[str, int], checks_run: int) -> str:
    """How many checks fail at each severity and what that mix says about the data."""
    failing = sum(sev.values())
    if not failing:
        return "No check found a failing record, which is rare: confirm the run covered the tables you expected."
    s = f"{failing} of {checks_run} checks found failing records."
    worst = next((k for k in _SEV_ORDER if sev.get(k)), None)
    if worst == "critical":
        s += (f" {sev['critical']} {'is' if sev['critical'] == 1 else 'are'} critical: "
              "these are the rules that stop a record being used, and each one caps the module score.")
    elif worst == "high":
        s += " None is critical, so the score is not capped, but the high-severity failures still block readiness."
    else:
        s += " None is critical or high, so the failures degrade the data without blocking its use."
    if failing and sev.get("low", 0) + sev.get("medium", 0) > sev.get("critical", 0) + sev.get("high", 0):
        s += " Most of the failures are medium or low: real, but not the place to start."
    return s


def critical_findings(rows: list[dict]) -> str:
    if not rows:
        return "No critical check fails, so nothing in this run blocks a record outright."
    by_mod: dict[str, int] = {}
    for r in rows:
        by_mod[r["module"]] = by_mod.get(r["module"], 0) + 1
    worst = max(by_mod, key=lambda m: (by_mod[m], m))
    records = sum(int(r.get("affected") or 0) for r in rows)
    s = (f"{len(rows)} critical {_plural(len(rows), 'check')} {'fails' if len(rows) == 1 else 'fail'} "
         f"across {len(by_mod)} {_plural(len(by_mod), 'module')}, on {_n(records)} records in total.")
    if len(by_mod) > 1 and sorted(by_mod.values())[-1] > sorted(by_mod.values())[-2]:
        s += f" {_mod(worst)} carries the most, {by_mod[worst]}."
    s += " Each of these records cannot be trusted for the process it feeds until the failure is cleared."
    return s


def clusters(rows: list[dict]) -> str:
    """The root-cause view: how much of the impact one field explains."""
    if not rows:
        return ""
    total = sum(float(c.get("impact") or 0) for c in rows) or 1
    top = rows[0]
    label = f"{_mod(top['module'])} {top['field']}" if top.get("field") else f"{_mod(top['module'])} rules with no named field"
    share = float(top.get("impact") or 0) / total
    s = (f"{label} is the largest root cause, {share * 100:.0f}% of the impact across the clusters shown, "
         f"through {len(top.get('rules') or [])} {_plural(len(top.get('rules') or []), 'rule')}.")
    top3 = sum(float(c.get("impact") or 0) for c in rows[:3]) / total
    if len(rows) > 3 and top3 >= 0.6:
        s += f" The top three clusters together hold {top3 * 100:.0f}%: the problem is concentrated, which makes it fixable."
    elif len(rows) > 3:
        s += " The impact is spread across many fields, so the fix is a programme rather than one correction."
    pct = top.get("auto_fix_pct")
    if pct:
        s += f" {pct:.0f}% of the top cluster's records already have a proposed value waiting for approval."
    return s


def blockers(rows: list[dict], total: int, waves: Optional[list[dict]] = None) -> str:
    """What stands between this run and a go decision."""
    if not total:
        return "No blocking rule fails: nothing in this run stops a migration wave on data quality grounds."
    top = rows[0] if rows else None
    s = f"{total} blocking {_plural(total, 'rule')} {'fails' if total == 1 else 'fail'}."
    if top:
        s += (f" The largest is {_short(top.get('name'), top['check_id'])} in {_mod(top['module'])}, "
              f"failing on {_n(top.get('affected'))} records.")
    by_mod: dict[str, int] = {}
    for r in rows:
        by_mod[r["module"]] = by_mod.get(r["module"], 0) + 1
    if len(by_mod) == 1:
        s += f" Every blocker shown sits in {_mod(next(iter(by_mod)))}, so one team owns the whole list."
    elif by_mod and sorted(by_mod.values())[-1] > sorted(by_mod.values())[-2]:
        worst = max(by_mod, key=lambda m: (by_mod[m], m))
        s += f" {_mod(worst)} holds the most of those shown, {by_mod[worst]}."
    hit = [w["name"] for w in (waves or []) if any(m.get("blockers") for m in w.get("modules") or [])]
    if hit:
        s += f" {_oxford(hit)} cannot go until these are cleared."
    return s


def waves(rows: list[dict], thresholds: Optional[dict] = None) -> str:
    if not rows:
        return "No migration wave is planned, so readiness is reported per module only."
    t = _th(thresholds)
    out = []
    for w in rows:
        mods = w.get("modules") or []
        if not mods:
            out.append(f"{w['name']} has no scored module.")
            continue
        blocked = [m for m in mods if m.get("blockers")]
        scored = [m for m in mods if m.get("score") is not None]
        low = [m for m in scored if m["score"] < t["warning"]]
        conditional = [m for m in scored if t["warning"] <= m["score"] < t["target"]]
        if not blocked and not low and not conditional:
            out.append(f"{w['name']} is clear: no module in it has a blocking rule and every module meets "
                       f"the {t['target']:.0f} target.")
        elif not blocked and not low:
            out.append(f"{w['name']} is not blocked, but {_oxford([_mod(m['name']) for m in conditional])} "
                       f"{'scores' if len(conditional) == 1 else 'score'} below the {t['target']:.0f} target, "
                       "so it is conditional rather than ready.")
        else:
            parts = []
            if blocked:
                parts.append(f"{len(blocked)} of {len(mods)} {_plural(len(mods), 'module')} "
                             f"{'has' if len(blocked) == 1 else 'have'} blocking rules ({_oxford([_mod(m['name']) for m in blocked])})")
            if low:
                parts.append(f"{_oxford([_mod(m['name']) for m in low])} {'scores' if len(low) == 1 else 'score'} "
                             f"below {t['warning']:.0f}")
            if conditional:
                parts.append(f"{_oxford([_mod(m['name']) for m in conditional])} {'is' if len(conditional) == 1 else 'are'} "
                             f"below the {t['target']:.0f} target")
            out.append(f"{w['name']} is held back: " + "; ".join(parts) + ".")
    return " ".join(out)


# ── modules ──────────────────────────────────────────────────────────────────


def module(m: dict, thresholds: Optional[dict] = None) -> str:
    """One paragraph for one module block: score against the bands, weakest dimension, the blocking
    rule and the share of records it touches."""
    t = _th(thresholds)
    name = _mod(m["name"])
    score = m.get("score")
    if score is None:
        return f"{name} produced no score in this run."
    s = f"{name} scores {score:.1f}, which {score_word(score, t)}."
    delta = m.get("delta")
    if delta is not None and delta != 0:
        s += f" It moved {abs(delta):.1f} points {'up' if delta > 0 else 'down'} since the earlier run."
    dims = m.get("dims") or {}
    measured = {d: v for d, v in dims.items() if v is not None}
    if measured:
        weakest = min(measured, key=lambda d: (measured[d], d))
        meaning = DIMENSION_MEANING.get(weakest, ("records fail its checks", ""))[0]
        s += f" Its weakest dimension is {weakest} at {measured[weakest]:.1f}, meaning {meaning}."
    rules = m.get("rules") or []
    if rules:
        r = rules[0]
        total = int(r.get("total") or 0)
        pct = f" ({100.0 * int(r.get('affected') or 0) / total:.1f}% of its records)" if total else ""
        s += (f" The rule doing most damage is {_short(r.get('name') or r.get('message'), r['check_id'])}, "
              f"failing on {_n(r.get('affected'))} records{pct}.")
    if m.get("blockers"):
        s += (f" {m['blockers']} blocking {_plural(m['blockers'], 'rule')} "
              f"{'stops' if m['blockers'] == 1 else 'stop'} this module going live as it stands.")
    elif m.get("critical") and m.get("cap_reason"):
        s += f" {m['critical']} critical {_plural(m['critical'], 'failure')} {'caps' if m['critical'] == 1 else 'cap'} its score."
    elif m.get("critical"):
        s += (f" {m['critical']} critical {_plural(m['critical'], 'failure')} {'sits' if m['critical'] == 1 else 'sit'} "
              "within the tolerance, so the score is not capped, but those records cannot be used until fixed.")
    elif score >= t["target"]:
        s += " Nothing here blocks it; keep it there."
    return s


def modules_overview(rows: list[dict], thresholds: Optional[dict] = None) -> str:
    """The spread across modules: how many meet the target, the best and the worst."""
    scored = [m for m in rows if m.get("score") is not None]
    if not scored:
        return "No module has a score in this run."
    t = _th(thresholds)
    ok = [m for m in scored if m["score"] >= t["target"]]
    worst = min(scored, key=lambda m: (m["score"], m["name"]))
    best = max(scored, key=lambda m: (m["score"], m["name"]))
    s = (f"{len(ok)} of {len(scored)} scored {_plural(len(scored), 'module')} "
         f"{'meets' if len(ok) == 1 else 'meet'} the {t['target']:.0f} target.")
    if worst["name"] != best["name"]:
        s += (f" {_mod(worst['name'])} is the weakest at {worst['score']:.1f} and {_mod(best['name'])} the "
              f"strongest at {best['score']:.1f}, a spread of {best['score'] - worst['score']:.1f} points.")
    else:
        s += f" {_mod(worst['name'])} scores {worst['score']:.1f}."
    blocked = [m for m in scored if m.get("critical") or m.get("blockers")]
    if blocked:
        s += (f" {len(blocked)} {_plural(len(blocked), 'module')} "
              f"{'carries' if len(blocked) == 1 else 'carry'} a critical or blocking failure: "
              f"{_oxford([_mod(m['name']) for m in blocked[:4]])}{', and more' if len(blocked) > 4 else ''}.")
    unscored = len(rows) - len(scored)
    if unscored:
        s += f" {unscored} {_plural(unscored, 'module')} produced no score, usually because no data was supplied."
    return s


# ── cleansing and remediation ────────────────────────────────────────────────


def funnel(steps: list[dict]) -> str:
    """How much of the failing data has a fix, and where the pipeline stalls."""
    by = {s["key"]: int(s.get("records") or 0) for s in steps}
    failing = by.get("failing", 0)
    if not failing:
        return "No failing records, so there is nothing to cleanse."
    proposed, approved, applied = by.get("proposed", 0), by.get("approved", 0), by.get("applied", 0)
    s = f"{proposed / failing * 100:.0f}% of failing records have a proposed value."
    if proposed:
        if approved == 0:
            s += " None has been approved yet: the proposals are waiting on a steward."
        else:
            s += f" {approved / proposed * 100:.0f}% of those are approved"
            s += (f" and {applied / approved * 100:.0f}% of the approved values are applied."
                  if approved else ".")
            if approved and applied < approved:
                s += " The gap between approved and applied is the export batch still to be loaded."
    else:
        s += " Fixes have to be found by hand until a cleaning rule covers these records."
    return s


def cleaning(ctx: dict) -> str:
    total, applied = int(ctx.get("queue_total") or 0), int(ctx.get("applied") or 0)
    recon = ctx.get("recon") or {}
    if not total and not recon.get("records") and not ctx.get("record_fixes_total"):
        return ("Nothing has been proposed or corrected yet. Cleaning rules run after an analysis once they are "
                "active, and remediation batches are built from the findings with a safe correction.")
    s = f"{applied} of {total} proposals are applied, {applied / total * 100:.0f}%." if total else ""
    pending = (ctx.get("by_status") or {}).get("pending", 0)
    if pending:
        s += f" {pending} are still pending review, which is the queue a steward should clear first."
    if recon.get("records"):
        fixed, still = int(recon.get("fixed") or 0), int(recon.get("still_failing") or 0)
        checked = fixed + still
        if checked:
            s += (f" Of the corrections checked by a later run, {fixed / checked * 100:.0f}% held and "
                  f"{still} {'is' if still == 1 else 'are'} still failing"
                  + (": those need a second look at how the change reached SAP." if still else "."))
        if recon.get("unreconciled"):
            s += f" {recon['unreconciled']} corrected records have not been re-checked yet; the next run will settle them."
    return s.strip()


# ── extraction ───────────────────────────────────────────────────────────────


def extraction(ctx: dict) -> str:
    cov = ctx.get("coverage") or []
    if not cov:
        return "The run recorded no table coverage, so nothing can be said about what was read."
    live, failed, skipped = int(ctx.get("live") or 0), int(ctx.get("failed") or 0), int(ctx.get("skipped") or 0)
    s = ""
    if failed:
        names = [c["table"] for c in cov if c.get("status") == "failed"][:3]
        s += (f"{failed} {_plural(failed, 'table')} failed to read ({_oxford(names)}), so every check that "
              f"needs {'it' if failed == 1 else 'them'} was skipped and the score is built on less data than planned. ")
    partial = [c["table"] for c in cov if c.get("status") == "live" and (c.get("truncated") or c.get("partial"))]
    if partial:
        s += (f"{_oxford(partial[:3])} {'was' if len(partial) == 1 else 'were'} read in part, so counts for "
              f"{'that table' if len(partial) == 1 else 'those tables'} understate the system. ")
    if skipped:
        s += f"{skipped} {_plural(skipped, 'table')} {'is' if skipped == 1 else 'are'} not in this system and {'was' if skipped == 1 else 'were'} skipped by design. "
    if not failed and not partial:
        s += f"All {live} tables were read in full, so the scores rest on complete data. "
    if ctx.get("complete") is False:
        s += "The extraction is marked incomplete: treat this run as a preview and re-run before relying on it."
    return s.strip()


# ── comparison and trend ─────────────────────────────────────────────────────


def comparison(dims: list[dict], improvers: list[dict], regressions: list[dict], changes: dict) -> str:
    moved = [d for d in dims if d.get("change")]
    s = ""
    if moved:
        up = max(moved, key=lambda d: d["change"])
        down = min(moved, key=lambda d: d["change"])
        if up["change"] > 0:
            s += f"{up['name'].capitalize()} improved most, {up['change']:+.1f} points. "
        if down["change"] < 0:
            s += f"{down['name'].capitalize()} slipped most, {down['change']:+.1f} points. "
    if improvers:
        i = improvers[0]
        s += (f"The biggest single improvement is {_short(i.get('message'), i['check_id'])} in {_mod(i['module'])}, "
              f"{_n(abs(int(i['change'])))} fewer failing records. ")
    if regressions:
        r = regressions[0]
        s += (f"The biggest regression is {_short(r.get('message'), r['check_id'])} in {_mod(r['module'])}, "
              f"{_n(int(r['change']))} more failing records: check whether new data arrived or a fix was undone. ")
    new, fixed, persist = len(changes.get("new") or []), len(changes.get("resolved") or []), len(changes.get("persisting") or [])
    if new > fixed:
        s += f"More rules started failing ({new}) than were fixed ({fixed}); the trend is the wrong way."
    elif fixed:
        s += f"{fixed} {_plural(fixed, 'rule was', 'rules were')} fixed against {new} that started failing."
    if persist:
        s += f" {persist} {_plural(persist, 'rule')} still {'fails' if persist == 1 else 'fail'} in both runs: that is the standing backlog."
    return s.strip()


def trend_dimension(d: dict) -> str:
    values = [v for v in (d.get("values") or []) if v is not None]
    if len(values) < 2:
        return ""
    change = d.get("change") or 0
    name = d["name"].capitalize()
    lo, hi = min(values), max(values)
    if change > 0:
        s = f"{name} rose {change:.1f} points over the window, from {values[0]:.1f} to {values[-1]:.1f}."
    elif change < 0:
        s = f"{name} fell {abs(change):.1f} points over the window, from {values[0]:.1f} to {values[-1]:.1f}."
    else:
        s = f"{name} ended where it started, at {values[-1]:.1f}."
    if hi - lo > 10:
        s += f" It swung {hi - lo:.1f} points between runs, which usually means scope changed between extractions rather than the data."
    if change < 0:
        s += f" {DIMENSION_MEANING[d['name']][1].capitalize()}."
    return s


def movers(rows: list[dict]) -> str:
    if not rows:
        return ""
    up = [m for m in rows if m["change"] > 0]
    down = [m for m in rows if m["change"] < 0]
    s = f"{len(up)} {_plural(len(up), 'object')} improved and {len(down)} slipped between the first and the last run."
    if up:
        b = max(up, key=lambda m: m["change"])
        s += f" {_mod(b['module'])} gained most, {b['change']:+.1f} points."
    if down:
        w = min(down, key=lambda m: m["change"])
        s += f" {_mod(w['module'])} lost most, {w['change']:+.1f} points, and deserves the first look."
    return s


def rule_changes(new: list[dict], fixed: list[dict]) -> str:
    if not new and not fixed:
        return "No rule changed state between the first and the last run."
    s = ""
    if fixed:
        s += f"{len(fixed)} {_plural(len(fixed), 'rule')} that failed at the start of the window {'passes' if len(fixed) == 1 else 'pass'} now. "
    if new:
        worst = new[0]
        s += (f"{len(new)} {_plural(len(new), 'rule')} started failing, led by {worst['check_id']} in "
              f"{_mod(worst['module'])} on {_n(worst.get('v2'))} records. "
              "A rule that passed before and fails now points at a process change, not legacy data.")
    return s.strip()


# ── owners ───────────────────────────────────────────────────────────────────


def owner(o: dict) -> str:
    name = o.get("owner") or "This owner"
    open_n = int(o.get("open") or 0)
    if o.get("score") is None and not o.get("objects"):
        return f"{name} has no items and no objects assigned, so there is nothing to act on."
    s = ""
    if o.get("score") is not None:
        s += f"{name} holds {open_n} open {_plural(open_n, 'item')} and an owner score of {o['score']:.1f}. "
    sev = o.get("open_by_severity") or {}
    if sev.get("critical"):
        s += f"{sev['critical']} {'is' if sev['critical'] == 1 else 'are'} critical and should come first. "
    if o.get("trend") == "improved":
        s += f"The score improved {abs(o.get('delta') or 0):.1f} in the last seven days. "
    elif o.get("trend") == "slipped":
        s += f"The score slipped {abs(o.get('delta') or 0):.1f} in the last seven days: new items arrived faster than they were closed. "
    age = o.get("oldest_item_age_days")
    if age and age > 30:
        s += f"The oldest item is {age} days old, which is long enough to ask whether it is still owned. "
    blocked = int(o.get("blocked") or 0)
    if blocked:
        s += f"{blocked} of {name}'s {int(o.get('object_count') or 0)} objects {'has' if blocked == 1 else 'have'} a blocking rule."
    return s.strip()


def unassigned(rows: list[dict]) -> str:
    if not rows:
        return "Every object has an owner, so every failure already reaches a named person."
    blocked = [r for r in rows if r.get("blocking")]
    s = f"{len(rows)} {_plural(len(rows), 'object has', 'objects have')} no owner."
    if blocked:
        s += (f" {len(blocked)} of them {'carries' if len(blocked) == 1 else 'carry'} a blocking rule "
              f"({_oxford([_mod(r['module']) for r in blocked[:3]])}), so those blockers have nobody working them. "
              "Assign these first.")
    else:
        s += " None has a blocking rule, so the gap is a governance one rather than an urgent one."
    return s


# ── object report ────────────────────────────────────────────────────────────


def object_rules(rules: list[dict], fails: list[dict]) -> str:
    if not rules:
        return ""
    s = f"{len(fails)} of {len(rules)} rules found failing records."
    if fails:
        top = fails[0]
        total = int(top.get("total") or 0)
        pct = f", {100.0 * int(top.get('affected') or 0) / total:.1f}% of the records checked" if total else ""
        s += f" The worst is {_short(top.get('message'), top['check_id'])} with {_n(top.get('affected'))} failures{pct}."
        clean = len(rules) - len(fails)
        if clean:
            s += f" {clean} {_plural(clean, 'rule')} {'passes' if clean == 1 else 'pass'} on every record."
    return s


def samples(samples: list[dict]) -> str:
    if not samples:
        return ""
    return ("The sample rows below show real failing records with their values, so the people who maintain this "
            "object can see the pattern rather than a count. Masked fields stay masked.")


# ── next steps ───────────────────────────────────────────────────────────────


def next_steps(*, fix_first_rows: list[dict] = (), critical: int = 0, capped: bool = False, unmeasured: list[str] = (),
               errored: int = 0, blockers_total: int = 0, pending_proposals: int = 0,
               unowned: int = 0, score: Optional[float] = None, thresholds: Optional[dict] = None) -> list[str]:
    """Up to five actions in the order to take them, each one a sentence a manager can forward."""
    out: list[str] = []
    if fix_first_rows:
        top = fix_first_rows[0]
        out.append(f"Fix {_short(top.get('message') or top.get('name'), top['check_id'])} in {_mod(top['module'])} first: "
                   f"{_n(top.get('affected'))} records, the largest impact in the run.")
    if critical:
        out.append(f"Clear the {critical} critical {_plural(critical, 'failure')}"
                   + (" to lift the cap on the score." if capped else ": each one marks records that cannot be used."))
    if blockers_total and not critical:
        out.append(f"Work the {blockers_total} blocking {_plural(blockers_total, 'rule')} before the next readiness review.")
    if pending_proposals:
        out.append(f"Approve or reject the {_n(pending_proposals)} pending proposals so the fixes that already exist can be applied.")
    if errored:
        out.append(f"Supply the tables behind the {errored} {_plural(errored, 'check')} that could not run, "
                   "so the score covers everything it should.")
    if unowned:
        out.append(f"Assign an owner to the {unowned} {_plural(unowned, 'object')} that have none.")
    t = _th(thresholds)
    if score is not None and score < t["target"] and len(out) < 5:
        out.append(f"Re-run after the fixes above and compare: the target is {t['target']:.0f}, {t['target'] - score:.1f} points away.")
    return out[:5]
