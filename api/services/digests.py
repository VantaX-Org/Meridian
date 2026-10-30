"""Scheduled digests and executive mailouts (migration 114).

A digest schedule is for a role or for one migration wave, on a five-field cron in its time zone, to one channel:

  email          the HTML digest to the schedule's recipients (addresses, users of the tenant, or, for a role digest
                 with neither, every active user holding that role), with the digest as a PDF attachment
  webhook        a ``digest.sent`` webhook event (ids, names and numbers only) to the tenant's webhooks
  alert_channel  one Slack, Teams, webhook or email alert channel (a summary and a link; email gets the HTML and PDF)

The digest is rendered from the deterministic numbers only, read from what the runs stored (``build``):

  landscape   the sentence of the landscape over the current cells ("held under 85", the rules that release most)
  score moves each cell's score against the previous finished run of its system that measured the object
  waves       each wave's gate (api/services/wave_gate.py over the same cells and the contracts)
  approvals   draft fix batches with accepted items waiting for a second person
  SLA         record issues in breach of their SLA (sla_state 'breached', still open)
  value       the five findings with the most cost at risk in the current state

A wave digest reads only the wave's objects (and its source system when it has one). Sending (``send``) claims the slot
in digest_deliveries first (ON CONFLICT DO NOTHING), so a slot goes out at most once; in sandbox mode the slot is
recorded as skipped (reason ``sandbox``) and nothing is sent. No LLM; every query carries the tenant id and runs after
``app.tenant_id`` is set.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from sqlalchemy import text

from api.services.version_status import finished_sql

logger = logging.getLogger("meridian.digests")

TOP_MOVES = 5
TOP_VALUE = 5
OPEN_ISSUE = "status IN ('open', 'in_progress', 'waiting_sap', 'waiting_requester')"


# ── schedule maths ───────────────────────────────────────────────────────────────────────────────────────────

def valid_cron(cron: str) -> bool:
    return bool(cron and cron.strip()) and len(cron.split()) == 5 and croniter.is_valid(cron)


def zone(tz: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(tz or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def valid_zone(tz: str) -> bool:
    try:
        ZoneInfo(tz)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def next_run(cron: str, tz: Optional[str], after: datetime) -> datetime:
    """The first occurrence of ``cron`` in time zone ``tz`` strictly after ``after``, in UTC."""
    after = after if after.tzinfo else after.replace(tzinfo=timezone.utc)
    nxt = croniter(cron, after.astimezone(zone(tz))).get_next(datetime)
    return nxt.astimezone(timezone.utc)


# ── the numbers (sync session, app.tenant_id set) ────────────────────────────────────────────────────────────

def _cells(session, tid: str) -> list[dict]:
    """The landscape's current cells: (system, object) at the newest finished run of that system that measured it."""
    from api.routes.landscape import _CELL_RUNS_SQL
    from api.routes.objects import breach_ids, cap_level_of
    from api.services.scoring import critical_over_tolerance

    active = {r[0]: r[1] for r in session.execute(text(
        "SELECT id::text, name FROM sap_systems WHERE tenant_id = CAST(:t AS uuid) AND is_active"), {"t": tid})}
    triples = [(r[0], r[1], r[2]) for r in session.execute(text(_CELL_RUNS_SQL), {"t": tid}) if r[0] in active]
    runs = sorted({r for _s, _m, r in triples})
    meta: dict[str, tuple[dict, datetime]] = {}
    if runs:
        for rid, summ, at in session.execute(text(
                "SELECT id::text, dqs_summary, run_at FROM analysis_versions WHERE tenant_id = CAST(:t AS uuid) "
                "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": tid, "ids": runs}):
            meta[rid] = (summ if isinstance(summ, dict) else {}, at)
    out = []
    for sid, module, rid in triples:
        m = meta.get(rid, ({}, None))[0].get(module)
        if not isinstance(m, dict):
            continue
        out.append({"system_id": sid, "system": active[sid], "module": module, "run_id": rid,
                    "run_at": meta[rid][1], "score": m.get("composite_score"), "capped": bool(m.get("capped")),
                    "cap_level": cap_level_of(m), "breaches": breach_ids(m),
                    "critical_over_tolerance": critical_over_tolerance(m)})
    return sorted(out, key=lambda c: (c["system"], c["module"]))


