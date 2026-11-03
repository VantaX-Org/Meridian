"""Aletheia rule promotion: preview, apply, revert and "promote anyway" for the generated rules.

Classification is deterministic and local (api/services/rule_promotion.py). Reads need ``view``;
every write needs ``manage_rules`` (the permission the rules PATCH uses) and is audited.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.routes.rule_authoring import _dictionary, _latest
from api.services import rule_promotion as rp
from api.services.rbac import current_user_id, require_permission

router = APIRouter(prefix="/api/v1/rule-promotion", tags=["rule-promotion"])


class ApplyIn(BaseModel):
    module: str = Field(min_length=1, max_length=64)
    rule_ids: Optional[list[str]] = Field(None, max_length=5000)  # default: the whole promote bucket
    system_id: Optional[str] = None


class RevertIn(BaseModel):
    module: str = Field(min_length=1, max_length=64)
    rule_ids: Optional[list[str]] = Field(None, max_length=5000)  # default: every promotion of the module


class AnywayIn(BaseModel):
    module: str = Field(min_length=1, max_length=64)
    rule_ids: list[str] = Field(min_length=1, max_length=500)
    reason: str = Field(min_length=5, max_length=1000)
    system_id: Optional[str] = None


class ThresholdsIn(BaseModel):
    min_populated_pct: float = Field(ge=0, le=100)
    max_failure_rate: float = Field(ge=0, le=1)
    min_records: int = Field(ge=1)
    drift_delta: float = Field(ge=0, le=1)


def _module(m: str) -> str:
    if not rp.valid_module(m):
        raise HTTPException(status_code=404, detail="No generated rules for this module.")
    return m


async def _evaluate(db: AsyncSession, tenant: Tenant, module: str, system_id: Optional[str], only: Optional[set] = None):
    """(rows, version_id, thresholds). Dry-runs the module's generated rules against its latest extraction."""
    await _rls(db, tenant)
    th = await rp.thresholds(db, tenant.id)
    rules = [r for r in rp.generated_rules(module) if only is None or r["id"] in only]
    latest = await _latest(db, tenant, module, system_id)
    meta = (latest[1] or {}) if latest else {}
    d = await _dictionary(db, meta)
    snaps = []
    if meta.get("system_id"):
        snaps = (await db.execute(text("SELECT config_table, config_data FROM config_snapshots "
                                       "WHERE system_id = :s AND source = 'live'"), {"s": meta["system_id"]})).fetchall()
    refs = rp.live_references(snaps)

    def work():
        frames = None
        if meta.get("dataset_path"):
            from checks.runner import rule_columns
            from workers.dataset import load_dataset
            try:
                # ponytail: loads the dataset per request; cache frames per version if screens poll
                frames = load_dataset(meta["dataset_path"], d, [module], {c for r in rules for c in rule_columns(r)})[0]
            except Exception:
                frames = None
        return rp.classify(rules, frames, d, refs, th)

    return await run_in_threadpool(work), (str(latest[0]) if latest else None), th


