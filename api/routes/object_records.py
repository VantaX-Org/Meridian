"""Generalized record fix sheet — api/routes/object_records.py.

GET /api/v1/objects/{object}/records/{key} is the object-agnostic entry point the
/objects/[object]/records/[key] page calls. Wave 1b wired material_master,
delegating to the existing, unchanged api/services/material_360.py logic that
api/routes/materials.py already exposes at /api/v1/materials/{matnr}. Wave 3
adds business_partner, keyed by BUT000.PARTNER: it reuses the same _tables
loader (generalised to take a module name) and returns the same Material360Out
shape the frontend record page already renders generically (identity + view
matrix), with the material-only sections (makt/marc/... and the view matrix)
left empty since BUT000 has no equivalent. Every other object gets the generic sheet
(_generic_record): the row of the run's data that carries the record's key fields, read
from only the tables that hold them, plus the rules it fails in that run
(GET /{object}/records/{key}/findings).
"""
import re
import uuid
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.deps import Tenant, get_db, get_tenant
from api.routes.materials import Material360Out, _norm, _tables
from api.routes.rule_authoring import _dictionary, _latest, _rls
from api.services import material_360 as m360
from api.services.rbac import require_permission
from sap.data_dictionary import DATA_DICTIONARY

router = APIRouter(prefix="/api/v1/objects", tags=["objects"])

_SUPPORTED = {"material_master", "business_partner"}

# BUT000 fields worth surfacing in the Identity "labels" bag, in priority order.
# The names are the SAP field names the data dictionary carries (BUT000.TYPE is
# SAP's "business partner category"; BU_TYPE is its data element).
_BP_LABEL_FIELDS = ("PARTNER", "TYPE", "NAME1", "NAME_ORG1")


def _bp_label(field: str, raw: Optional[str]) -> Optional[str]:
    """Human-readable value for a BUT000 field: decode via the data dictionary's
    standard_values (e.g. BU_TYPE "2" -> "Organisation (legal entity)") when
    available, else the raw field value as-is."""
    if raw is None:
        return None
    standard_values = DATA_DICTIONARY.get("BUT000", {}).get(field, {}).get("standard_values") or {}
    return standard_values.get(raw, raw)


def _business_partner_record(tables: dict, partner: str) -> Optional[dict[str, Any]]:
    """Material360Out-shaped payload for one BUT000 row, keyed by PARTNER.

    BUT000 carries none of the material-specific tables/matrix, so those stay
    empty lists rather than fabricated data; the frontend's record page
    already renders material-only sections conditionally.
    """
    but000 = tables.get("BUT000")
    if but000 is None or but000.empty or "PARTNER" not in but000.columns:
        return None
    s = but000["PARTNER"].astype("string").str.strip()
    row = but000[(s == partner) | (s == partner.lstrip("0")) | (s.str.zfill(10) == partner)]
    if row.empty:
        return None
    r = row.iloc[0]
    mara = {c: m360._s(r[c]) for c in but000.columns}
    description = mara.get("NAME1") or mara.get("PARTNER")
    labels = {f: _bp_label(f, mara.get(f)) for f in _BP_LABEL_FIELDS if f in but000.columns}
    return {
        "matnr": mara.get("PARTNER") or partner, "description": description, "language": None,
        "mara": mara, "makt": [], "marm": [], "mean": [], "marc": [], "mvke": [], "mbew": [],
        "mard": [], "mlgn": [], "labels": labels,
        "expected_views": None, "expected_known": False,
        "levels": [{"id": "client", "kind": "client", "plant": None}], "levels_total": 1,
        "views": [],
        "phasing": {"plants": 0, "phasing_out": 0, "with_followup": 0, "plant": None, "ausdt": None,
                    "nfmat": None, "followup_description": None},
    }


# Fields that read as a record's name, in the order they are tried.
_NAME_FIELDS = ("NAME1", "NAME_ORG1", "MAKTX", "TXT50", "LTEXT", "KTEXT", "BUTXT", "TXT20", "STEXT", "firstName", "lastName")


def key_fields(key: str) -> dict[str, str]:
    """{FIELD: value} of a composite record key (`LIFNR=V9|BUKRS=2000`); {} for a bare key."""
    return {k.strip().split(".")[-1]: v.strip() for k, v in (p.split("=", 1) for p in key.split("|") if "=" in p)}


def _same(col: pd.Series, value: str) -> pd.Series:
    s = col.astype("string").str.strip()
    return (s == value) | (s.str.lstrip("0") == value.lstrip("0"))


def find_record(tables: dict[str, pd.DataFrame], fields: dict[str, str]) -> Optional[tuple[str, dict[str, Any]]]:
    """(table, row) of the first table whose columns hold every key field and has a row with those values."""
    for name, df in tables.items():
        if df is None or df.empty or not fields or not all(f in df.columns for f in fields):
            continue
        mask = pd.Series(True, index=df.index)
        for f, v in fields.items():
            mask &= _same(df[f], v)
        hit = df[mask]
        if not hit.empty:
            return name, {c: (None if pd.isna(x) else str(x)) for c, x in hit.iloc[0].items()}
    return None


def _generic_record(table: str, row: dict[str, Any], key: str, fields: dict[str, str]) -> dict[str, Any]:
    """Material360Out-shaped payload for any object: the row's fields, its key as identity labels."""
    name = next((row[f] for f in _NAME_FIELDS if row.get(f)), None)
    return {
        "matnr": key, "description": name, "language": None,
        "mara": row, "makt": [], "marm": [], "mean": [], "marc": [], "mvke": [], "mbew": [], "mard": [], "mlgn": [],
        "labels": {"Table": table, **fields},
        "expected_views": None, "expected_known": False,
        "levels": [{"id": "client", "kind": "client", "plant": None}], "levels_total": 1, "views": [],
        "phasing": {"plants": 0, "phasing_out": 0, "with_followup": 0, "plant": None, "ausdt": None,
                    "nfmat": None, "followup_description": None},
    }


