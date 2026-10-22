"""Deterministic PDF reports: analysis run, extraction run, cleaning and fixes,
version comparison and the executive report.

Every figure comes from the database or from Python in this module — never from
an LLM. AI-written text, where a report shows any, sits in a callout labelled
as AI-generated.

Three layers, so the arithmetic is testable without a database:
  * ``load_*``   — sync loaders over a tenant-scoped Session (RLS already set);
                   return plain dicts. Async routes call them via ``run_sync``.
  * ``*_context`` — pure builders: plain dicts in, template context out.
  * ``render``   — Jinja2 + WeasyPrint, A4, shared ``_base.html`` and
                   ``assets/report.css``. Charts are inline SVG built here.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader, Undefined, select_autoescape
from markupsafe import Markup, escape
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.routes.findings import composite_dqs
from api.services.deterministic_report import compute_readiness_status
from api.services.scoring import critical_over_tolerance, impact
from api.services.report_pdf import TEMPLATE_DIR
from api.services.insights_impact import DEFAULT_CURRENCY, tenant_currency
from api.services.report_theme import PRINT_TOKENS, band_colour

DIMENSIONS = ("completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity")
SEVERITIES = ("critical", "high", "medium", "low")
_SEV_RANK = {s: i for i, s in enumerate(SEVERITIES)}
_IP = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}(?::\S+)?")

# ── formatting ───────────────────────────────────────────────────────────────


def _missing(v: Any) -> bool:
    return v is None or v == "" or isinstance(v, Undefined)


def _to_dt(v: Any) -> Optional[datetime]:
    if _missing(v):
        return None
    if isinstance(v, datetime):
        d = v
    else:
        try:
            d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def fmt_n(v: Any, dp: int = 0) -> str:
    if _missing(v):
        return "—"
    return f"{float(v):,.{dp}f}"


def fmt_pct(v: Any, dp: int = 1) -> str:
    return "—" if _missing(v) else f"{float(v):.{dp}f}%"


def fmt_signed(v: Any, dp: int = 1) -> str:
    if _missing(v):
        return "—"
    v = round(float(v), dp)
    if v == 0:
        return f"{0:.{dp}f}"
    return f"+{v:,.{dp}f}" if v > 0 else f"−{abs(v):,.{dp}f}"


_SAST = ZoneInfo("Africa/Johannesburg")


def fmt_dt(v: Any) -> str:
    d = _to_dt(v)
    return "—" if d is None else d.astimezone(_SAST).strftime("%-d %b %Y, %H:%M SAST")


_SAST = ZoneInfo("Africa/Johannesburg")


def fmt_sast(v: object) -> str:
    d = _to_dt(v)
    return "—" if d is None else d.astimezone(_SAST).strftime("%-d %b %Y, %H:%M SAST")


def fmt_dur(seconds: Any) -> str:
    if _missing(seconds):
        return "—"
    s = float(seconds)
    if s < 60:
        return f"{s:.1f} s" if s < 10 else f"{s:.0f} s"
    m, s = divmod(int(round(s)), 60)
    if m < 60:
        return f"{m} min {s:02d} s"
    h, m = divmod(m, 60)
    if h < 48:
        return f"{h} h {m:02d} min"
    return f"{h // 24} days {h % 24} h"


_UPPER = {"fi": "FI", "gl": "GL", "sd": "SD", "mm": "MM", "ewms": "eWMS", "grc": "GRC", "mdg": "MDG",
          "wm": "WM", "btp": "BTP", "hr": "HR", "id": "ID"}


def fmt_module(v: Any) -> str:
    """'fi_gl' -> 'FI GL', 'business_partner' -> 'Business partner' (sentence case)."""
    words = [_UPPER.get(w, w) for w in str(v or "").replace("_", " ").split()]
    s = " ".join(words)
    return s[:1].upper() + s[1:]


def css_str(v: Any) -> Markup:
    """Quote a value as a CSS string for @page margin boxes."""
    s = str(v).replace("\\", "\\\\").replace('"', '\\"').replace("<", "\\3c ").replace("\n", " ")
    return Markup(f'"{s}"')


def status_class(status: Optional[str]) -> str:
    return {"go": "ok", "conditional": "warn", "no-go": "bad", "live": "ok", "complete": "ok",
            "fixed": "ok", "failed": "bad", "still_failing": "bad", "critical": "bad",
            "high": "bad", "medium": "warn", "low": "na",
            "at_risk": "warn", "no_go": "bad"}.get(str(status or ""), "na")


def redact(v: Any) -> str:
    """Connector errors can quote the server address; the PDF never carries it."""
    return _IP.sub("[server]", str(v or ""))


@lru_cache(maxsize=1)
def _env() -> Environment:
    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=select_autoescape(["html"]),
                      trim_blocks=True, lstrip_blocks=True)
    env.globals.update(tokens=PRINT_TOKENS, band_colour=band_colour)
    env.filters.update(n=fmt_n, pct=fmt_pct, signed=fmt_signed, dt=fmt_dt, dur=fmt_dur,
                       module=fmt_module, st=status_class, redact=redact,
                       css_str=css_str, sast=fmt_sast)
    return env


def render(template: str, ctx: dict) -> bytes:
    """Render one report template to PDF bytes."""
    from weasyprint import HTML  # lazy: native libs

    html = _env().get_template(template).render(**ctx)
    return HTML(string=html, base_url=TEMPLATE_DIR).write_pdf()


# ── inline SVG charts (no JS) ────────────────────────────────────────────────

_ACCENT, _TRACK, _INK, _MUTED = (PRINT_TOKENS[k] for k in ("accent_fill", "ring_track", "ink", "ink_3"))
_UP, _DOWN = PRINT_TOKENS["ok_fill"], PRINT_TOKENS["bad_fill"]
_HIGH, _MED = PRINT_TOKENS["high"], PRINT_TOKENS["warn"]


def hbars(rows: Iterable[tuple[str, Optional[float]]], maximum: float = 100.0, unit: str = "",
          dp: int = 1) -> Markup:
    """Horizontal bars on a 0..maximum scale. ``None`` renders as 'Not measured'."""
    rows = list(rows)
    w, lw, vw, rh = 640, 150, 80, 20
    bw = w - lw - vw
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {rh * len(rows) + 4}" '
           f'font-family="Instrument Sans" font-size="11">']
    for i, (label, value) in enumerate(rows):
        y = i * rh + 4
        out.append(f'<text x="0" y="{y + 11}" fill="{_INK}">{escape(label)}</text>')
        out.append(f'<rect x="{lw}" y="{y + 2}" width="{bw}" height="11" fill="{_TRACK}"/>')
        if value is None:
            out.append(f'<text x="{w}" y="{y + 11}" text-anchor="end" fill="{_MUTED}">Not measured</text>')
            continue
        frac = max(0.0, min(1.0, float(value) / maximum)) if maximum else 0.0
        out.append(f'<rect x="{lw}" y="{y + 2}" width="{bw * frac:.1f}" height="11" fill="{_ACCENT}"/>')
        out.append(f'<text x="{w}" y="{y + 11}" text-anchor="end" fill="{_INK}" font-weight="600">'
                   f'{fmt_n(value, dp)}{escape(unit)}</text>')
    out.append("</svg>")
    return Markup("".join(out))


def delta_bars(rows: Iterable[tuple[str, Optional[float]]], unit: str = " pts") -> Markup:
    """Diverging bars around zero: improvement right (success), decline left (danger)."""
    rows = list(rows)
    w, lw, vw, rh = 640, 150, 80, 20
    bw = w - lw - vw
    mid = lw + bw / 2
    scale = max([abs(v) for _, v in rows if v is not None] + [1.0])
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {rh * len(rows) + 4}" '
           f'font-family="Instrument Sans" font-size="11">',
           f'<line x1="{mid}" y1="0" x2="{mid}" y2="{rh * len(rows) + 4}" stroke="{_MUTED}" stroke-width="0.75"/>']
    for i, (label, v) in enumerate(rows):
        y = i * rh + 4
        out.append(f'<text x="0" y="{y + 11}" fill="{_INK}">{escape(label)}</text>')
        if v is None:
            out.append(f'<text x="{w}" y="{y + 11}" text-anchor="end" fill="{_MUTED}">Not comparable</text>')
            continue
        half = (bw / 2 - 2) * abs(v) / scale
        x = mid if v >= 0 else mid - half
        out.append(f'<rect x="{x:.1f}" y="{y + 2}" width="{half:.1f}" height="11" '
                   f'fill="{_UP if v >= 0 else _DOWN}"/>')
        out.append(f'<text x="{w}" y="{y + 11}" text-anchor="end" fill="{_INK}" font-weight="600">'
                   f'{fmt_signed(v)}{escape(unit)}</text>')
    out.append("</svg>")
    return Markup("".join(out))


def trend_line(points: Iterable[tuple[str, Optional[float]]], threshold: Optional[float] = None) -> Markup:
    """Score over runs, oldest first, on a 0..100 scale with a dashed target line. A run with no
    score leaves a gap. The last point takes the score band colour."""
    pts = list(points)
    w, h, pl, pr, pt, pb = 640, 150, 28, 12, 10, 22
    iw, ih = w - pl - pr, h - pt - pb
    x = lambda i: pl + (iw * i / (len(pts) - 1) if len(pts) > 1 else iw / 2)  # noqa: E731
    y = lambda v: pt + ih * (1 - max(0.0, min(100.0, float(v))) / 100.0)  # noqa: E731
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="Instrument Sans" font-size="9">']
    for g in (0, 50, 100):
        out.append(f'<line x1="{pl}" y1="{y(g):.1f}" x2="{w - pr}" y2="{y(g):.1f}" stroke="{_TRACK}" stroke-width="0.75"/>'
                   f'<text x="{pl - 4}" y="{y(g) + 3:.1f}" text-anchor="end" fill="{_MUTED}">{g}</text>')
    if threshold is not None:
        out.append(f'<line x1="{pl}" y1="{y(threshold):.1f}" x2="{w - pr}" y2="{y(threshold):.1f}" stroke="{_MUTED}" '
                   f'stroke-width="0.75" stroke-dasharray="4 3"/>'
                   f'<text x="{w - pr}" y="{y(threshold) - 3:.1f}" text-anchor="end" fill="{_MUTED}">Target {fmt_n(threshold)}</text>')
    seg: list[str] = []
    done = [(i, v) for i, (_, v) in enumerate(pts) if v is not None]
    for i, v in done:
        seg.append(f"{x(i):.1f},{y(v):.1f}")
    if len(seg) > 1:
        out.append(f'<polyline points="{" ".join(seg)}" fill="none" stroke="{_ACCENT}" stroke-width="1.5"/>')
    for i, v in done:
        last = i == done[-1][0]
        out.append(f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="{3.2 if last else 2.2}" '
                   f'fill="{band_colour(v) if last else _ACCENT}"/>')
    if done:
        i, v = done[-1]
        out.append(f'<text x="{x(i):.1f}" y="{y(v) - 6:.1f}" text-anchor="end" fill="{_INK}" font-weight="600">{fmt_n(v, 1)}</text>')
    for i in sorted({0, len(pts) - 1}) if pts else []:
        out.append(f'<text x="{x(i):.1f}" y="{h - 6}" text-anchor="{"start" if i == 0 and len(pts) > 1 else "end"}" '
                   f'fill="{_MUTED}">{escape(str(pts[i][0] or "")[:18])}</text>')
    out.append("</svg>")
    return Markup("".join(out))


def funnel_bars(steps: Iterable[tuple[str, int]]) -> Markup:
    """Counts that can only shrink down a pipeline, each bar scaled to the first step."""
    rows = list(steps)
    w, lw, vw, rh = 640, 150, 80, 22
    bw = w - lw - vw
    top = max([n for _, n in rows] + [1])
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {rh * len(rows) + 4}" '
           f'font-family="Instrument Sans" font-size="11">']
    for i, (label, n) in enumerate(rows):
        y = i * rh + 4
        out.append(f'<text x="0" y="{y + 12}" fill="{_INK}">{escape(label)}</text>'
                   f'<rect x="{lw}" y="{y + 2}" width="{bw}" height="13" fill="{_TRACK}"/>'
                   f'<rect x="{lw}" y="{y + 2}" width="{bw * n / top:.1f}" height="13" fill="{_ACCENT}"/>'
                   f'<text x="{w}" y="{y + 12}" text-anchor="end" fill="{_INK}" font-weight="600">{fmt_n(n)}</text>')
    out.append("</svg>")
    return Markup("".join(out))


# ── shared pure helpers ──────────────────────────────────────────────────────


def _first_sentence(s: str) -> str:
    return s.split(". ", 1)[0].rstrip(".") + "."


@lru_cache(maxsize=1)
def _rules() -> dict[str, dict]:
    """check_id -> {message, field, why} from the YAML rule catalogue."""
    from api.services.tenant_seed import rule_catalogue

    out = {}
    for r in rule_catalogue():
        cond = (json.loads(r.get("conditions") or "[]") or [{}])[0]
        msg = r["name"].split(": ", 1)[1] if ": " in r["name"] else r["name"]
        out[r["rid"]] = {"message": msg, "field": cond.get("field"),
                         "why": _first_sentence(r["description"]) if r["description"] != msg else None}
    return out


def _rule(check_id: str) -> dict:
    try:
        return _rules().get(check_id) or {}
    except Exception:  # catalogue unreadable: the report still renders with ids only
        return {}


@lru_cache(maxsize=1)
def _modules() -> frozenset[str]:
    """Every module the rule catalogue knows about, for the object report's 404 on an unknown module."""
    from api.services.tenant_seed import rule_catalogue

    return frozenset(r["module"] for r in rule_catalogue())