@router.get("/modules", dependencies=[Depends(require_permission("view"))])
async def modules(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Modules with generated rules: pack size, promoted count and the last evaluation's bucket counts."""
    await _rls(db, tenant)
    out = []
    for m in rp.generated_modules():
        st = await rp.state(db, tenant.id, m)
        out.append({"module": m, "generated": len(rp.generated_rules(m)), "promoted": len(st.get("promoted") or {}),
                    "summary": st.get("summary"), "evaluated_at": st.get("at")})
    return {"modules": out}


@router.get("/preview", dependencies=[Depends(require_permission("view"))])
async def preview(module: str, system_id: Optional[str] = None, db: AsyncSession = Depends(get_db),
                  tenant: Tenant = Depends(get_tenant), request: Request = None):
    """Classify every generated rule of the module (no writes except the cached bucket counts),
    and flag promoted rules whose failure rate has drifted since promotion."""
    _module(module)
    rows, vid, th = await _evaluate(db, tenant, module, system_id)
    st = await rp.state(db, tenant.id, module)
    promoted = st.get("promoted") or {}
    c = rp.counts([r for r in rows if r["id"] not in promoted])
    flags = rp.drift(promoted, [r for r in rows if r["id"] in promoted], th, vid)
    for r in rows:
        r["promoted"] = r["id"] in promoted
    return {"module": module, "version_id": vid, "thresholds": th, "counts": c, "promoted": len(promoted),
            "drift": flags, "rules": rows, "narrative": rp.narrative(module, c, len(flags))}


async def _save_summary(db, tenant, request, module, st, rows):
    from datetime import datetime, timezone
    st["summary"] = rp.counts([r for r in rows if r["id"] not in (st.get("promoted") or {})])
    st["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    await rp.save_state(db, tenant.id, current_user_id(request), module, st)


@router.post("/apply")
async def apply(body: ApplyIn, request: Request, db: AsyncSession = Depends(get_db),
                tenant: Tenant = Depends(get_tenant), _perm: str = Depends(require_permission("manage_rules"))):
    """Enable the promote bucket (or the named subset of it). Evidence is recomputed here, never trusted from the client."""
    _module(body.module)
    rows, vid, th = await _evaluate(db, tenant, body.module, body.system_id)
    st = await rp.state(db, tenant.id, body.module)
    by_id = {r["id"]: r for r in rp.generated_rules(body.module)}
    pick = [r for r in rows if r["bucket"] == "promote" and r["id"] not in (st.get("promoted") or {})
            and (body.rule_ids is None or r["id"] in body.rule_ids)]
    for r in pick:
        await rp.enable(db, tenant.id, request, body.module, by_id[r["id"]], rp.evidence_of(r, th, vid, "auto", None), st)
    await _save_summary(db, tenant, request, body.module, st, rows)
    await db.commit()
    return {"enabled": [r["id"] for r in pick], "counts": st["summary"]}


@router.post("/promote-anyway")
async def promote_anyway(body: AnywayIn, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant), _perm: str = Depends(require_permission("manage_rules"))):
    """Manually enable review-bucket rules. Needs a reason, which is stored with the evidence in the audit log.
    Needs-value-set and skipped rules are refused: they would flag every customer value or judge nothing."""
    _module(body.module)
    rows, vid, th = await _evaluate(db, tenant, body.module, body.system_id, set(body.rule_ids))
    ok = {r["id"]: r for r in rows if r["bucket"] == "review"}
    bad = [i for i in body.rule_ids if i not in ok]
    if bad:
        raise HTTPException(status_code=422, detail={"not_in_review": bad})
    st = await rp.state(db, tenant.id, body.module)
    by_id = {r["id"]: r for r in rp.generated_rules(body.module)}
    for rid, r in ok.items():
        await rp.enable(db, tenant.id, request, body.module, by_id[rid],
                        rp.evidence_of(r, th, vid, "manual", body.reason.strip()), st)
    await rp.save_state(db, tenant.id, current_user_id(request), body.module, st)
    await db.commit()
    return {"enabled": list(ok)}


@router.post("/revert")
async def revert(body: RevertIn, request: Request, db: AsyncSession = Depends(get_db),
                 tenant: Tenant = Depends(get_tenant), _perm: str = Depends(require_permission("manage_rules"))):
    """Revert this promotion: the rules go back to their shipped (disabled) state."""
    _module(body.module)
    await _rls(db, tenant)
    st = await rp.state(db, tenant.id, body.module)
    ids = body.rule_ids if body.rule_ids is not None else list((st.get("promoted") or {}))
    done = await rp.revert(db, tenant.id, request, body.module, ids, st)
    await rp.save_state(db, tenant.id, current_user_id(request), body.module, st)
    await db.commit()
    return {"reverted": done}


@router.get("/thresholds", dependencies=[Depends(require_permission("view"))])
async def get_thresholds(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    return {**await rp.thresholds(db, tenant.id), "defaults": rp.DEFAULTS}


@router.put("/thresholds")
async def put_thresholds(body: ThresholdsIn, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant), _perm: str = Depends(require_permission("manage_rules"))):
    from api.services.tenant_settings import put_setting
    await _rls(db, tenant)
    await put_setting(db, tenant.id, rp.SETTING, body.model_dump(), current_user_id(request))
    await db.commit()
    return body.model_dump()