_PREVIOUS_SQL = f"""
    SELECT (dqs_summary->:m->>'composite_score')::float8 FROM analysis_versions
     WHERE tenant_id = CAST(:t AS uuid) AND {finished_sql()} AND metadata->>'system_id' = :s
       AND dqs_summary ? :m AND run_at < :at AND id <> CAST(:v AS uuid)
       AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
       AND metadata->>'archived' IS DISTINCT FROM 'true'
     ORDER BY run_at DESC LIMIT 1"""


def _moves(session, tid: str, cells: list[dict]) -> list[dict]:
    out = []
    for c in cells:
        if c["score"] is None or c["run_at"] is None:
            continue
        prev = session.execute(text(_PREVIOUS_SQL), {"t": tid, "m": c["module"], "s": c["system_id"], "at": c["run_at"],
                                                     "v": c["run_id"]}).scalar()
        if prev is None:
            continue
        delta = round(float(c["score"]) - float(prev), 1)
        if delta:
            out.append({"system": c["system"], "module": c["module"], "before": round(float(prev), 1),
                        "after": round(float(c["score"]), 1), "delta": delta})
    out.sort(key=lambda x: (-abs(x["delta"]), x["system"], x["module"]))
    return out[:TOP_MOVES]


def _waves(session, tid: str, cells: list[dict], wave_id: Optional[str]) -> list[dict]:
    from api.services import wave_gate

    waves = session.execute(text(
        "SELECT w.id::text AS id, w.name, w.modules, w.source_system_id::text AS source_system_id, w.target_date, "
        "g.min_score, g.zero_criticals, g.contracts_met, g.wave_id IS NOT NULL AS has_gate "
        "FROM migration_waves w LEFT JOIN wave_gates g ON g.wave_id = w.id AND g.tenant_id = w.tenant_id "
        "WHERE w.tenant_id = CAST(:t AS uuid) AND (CAST(:w AS uuid) IS NULL OR w.id = CAST(:w AS uuid)) "
        "ORDER BY w.target_date NULLS LAST, w.name"), {"t": tid, "w": wave_id}).mappings().all()
    if not waves:
        return []
    contracts = [dict(r) for r in session.execute(text("""
        SELECT c.name, c.status, c.producer, c.consumer, c.quality_contract, h.overall_compliant AS latest_compliant
          FROM contracts c
          LEFT JOIN LATERAL (SELECT overall_compliant FROM contract_compliance_history
                              WHERE contract_id = c.id AND tenant_id = c.tenant_id ORDER BY recorded_at DESC LIMIT 1) h ON true
         WHERE c.tenant_id = CAST(:t AS uuid)"""), {"t": tid}).mappings().all()]
    out = []
    for w in waves:
        gate = ({"min_score": w["min_score"], "zero_criticals": w["zero_criticals"], "contracts_met": w["contracts_met"]}
                if w["has_gate"] else {"min_score": None, "zero_criticals": True, "contracts_met": False})
        status = wave_gate.gate_checks(gate, dict(w), cells, contracts)
        out.append({"id": w["id"], "name": w["name"], "modules": list(w["modules"] or []),
                    "target_date": w["target_date"].isoformat() if w["target_date"] else None,
                    "gate_open": bool(status["passed"]),
                    "failing": [c["label"] for c in status["checks"] if not c["passed"]]})
    return out