def failing(f: dict) -> bool:
    return not (f.get("details") or {}).get("error") and (f.get("affected_count") or 0) > 0


def errored(f: dict) -> bool:
    return bool((f.get("details") or {}).get("error"))


def dimension_scores(summary: dict) -> dict[str, Optional[float]]:
    """Check-weighted dimension scores across modules; a dimension no check
    measured is ``None`` (the scorer reports such dimensions as 100)."""
    out: dict[str, Optional[float]] = {}
    for d in DIMENSIONS:
        num = den = 0.0
        for r in (summary or {}).values():
            if not isinstance(r, dict) or d not in (r.get("dimension_scores") or {}):
                continue
            cov = (r.get("dimension_coverage") or {}).get(d)
            n = float(cov) if cov is not None else float(max(1, r.get("total_checks") or 1))
            if n:
                num += r["dimension_scores"][d] * n
                den += n
        out[d] = round(num / den, 1) if den else None
    return out


def overall_readiness(statuses: Iterable[str]) -> str:
    s = list(statuses)
    if not s or "no-go" in s:
        return "no-go"
    return "conditional" if "conditional" in s else "go"


def _rows_checked(findings: list[dict]) -> dict[str, int]:
    """Records in scope per module: the largest record count any check saw."""
    out: dict[str, int] = {}
    for f in findings:
        out[f["module"]] = max(out.get(f["module"], 0), int(f.get("total_count") or 0))
    return out


def _sorted_fails(findings: list[dict]) -> list[dict]:
    """Failing checks, worst first: severity, then affected count, then id.
    Shared by analysis/executive (current run) and comparison (later run)."""
    return sorted((_check_row(f) for f in findings if failing(f)),
                  key=lambda f: (_SEV_RANK.get(f.get("severity"), 9), -f["affected"], f["check_id"]))


def _quality_chart(dims: dict[str, Optional[float]]) -> Optional[Markup]:
    if not any(v is not None for v in dims.values()):
        return None
    return hbars([(fmt_module(d), dims[d]) for d in DIMENSIONS])


def _check_row(f: dict) -> dict:
    r = _rule(f["check_id"])
    total = int(f.get("total_count") or 0)
    affected = int(f.get("affected_count") or 0)
    return {**f, "message": r.get("message") or f.get("message") or "", "field": r.get("field") or f.get("field"),
            "why": r.get("why"), "affected": affected, "total": total,
            "fail_pct": round(100.0 * affected / total, 1) if total else None}


def _scope_label(tenant_name: str, system: Optional[dict]) -> str:
    return f"{tenant_name} – {system['name']}" if system else f"{tenant_name} – Uploaded data"


def _system_line(system: Optional[dict]) -> str:
    if not system:
        return "Uploaded file (no connected system)"
    return f"{system['name']} ({str(system.get('system_type') or '').upper()}, {system.get('environment') or '—'})"


def _now(generated_at: Optional[datetime]) -> datetime:
    return generated_at or datetime.now(timezone.utc)


# ── analysis run ─────────────────────────────────────────────────────────────


def methodology_block(scoring: dict) -> dict:
    """The scoring parameters the methodology page prints, from the tenant's current config."""
    from api.services.scoring import SEV_WEIGHT, scoring_config

    c = scoring_config(scoring)
    return {"weights": c["dimension_weights"], "thresholds": c["thresholds"],
            "severity_weights": c["severity_weights"], "impact_weights": SEV_WEIGHT,
            "tolerance": c["critical_tolerance"]}


def analysis_context(version: dict, findings: list[dict], *, tenant_name: str, scoring: dict,
                     system: Optional[dict] = None, generated_at: Optional[datetime] = None,
                     previous_dqs: Optional[float] = None) -> dict:
    summary = version.get("dqs_summary") or {}
    meta = version.get("metadata") or {}
    overall = composite_dqs([summary], scoring=scoring)
    dims = dimension_scores(summary)
    checked = _rows_checked(findings)

    modules = []
    for mod in sorted(summary):
        r = summary[mod] or {}
        score = r.get("composite_score")
        status = compute_readiness_status(score, critical_over_tolerance(r), overall.get("thresholds")) if score is not None else None
        mf = [f for f in findings if f["module"] == mod]
        modules.append({"name": mod, "score": score, "status": status,
                        "checks": int(r.get("total_checks") or len(mf)),
                        "passing": r.get("passing_checks"),
                        "failing": sum(1 for f in mf if failing(f)),
                        "errored": sum(1 for f in mf if errored(f)),
                        "critical": sum(1 for f in mf if failing(f) and f.get("severity") == "critical"),
                        "high": sum(1 for f in mf if failing(f) and f.get("severity") == "high"),
                        "records": checked.get(mod), "cap_reason": r.get("cap_reason")})
    modules.sort(key=lambda m: (m["score"] is None, m["score"] if m["score"] is not None else 0))

    fails = _sorted_fails(findings)
    sev = {s: sum(1 for f in fails if f.get("severity") == s) for s in SEVERITIES}
    fix_first = sorted(fails, key=lambda f: (-impact(f["affected"], f.get("severity")), f["check_id"]))[:5]
    readiness = overall_readiness(m["status"] for m in modules if m["status"])
    ran = [f for f in findings if not errored(f)]
    errs = [_check_row(f) for f in findings if errored(f)]

    if overall["composite"] is None:
        headline = "No module produced a score in this run, so there is no data quality score to report."
    else:
        headline = (f"This run scored {overall['composite']:.1f} out of 100 across {len(modules)} "
                    f"module{'s' if len(modules) != 1 else ''}. {len(fails)} of {len(ran)} checks found failing "
                    f"records, {sev['critical']} of them critical.")
        if sev["critical"]:
            headline += " Critical failures cap the score and block migration until they are fixed."
        if errs:
            headline += (f" {len(errs)} check{'s' if len(errs) != 1 else ''} could not be evaluated "
                         f"and {'are' if len(errs) != 1 else 'is'} excluded from the score.")

    now = _now(generated_at)
    dim_chart = _quality_chart(dims)
    previous = ({"composite": previous_dqs, "delta": round(overall["composite"] - previous_dqs, 1)}
                if previous_dqs is not None and overall["composite"] is not None else None)
    return {
        "title": "Analysis run report", "eyebrow": "Data quality assessment", "cover": True,
        "scope_label": _scope_label(tenant_name, system), "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Organisation", tenant_name), ("System", _system_line(system)),
                 ("Run", version.get("label") or str(version["id"])), ("Run ID", str(version["id"])),
                 ("Run at", fmt_dt(version.get("run_at"))), ("Generated", fmt_dt(now)),
                 ("Modules", ", ".join(fmt_module(m) for m in sorted(summary)) or "—")],
        "version": version, "source": meta.get("source") or "upload",
        "overall": overall, "dims": dims, "readiness": readiness,
        "dim_chart": dim_chart, "quality_chart": dim_chart, "previous_dqs": previous,
        "module_chart": hbars([(fmt_module(m["name"]), m["score"]) for m in modules]),
        "modules": modules, "sev": sev, "checks_run": len(ran), "checks_failing": len(fails),
        "failing_checks": fails[:30], "failing_more": max(0, len(fails) - 30),
        "top_findings": fails[:15],
        "critical": [f for f in fails if f.get("severity") == "critical"],
        "fix_first": fix_first, "errored": errs, "headline": headline,
        "methodology": methodology_block(scoring),
    }