async def _version(db: AsyncSession, tenant: Tenant, version_id: Optional[uuid.UUID], module: str):
    await _rls(db, tenant)
    if version_id:
        return (await db.execute(text("SELECT id, metadata FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                                 {"v": str(version_id), "t": str(tenant.id)})).fetchone()
    return await _latest(db, tenant, module, None)


async def _module_tables(db: AsyncSession, vid, module: str) -> set[str]:
    """Tables this run's rules read for ``module``, from the fields its findings checked."""
    rows = (await db.execute(text("""
        SELECT DISTINCT details->>'field_checked' FROM findings WHERE version_id = :v AND module = :m"""),
        {"v": str(vid), "m": module})).scalars().all()
    return {m.group(1) for r in rows if r for m in re.finditer(r"\b([A-Z][A-Z0-9_/]*)\.[A-Za-z0-9_/]+", r)}


async def _generic(db: AsyncSession, tenant: Tenant, object: str, key: str, version_id: Optional[uuid.UUID]):
    fields = key_fields(key)
    if not fields:
        raise HTTPException(422, "This record key names no fields, so the record cannot be looked up.")
    row = await _version(db, tenant, version_id, object)
    path = (row[1] or {}).get("dataset_path") if row else None
    if not row or not path:
        raise HTTPException(409, f"No analysis version with an extracted dataset for {object}")
    names = await _module_tables(db, row[0], object)
    d = await _dictionary(db, row[1])

    def load() -> dict[str, pd.DataFrame]:
        from checks.frames import unprefix
        from workers.dataset import load_dataset
        frames = load_dataset(path, d, [object], tables=names or None)[0].frames
        return {t: unprefix(t, f) for t, f in frames.items() if isinstance(f, pd.DataFrame)}

    hit = find_record(await run_in_threadpool(load), fields)
    if hit is None:
        raise HTTPException(404, "Record not found")
    return {**_generic_record(hit[0], hit[1], key, fields), "version_id": row[0]}


def _parse_key(key: str) -> tuple[str, Optional[str]]:
    """(material number, plant) from a record key.

    The rule page links composite keys as `FIELD=value|FIELD=value`
    (e.g. `MATNR=000000000000000101|WERKS=3000`); a key without `=` is a bare matnr.
    """
    if "=" not in key:
        return key, None
    fields = dict(part.split("=", 1) for part in key.split("|") if "=" in part)
    matnr = fields.get("MATNR")
    if not matnr:
        raise HTTPException(422, "Composite record key must include MATNR")
    return matnr, fields.get("WERKS") or None


@router.get("/{object}/records/{key}", response_model=Material360Out,
            dependencies=[Depends(require_permission("view"))])
async def get_object_record(object: str, key: str, version_id: Optional[uuid.UUID] = None,
                            plant: Optional[str] = None,
                            db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    if object not in _SUPPORTED:
        return await _generic(db, tenant, object, key.strip(), version_id)
    if object == "business_partner":
        vid, tables = await _tables(db, tenant, version_id, {"BUT000"}, module="business_partner")
        out = _business_partner_record(tables, key.strip())
        if out is None:
            raise HTTPException(404, "Record not found")
        return {**out, "version_id": vid}
    matnr, key_plant = _parse_key(key)
    plant = plant or key_plant
    vid, tables = await _tables(db, tenant, version_id, set(m360.CORE_TABLES) | set(m360.OPTIONAL_TABLES))
    out = m360.build_material(tables, _norm(matnr))
    if out is None:
        raise HTTPException(404, "Record not found")
    out["levels"], out["levels_total"] = m360.cap_levels(out["levels"], plant)
    shown = {lv["id"] for lv in out["levels"]}
    for row in out["views"]:
        row["cells"] = [c for c in row["cells"] if c["level"] in shown]
    return {**out, "version_id": vid}


class RecordFinding(BaseModel):
    check_id: str
    severity: str
    message: Optional[str] = None
    field: Optional[str] = None


class RecordFindingsOut(BaseModel):
    version_id: Optional[str]
    failing: list[RecordFinding]


@router.get("/{object}/records/{key}/findings", response_model=RecordFindingsOut,
            dependencies=[Depends(require_permission("view"))])
async def get_object_record_findings(object: str, key: str, version_id: Optional[uuid.UUID] = None,
                                     db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The rules this record fails in the run: its open issues last seen there, with each rule's message."""
    row = await _version(db, tenant, version_id, object)
    if not row:
        return {"version_id": None, "failing": []}
    rows = (await db.execute(text("""
        SELECT ri.check_id, ri.severity, MAX(f.details->>'message') AS message, MAX(f.details->>'field_checked') AS field
          FROM record_issues ri
          LEFT JOIN findings f ON f.version_id = ri.last_seen_version AND f.check_id = ri.check_id AND f.module = ri.module
         WHERE ri.tenant_id = :t AND ri.module = :m AND ri.record_key = :k AND ri.last_seen_version = :v
           AND ri.status IN ('open', 'in_progress')
         GROUP BY ri.check_id, ri.severity
         ORDER BY ri.check_id"""),
        {"t": str(tenant.id), "m": object, "k": key.strip(), "v": str(row[0])})).mappings().all()
    return {"version_id": str(row[0]), "failing": [dict(r) for r in rows]}
