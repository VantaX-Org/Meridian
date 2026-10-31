"""Readiness certificate of a migration wave: what was measured, on which run, signed by each owner.

POST /api/v1/migration/waves/{id}/certificate builds the certificate content from stored data only: per object of the
wave its newest finished run (on the wave's source system when it names one), the measured score before the cap and
the shown score, the cap and the critical rules over tolerance, the open critical records, the signed-off exceptions
with their approver and date, and the status of the data contracts that cover the object. The content is hashed
(SHA-256 over canonical JSON) and the hash and the certificate id are printed on the PDF, which goes through the report
pipeline (api/services/pdf_reports.render) and the report history (kind ``readiness_certificate``).

The gate: no certificate while any object of the wave has a critical rule over tolerance, or was never measured.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.receipt_math import breach_ids, cap_level_of, rule_names

KIND = "readiness_certificate"
LEAD_ROLES = frozenset({"programme_lead", "manager", "admin", "platform_admin"})
DEFAULT_STATEMENT = ("I confirm the objects of this wave are ready to migrate as measured on the runs this "
                     "certificate names.")
OPEN_ISSUE = ("open", "in_progress")


class GateRefused(Exception):
    def __init__(self, reasons: list[dict]):
        super().__init__("gate refused")
        self.reasons = reasons


def refusal(reasons: list[dict], detail: str = "The wave is not ready to certify.") -> dict:
    """The 409 body of a refused certificate (F18): the sentence, the objects as before (``objects``), and
    ``reasons``, one per object with its label, the reason in words, the rules in the way and where to open each."""
    from api.services import app_links
    from api.services.migration import object_label

    out = []
    for r in reasons:
        m = r.get("module")
        rules = list(r.get("rules") or [])
        out.append({"module": m, "label": object_label(m) if m else None, "reason": r["reason"],
                    "sentence": (f"{object_label(m)}: {r['reason']}" + (f" ({', '.join(rules)})" if rules else ""))
                    if m else r["reason"].capitalize() + ".",
                    "rules": [{"check_id": c, "href": app_links.rule(c)} for c in rules],
                    "href": app_links.object_page(m) if m else None})
    return {"detail": detail, "objects": reasons, "reasons": out}


def canonical(content: dict) -> bytes:
    return json.dumps(content, sort_keys=True, separators=(",", ":"), default=str).encode()


def content_hash(content: dict) -> str:
    return hashlib.sha256(canonical(content)).hexdigest()


async def owners_of(db: AsyncSession, tenant_id: str, modules: list[str]) -> dict[str, dict]:
    """{user id: {name, modules}} of the data owners of the wave's objects."""
    out: dict[str, dict] = {}
    for ref, uid, name in (await db.execute(text(
            "SELECT d.ref, d.owner_user_id::text, u.name FROM data_owners d JOIN users u ON u.id = d.owner_user_id "
            "WHERE d.tenant_id = :t AND d.kind = 'object' AND d.ref = ANY(:m) ORDER BY d.ref"),
            {"t": tenant_id, "m": modules})).fetchall():
        out.setdefault(uid, {"name": name, "modules": []})["modules"].append(ref)
    return out