def _value(session, tid: str, cells: list[dict]) -> tuple[list[dict], Optional[float]]:
    if not cells:
        return [], None
    p = {"t": tid, "m": [c["module"] for c in cells], "v": [c["run_id"] for c in cells], "n": TOP_VALUE}
    where = ("f.tenant_id = CAST(:t AS uuid) AND f.affected_count > 0 AND f.cost_at_risk IS NOT NULL "
             "AND (f.module, f.version_id) IN (SELECT m, v FROM unnest(CAST(:m AS text[]), CAST(:v AS uuid[])) x(m, v))")
    rows = session.execute(text(f"SELECT f.check_id, f.module, f.cost_at_risk::float8 AS cost, f.affected_count "
                                f"FROM findings f WHERE {where} ORDER BY f.cost_at_risk DESC, f.check_id LIMIT :n"),
                           p).mappings().all()
    total = session.execute(text(f"SELECT sum(f.cost_at_risk)::float8 FROM findings f WHERE {where}"), p).scalar()
    return [{"check_id": r["check_id"], "module": r["module"], "cost_at_risk": round(float(r["cost"]), 2),
             "failing_records": int(r["affected_count"])} for r in rows], (round(float(total), 2) if total else None)


def sentence_text(s: dict) -> str:
    if not s["objects"]:
        return "No object has been measured yet."
    head = f"{s['held_under_85']} of {s['objects']} objects held under 85"
    if s["release_if_fixed"] and s["released"]:
        rules = " and ".join(s["release_if_fixed"])
        return f"{head}; fix {rules} to release {s['released']}."
    return head + "."