# ── extraction run ───────────────────────────────────────────────────────────


def _extraction_issues(coverage: list[dict]) -> list[dict]:
    out = []
    for c in coverage:
        t, st = c.get("table"), c.get("status")
        if st == "failed":
            out.append({"level": "Error", "table": t, "text": f"Read failed: {redact(c.get('detail')) or 'no detail'}"})
        elif st == "not_in_system":
            out.append({"level": "Warning", "table": t,
                        "text": "Not available in this system; checks that need it were skipped."})
        elif st == "no_rule_mapping":
            out.append({"level": "Warning", "table": t, "text": redact(c.get("detail"))})
        elif st == "live":
            if c.get("truncated"):
                out.append({"level": "Warning", "table": t,
                            "text": f"Stopped at {fmt_n(c.get('rows'))} rows (row limit reached); "
                                    "the remaining rows were not read."})
            src = c.get("source_rows")
            if src is not None and src != c.get("rows") and not c.get("truncated"):
                out.append({"level": "Warning", "table": t,
                            "text": f"Read {fmt_n(c.get('rows'))} of {fmt_n(src)} rows that SAP reports."})
            if c.get("duplicate_keys"):
                out.append({"level": "Warning", "table": t,
                            "text": f"{fmt_n(c['duplicate_keys'])} key values repeat after de-duplication; "
                                    "the paged read may be inconsistent."})
    return out


def extraction_context(version: dict, *, tenant_name: str, scoring: dict, system: Optional[dict] = None,
                       sync_run: Optional[dict] = None, generated_at: Optional[datetime] = None) -> dict:
    meta = version.get("metadata") or {}
    now = _now(generated_at)
    summary_dims = dimension_scores(version.get("dqs_summary") or {})
    coverage = sorted(meta.get("coverage") or [],
                      key=lambda c: ({"failed": 0, "live": 1}.get(c.get("status"), 2), str(c.get("table"))))
    live = [c for c in coverage if c.get("status") == "live"]
    timed = [c["seconds"] for c in coverage if c.get("seconds") is not None]
    started, finished = _to_dt(meta.get("started_at")), _to_dt(meta.get("downloaded_at"))
    if sync_run:
        started = started or _to_dt(sync_run.get("started_at"))
        finished = finished or _to_dt(sync_run.get("completed_at"))
    age = (now - finished).total_seconds() if finished else None
    scope = meta.get("scope") or {}
    issues = _extraction_issues(coverage)
    rows = meta.get("row_count")
    if rows is None and sync_run:
        rows = sync_run.get("rows_extracted")
    object_rows = meta.get("object_rows") or {}

    return {
        "title": "Extraction run report", "eyebrow": "Data extraction", "cover": True,
        "scope_label": _scope_label(tenant_name, system), "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Organisation", tenant_name), ("System", _system_line(system)),
                 ("Run", version.get("label") or str(version["id"])), ("Run ID", str(version["id"])),
                 ("Downloaded", fmt_dt(finished)), ("Status", version.get("status") or "—"),
                 ("Generated", fmt_dt(now))],
        "overall": composite_dqs([version.get("dqs_summary") or {}], scoring=scoring),
        "quality_chart": _quality_chart(summary_dims), "previous_dqs": None, "top_findings": [],
        "modules": [{"name": m, "records": object_rows.get(m)} for m in (meta.get("modules") or [])],
        "coverage": coverage, "live": len(live),
        "failed": sum(1 for c in coverage if c.get("status") == "failed"),
        "skipped": sum(1 for c in coverage if c.get("status") not in ("live", "failed")),
        "rows": rows, "complete": meta.get("extraction_complete"),
        "duration": (finished - started).total_seconds() if started and finished else None,
        "table_seconds": sum(timed) if timed else None, "timed": bool(timed),
        "started_at": started, "finished_at": finished, "age": age,
        "scope": [(k, ", ".join(map(str, v)) if isinstance(v, list) else v) for k, v in scope.items() if v],
        "issues": issues, "errors": sum(1 for i in issues if i["level"] == "Error"),
        "warnings": sum(1 for i in issues if i["level"] == "Warning"),
        "sync_run": sync_run, "is_extraction": meta.get("source") == "extraction" or bool(sync_run),
        "chart": hbars([(c["table"], float(c.get("rows") or 0))
                        for c in sorted(live, key=lambda c: -float(c.get("rows") or 0))[:14]],
                       maximum=max([float(c.get("rows") or 0) for c in live] + [1.0]), dp=0) if live else None,
    }


# ── cleaning and fixes ───────────────────────────────────────────────────────


def cleaning_context(data: dict, *, tenant_name: str, scoring: dict, version: Optional[dict] = None,
                     generated_at: Optional[datetime] = None) -> dict:
    queue = data.get("queue") or []
    by_status: dict[str, int] = {}
    for r in queue:
        by_status[r["status"]] = by_status.get(r["status"], 0) + int(r["n"])
    objects = sorted({r["object_type"] for r in queue})
    matrix = []
    for o in objects:
        row = {st: sum(int(r["n"]) for r in queue if r["object_type"] == o and r["status"] == st) for st in by_status}
        matrix.append({"object_type": o, **row, "total": sum(row.values())})
    batches = data.get("batches")
    recon = {k: sum(int(b.get(k) or 0) for b in batches or []) for k in ("records", "fixed", "still_failing")}
    recon["unreconciled"] = recon["records"] - recon["fixed"] - recon["still_failing"]
    fixes = data.get("record_fixes") or []
    scope = "This run only" if version else "All runs for this organisation"
    now = _now(generated_at)
    cleaning_dims = dimension_scores((version or {}).get("dqs_summary") or {})
    return {
        "overall": composite_dqs([(version or {}).get("dqs_summary") or {}], scoring=scoring),
        "quality_chart": _quality_chart(cleaning_dims), "previous_dqs": None, "top_findings": [],
        "title": "Cleaning and fixes report", "eyebrow": "Data cleaning and remediation", "cover": True,
        "scope_label": f"{tenant_name} – {'Run ' + (version.get('label') or str(version['id'])) if version else 'All runs'}",
        "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Organisation", tenant_name), ("Scope", scope)]
                + ([("Run", version.get("label") or str(version["id"])), ("Run ID", str(version["id"]))]
                   if version else [])
                + [("Generated", fmt_dt(now))],
        "statuses": list(by_status), "by_status": by_status, "matrix": matrix,
        "queue_total": sum(by_status.values()), "applied": by_status.get("applied", 0),
        "audit": data.get("audit") or [], "rules_applied": data.get("rules_applied") or [],
        "dedup": data.get("dedup") or {}, "batches": batches,
        "batches_reason": data.get("batches_reason"), "recon": recon,
        "proposals": data.get("proposals") or [], "proposal_samples": data.get("proposal_samples") or [],
        "proposal_source": data.get("proposal_source"),
        "record_fixes": fixes, "record_fixes_total": sum(int(r["n"]) for r in fixes),
    }


# ── version comparison ───────────────────────────────────────────────────────


def module_deltas(summary1: dict, summary2: dict) -> dict:
    """Per-module DQS and dimension deltas (v2 − v1). Shared with /versions/compare."""
    delta = {}
    for mod in sorted(set(summary1 or {}) | set(summary2 or {})):
        s1, s2 = (summary1 or {}).get(mod) or {}, (summary2 or {}).get(mod) or {}
        score1, score2 = s1.get("composite_score"), s2.get("composite_score")
        if score1 is None or score2 is None:
            continue  # absent from a run, or ran but not measured: nothing to compare
        d1, d2 = s1.get("dimension_scores") or {}, s2.get("dimension_scores") or {}
        delta[mod] = {
            "dqs_change": round(score2 - score1, 2), "v1_score": score1, "v2_score": score2,
            "dimensions": {dim: {"v1": d1.get(dim), "v2": d2.get(dim),
                                 "change": None if d1.get(dim) is None or d2.get(dim) is None
                                 else round(d2[dim] - d1[dim], 2)}
                           for dim in sorted(set(d1) | set(d2))},
        }
    return delta


def check_changes(findings1: list[dict], findings2: list[dict]) -> dict:
    """Classify each check by its state in both runs. Only checks that ran
    cleanly in both runs are compared; the rest are listed as not comparable."""
    a = {f["check_id"]: f for f in findings1}
    b = {f["check_id"]: f for f in findings2}
    out: dict[str, list[dict]] = {"new": [], "resolved": [], "persisting": [], "not_comparable": []}
    for cid in sorted(set(a) | set(b)):
        f1, f2 = a.get(cid), b.get(cid)
        ref = f2 or f1
        row = {"check_id": cid, "module": ref["module"], "severity": ref.get("severity"),
               "message": _rule(cid).get("message") or "",
               "v1": int(f1["affected_count"] or 0) if f1 else None,
               "v2": int(f2["affected_count"] or 0) if f2 else None}
        if not f1 or not f2 or errored(f1) or errored(f2):
            row["reason"] = ("Not run in the earlier run" if not f1 else "Not run in the later run" if not f2
                             else "Could not be evaluated in one of the runs")
            out["not_comparable"].append(row)
            continue
        row["change"] = row["v2"] - row["v1"]
        if failing(f2) and not failing(f1):
            out["new"].append(row)
        elif failing(f1) and not failing(f2):
            out["resolved"].append(row)
        elif failing(f1) and failing(f2):
            out["persisting"].append(row)
    for k in ("new", "resolved", "persisting"):
        out[k].sort(key=lambda r: (_SEV_RANK.get(r["severity"], 9), -abs(r["change"]), r["check_id"]))
    return out


