"""Email, phone and address verification: the latest result of every contact rule, and its one setting.

GET  /api/v1/contact-verification            per rule: reasons counted, sampled records with their own reason,
                                             fixes waiting in the cleansing queue; plus the MX lookup setting
PUT  /api/v1/contact-verification/settings   turn the MX lookup on or off (manage_settings, audited)

Rules are the contact packs (BP900, SDCM900 and EC900 onward) and the generated address rules against the uploaded
postal reference (PC-, PR-, PX-). Values in samples stay masked as the check engine wrote them.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.rbac import current_user_id, require_permission, write_audit
from api.services.tenant_settings import get_setting, put_setting
from checks.country_rules import rule_name

router = APIRouter(prefix="/api/v1", tags=["contact-verification"])
KEY = "contact_verify"
_SQL = text(r"""
SELECT DISTINCT ON (check_id) check_id, module, affected_count, total_count, pass_rate, details,
       COALESCE(jsonb_array_length(record_fixes), 0) AS fixes, created_at
FROM findings
WHERE tenant_id = :t AND (check_id ~ '^(BP|SDCM|EC)9[0-9]{2}(-MX)?$' OR check_id ~ '^(PC|PR|PX)-')
ORDER BY check_id, created_at DESC
""")


def _setting(raw) -> dict:
    return {"mx": bool((raw or {}).get("mx"))}


@router.get("/contact-verification", dependencies=[Depends(require_permission("view"))])
async def get_contact_verification(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    rows = (await db.execute(_SQL, {"t": str(tenant.id)})).mappings().all()
    rules = []
    for r in rows:
        d = r["details"] or {}
        rules.append({
            "check_id": r["check_id"], "module": r["module"],
            "message": d.get("message") or rule_name(r["check_id"]) or r["check_id"],
            "field": d.get("field_checked"), "affected": r["affected_count"], "total": r["total_count"],
            "pass_rate": r["pass_rate"], "reasons": d.get("reasons") or {}, "fixes": r["fixes"],
            "samples": [{"record_key": s.get("record_key"), "value": s.get("invalid_value"),
                         "reason": s.get("reason"), "reason_text": s.get("reason_text")}
                        for s in d.get("sample_failing_records") or []],
            "checked_at": r["created_at"].isoformat() if r["created_at"] else None,
        })
    return {"rules": rules, "settings": _setting(await get_setting(db, tenant.id, KEY))}


class SettingsIn(BaseModel):
    mx: bool


@router.put("/contact-verification/settings", dependencies=[Depends(require_permission("manage_settings"))])
async def put_contact_verification(body: SettingsIn, request: Request, db: AsyncSession = Depends(get_db),
                                   tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    before = _setting(await get_setting(db, tenant.id, KEY))
    after = {"mx": body.mx}
    await put_setting(db, tenant.id, KEY, after, current_user_id(request))
    await write_audit(db, tenant.id, request, "contact_verify_settings", "tenant_settings", KEY, before, after)
    await db.commit()
    return after