def build(session, tenant_id: str, schedule: dict) -> dict:
    """The digest's numbers for ``schedule`` (a digest_schedules row as a mapping)."""
    from api.routes.landscape import sentence_of
    from checks.cost import effective as effective_cost_model

    tid = str(tenant_id)
    tenant = session.execute(text("SELECT name, cost_model FROM tenants WHERE id = CAST(:t AS uuid)"), {"t": tid}).fetchone()
    currency = str(effective_cost_model(tenant[1] if tenant and isinstance(tenant[1], dict) else None)["currency"])
    cells = _cells(session, tid)
    wave_id = str(schedule["wave_id"]) if schedule.get("audience") == "wave" and schedule.get("wave_id") else None
    if wave_id:
        w = session.execute(text("SELECT modules, source_system_id::text FROM migration_waves "
                                 "WHERE id = CAST(:w AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                            {"w": wave_id, "t": tid}).fetchone()
        mods, src = (set(w[0] or []), w[1]) if w else (set(), None)
        cells = [c for c in cells if c["module"] in mods and (src is None or c["system_id"] == src)]
    sentence = sentence_of([{**c} for c in cells])
    approvals = session.execute(text(
        "SELECT count(DISTINCT b.id) FROM remediation_batches b JOIN remediation_items i ON i.batch_id = b.id "
        "AND i.tenant_id = b.tenant_id WHERE b.tenant_id = CAST(:t AS uuid) AND b.status = 'draft' AND i.accepted"
        + (" AND i.module = ANY(:mods)" if wave_id else "")),
        {"t": tid, "mods": sorted({c["module"] for c in cells})}).scalar() or 0
    sla = session.execute(text(
        f"SELECT count(*) FROM record_issues WHERE tenant_id = CAST(:t AS uuid) AND sla_state = 'breached' "
        f"AND {OPEN_ISSUE} AND scope NOT LIKE 'sandbox:%'" + (" AND module = ANY(:mods)" if wave_id else "")),
        {"t": tid, "mods": sorted({c["module"] for c in cells})}).scalar() or 0
    top_value, value_total = _value(session, tid, cells)
    return {
        "schedule_id": str(schedule["id"]) if schedule.get("id") else None, "name": schedule.get("name") or "Digest",
        "audience": schedule.get("audience"), "role": schedule.get("role"), "wave_id": wave_id,
        "tenant": tenant[0] if tenant else "", "currency": currency,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "landscape": {**sentence, "text": sentence_text(sentence)},
        "score_moves": _moves(session, tid, cells),
        "waves": _waves(session, tid, cells, wave_id),
        "approvals_waiting": int(approvals),
        "sla_breaches": int(sla),
        "value_at_risk": {"total": value_total, "top": top_value},
    }


# ── rendering ────────────────────────────────────────────────────────────────────────────────────────────────

def _money(x: Optional[float], currency: str) -> str:
    return "not priced" if x is None else f"{currency} {x:,.0f}"


def subject_of(d: dict) -> str:
    return f"Meridian digest: {d['name']}"


def summary_text(d: dict) -> str:
    """One paragraph for Slack, Teams and the in-app line: the numbers, no record data."""
    waves = d["waves"]
    open_ = sum(1 for w in waves if w["gate_open"])
    parts = [d["landscape"]["text"]]
    if waves:
        parts.append(f"{open_} of {len(waves)} wave gates open.")
    parts.append(f"{d['approvals_waiting']} fix batches waiting for approval; {d['sla_breaches']} SLA breaches.")
    parts.append(f"Value at risk: {_money(d['value_at_risk']['total'], d['currency'])}.")
    return " ".join(parts)


def html(d: dict, link: str = "") -> str:
    from workers import email_templates as mail

    land = d["landscape"]
    blocks = [mail.paragraph(land["text"]),
              mail.stats([mail.stat("Objects", land["objects"]),
                          mail.stat("Held under 85", land["held_under_85"], tone="critical" if land["held_under_85"] else None),
                          mail.stat("Approvals waiting", d["approvals_waiting"]),
                          mail.stat("SLA breaches", d["sla_breaches"], tone="critical" if d["sla_breaches"] else None)])]
    if d["score_moves"]:
        blocks += [mail.section("Score moves"),
                   mail.table(["System", "Object", "Before", "After", "Change"],
                              [(m["system"], m["module"], f"{m['before']:.1f}", f"{m['after']:.1f}",
                                f"{m['delta']:+.1f}") for m in d["score_moves"]], numeric_last=True)]
    if d["waves"]:
        blocks += [mail.section("Waves and gates"),
                   mail.table(["Wave", "Gate", "Not met"],
                              [(w["name"], "open" if w["gate_open"] else "closed", "; ".join(w["failing"]) or "none")
                               for w in d["waves"]])]
    vr = d["value_at_risk"]
    blocks += [mail.section("Top value at risk"),
               mail.paragraph(f"Total: {_money(vr['total'], d['currency'])}.")]
    if vr["top"]:
        blocks.append(mail.table(["Rule", "Object", "Failing records", "At risk"],
                                 [(v["check_id"], v["module"], f"{v['failing_records']:,}",
                                   _money(v["cost_at_risk"], d["currency"])) for v in vr["top"]], numeric_last=True))
    if link:
        blocks.append(mail.button("Open Meridian", link))
    return mail.render_email(title=d["name"], tenant=d["tenant"], preheader=land["text"], blocks=blocks)


def pdf(d: dict) -> bytes:
    """The digest through the report PDF path (api/services/pdf_reports.render, templates/digest_report.html)."""
    from api.services import pdf_reports

    when = datetime.now(timezone.utc)
    ctx = {"title": d["name"], "eyebrow": "Digest", "scope_label": d["tenant"],
           "generated_sast": pdf_reports.fmt_sast(when),
           "meta": [("Tenant", d["tenant"]), ("Generated", pdf_reports.fmt_dt(when)),
                    ("Audience", f"Wave {d['waves'][0]['name']}" if d["audience"] == "wave" and d["waves"]
                     else f"Role {d['role'] or ''}".strip())],
           "d": d, "money": lambda x: _money(x, d["currency"])}
    return pdf_reports.render("digest_report.html", ctx)


def webhook_data(d: dict) -> dict:
    """The ``digest.sent`` event: ids, names and numbers only (api/services/webhooks.check_payload)."""
    return {"schedule_id": d["schedule_id"], "name": d["name"], "audience": d["audience"], "role": d["role"],
            "wave_id": d["wave_id"], "objects": d["landscape"]["objects"],
            "held_under_85": d["landscape"]["held_under_85"],
            "critical_over_tolerance": d["landscape"]["critical_over_tolerance"],
            "release_if_fixed": d["landscape"]["release_if_fixed"], "approvals_waiting": d["approvals_waiting"],
            "sla_breaches": d["sla_breaches"], "value_at_risk_total": d["value_at_risk"]["total"],
            "currency": d["currency"], "waves_open": sum(1 for w in d["waves"] if w["gate_open"]),
            "waves": len(d["waves"])}


# ── sending (sync session, app.tenant_id set) ────────────────────────────────────────────────────────────────

_COLS = ("id, tenant_id, name, audience, role, wave_id, cron, timezone, channel, recipients, recipient_user_ids, "
         "alert_channel_id, attach_pdf, enabled, last_sent_at, next_run_at, created_by, created_at, updated_at")


def load(session, tenant_id: str, schedule_id: str) -> Optional[dict]:
    row = session.execute(text(f"SELECT {_COLS} FROM digest_schedules WHERE id = CAST(:id AS uuid) "
                               "AND tenant_id = CAST(:t AS uuid)"), {"id": str(schedule_id), "t": str(tenant_id)}).mappings().first()
    return dict(row) if row else None


def due(session, tenant_id: str, now: datetime) -> list[dict]:
    return [dict(r) for r in session.execute(text(
        f"SELECT {_COLS} FROM digest_schedules WHERE tenant_id = CAST(:t AS uuid) AND enabled "
        "AND next_run_at IS NOT NULL AND next_run_at <= :now ORDER BY next_run_at"),
        {"t": str(tenant_id), "now": now}).mappings().all()]


def recipients(session, tenant_id: str, schedule: dict) -> list[str]:
    """The addresses an email digest goes to: its addresses, its users (active, of this tenant) and, for a role
    digest with neither, every active user holding the role."""
    out = [str(a).strip() for a in schedule.get("recipients") or [] if str(a).strip()]
    ids = [str(u) for u in schedule.get("recipient_user_ids") or []]
    if ids:
        out += [r[0] for r in session.execute(text(
            "SELECT email FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active AND id = ANY(CAST(:ids AS uuid[])) "
            "ORDER BY email"), {"t": str(tenant_id), "ids": ids}) if r[0]]
    if not out and schedule.get("audience") == "role" and schedule.get("role"):
        out += [r[0] for r in session.execute(text(
            "SELECT email FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active AND role = :r ORDER BY email"),
            {"t": str(tenant_id), "r": schedule["role"]}) if r[0]]
    return list(dict.fromkeys(out))


def claim(session, tenant_id: str, schedule_id: str, due_at: datetime, manual: bool) -> Optional[str]:
    return session.execute(text(
        "INSERT INTO digest_deliveries (tenant_id, schedule_id, due_at, manual) VALUES (CAST(:t AS uuid), "
        "CAST(:s AS uuid), :d, :m) ON CONFLICT (schedule_id, due_at) DO NOTHING RETURNING id::text"),
        {"t": str(tenant_id), "s": str(schedule_id), "d": due_at, "m": manual}).scalar()


def _finish(session, tenant_id: str, delivery_id: str, status: str, delivered: int, failed: int,
            reason: Optional[str]) -> None:
    session.execute(text(
        "UPDATE digest_deliveries SET status = :st, delivered = :d, failed = :f, reason = :r, finished_at = now() "
        "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)"),
        {"st": status, "d": delivered, "f": failed, "r": (reason or None) and reason[:1000], "id": delivery_id,
         "t": str(tenant_id)})


def advance(session, schedule: dict, due_at: datetime, now: datetime) -> datetime:
    """Move next_run_at past now (compare-and-swap: only if nobody moved it meanwhile)."""
    nxt = next_run(schedule["cron"], schedule["timezone"], max(now, due_at))
    session.execute(text("UPDATE digest_schedules SET next_run_at = :n WHERE id = CAST(:id AS uuid) "
                         "AND tenant_id = CAST(:t AS uuid) AND next_run_at IS NOT DISTINCT FROM :due"),
                    {"n": nxt, "id": str(schedule["id"]), "t": str(schedule["tenant_id"]), "due": due_at})
    return nxt


def send(session, tenant_id: str, schedule: dict, due_at: datetime, *, manual: bool = False, base_url: str = "",
         send_email: Optional[Callable[..., bool]] = None, post: Optional[Callable[..., bool]] = None) -> Optional[dict]:
    """Claim the slot, build, render and deliver. None when the slot was already claimed. Commits."""
    from api.services.sandbox import held_back_sync

    tid = str(tenant_id)
    if str(schedule.get("tenant_id")) != tid:
        logger.error("digest %s refused: not a schedule of the tenant being processed", schedule.get("id"))
        return None
    did = claim(session, tid, str(schedule["id"]), due_at, manual)
    session.commit()
    if not did:
        return None
    if held_back_sync(session, tid, "digest", schedule["channel"], str(schedule["id"])):
        _finish(session, tid, did, "skipped", 0, 0, "sandbox")
        session.commit()
        return {"delivery_id": did, "status": "skipped", "reason": "sandbox", "delivered": 0, "failed": 0}
    if send_email is None:
        from workers.tasks.send_notifications import _deliver_email as send_email
    if post is None:
        from workers.tasks.report_schedules import post_channel as post
    delivered = failed = 0
    notes: list[str] = []
    try:
        d = build(session, tid, schedule)
        link = f"{base_url}/v2" if base_url else ""
        if schedule["channel"] == "webhook":
            from api.services import webhooks
            delivered = len(webhooks.emit(session, tid, "digest.sent", webhook_data(d)))
            if not delivered:
                notes.append("no active webhook subscribes to digest.sent")
        else:
            body = html(d, link)
            attachments = None
            if schedule.get("attach_pdf"):
                try:
                    attachments = [(f"meridian_digest_{datetime.now(timezone.utc):%Y%m%d}.pdf", pdf(d), "application/pdf")]
                except Exception as e:  # noqa: BLE001 - the email still goes, without the file
                    notes.append(f"PDF not attached ({type(e).__name__})")
            if schedule["channel"] == "email":
                targets = recipients(session, tid, schedule)
                if not targets:
                    notes.append("no recipients")
                for address in targets:
                    try:
                        ok = bool(send_email(address, subject_of(d), body, attachments))
                    except Exception as e:  # noqa: BLE001 - one failing address never stops the rest
                        logger.error("digest %s email raised: %s", schedule["id"], type(e).__name__)
                        ok = False
                    delivered, failed = delivered + ok, failed + (not ok)
            else:
                ch = session.execute(text(
                    "SELECT id, kind, target, secret FROM alert_channels WHERE tenant_id = CAST(:t AS uuid) AND enabled "
                    "AND id = CAST(:c AS uuid)"), {"t": tid, "c": str(schedule.get("alert_channel_id"))}).mappings().first() \
                    if schedule.get("alert_channel_id") else None
                if ch is None:
                    notes.append("the alert channel is gone or disabled")
                    failed = 1
                else:
                    try:
                        if ch["kind"] == "email":
                            ok = bool(send_email(ch["target"], subject_of(d), body, attachments))
                        else:
                            ok = bool(post(dict(ch), {"event": "meridian.digest", **webhook_data(d)},
                                           summary_text(d), link or "/v2"))
                    except Exception as e:  # noqa: BLE001
                        logger.error("digest %s channel raised: %s", schedule["id"], type(e).__name__)
                        ok = False
                    delivered, failed = int(ok), int(not ok)
    except Exception as e:  # noqa: BLE001 - recorded on the delivery row; never a stack trace to a caller
        session.rollback()
        logger.error("digest %s failed: %s", schedule.get("id"), type(e).__name__)
        _finish(session, tid, did, "failed", 0, 0, f"build failed ({type(e).__name__})")
        session.commit()
        return {"delivery_id": did, "status": "failed", "reason": f"build failed ({type(e).__name__})",
                "delivered": 0, "failed": 0}
    status = "sent" if delivered else "failed"  # a partial send is "sent" with the failures counted
    _finish(session, tid, did, status, delivered, failed, "; ".join(notes) or None)
    if delivered:
        session.execute(text("UPDATE digest_schedules SET last_sent_at = now() WHERE id = CAST(:id AS uuid) "
                             "AND tenant_id = CAST(:t AS uuid)"), {"id": str(schedule["id"]), "t": tid})
    session.commit()
    return {"delivery_id": did, "status": status, "reason": "; ".join(notes) or None, "delivered": delivered,
            "failed": failed}