async def _objects(db: AsyncSession, tenant_id: str, wave: Any) -> list[dict]:
    from api.services.migration import object_label
    from api.services.run_context import latest_run

    out = []
    sid = str(wave.source_system_id) if wave.source_system_id else None
    for m in list(wave.modules or []):
        rid = await latest_run(db, tenant_id, system_id=sid, module=m)
        row = (await db.execute(text("SELECT run_at, dqs_summary FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                                {"v": rid, "t": tenant_id})).fetchone() if rid else None
        s = ((row[1] or {}).get(m) if row and isinstance(row[1], dict) else None) or {}
        ids = breach_ids(s)
        names = await rule_names(db, _T(tenant_id), ids)
        crit_rules = (await db.execute(text(
            "SELECT count(*) FROM findings WHERE tenant_id = :t AND version_id = :v AND module = :m "
            "AND severity = 'critical' AND affected_count > 0"), {"t": tenant_id, "v": rid, "m": m})).scalar() if rid else None
        crit_records = (await db.execute(text(
            "SELECT count(*) FROM record_issues WHERE tenant_id = :t AND module = :m AND severity = 'critical' "
            "AND status = ANY(:open) AND (CAST(:s AS text) IS NULL OR scope = :s)"),
            {"t": tenant_id, "m": m, "open": list(OPEN_ISSUE), "s": sid})).scalar()
        out.append({
            "module": m, "label": object_label(m), "run_id": rid, "run_at": row[0].isoformat() if row else None,
            "measured": s.get("raw_score"), "shown": s.get("composite_score"), "cap_level": cap_level_of(s) if s else None,
            "breaches": [{"check_id": c, "name": names.get(c)} for c in ids],
            "open_critical_rules": int(crit_rules) if crit_rules is not None else None,
            "open_critical_records": int(crit_records or 0),
            "measured_ok": bool(s) and s.get("composite_score") is not None,
        })
    return out


class _T:
    """The minimal tenant object receipt_math.rule_names reads (``.id``)."""
    def __init__(self, tid: str):
        self.id = uuid.UUID(tid)


async def _exceptions(db: AsyncSession, tenant_id: str, modules: list[str]) -> list[dict]:
    """Signed-off record issues of the wave's objects (accepted risk, not an issue), per rule and approver."""
    rows = (await db.execute(text("""
        SELECT ri.module, ri.check_id, ri.resolution, ev.user_label AS approver, count(*) AS records,
               max(COALESCE(ri.resolved_at, ev.created_at)) AS approved_at
          FROM record_issues ri
          LEFT JOIN LATERAL (SELECT e.user_label, e.created_at FROM record_issue_events e
                              WHERE e.issue_id = ri.id AND e.action = 'status' AND e.to_value = 'accepted'
                              ORDER BY e.created_at DESC LIMIT 1) ev ON true
         WHERE ri.tenant_id = :t AND ri.module = ANY(:m) AND ri.status = 'accepted'
           AND ri.resolution IN ('accepted_risk', 'false_positive')
         GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 4"""), {"t": tenant_id, "m": modules})).mappings().all()
    return [{"module": r["module"], "check_id": r["check_id"], "resolution": r["resolution"],
             "approver": r["approver"], "records": int(r["records"]),
             "approved_at": r["approved_at"].isoformat() if r["approved_at"] else None} for r in rows]


async def _contracts(db: AsyncSession, tenant_id: str, objects: list[dict]) -> list[dict]:
    """Active contracts covering a wave object: the latest compliance record and the contract's breaches on the runs
    the objects were measured on (api/services/contract_enforcement.py)."""
    from api.services import contract_enforcement as ce
    from api.services.contract_compliance import scope_modules

    modules = [o["module"] for o in objects]
    out = []
    for c in await ce.active(db, tenant_id):
        covered = scope_modules(c, modules)
        if not covered:
            continue
        last = (await db.execute(text(
            "SELECT overall_compliant, recorded_at FROM contract_compliance_history WHERE tenant_id = :t "
            "AND contract_id = :c ORDER BY recorded_at DESC LIMIT 1"), {"t": tenant_id, "c": c["id"]})).fetchone()
        breaches = 0
        for o in objects:
            if o["module"] in covered and o["run_id"]:
                breaches += len(await ce.breaches_for_run(db, tenant_id, c, o["run_id"], [o["module"]]))
        out.append({"contract_id": str(c["id"]), "name": c["name"], "modules": covered, "enforce": bool(c.get("enforce")),
                    "compliant": None if last is None else bool(last[0]),
                    "checked_at": last[1].isoformat() if last else None, "breaches": breaches})
    return out


async def build(db: AsyncSession, tenant_id: str, wave: Any, tenant_name: str, version: int,
                issued_by: str | None) -> dict:
    """The certificate content, or GateRefused when an object holds a critical rule over tolerance or is unmeasured."""
    objects = await _objects(db, tenant_id, wave)
    refused = [{"module": o["module"], "reason": "not measured"} for o in objects if not o["measured_ok"]]
    refused += [{"module": o["module"], "reason": "critical over tolerance",
                 "rules": [b["check_id"] for b in o["breaches"]]} for o in objects if o["breaches"]]
    if refused or not objects:
        raise GateRefused(refused or [{"module": None, "reason": "the wave has no objects"}])
    return {
        "certificate_id": str(uuid.uuid4()), "version": version, "tenant": tenant_name,
        "issued_at": datetime.now(timezone.utc).isoformat(), "issued_by": issued_by,
        "wave": {"id": str(wave.id), "name": wave.name, "stage": wave.stage, "target_release": wave.target_release,
                 "target_date": str(wave.target_date) if wave.target_date else None,
                 "min_dqs": wave.min_dqs, "source_system_id": str(wave.source_system_id) if wave.source_system_id else None},
        "objects": [{k: v for k, v in o.items() if k != "measured_ok"} for o in objects],
        "measured_on": [{"module": o["module"], "run_id": o["run_id"], "run_at": o["run_at"]} for o in objects],
        "exceptions": await _exceptions(db, tenant_id, [o["module"] for o in objects]),
        "contracts": await _contracts(db, tenant_id, objects),
    }


def pdf_context(content: dict, sha: str) -> dict:
    from api.services.pdf_reports import fmt_n, fmt_sast

    w = content["wave"]
    return {
        "title": f"Readiness certificate: {w['name']}",
        "eyebrow": "Migration readiness",
        "scope_label": content["tenant"],
        "generated_at": datetime.fromisoformat(content["issued_at"]),
        "generated_sast": fmt_sast(content["issued_at"]),
        "meta": [("Wave", w["name"]), ("Stage", w["stage"]), ("Version", str(content["version"])),
                 ("Certificate", content["certificate_id"]), ("Issued by", content["issued_by"] or "system"),
                 ("Minimum DQS", fmt_n(w["min_dqs"], 1) if w["min_dqs"] is not None else "Not set")],
        "c": content, "sha256": sha,
    }


async def certificates(db: AsyncSession, tenant_id: str, wave_id: str) -> list[dict]:
    """Every version of the wave's certificate, newest first, with its signatures."""
    certs = (await db.execute(text(
        "SELECT id::text, version, status, content_sha256, report_file_id::text, created_by_label, created_at, "
        "content->'measured_on' AS measured_on FROM wave_certificates WHERE tenant_id = :t AND wave_id = :w "
        "ORDER BY version DESC"), {"t": tenant_id, "w": wave_id})).mappings().all()
    sigs: dict[str, list[dict]] = {}
    if certs:
        for r in (await db.execute(text(
                "SELECT certificate_id::text, user_id::text, user_label, statement, signed_at FROM wave_certificate_signatures "
                "WHERE tenant_id = :t AND certificate_id = ANY(CAST(:ids AS uuid[])) ORDER BY signed_at"),
                {"t": tenant_id, "ids": [c["id"] for c in certs]})).mappings().all():
            sigs.setdefault(r["certificate_id"], []).append(
                {"user_id": r["user_id"], "user": r["user_label"], "statement": r["statement"],
                 "signed_at": r["signed_at"].isoformat()})
    return [{"id": c["id"], "version": c["version"], "status": c["status"], "sha256": c["content_sha256"],
             "report_file_id": c["report_file_id"], "issued_by": c["created_by_label"],
             "issued_at": c["created_at"].isoformat(), "measured_on": c["measured_on"] or [],
             "signatures": sigs.get(c["id"], [])} for c in certs]