def comparison_context(v1: dict, v2: dict, findings1: list[dict], findings2: list[dict], *,
                       record_diff: Optional[list[dict]], tenant_name: str, scoring: dict,
                       system: Optional[dict] = None, generated_at: Optional[datetime] = None) -> dict:
    s1, s2 = v1.get("dqs_summary") or {}, v2.get("dqs_summary") or {}
    o1, o2 = composite_dqs([s1], scoring=scoring), composite_dqs([s2], scoring=scoring)
    d1, d2 = dimension_scores(s1), dimension_scores(s2)
    dims = [{"name": d, "v1": d1[d], "v2": d2[d],
             "change": None if d1[d] is None or d2[d] is None else round(d2[d] - d1[d], 1)} for d in DIMENSIONS]
    deltas = module_deltas(s1, s2)
    modules = [{"name": m, "v1": (s1.get(m) or {}).get("composite_score"),
                "v2": (s2.get(m) or {}).get("composite_score"),
                "change": deltas[m]["dqs_change"] if m in deltas else None}
               for m in sorted(set(s1) | set(s2))]
    changes = check_changes(findings1, findings2)
    comparable = [m for m in modules if m["change"] is not None]

    rc1, rc2 = _rows_checked(findings1), _rows_checked(findings2)
    or1, or2 = (v1.get("metadata") or {}).get("object_rows") or {}, (v2.get("metadata") or {}).get("object_rows") or {}
    records = []
    for m in sorted(set(rc1) | set(rc2) | set(or1) | set(or2)):
        a, b = or1.get(m, rc1.get(m)), or2.get(m, rc2.get(m))
        records.append({"name": m, "v1": a, "v2": b, "change": None if a is None or b is None else b - a})
    rows1, rows2 = (v1.get("metadata") or {}).get("row_count"), (v2.get("metadata") or {}).get("row_count")

    rec = None
    if record_diff:
        ok = [r for r in record_diff if r.get("comparable")]
        rec = {"totals": {k: sum(int(r[k]) for r in ok) for k in ("new", "resolved", "persisting")},
               "checks": sorted(ok, key=lambda r: (-int(r["new"]), -int(r["resolved"]), r["check_id"]))[:15],
               "excluded": len(record_diff) - len(ok)}

    persisting = changes["persisting"]
    check_moves = changes["new"] + changes["resolved"] + persisting
    change = None if o1["composite"] is None or o2["composite"] is None else round(o2["composite"] - o1["composite"], 1)
    fails2 = _sorted_fails(findings2)
    previous_dqs = {"composite": o1["composite"], "delta": change} if change is not None else None
    if change is None:
        headline = "One of the two runs has no score, so the overall score cannot be compared."
    else:
        word = "rose" if change > 0 else "fell" if change < 0 else "did not change"
        headline = (f"The data quality score {word}"
                    + (f" by {abs(change):.1f} points, from {o1['composite']:.1f} to {o2['composite']:.1f}."
                       if change else f" ({o2['composite']:.1f}).")
                    + f" {len(changes['resolved'])} check{'s' if len(changes['resolved']) != 1 else ''} stopped failing"
                    + f" and {len(changes['new'])} started failing; {len(persisting)} still fail.")
    now = _now(generated_at)
    return {
        "title": "Run comparison report", "eyebrow": "Version comparison", "cover": True,
        "scope_label": _scope_label(tenant_name, system), "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Organisation", tenant_name), ("System", _system_line(system)),
                 ("Earlier run", f"{v1.get('label') or v1['id']} — {fmt_dt(v1.get('run_at'))}"),
                 ("Later run", f"{v2.get('label') or v2['id']} — {fmt_dt(v2.get('run_at'))}"),
                 ("Run IDs", f"{v1['id']} → {v2['id']}"), ("Generated", fmt_dt(now))],
        "v1": v1, "v2": v2, "o1": o1, "o2": o2, "change": change, "headline": headline,
        "overall": o2, "previous_dqs": previous_dqs, "top_findings": fails2[:15],
        "quality_chart": _quality_chart({d["name"]: d["v2"] for d in dims}),
        "dims": dims, "dim_chart": delta_bars([(fmt_module(d["name"]), d["change"]) for d in dims]),
        "modules": sorted(modules, key=lambda m: (m["change"] is None, m["change"] or 0)),
        "module_chart": delta_bars([(fmt_module(m["name"]), m["change"]) for m in
                                    sorted(comparable, key=lambda m: m["change"])][:14]) if comparable else None,
        "changes": changes, "rec": rec, "records": records, "rows1": rows1, "rows2": rows2,
        "improvers": sorted([c for c in check_moves if c["change"] < 0], key=lambda c: c["change"])[:5],
        "regressions": sorted([c for c in check_moves if c["change"] > 0], key=lambda c: -c["change"])[:5],
        "best_module": max(comparable, key=lambda m: m["change"]) if comparable else None,
        "worst_module": min(comparable, key=lambda m: m["change"]) if comparable else None,
    }


# ── executive ────────────────────────────────────────────────────────────────

_CANNED = "Data quality assessment complete. Review the detailed findings below for remediation priorities."


def executive_context(report_json: dict, supplementary: dict, version: dict, findings: list[dict], *,
                      tenant_name: str, scoring: dict, system: Optional[dict] = None,
                      generated_at: Optional[datetime] = None, previous_dqs: Optional[float] = None,
                      currency: str = DEFAULT_CURRENCY) -> dict:
    ctx = analysis_context(version, findings, tenant_name=tenant_name, scoring=scoring, system=system,
                           generated_at=generated_at, previous_dqs=previous_dqs)
    ai = report_json.get("ai_executive_summary")
    if not ai and "ai_executive_summary" not in report_json:  # agent-written report: summary is LLM text
        ai = report_json.get("executive_summary")
    ai = None if not ai or str(ai).strip() == _CANNED else str(ai).strip()
    return {**ctx, "title": "Executive data quality report", "eyebrow": "Executive summary",
            "ai_summary": ai, "report": report_json, "currency": currency, **supplementary}


# ── board report (one run, optional comparison run) ───────────────────────────

_GROUP_LABEL = {"ecc": "ECC", "successfactors": "SuccessFactors", "warehouse": "Warehouse"}
BOARD_MODULE_MAX = 29
BOARD_RULE_APPENDIX = 40


def board_context(data: dict, *, tenant_name: str, scoring: dict, ai_summary: Optional[str] = None,
                  generated_at: Optional[datetime] = None, app_version: str = "") -> dict:
    """Pure builder over ``insights_aggregate.gather`` output. Impact is shown per L1 and never
    summed across L1s."""
    from api.services import insights_aggregate as agg
    from api.services import s4_readiness
    from api.services.insights_impact import by_l1
    from api.services.scoring import scoring_config

    v, prev = data["version"], data["previous"]
    summary, findings = v.get("dqs_summary") or {}, data["findings"]
    cfg = scoring_config(scoring)
    ov = data["overview"]
    overall = composite_dqs([summary], scoring=scoring)
    now = _now(generated_at)
    dims = dimension_scores(summary)
    prev_summary = (prev or {}).get("dqs_summary") or {}
    prev_dims = dimension_scores(prev_summary) if prev else {}
    deltas = module_deltas(prev_summary, summary) if prev else {}
    rules = agg.rule_rows(findings, data["previous_findings"] if prev else None, data["fixes_by_check"])
    blockers = sorted((r for r in rules if r["severity"] == "critical" or r["s4"] == "blocking"),
                      key=lambda r: (-r["impact"], r["check_id"]))
    roll = s4_readiness.rollup(findings)
    areas = [a for a in roll["areas"] if a["evaluated"]]
    top_impact = max([c["impact"] for c in data["clusters"][:5]] + [1])

    dim_rows = [{"name": d, "score": dims[d], "previous": prev_dims.get(d),
                 "delta": None if not prev or dims[d] is None or prev_dims.get(d) is None
                 else round(dims[d] - prev_dims[d], 1)} for d in DIMENSIONS]
    hbars_delta = None
    if prev and deltas:
        moved = sorted(((fmt_module(m), d["dqs_change"]) for m, d in deltas.items()),
                       key=lambda kv: (-abs(kv[1] or 0), kv[0]))[:12]
        hbars_delta = delta_bars(moved)
    runs = (data["trend"] or {}).get("runs") or []
    heat = agg.heatmap_rows(summary, cfg["thresholds"])[:BOARD_MODULE_MAX]
    by_module_rules: dict[str, list[dict]] = {}
    for r in rules:
        by_module_rules.setdefault(r["module"], []).append(r)
    blocking_by_module: dict[str, int] = {}
    for r in blockers:
        blocking_by_module[r["module"]] = blocking_by_module.get(r["module"], 0) + 1

    def module_block(h: dict) -> dict:
        m = h["module"]
        r = summary.get(m) or {}
        mdims = {d: h["scores"].get(d) for d in DIMENSIONS}
        return {"name": m, "score": h["scores"]["composite"], "tier": h["tier"]["composite"],
                "delta": (deltas.get(m) or {}).get("dqs_change") if prev else None,
                "chart": hbars([(fmt_module(d), mdims[d]) for d in DIMENSIONS]),
                "rules": by_module_rules.get(m, [])[:5], "blockers": blocking_by_module.get(m, 0),
                "critical": h["critical"], "cap_reason": h["cap_reason"],
                "checks": int(r.get("total_checks") or 0)}

    groups = [{"label": _GROUP_LABEL[g], "modules": [module_block(h) for h in heat if h["group"] == g]}
              for g in agg.GROUPS]
    wave_rows = []
    for w in data["waves"]:
        mods = [h for h in heat if h["module"] in set(w.get("modules") or [])]
        wave_rows.append({"name": w["name"], "modules": [
            {"name": h["module"], "score": h["scores"]["composite"], "tier": h["tier"]["composite"],
             "blockers": blocking_by_module.get(h["module"], 0)} for h in mods]})
    l1 = sorted(by_l1(data["impact_rows"]).items(), key=lambda kv: (-kv[1], kv[0]))
    steps = (data["cleansing"] or {}).get("steps") or []

    return {
        "title": "Board data quality report", "eyebrow": "Board report", "cover": True,
        "scope_label": _scope_label(tenant_name, data["system"]), "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Organisation", tenant_name), ("System", _system_line(data["system"])),
                 ("Run", v.get("label") or str(v["id"])), ("Run ID", str(v["id"])),
                 ("Run at", fmt_dt(v.get("run_at"))),
                 ("Compared with", (prev.get("label") or str(prev["id"])) if prev else "No earlier run"),
                 ("Generated", fmt_dt(now))],
        "overall": overall, "headline": (ov["narrative"] or [{"text": ""}])[0]["text"],
        "currency": data["currency"], "compared": bool(prev),
        "narrative": [n["text"] for n in ov["narrative"]], "overview": ov,
        "cluster_chart": hbars([((f"{fmt_module(c['module'])} {c['field']}" if c["field"] else
                                  f"{fmt_module(c['module'])} unattributed"), c["impact"]) for c in data["clusters"][:5]],
                               maximum=float(top_impact)) if data["clusters"] else None,
        "ai_summary": ai_summary,
        "dim_rows": dim_rows, "trend_chart": trend_line([(r["label"] or r["run_at"], r["composite"]) for r in runs],
                                                       cfg["thresholds"]["target"]) if runs else None,
        "trend_count": len(runs), "delta_chart": hbars_delta,
        "waves": wave_rows, "blockers": blockers[:10], "blocker_total": len(blockers),
        "area_blocking_chart": hbars([(a["label"], a["blocking_failing"]) for a in areas],
                                     maximum=float(max([a["blocking_failing"] for a in areas] + [1]))) if areas else None,
        "area_warning_chart": hbars([(a["label"], a["warning_failing"]) for a in areas],
                                    maximum=float(max([a["warning_failing"] for a in areas] + [1]))) if areas else None,
        "l1_rows": [{"l1": k, "amount": amt} for k, amt in l1],
        "groups": [g for g in groups if g["modules"]],
        "funnel_chart": funnel_bars([(x["label"], x["records"]) for x in steps]) if steps else None,
        "rule_appendix": rules[:BOARD_RULE_APPENDIX], "rule_total": len(rules),
        "app_version": app_version, "methodology": methodology_block(scoring),
    }


