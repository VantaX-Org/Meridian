"""Extraction targets: the target system and per-object target templates chosen when an extraction starts,
and the automatic fill of each template once the run is stored.

The fill itself is the on-demand one (api/routes/migration._export_workbook); this module only chooses what to
fill, stores the outcome on the run (analysis_versions.extract_target) and mirrors it on the job.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text

logger = logging.getLogger("meridian.extract_target")
BUCKET_PREFIX = "autofill"


class TemplateFillOut(BaseModel):
    """One assigned template and, once the run has been stored, how its automatic fill went."""
    model_config = ConfigDict(extra="allow")
    module: str
    template_id: str
    template_name: Optional[str] = None
    status: str = "pending"  # pending | filled | failed
    error: Optional[str] = None
    filled_at: Optional[str] = None
    format: Optional[str] = None
    summary: Optional[dict[str, Any]] = None
    download_url: Optional[str] = None


class ExtractTargetOut(BaseModel):
    """The target chosen for an extraction: a target system, templates per module, or both."""
    model_config = ConfigDict(extra="allow")
    target_system_id: Optional[str] = None
    templates: list[TemplateFillOut] = []


def choose_target(source_id: str, source_paired: Optional[str], modules: list[str], target_system_id: Optional[str],
                  template_ids: Optional[dict[str, str]], systems: dict[str, dict], templates: dict[str, dict],
                  latest: dict[str, str]) -> dict:
    """Validate and default the chosen target. Raises 422 with a message on a bad choice.

    ``systems``: id to {role} for the tenant's systems; ``templates``: id to {module, name} for the tenant's
    templates; ``latest``: module to the id of its newest template."""
    tid = target_system_id or source_paired
    if target_system_id:
        s = systems.get(target_system_id)
        if s is None:
            raise HTTPException(422, "The target system is not one of this tenant's systems.")
        if s["role"] != "target" and target_system_id != source_paired:
            raise HTTPException(422, "The target system must have the target role or be the system paired to this source.")
    chosen: dict[str, str] = {}
    for module, tpl in (template_ids or {}).items():
        t = templates.get(str(tpl).lower())
        if module not in modules:
            raise HTTPException(422, f"Template given for {module}, which is not among the requested modules.")
        if t is None:
            raise HTTPException(422, f"Template {tpl} is not one of this tenant's templates.")
        if t["module"] != module:
            raise HTTPException(422, f"Template {tpl} belongs to {t['module']}, not {module}.")
        chosen[module] = str(tpl).lower()
    for m in modules:
        if m not in chosen and m in latest:
            chosen[m] = latest[m]
    return {"target_system_id": tid, "templates": [
        {"module": m, "template_id": chosen[m], "template_name": templates.get(chosen[m], {}).get("name"),
         "status": "pending"} for m in modules if m in chosen]}


async def resolve_target(db: Any, tenant_id: str, source_id: str, modules: list[str],
                         target_system_id: Optional[str], template_ids: Optional[dict[str, str]]) -> Optional[dict]:
    """``choose_target`` over the tenant's rows. None when nothing is assigned (no target, no template)."""
    await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": str(tenant_id)})
    rows = (await db.execute(text("SELECT CAST(id AS text), role, CAST(target_system_id AS text) FROM sap_systems "
                                  "WHERE tenant_id = :t"), {"t": str(tenant_id)})).fetchall()
    systems = {r[0]: {"role": r[1]} for r in rows}
    paired = next((r[2] for r in rows if r[0] == str(source_id)), None)
    trows = (await db.execute(text("SELECT CAST(id AS text), module, name, version FROM target_templates "
                                   "WHERE tenant_id = :t ORDER BY name, version DESC"), {"t": str(tenant_id)})).fetchall()
    templates = {r[0]: {"module": r[1], "name": r[2], "version": r[3]} for r in trows}
    latest: dict[str, str] = {}
    created = (await db.execute(text("SELECT CAST(id AS text), module FROM target_templates WHERE tenant_id = :t "
                                     "ORDER BY created_at DESC"), {"t": str(tenant_id)})).fetchall()
    for tid, module in created:  # newest upload per module wins
        latest.setdefault(module, tid)
    out = choose_target(str(source_id), paired, modules, target_system_id, template_ids, systems, templates, latest)
    return out if out["target_system_id"] or out["templates"] else None


def file_key(tenant_id: str, version_id: str, module: str, ext: str) -> str:
    return f"{BUCKET_PREFIX}/{tenant_id}/{version_id}/{module}.{ext}"


def download_url(version_id: str, module: str) -> str:
    return f"/api/v1/versions/{version_id}/extract-target/{module}/file"


def _save(session: Any, tenant_id: str, version_id: str, target: dict) -> None:
    import json
    session.execute(text("UPDATE analysis_versions SET extract_target = CAST(:x AS jsonb) "
                         "WHERE id = CAST(:v AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                    {"x": json.dumps(target), "v": version_id, "t": str(tenant_id)})
    session.commit()


def autofill(session: Any, tenant_id: str, version_id: str, target: dict) -> dict:
    """Fill each assigned template from the stored run with the on-demand export, store the file, set
    last_fill_version_id and audit it. A failed fill is recorded on its entry and never raised."""
    import datetime

    from api.config import settings
    from api.routes.migration import _export_workbook
    from api.services import storage
    from api.services.purge import write_audit_row

    for entry in target.get("templates", []):
        try:
            row = session.execute(text("SELECT name, version, filename, column_map, content FROM target_templates "
                                       "WHERE CAST(id AS text) = :i AND module = :m AND tenant_id = CAST(:t AS uuid)"),
                                  {"i": entry["template_id"], "m": entry["module"], "t": str(tenant_id)}).fetchone()
            if row is None:
                raise ValueError("Template no longer exists.")
            content, ext, summary = _export_workbook(tenant_id, version_id, bytes(row[4]), row[2], "xlsx",
                                                     row[3] or {}, True, fresh=True)
            key = file_key(tenant_id, version_id, entry["module"], ext)
            storage.upload_file(settings.minio_bucket_reports, key, content, suppress=False)
            session.execute(text("UPDATE target_templates SET last_fill_at = now(), last_fill_version_id = :v "
                                 "WHERE id = CAST(:i AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                            {"v": version_id, "i": entry["template_id"], "t": str(tenant_id)})
            write_audit_row(session, tenant_id, None, "migration.template.autofill", "target_template",
                            entry["template_id"], {"format": "xlsx", "version_id": version_id, **summary})
            entry.update(status="filled", error=None, format=ext, summary=summary,
                         filled_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                         download_url=download_url(version_id, entry["module"]))
        except Exception as e:  # noqa: BLE001 - a fill must never fail the extraction
            session.rollback()
            logger.warning("auto-fill of template %s for %s failed: %s", entry.get("template_id"), version_id, e)
            detail = getattr(e, "detail", None) or str(e) or e.__class__.__name__
            entry.update(status="failed", error=re.sub(r"\s+", " ", str(detail))[:300])
        _save(session, tenant_id, version_id, target)
    return target
