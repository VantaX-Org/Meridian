"""Generalized record fix sheet — api/routes/object_records.py.

GET /api/v1/objects/{object}/records/{key} is the object-agnostic entry point the
/objects/[object]/records/[key] page calls. Wave 1b wired material_master,
delegating to the existing, unchanged api/services/material_360.py logic that
api/routes/materials.py already exposes at /api/v1/materials/{matnr}. Wave 3
adds business_partner, keyed by BUT000.PARTNER: it reuses the same _tables
loader (generalised to take a module name) and returns the same Material360Out
shape the frontend record page already renders generically (identity + view
matrix), with the material-only sections (makt/marc/... and the view matrix)
left empty since BUT000 has no equivalent. Any other object still returns 501
so the frontend shows "not yet available" rather than guessing at a shape.
"""
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.materials import Material360Out, _norm, _tables
from api.services import material_360 as m360
from api.services.rbac import require_permission
from sap.data_dictionary import DATA_DICTIONARY

router = APIRouter(prefix="/api/v1/objects", tags=["objects"])

_SUPPORTED = {"material_master", "business_partner"}

# BUT000 fields worth surfacing in the Identity "labels" bag, in priority order.
_BP_LABEL_FIELDS = ("PARTNER", "BU_TYPE", "NAME1", "NAME_ORG1")


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
        raise HTTPException(501, f"Record fix sheet not yet available for object '{object}'")
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