def load_board(s: Session, tid: str, vid: str, compare: Optional[str] = None) -> Optional[dict]:
    from api.services import insights_aggregate as agg
    from api.services.report_pdf import _load_report_json

    d = agg.gather(s, tid, vid, compare)
    if not d:
        return None
    rj = _load_report_json(s, str(d["version"]["id"]), tid) or {}
    ai = rj.get("ai_executive_summary") or rj.get("executive_summary")
    d["ai_summary"] = None if not ai or str(ai).strip() == _CANNED else str(ai).strip()
    return d


# ── object report (one module, one run) ───────────────────────────────────────


def object_context(module: str, module_dqs: dict, findings: list[dict], samples: list[dict], *,
                   tenant_name: str, scoring: dict, system: Optional[dict] = None,
                   generated_at: Optional[datetime] = None) -> dict:
    """T18: every rule, finding and failing-record sample for one module in one run.
    ``module_dqs`` is ``version['dqs_summary'][module]`` (or ``{}`` if the module scored
    nothing); passing it through ``composite_dqs``/``dimension_scores`` as a single-module
    slice gets the module's own composite/tier/capped flag and dimension scores for free."""
    summary = {module: module_dqs or {}}
    overall = composite_dqs([summary], scoring=scoring)
    dims = dimension_scores(summary)
    ran = [f for f in findings if not errored(f)]
    errs = [_check_row(f) for f in findings if errored(f)]
    rules = sorted((_check_row(f) for f in ran),
                   key=lambda f: (_SEV_RANK.get(f.get("severity"), 9), -f["affected"], f["check_id"]))
    fails = [r for r in rules if r["affected"] > 0]
    score = (module_dqs or {}).get("composite_score")
    readiness = compute_readiness_status(score, critical_over_tolerance(module_dqs or {}), overall.get("thresholds")) \
        if score is not None else None

    if score is None:
        verdict = f"{fmt_module(module)} produced no data quality score in this run."
    else:
        verdict = (f"{fmt_module(module)} scored {score:.1f} out of 100 in this run. {len(fails)} of {len(ran)} "
                   f"checks found failing records.")
        if (module_dqs or {}).get("critical_count"):
            verdict += " Critical failures cap the score and block migration until they are fixed."
        if errs:
            verdict += (f" {len(errs)} check{'s' if len(errs) != 1 else ''} could not be evaluated "
                        f"and {'are' if len(errs) != 1 else 'is'} excluded from the score.")

    cols: list[str] = []
    for r in samples:
        for k in (r.get("field_values") or {}):
            if k not in cols:
                cols.append(k)

    now = _now(generated_at)
    return {
        "title": f"{fmt_module(module)} object report", "eyebrow": "Object data quality", "cover": True,
        "scope_label": _scope_label(tenant_name, system), "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Organisation", tenant_name), ("System", _system_line(system)), ("Module", fmt_module(module)),
                 ("Generated", fmt_dt(now))],
        "module": module, "overall": overall, "dims": dims, "readiness": readiness,
        "dim_chart": _quality_chart(dims), "headline": verdict,
        "rules": rules, "top_findings": fails[:10],
        "samples": samples, "sample_cols": cols, "errored": errs,
    }


# ── record fix sheet (Material 360, one record, one run) ─────────────────────


def record_context(matnr: str, by_view: list[dict], *, tenant_name: str, version: dict,
                   system: Optional[dict] = None, generated_at: Optional[datetime] = None) -> dict:
    """T19: Material 360 fix sheet for one MATNR — the same by-view sections and
    failing rules as ``GET /materials/{matnr}/findings`` (api/routes/materials.py),
    rendered as a PDF rather than JSON. Masked fields reach the template only through
    the shared ``redact`` filter; the data itself is already masked by migration 054."""
    failing_views = [v for v in by_view if v.get("failing")]
    now = _now(generated_at)
    return {
        "title": "Material 360 fix sheet", "eyebrow": "Record remediation", "cover": True,
        "scope_label": _scope_label(tenant_name, system), "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Organisation", tenant_name), ("System", _system_line(system)),
                 ("Material", matnr), ("Run", version.get("label") or str(version["id"])),
                 ("Generated", fmt_dt(now))],
        "matnr": matnr, "by_view": by_view, "failing_views": failing_views,
        "rules_total": sum(v.get("rules") or 0 for v in by_view),
        "failing_total": sum(len(v.get("failing") or []) for v in by_view),
    }


# ── loaders (sync; tenant RLS already set on the session) ────────────────────


def _one(db: Session, sql: str, /, **p: Any) -> Optional[dict]:
    r = db.execute(text(sql), p).mappings().first()
    return dict(r) if r else None


def _all(db: Session, sql: str, /, **p: Any) -> list[dict]:
    return [dict(r) for r in db.execute(text(sql), p).mappings().all()]


def load_version(s: Session, tid: str, vid: str) -> Optional[dict]:
    return _one(s, "SELECT id, label, run_at, status, dqs_summary, metadata FROM analysis_versions "
                   "WHERE id = :v AND tenant_id = :t", v=str(vid), t=tid)


def load_system(s: Session, tid: str, version: dict) -> Optional[dict]:
    sid = (version.get("metadata") or {}).get("system_id")
    if not sid:
        return None
    return _one(s, "SELECT name, system_type, environment FROM sap_systems WHERE id = CAST(:s AS uuid) "
                   "AND tenant_id = :t", s=sid, t=tid)


def load_findings(s: Session, tid: str, vid: str) -> list[dict]:
    return _all(s, "SELECT module, check_id, severity, dimension, affected_count, total_count, pass_rate, details "
                   "FROM findings WHERE version_id = :v AND tenant_id = :t", v=str(vid), t=tid)


def load_scoring(s: Session, tid: str) -> dict:
    """The tenant's raw scoring config (``tenants.dqs_weights``), loaded once per report."""
    return s.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"), {"t": tid}).scalar() or {}


def load_previous_dqs(s: Session, tid: str, version: dict, scoring: dict) -> Optional[float]:
    """Composite DQS of the prior run in the same lineage (same system, or the
    uploads of the same objects for uploads without a system_id), for the Summary section's
    change-since-previous-run figure. None when there is no prior scored run."""
    from api.services.run_lineage import lineage_key, lineage_sql
    lineage = lineage_key(version.get("metadata"), version.get("dqs_summary"), version.get("label"))
    row = _one(s, f"""
        SELECT dqs_summary FROM analysis_versions
         WHERE tenant_id = :t AND {lineage_sql()} = :lineage
           AND run_at < :run_at AND dqs_summary IS NOT NULL
         ORDER BY run_at DESC LIMIT 1""",
        t=tid, lineage=lineage, run_at=version["run_at"])
    if not row:
        return None
    return composite_dqs([row["dqs_summary"]], scoring=scoring)["composite"]


def load_analysis(s: Session, tid: str, vid: str) -> Optional[dict]:
    v = load_version(s, tid, vid)
    if not v:
        return None
    return {"version": v, "findings": load_findings(s, tid, vid), "system": load_system(s, tid, v)}


def load_extraction(s: Session, tid: str, vid: str) -> Optional[dict]:
    v = load_version(s, tid, vid)
    if not v:
        return None
    run_id = (v.get("metadata") or {}).get("sync_run_id")
    run = _one(s, "SELECT started_at, completed_at, rows_extracted, status, error_detail FROM sync_runs "
                  "WHERE id = CAST(:r AS uuid) AND tenant_id = :t", r=run_id, t=tid) if run_id else None
    return {"version": v, "system": load_system(s, tid, v), "sync_run": run}


def load_cleaning(s: Session, tid: str, vid: Optional[str]) -> Optional[dict]:
    version = None
    if vid:
        version = load_version(s, tid, vid)
        if not version:
            return None
    vf = "AND q.version_id = :v" if vid else ""
    p = {"t": tid, "v": str(vid) if vid else None}
    data: dict[str, Any] = {
        "queue": _all(s, f"SELECT q.object_type, q.status, COUNT(*) AS n FROM cleaning_queue q "
                         f"WHERE q.tenant_id = :t {vf} GROUP BY 1, 2 ORDER BY 1, 2", **p),
        "rules_applied": _all(s, f"""
            SELECT r.name, r.object_type, r.category, r.risk_level, COUNT(*) AS applied, MAX(q.applied_at) AS last_at
              FROM cleaning_queue q JOIN cleaning_rules r ON r.id = q.rule_id
             WHERE q.tenant_id = :t AND q.status = 'applied' {vf}
             GROUP BY 1, 2, 3, 4 ORDER BY applied DESC, r.name LIMIT 25""", **p),
        "audit": _all(s, f"""
            SELECT a.action, COUNT(*) AS n, COUNT(DISTINCT a.record_key) AS records, MAX(a.created_at) AS last_at
              FROM cleaning_audit a {'JOIN cleaning_queue q ON q.id = a.queue_id' if vid else ''}
             WHERE a.tenant_id = :t {vf} GROUP BY 1 ORDER BY n DESC""", **p),
        "dedup": _one(s, "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'pending') AS pending, "
                         "COUNT(*) FILTER (WHERE status = 'merged') AS merged FROM dedup_candidates "
                         "WHERE tenant_id = :t", t=tid),
        "record_fixes": _all(s, f"SELECT status, COUNT(*) AS n FROM record_fixes WHERE tenant_id = :t "
                                f"{'AND version_id = :v' if vid else ''} GROUP BY 1 ORDER BY 2 DESC", **p),
    }
    if s.execute(text("SELECT to_regclass('remediation_batches')")).scalar() is None:
        data["batches"] = None
        data["batches_reason"] = "Remediation batches are not enabled in this installation."
    else:
        data["batches"] = _all(s, """
            SELECT b.name, b.status, b.created_at, b.approved_at, b.exported_at, COUNT(i.*) AS records,
                   COUNT(*) FILTER (WHERE i.recon_status = 'fixed') AS fixed,
                   COUNT(*) FILTER (WHERE i.recon_status = 'still_failing') AS still_failing
              FROM remediation_batches b LEFT JOIN remediation_items i ON i.batch_id = b.id
             WHERE b.tenant_id = :t GROUP BY b.id ORDER BY b.created_at DESC LIMIT 25""", t=tid)
        data["proposals"] = _all(s, """
            SELECT COALESCE(proposal_source, 'none') AS source, COUNT(*) AS n,
                   COUNT(*) FILTER (WHERE proposed_value IS NOT NULL) AS with_value
              FROM remediation_items WHERE tenant_id = :t GROUP BY 1 ORDER BY 2 DESC""", t=tid)
        data["proposal_samples"] = _all(s, """
            SELECT check_id, field, current_value, proposed_value, COUNT(*) AS n
              FROM remediation_items WHERE tenant_id = :t AND proposed_value IS NOT NULL
             GROUP BY 1, 2, 3, 4 ORDER BY n DESC, check_id LIMIT 15""", t=tid)
        data["proposal_source"] = "remediation_items"
    if not data.get("proposals"):
        data["proposals"] = _all(s, f"""
            SELECT 'rule' AS source, COUNT(*) AS n, COUNT(*) FILTER (WHERE suggested_value IS NOT NULL) AS with_value
              FROM record_fixes WHERE tenant_id = :t {'AND version_id = :v' if vid else ''} HAVING COUNT(*) > 0""", **p)
        data["proposal_samples"] = _all(s, f"""
            SELECT check_id, field, invalid_value AS current_value, suggested_value AS proposed_value, COUNT(*) AS n
              FROM record_fixes WHERE tenant_id = :t AND suggested_value IS NOT NULL
                   {'AND version_id = :v' if vid else ''}
             GROUP BY 1, 2, 3, 4 ORDER BY n DESC, check_id LIMIT 15""", **p)
        data["proposal_source"] = "record_fixes" if data["proposals"] else None
    return {"data": data, "version": version}


def gather_executive_data(s: Session, tid: str, vid: str) -> Optional[dict]:
    """Same report_json + supplementary data api/services/report_pdf.py's
    _render_pdf() already loads for the executive report — reused here rather
    than re-querying. Shared by build(kind="executive") (-> PDF) and
    api/routes/insights.py's GET /exec (-> same data as on-screen JSON)."""
    from api.services.report_pdf import _load_report_json, _load_supplementary

    d = load_analysis(s, tid, vid)
    if not d:
        return None
    return {"report_json": _load_report_json(s, vid, tid) or {},
            "supplementary": _load_supplementary(s, vid, tid),
            "version": d["version"], "findings": d["findings"], "system": d["system"]}


def load_comparison(s: Session, tid: str, vid1: str, vid2: str) -> Optional[dict]:
    from api.services.record_issues import DIFF_SQL

    v1, v2 = load_version(s, tid, vid1), load_version(s, tid, vid2)
    if not v1 or not v2:
        return None
    diff = [{"check_id": r.check_id, "module": r.module, "severity": r.severity, "new": r.new,
             "resolved": r.resolved, "persisting": r.persisting,
             "comparable": bool(r.ran_v1 and r.ran_v2 and not r.truncated)}
            for r in s.execute(text(DIFF_SQL), {"v1": str(vid1), "v2": str(vid2)}).fetchall()]
    return {"v1": v1, "v2": v2, "findings1": load_findings(s, tid, vid1), "findings2": load_findings(s, tid, vid2),
            "record_diff": diff, "system": load_system(s, tid, v2)}


def load_object(s: Session, tid: str, vid: str, module: str) -> Optional[dict]:
    """T18: findings + failing-record samples for one module in one run. Returns ``None``
    for an unknown run or a module the rule catalogue does not know (-> 404)."""
    if module not in _modules():
        return None
    v = load_version(s, tid, vid)
    if not v:
        return None
    findings = _all(s, "SELECT module, check_id, severity, dimension, affected_count, total_count, pass_rate, "
                       "details FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m",
                    v=str(vid), t=tid, m=module)
    top3 = [r["check_id"] for r in
            sorted((_check_row(f) for f in findings if failing(f)),
                   key=lambda f: (_SEV_RANK.get(f.get("severity"), 9), -f["affected"], f["check_id"]))[:3]]
    # Per-rule cap (not a single global LIMIT) so a rule with many failures can't crowd the
    # other top-3 rules out of the sample: each of the top 3 check_ids gets its own 9 rows.
    samples = _all(s, "SELECT check_id, record_key, field_values FROM ("
                      "SELECT check_id, record_key, field_values, "
                      "ROW_NUMBER() OVER (PARTITION BY check_id ORDER BY record_key) AS rn "
                      "FROM finding_records WHERE tenant_id = :t AND version_id = :v "
                      "AND module = :m AND check_id = ANY(:ids)) ranked "
                      "WHERE rn <= 9 ORDER BY check_id, record_key",
                   t=tid, v=str(vid), m=module, ids=top3) if top3 else []
    return {"version": v, "findings": findings, "module_dqs": (v.get("dqs_summary") or {}).get(module) or {},
            "samples": samples, "system": load_system(s, tid, v)}


def load_record(s: Session, tid: str, vid: str, matnr: str) -> Optional[dict]:
    """T19: the same data materials.py's ``GET /{matnr}/findings`` builds (by-view sections,
    failing rules with actual values and record fixes), loaded synchronously for the PDF
    report rather than through that async route."""
    from api.services import material_360 as m360
    from api.services.source_design import dictionary_for

    v = load_version(s, tid, vid)
    if not v:
        return None
    m = m360.norm_matnr(matnr)
    cat = m360.rule_catalogue()
    names = {r["table"] for r in cat.values() if r["table"]} | {"MARA"}
    path = (v.get("metadata") or {}).get("dataset_path")
    if not path:
        return None
    d = dictionary_for(s, (v.get("metadata") or {}).get("system_id"))
    tables = m360.load_tables(path, d, names)
    if m360._for(tables, "MARA", m).empty:
        return None
    like = {"exact": f"MATNR={m}", "pre": f"MATNR={m}|%"}
    fr = _all(s, "SELECT check_id, record_key, field_values FROM finding_records WHERE tenant_id = :t "
                 "AND version_id = :v AND module = :mod AND (record_key = :exact OR record_key LIKE :pre)",
             t=tid, v=str(vid), mod=m360.MODULE, **like)
    iss = _all(s, "SELECT id, check_id, record_key, status FROM record_issues WHERE tenant_id = :t "
                  "AND module = :mod AND (record_key = :exact OR record_key LIKE :pre)",
              t=tid, mod=m360.MODULE, **like)
    issues = {(r["check_id"], r["record_key"]): {"id": r["id"], "status": r["status"]} for r in iss}
    out = m360.build_findings(fr, issues, m360.present_tables(tables, m), set(tables))
    return {"version": v, "matnr": m, "by_view": out["by_view"], "system": load_system(s, tid, v)}


def _cost_model(s: Session, tid: str) -> dict:
    from api.services.insights_aggregate import load_cost_model

    return load_cost_model(s, tid)


def _app_version() -> str:
    from api.services.version import APP_VERSION

    return str(APP_VERSION)


def build(s: Session, tid: str, kind: str, vid: Optional[str] = None, vid1: Optional[str] = None,
         module: Optional[str] = None, matnr: Optional[str] = None, runs: int = 12) -> Optional[bytes]:
    """Load one report's data for a tenant and render it. ``None`` when the run is not found
    (or, for an extraction report, the run was not extracted from SAP)."""
    tenant_name = s.execute(text("SELECT name FROM tenants WHERE id = :t"), {"t": tid}).scalar() or ""
    kw: dict[str, Any] = {"tenant_name": tenant_name}
    scoring = load_scoring(s, tid)
    if kind == "analysis":
        d = load_analysis(s, tid, vid)
        return d and render("analysis_report.html", analysis_context(
            d["version"], d["findings"], system=d["system"], scoring=scoring,
            previous_dqs=load_previous_dqs(s, tid, d["version"], scoring), **kw))
    if kind == "extraction":
        d = load_extraction(s, tid, vid)
        if not d:
            return None
        ctx = extraction_context(d["version"], system=d["system"], sync_run=d["sync_run"], scoring=scoring, **kw)
        return render("extraction_report.html", ctx) if ctx["is_extraction"] else None
    if kind == "cleaning":
        d = load_cleaning(s, tid, vid)
        return d and render("cleaning_report.html", cleaning_context(d["data"], version=d["version"], scoring=scoring, **kw))
    if kind == "comparison":
        d = load_comparison(s, tid, vid1, vid)
        return d and render("comparison_report.html", comparison_context(
            d["v1"], d["v2"], d["findings1"], d["findings2"], record_diff=d["record_diff"],
            system=d["system"], scoring=scoring, **kw))
    if kind == "executive":
        d = gather_executive_data(s, tid, vid)
        return d and render("executive_report.html", executive_context(
            d["report_json"], d["supplementary"], d["version"], d["findings"], system=d["system"],
            scoring=scoring, previous_dqs=load_previous_dqs(s, tid, d["version"], scoring),
            currency=tenant_currency(_cost_model(s, tid)), **kw))
    if kind == "board":
        d = load_board(s, tid, vid, vid1)
        return d and render("board_report.html", board_context(
            d, tenant_name=tenant_name, scoring=scoring, ai_summary=d["ai_summary"], app_version=_app_version()))
    if kind == "object":
        d = load_object(s, tid, vid, module)
        return d and render("object_report.html", object_context(
            module, d["module_dqs"], d["findings"], d["samples"], system=d["system"], scoring=scoring, **kw))
    if kind == "record":
        d = load_record(s, tid, vid, matnr)
        return d and render("record_report.html", record_context(
            d["matnr"], d["by_view"], version=d["version"], system=d["system"], **kw))
    if kind == "trend":
        d = load_trend(s, tid, vid, runs)
        return d and render("trend_report.html", trend_context(
            d["version"], d["trend"], d["findings_first"], d["findings_last"], system=d["system"],
            scoring=scoring, **kw))
    if kind == "rules":
        return render("rule_catalogue.html", rules_context(load_rules(s, tid, module), module=module, **kw))
    if kind == "dictionary":
        return render("data_dictionary.html", dictionary_context(module=module, **kw))
    if kind == "owners":
        d = load_owners(s, tid, vid)
        return d and render("owner_report.html", owners_context(
            d["version"], d["owners"], d["objects"], system=d["system"], scoring=scoring, **kw))
    raise ValueError(kind)


# ── trend report (the last N finished runs of one lineage) ────────────────────

TREND_MOVERS = 10
TREND_RULES_MAX = 25


def _dim_series(runs: list[dict]) -> list[dict]:
    """One row per dimension: the label, the score in every run (None when no check measured it) and
    a line chart over the runs that did measure it."""
    out = []
    for d in DIMENSIONS:
        values = [(r.get("dimensions") or {}).get(d) for r in runs]
        if not any(v is not None for v in values):
            out.append({"name": d, "values": values, "chart": None, "change": None})
            continue
        measured = [v for v in values if v is not None]
        out.append({"name": d, "values": values,
                    "chart": trend_line([(r["label"] or r["run_at"] or "", v) for r, v in zip(runs, values)]),
                    "change": round(measured[-1] - measured[0], 1) if len(measured) > 1 else None})
    return out


def _movers(first: dict, last: dict) -> list[dict]:
    """Objects scored in both the first and the last run, ordered by how far the score moved."""
    rows = [{"module": m, "first": first[m], "last": last[m], "change": round(last[m] - first[m], 1)}
            for m in sorted(set(first) & set(last))
            if first.get(m) is not None and last.get(m) is not None]
    rows.sort(key=lambda r: (-abs(r["change"]), r["module"]))
    return rows


def _trend_headline(runs: list[dict], movers: list[dict], new: int, fixed: int) -> str:
    scored = [r for r in runs if r["composite"] is not None]
    if not scored:
        return "None of the runs in this window produced a score, so there is no trend to report."
    if len(scored) < 2:
        return (f"Only one run in this window has a score, {scored[-1]['composite']:.1f} out of 100, "
                "so there is no movement to report yet.")
    a, b = scored[0], scored[-1]
    delta = round(b["composite"] - a["composite"], 1)
    word = "rose" if delta > 0 else "fell" if delta < 0 else "did not change"
    s = (f"Across {len(scored)} runs the score {word}"
         + (f" by {abs(delta):.1f} points" if delta else "")
         + f", from {a['composite']:.1f} to {b['composite']:.1f} out of 100.")
    if movers:
        top = max(movers, key=lambda r: r["change"])
        low = min(movers, key=lambda r: r["change"])
        if top["change"] > 0:
            s += f" {fmt_module(top['module'])} improved most, by {top['change']:.1f} points."
        if low["change"] < 0:
            s += f" {fmt_module(low['module'])} slipped most, by {abs(low['change']):.1f} points."
    s += (f" Between the first and the last run {fmt_n(fixed)} rule{'s' if fixed != 1 else ''} "
          f"stopped failing and {fmt_n(new)} started failing.")
    return s


def trend_context(version: dict, trend: dict, findings_first: list[dict], findings_last: list[dict], *,
                  tenant_name: str, scoring: dict, system: Optional[dict] = None,
                  generated_at: Optional[datetime] = None) -> dict:
    """Pure builder. ``trend`` is ``insights_aggregate.trends`` output (runs oldest first, each with
    composite, dimensions and per-module scores under the tenant's current weights)."""
    from api.services.scoring import scoring_config

    runs = list((trend or {}).get("runs") or [])
    cfg = scoring_config(scoring)
    now = _now(generated_at)
    first, last = (runs[0], runs[-1]) if runs else ({}, {})
    movers = _movers(first.get("modules") or {}, last.get("modules") or {}) if len(runs) > 1 else []
    changes = check_changes(findings_first, findings_last) if len(runs) > 1 else \
        {"new": [], "resolved": [], "persisting": [], "not_comparable": []}
    shown = movers[:TREND_MOVERS]
    overall = {"composite": last.get("composite"), "capped": False}
    scored = last.get("composite") is not None
    return {
        "title": "Trend report", "eyebrow": "Data quality trend", "cover": True,
        "scope_label": _scope_label(tenant_name, system), "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Organisation", tenant_name), ("System", _system_line(system)),
                 ("Run", version.get("label") or str(version["id"])), ("Run ID", str(version["id"])),
                 ("Window", f"{len(runs)} finished run{'s' if len(runs) != 1 else ''}"
                  + (f", {fmt_dt(first.get('run_at'))} to {fmt_dt(last.get('run_at'))}" if len(runs) > 1 else "")),
                 ("Generated", fmt_dt(now))],
        "overall": overall if scored else None,
        "headline": _trend_headline(runs, movers, len(changes["new"]), len(changes["resolved"])),
        "runs": runs, "run_count": len(runs),
        "score_chart": trend_line([(r["label"] or r["run_at"] or "", r["composite"]) for r in runs],
                                  cfg["thresholds"]["target"]) if runs else None,
        "dims": _dim_series(runs),
        "movers": shown, "movers_total": len(movers),
        "mover_chart": delta_bars([(fmt_module(m["module"]), m["change"]) for m in shown]) if shown else None,
        "new_rules": changes["new"][:TREND_RULES_MAX], "new_total": len(changes["new"]),
        "fixed_rules": changes["resolved"][:TREND_RULES_MAX], "fixed_total": len(changes["resolved"]),
        "first_label": first.get("label") or first.get("run_at"), "last_label": last.get("label") or last.get("run_at"),
        "annotations": (trend or {}).get("annotations") or [],
        "methodology": methodology_block(scoring),
    }


def load_trend(s: Session, tid: str, vid: str, runs: int = 12) -> Optional[dict]:
    """The run, its lineage's last ``runs`` finished runs, and the findings of the first and last."""
    from api.services import insights_aggregate as agg

    v = load_version(s, tid, vid)
    if not v:
        return None
    trend = agg.trends(s, tid, vid, None, runs) or {"runs": [], "annotations": []}
    ids = [r["version_id"] for r in trend["runs"]]
    first = agg.load_run_findings(s, tid, ids[0]) if len(ids) > 1 else []
    last = agg.load_run_findings(s, tid, ids[-1]) if len(ids) > 1 else []
    return {"version": v, "trend": trend, "findings_first": first, "findings_last": last,
            "system": load_system(s, tid, v)}


# ── rule catalogue ───────────────────────────────────────────────────────────

_RULE_DESC_MAX = 260


def _rule_row(rid: str, name: str, module: str, category: str, severity: str, description: str,
              conditions: Any, enabled: bool, source: str) -> dict:
    cond = conditions
    if isinstance(cond, str):
        try:
            cond = json.loads(cond or "[]")
        except ValueError:
            cond = []
    cond = (cond or [{}])[0] if isinstance(cond, list) else {}
    cond = cond if isinstance(cond, dict) else {}
    msg = name.split(": ", 1)[1] if ": " in name else name
    desc = (description or "").strip()
    if desc == msg:
        desc = ""
    elif desc:
        desc = _first_sentence(desc)
    if len(desc) > _RULE_DESC_MAX:
        desc = desc[:_RULE_DESC_MAX].rsplit(" ", 1)[0].rstrip(",;:. ") + "..."
    return {"id": rid, "name": msg, "module": module, "category": category, "severity": severity or "medium",
            "dimension": cond.get("dimension"), "field": cond.get("field"), "description": desc,
            "enabled": enabled, "source": source}


def rules_context(rules: list[dict], *, tenant_name: str, module: Optional[str] = None,
                  generated_at: Optional[datetime] = None) -> dict:
    """Pure builder. ``rules`` are ``_rule_row`` dicts. Grouped by module, ordered by category then module
    name, rules by severity then id; a contents list by module with the rule counts."""
    now = _now(generated_at)
    rows = [r for r in rules if not module or r["module"] == module]
    by_module: dict[str, list[dict]] = {}
    for r in rows:
        by_module.setdefault(r["module"], []).append(r)
    cat_of = {m: rs[0]["category"] for m, rs in by_module.items()}
    order = sorted(by_module, key=lambda m: (_GROUP_RANK.get(cat_of[m], 9), m))
    groups = []
    for m in order:
        rs = sorted(by_module[m], key=lambda r: (_SEV_RANK.get(r["severity"], 9), r["id"]))
        groups.append({"module": m, "slug": re.sub(r"[^a-z0-9]+", "-", m.lower()), "category": cat_of[m],
                       "rules": rs, "count": len(rs), "enabled": sum(1 for r in rs if r["enabled"])})
    sev = {s: sum(1 for r in rows if r["severity"] == s) for s in (*SEVERITIES, "info")}
    off = sum(1 for r in rows if not r["enabled"])
    if not rows:
        headline = ("No rule matches the module you chose." if module
                    else "The rule catalogue is empty on this installation.")
    else:
        headline = (f"The catalogue holds {fmt_n(len(rows))} rule{'s' if len(rows) != 1 else ''} across "
                    f"{fmt_n(len(groups))} object{'s' if len(groups) != 1 else ''}. "
                    f"{fmt_n(sev['critical'])} are critical and {fmt_n(sev['high'])} are high severity. "
                    + (f"{fmt_n(off)} {'is' if off == 1 else 'are'} switched off for this organisation."
                       if off else "Every rule is switched on for this organisation."))
    return {
        "title": "Rule catalogue", "eyebrow": "Validation rules", "cover": False,
        "scope_label": _scope_label(tenant_name, None), "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Organisation", tenant_name), ("Scope", fmt_module(module) if module else "Every object"),
                 ("Rules", fmt_n(len(rows))), ("Generated", fmt_dt(now))],
        "headline": headline, "groups": groups, "total": len(rows), "sev": sev, "switched_off": off,
        "module": module,
    }


_GROUP_RANK = {"ecc": 0, "successfactors": 1, "warehouse": 2, "concur": 3, "ariba": 4}


def load_rules(s: Session, tid: str, module: Optional[str] = None) -> list[dict]:
    """The shipped YAML catalogue merged with this tenant's rules table: the table decides enabled and
    severity, and adds the tenant's own rules (custom, mined, HQ). A rule the tenant has not been seeded
    with yet is listed with the catalogue's own state."""
    from api.services.tenant_seed import rule_catalogue

    out: dict[tuple[str, str], dict] = {}
    for r in rule_catalogue():
        if module and r["module"] != module:
            continue
        out[(r["rid"], r["module"])] = _rule_row(r["rid"], r["name"], r["module"], r["category"], r["severity"],
                                                 r["description"], r["conditions"], r["enabled"], "yaml")
    for r in _all(s, "SELECT name, description, module, category, severity, enabled, conditions, source "
                     "FROM rules WHERE tenant_id = :t AND (CAST(:m AS text) IS NULL OR module = CAST(:m AS text))",
                  t=tid, m=module):
        rid = str(r["name"]).split(":", 1)[0].strip()
        out[(rid, r["module"])] = _rule_row(rid, r["name"], r["module"], r.get("category") or "", r["severity"],
                                            r["description"], r["conditions"], bool(r["enabled"]),
                                            r.get("source") or "yaml")
    return list(out.values())


def rules_modules() -> frozenset[str]:
    """Modules a rule-catalogue or data-dictionary report can be filtered to."""
    return _modules()


# ── data dictionary ──────────────────────────────────────────────────────────

_VALUES_MAX = 8
_VALUES_CHARS = 70


def _short_values(meta: dict) -> Optional[str]:
    vals = meta.get("valid_values")
    if not vals:
        return None
    vals = [str(v) for v in vals]
    if len(vals) <= _VALUES_MAX and sum(len(v) for v in vals) + 2 * len(vals) <= _VALUES_CHARS:
        return ", ".join(vals)
    return f"{len(vals)} allowed values"


def table_modules() -> dict[str, list[str]]:
    """Table name (upper case) -> the modules whose extraction reads it, across every system type."""
    from sap.extraction_registry import SYSTEM_EXTRACTIONS

    out: dict[str, set[str]] = {}
    for mods in SYSTEM_EXTRACTIONS.values():
        for module, targets in mods.items():
            for t in targets:
                out.setdefault(t.source.upper(), set()).add(module)
    return {t: sorted(m) for t, m in out.items()}


def dictionary_context(*, tenant_name: str, module: Optional[str] = None,
                       generated_at: Optional[datetime] = None) -> dict:
    """Pure over the shipped data dictionary and extraction registry: every table Meridian reads, its
    modules, and each field with key, mandatory, type, length and short valid-value lists."""
    from sap.data_dictionary import get_all_table_names, get_key_fields, get_mandatory_fields, get_table_metadata

    now = _now(generated_at)
    mods_of = table_modules()
    tables = []
    for name in get_all_table_names():
        mods = mods_of.get(name.upper(), [])
        if module and module not in mods:
            continue
        meta = get_table_metadata(name) or {}
        fields = [{"name": f, "description": m.get("description") or "", "type": m.get("data_type") or "",
                   "length": m.get("length"), "key": bool(m.get("key")), "mandatory": bool(m.get("mandatory")),
                   "allowed": _short_values(m), "config_table": m.get("config_table")} for f, m in meta.items()]
        tables.append({"name": name, "modules": mods, "fields": fields,
                       "key_fields": get_key_fields(name), "mandatory": get_mandatory_fields(name)})
    by_module: dict[str, list[str]] = {}
    for t in tables:
        for m in (t["modules"] or ["_unmapped"]):
            by_module.setdefault(m, []).append(t["name"])
    contents = [{"module": m, "tables": by_module[m]} for m in sorted(by_module, key=lambda x: (x == "_unmapped", x))]
    n_fields = sum(len(t["fields"]) for t in tables)
    if not tables:
        headline = ("No table in the data dictionary is read by the module you chose." if module
                    else "The data dictionary is empty on this installation.")
    else:
        headline = (f"Meridian reads {fmt_n(len(tables))} table{'s' if len(tables) != 1 else ''} with "
                    f"{fmt_n(n_fields)} documented field{'s' if n_fields != 1 else ''}"
                    + (f" for {fmt_module(module)}" if module else f" across {fmt_n(len(contents))} groups of objects")
                    + ". Key fields identify a record. Mandatory fields must hold a value for the record to be valid in SAP.")
    return {
        "title": "Data dictionary", "eyebrow": "Fields Meridian reads", "cover": False,
        "scope_label": _scope_label(tenant_name, None), "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Organisation", tenant_name), ("Scope", fmt_module(module) if module else "Every object"),
                 ("Tables", fmt_n(len(tables))), ("Generated", fmt_dt(now))],
        "headline": headline, "tables": tables, "contents": contents, "field_total": n_fields, "module": module,
    }


# ── owner workload ───────────────────────────────────────────────────────────


def _blocking_rule_of(findings: list[dict]) -> dict[str, dict]:
    """Per module, the failing critical or high rule that blocks most: severity, then failing records,
    then id (the same pick as the objects list)."""
    best: dict[str, dict] = {}
    for f in findings:
        if f.get("severity") not in ("critical", "high") or not failing(f):
            continue
        key = (_SEV_RANK.get(f["severity"], 9), -int(f.get("affected_count") or 0), f["check_id"])
        if f["module"] not in best or key < best[f["module"]]["key"]:
            best[f["module"]] = {"key": key, "check_id": f["check_id"], "severity": f["severity"],
                                 "affected": int(f.get("affected_count") or 0)}
    return {m: {k: v for k, v in b.items() if k != "key"} for m, b in best.items()}


def owners_context(version: dict, owners: list[dict], objects: list[dict], *, tenant_name: str, scoring: dict,
                   generated_at: Optional[datetime] = None, system: Optional[dict] = None) -> dict:
    """Pure builder. ``owners``: one dict per person with ``user_id``, ``owner``, ``score``, ``delta``,
    ``open_by_severity``, ``fixed_since_baseline`` and ``oldest_item_age_days`` (the /insights/owners
    cards; ``score`` is ``None`` for an owner with no assigned items). ``objects``: one dict per module of
    the run with ``module``, ``score``, ``owner_id``, ``blocking`` (check id, severity, affected, name)."""
    from api.services.insights_owners import _SEVERITY_WEIGHT

    now = _now(generated_at)
    by_owner: dict[Any, list[dict]] = {}
    for o in objects:
        by_owner.setdefault(o.get("owner_id"), []).append(o)

    def obj_sort(o: dict) -> tuple:
        return (o.get("score") is None, o.get("score") if o.get("score") is not None else 0, o["module"])

    rows = []
    for o in owners:
        mine = sorted(by_owner.get(o["user_id"], []), key=obj_sort)
        open_n = sum((o.get("open_by_severity") or {}).values())
        delta = o.get("delta")
        rows.append({**o, "open": open_n, "objects": mine, "object_count": len(mine),
                     "blocked": sum(1 for x in mine if x.get("blocking")),
                     "trend": None if delta in (None, 0) else ("improved" if delta > 0 else "slipped")})
    rows.sort(key=lambda r: (r["score"] is None, r["score"] if r["score"] is not None else 0, r["owner"].lower()))
    unassigned = sorted(by_owner.get(None, []), key=obj_sort)
    scored = [r for r in rows if r["score"] is not None]
    if not rows and not unassigned:
        headline = "No owner and no object is recorded for this run."
    else:
        headline = (f"{fmt_n(len(rows))} owner{'s' if len(rows) != 1 else ''} hold{'s' if len(rows) == 1 else ''} "
                    f"{fmt_n(sum(r['open'] for r in rows))} open item{'s' if sum(r['open'] for r in rows) != 1 else ''}. ")
        if scored:
            w = scored[0]
            headline += (f"{w['owner']} has the lowest owner score, {w['score']:.1f} out of 100, "
                         f"with {fmt_n(w['open'])} open item{'s' if w['open'] != 1 else ''}. ")
        headline += (f"{fmt_n(len(unassigned))} object{'s' if len(unassigned) != 1 else ''} "
                     f"{'has' if len(unassigned) == 1 else 'have'} no owner"
                     + (", and some of them have a blocking rule." if any(x.get("blocking") for x in unassigned) else "."))
    return {
        "title": "Owner workload", "eyebrow": "Data ownership", "cover": False,
        "scope_label": _scope_label(tenant_name, system), "generated_at": now, "generated_sast": fmt_dt(now),
        "meta": [("Organisation", tenant_name), ("System", _system_line(system)),
                 ("Run", version.get("label") or str(version["id"])), ("Run ID", str(version["id"])),
                 ("Run at", fmt_dt(version.get("run_at"))), ("Generated", fmt_dt(now))],
        "headline": headline, "owners": rows, "unassigned": unassigned,
        "severity_weights": _SEVERITY_WEIGHT, "methodology": methodology_block(scoring),
    }


def load_owners(s: Session, tid: str, vid: str) -> Optional[dict]:
    """The run, the owner cards (the same query and scorer as GET /insights/owners), who owns each object
    (``data_owners``, kind object) and the blocking rule of each object in the run."""
    from api.services.insights_owners import OWNER_ISSUE_SQL, baseline_cutoff, build_owner_card, load_owner_aggregates

    v = load_version(s, tid, vid)
    if not v:
        return None
    aggs = load_owner_aggregates(_all(s, OWNER_ISSUE_SQL, tid=tid, cutoff=baseline_cutoff()))
    owners: dict[str, dict] = {}
    for name, a in aggs.items():
        card = build_owner_card(name, **{k: x for k, x in a.items() if k != "user_id"})
        owners[str(a["user_id"])] = {"user_id": str(a["user_id"]), "owner": card.owner, "score": card.score,
                                     "delta": card.delta, "open_by_severity": card.open_by_severity,
                                     "fixed_since_baseline": card.fixed_since_baseline,
                                     "oldest_item_age_days": card.oldest_item_age_days}
    holders = _all(s, "SELECT d.ref, d.owner_user_id AS uid, u.name FROM data_owners d "
                      "JOIN users u ON u.id = d.owner_user_id AND u.tenant_id = d.tenant_id "
                      "WHERE d.tenant_id = :t AND d.kind = 'object' AND d.owner_user_id IS NOT NULL", t=tid)
    owner_of = {h["ref"]: str(h["uid"]) for h in holders}
    for h in holders:  # an owner with no assigned items yet still gets a section
        owners.setdefault(str(h["uid"]), {"user_id": str(h["uid"]), "owner": h["name"], "score": None, "delta": None,
                                          "open_by_severity": {}, "fixed_since_baseline": 0,
                                          "oldest_item_age_days": 0})
    findings = load_findings(s, tid, vid)
    blocking = _blocking_rule_of(findings)
    summary = v.get("dqs_summary") or {}
    objects = []
    for m in sorted(set(summary) | {f["module"] for f in findings}):
        b = blocking.get(m)
        objects.append({"module": m, "score": (summary.get(m) or {}).get("composite_score"),
                        "owner_id": owner_of.get(m),
                        "blocking": {**b, "name": _rule(b["check_id"]).get("message") or ""} if b else None})
    return {"version": v, "owners": list(owners.values()), "objects": objects, "system": load_system(s, tid, v)}
