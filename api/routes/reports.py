"""Routes for report download."""

import asyncio
import json
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from fastapi.routing import APIRoute
from starlette.background import BackgroundTask
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.report_pdf import (
    ReportNotAssembled,
    build_and_store_pdf,
)
from api.services.pdf_reports import _modules
from api.services.rbac import require_permission
from api.services.storage import download_file
from api.config import settings
from db.schema import Report

logger = logging.getLogger("meridian.reports")


def _store_in_history(tenant_id: str, kind: str, data: bytes, file_name: str, content_type: str,
                      version_id: Optional[str], params: dict, user_id: Optional[str], email: Optional[str]) -> None:
    """Background, after the file has gone out: keep it in report_files (migration 089). Never
    raises; a failure costs the history row, never the download."""
    from api.services.report_history import store_report_file
    from workers.db import get_sync_engine, tenant_session

    try:
        with tenant_session(get_sync_engine(), tenant_id) as session:
            if user_id and not session.execute(text("SELECT 1 FROM users WHERE id = CAST(:u AS uuid)"),
                                               {"u": user_id}).scalar():
                user_id = None  # created_by is a users FK; a dev or service caller has no row
            if version_id and not session.execute(text("SELECT 1 FROM analysis_versions WHERE id = CAST(:v AS uuid)"),
                                                  {"v": version_id}).scalar():
                version_id = None
            store_report_file(session, tenant_id, kind=kind, data=data, file_name=file_name,
                              content_type=content_type, version_id=version_id, params=params, source="download",
                              created_by=user_id, created_by_email=email)
            session.commit()
    except Exception as e:
        logger.warning("report %s not kept in history (%s)", kind, type(e).__name__)


def _uuid_or_none(value: object) -> Optional[str]:
    try:
        return str(uuid.UUID(str(value))) if value else None
    except ValueError:
        return None


class HistoryRoute(APIRoute):
    """Keeps every file a report route hands out in the report history: after a 200 attachment
    response, the bytes are stored in a background task (the download is never held up)."""

    def get_route_handler(self):  # type: ignore[no-untyped-def]
        from api.services.report_history import ENDPOINT_KINDS

        handler = super().get_route_handler()
        kind = ENDPOINT_KINDS.get(self.name)
        if kind is None:
            return handler

        async def with_history(request: Request) -> Response:
            response = await handler(request)
            try:
                disposition = response.headers.get("content-disposition", "")
                body = getattr(response, "body", None)
                tenant_id = getattr(request.state, "tenant_id", None)
                if response.status_code == 200 and "attachment" in disposition and body and tenant_id:
                    file_name = disposition.split("filename=", 1)[-1].strip().strip('"') or f"meridian_{kind}"
                    params = {**{k: v for k, v in request.path_params.items()}, **dict(request.query_params)}
                    vid = _uuid_or_none(request.path_params.get("version_id") or request.query_params.get("version_id")
                                        or request.query_params.get("v2"))
                    uid = _uuid_or_none(getattr(request.state, "local_user_id", None))
                    task = BackgroundTask(_store_in_history, str(tenant_id), kind, bytes(body), file_name,
                                          response.media_type or response.headers.get("content-type", ""),
                                          vid, params, uid, getattr(request.state, "local_user_email", None))
                    if response.background is None:
                        response.background = task
                    else:  # keep the route's own background work, then store
                        previous = response.background

                        async def both() -> None:
                            await previous()
                            await task()

                        response.background = BackgroundTask(both)
            except Exception:
                logger.exception("report history hook failed")
            return response

        return with_history


# Every route here returns a downloadable file, so the whole router needs export.
router = APIRouter(prefix="/api/v1", tags=["reports"], dependencies=[Depends(require_permission("export"))],
                   route_class=HistoryRoute)


async def _regenerate_pdf(version_id: str, tenant_id: str) -> bytes:
    """Run the sync PDF builder in a worker thread so we don't block the loop."""
    return (
        await asyncio.to_thread(build_and_store_pdf, version_id, str(tenant_id))
    )[0]


@router.get("/reports/{version_id}/download")
async def download_report(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Stream the PDF report from MinIO.

    Self-healing: if the row has no ``pdf_path`` or the MinIO object is
    missing, the PDF is rebuilt on the fly from the stored ``report_json``
    using the same code path as the background worker. This covers the case
    where the Celery ``generate_pdf`` task failed silently after the agent
    pipeline completed.

    Supported analysis statuses:
      - "complete": Checks done, deterministic report ready
      - "agents_complete": AI agents completed enrichment
      - "agents_failed": Agents failed but deterministic report is valid
      - "ai_enriched": Background AI enrichment finished
    """
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    vid = uuid.UUID(version_id)

    result = await db.execute(
        select(Report).where(
            Report.tenant_id == tenant.id,
            Report.version_id == vid,
        )
    )
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(
            status_code=404,
            detail=(
                "No report has been assembled for this version. "
                "The analysis pipeline must complete successfully before a report can be downloaded."
            ),
        )

    pdf_bytes: bytes | None = None

    # Fast path: MinIO already has the PDF produced by the worker
    if report.pdf_path:
        try:
            pdf_bytes = await asyncio.to_thread(download_file, settings.minio_bucket_reports, report.pdf_path)
        except Exception as e:
            logger.warning(
                f"PDF missing from MinIO for version {version_id} (pdf_path={report.pdf_path}): {e}. "
                "Falling back to on-demand regeneration."
            )
            pdf_bytes = None

    # Self-heal path: the reports row exists but no usable PDF is in storage yet.
    if pdf_bytes is None:
        logger.info(
            f"Regenerating PDF on demand for version {version_id} "
            f"(pdf_path={'set' if report.pdf_path else 'null'})"
        )
        try:
            pdf_bytes = await _regenerate_pdf(version_id, tenant.id)
        except ReportNotAssembled as e:
            logger.error(f"Cannot regenerate PDF for version {version_id}: {e}")
            raise HTTPException(
                status_code=404,
                detail=(
                    "Report data for this version is incomplete — the agent pipeline "
                    "did not persist a report. Please re-run the analysis."
                ),
            ) from e
        except Exception as e:
            logger.exception(
                f"On-demand PDF regeneration failed for version {version_id}: {e}"
            )
            raise HTTPException(
                status_code=500,
                detail="Failed to generate PDF report",
            ) from e

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="meridian_dq_report_{version_id}.pdf"'
            )
        },
    )


@router.get("/reports/{version_id}/export.json")
async def export_report_json(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Download the assembled report payload as JSON.

    This is the reliable export path: it bypasses template rendering,
    WeasyPrint, and MinIO entirely, so it works whenever the agent pipeline
    has persisted ``report_json`` for the version — even in environments
    where PDF generation is broken.
    """
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    vid = uuid.UUID(version_id)

    result = await db.execute(
        select(Report).where(
            Report.tenant_id == tenant.id,
            Report.version_id == vid,
        )
    )
    report = result.scalar_one_or_none()

    if not report or not report.report_json:
        raise HTTPException(
            status_code=404,
            detail=(
                "No assembled report is available for this version. "
                "Re-run the analysis to regenerate the report."
            ),
        )

    body = json.dumps(report.report_json, indent=2, default=str).encode()
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": (
                f'attachment; filename="meridian_dq_report_{version_id}.json"'
            )
        },
    )


# ── Deterministic run reports ────────────────────────────────────────────────
# Rendered inline (worker thread) rather than via Celery: each report is a few
# pages built from aggregate queries and renders in well under a second.

_NOT_FOUND = {
    "analysis": "Run not found.",
    "extraction": "No extraction run found for this version. Extraction reports exist only for runs read from SAP.",
    "cleaning": "Run not found.",
    "comparison": "One or both runs not found.",
    "executive": "Run not found.",
    "board": "Run not found.",
    "object": "Run not found, or this module was not evaluated.",
    "record": "Run not found, or this material is not in the extracted dataset.",
    "trend": "Run not found.",
    "rules": "No rules found.",
    "dictionary": "No tables found.",
    "owners": "Run not found.",
}


def _build_sync(tenant_id: str, kind: str, vid: Optional[str], vid1: Optional[str],
                module: Optional[str] = None, matnr: Optional[str] = None, runs: int = 12) -> Optional[bytes]:
    from api.services.pdf_reports import build
    from workers.db import get_sync_engine, tenant_session

    with tenant_session(get_sync_engine(), tenant_id) as session:
        return build(session, tenant_id, kind, vid, vid1, module=module, matnr=matnr, runs=runs)


async def _stored_pdf(tenant: Tenant, vid: Optional[uuid.UUID]) -> bytes | None:
    """The PDF the worker already generated for this version, if there is one.

    Rendering an analysis report is CPU-bound WeasyPrint work that holds the GIL, so on a large
    dataset it starves the single uvicorn process: requesting
    /reports/analysis/<id>.pdf for a run with 747 findings and 2.3M record issues wedged the API
    (health checks returned 502 and the whole site went down until the container was restarted).
    The worker generates exactly this PDF after every analysis, so serving it is both faster and
    safe - 4s instead of a render that never finished.
    """
    if vid is None:
        return None
    try:
        from workers.db import get_sync_engine, tenant_session

        def _lookup() -> str | None:
            with tenant_session(get_sync_engine(), str(tenant.id)) as session:
                row = session.execute(
                    select(Report).where(Report.tenant_id == tenant.id, Report.version_id == vid)
                ).scalar_one_or_none()
                return row.pdf_path if row else None

        path = await asyncio.to_thread(_lookup)
        if path:
            return await asyncio.to_thread(download_file, settings.minio_bucket_reports, path)
    except Exception as e:
        logger.warning("stored PDF unavailable for %s (%s); rendering instead", vid, e)
    return None


async def _pdf(tenant: Tenant, kind: str, filename: str, vid: Optional[uuid.UUID] = None,
               vid1: Optional[uuid.UUID] = None, module: Optional[str] = None,
               matnr: Optional[str] = None, runs: int = 12) -> Response:
    if kind == "analysis":
        stored = await _stored_pdf(tenant, vid)
        if stored is not None:
            return Response(content=stored, media_type="application/pdf",
                            headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    try:
        pdf = await asyncio.to_thread(_build_sync, str(tenant.id), kind,
                                      str(vid) if vid else None, str(vid1) if vid1 else None,
                                      module, matnr, runs)
    except Exception:
        logger.exception("PDF report %s failed", kind)
        raise HTTPException(status_code=500, detail="Failed to generate PDF report")
    if pdf is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND[kind])
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/reports/analysis/{version_id}.pdf")
async def analysis_report_pdf(version_id: uuid.UUID, tenant: Tenant = Depends(get_tenant)) -> Response:
    """Analysis run report: scores, readiness, what to fix first, failing checks."""
    return await _pdf(tenant, "analysis", f"meridian_analysis_{version_id}.pdf", version_id)


@router.get("/reports/extraction/{version_id}.pdf")
async def extraction_report_pdf(version_id: uuid.UUID, tenant: Tenant = Depends(get_tenant)) -> Response:
    """Extraction run report: tables read, row counts, timings and issues."""
    return await _pdf(tenant, "extraction", f"meridian_extraction_{version_id}.pdf", version_id)


@router.get("/reports/cleaning.pdf")
async def cleaning_report_pdf(version_id: Optional[uuid.UUID] = None,
                              tenant: Tenant = Depends(get_tenant)) -> Response:
    """Cleaning and fixes report for one run, or for the whole organisation without ``version_id``."""
    name = f"meridian_cleaning_{version_id}.pdf" if version_id else "meridian_cleaning.pdf"
    return await _pdf(tenant, "cleaning", name, version_id)


@router.get("/reports/executive/{version_id}.pdf")
async def executive_report_pdf(version_id: uuid.UUID, tenant: Tenant = Depends(get_tenant)) -> Response:
    """Executive report: ai summary, scores, readiness, management overview."""
    return await _pdf(tenant, "executive", f"meridian_executive_{version_id}.pdf", version_id)


@router.get("/reports/compare.pdf")
async def comparison_report_pdf(v2: str, v1: Optional[str] = None, db: AsyncSession = Depends(get_db),
                                tenant: Tenant = Depends(get_tenant)) -> Response:
    """Run comparison report. ``v1`` defaults to the baseline or previous run, as in /versions/compare."""
    from api.routes.versions import _resolve_pair

    await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": str(tenant.id)})
    try:
        vid1, vid2 = await _resolve_pair(db, v1, v2)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid run id")
    return await _pdf(tenant, "comparison", f"meridian_comparison_{vid1}_{vid2}.pdf", vid2, vid1)


@router.get("/reports/object/{version_id}/{module}.pdf")
async def object_report_pdf(version_id: uuid.UUID, module: str, tenant: Tenant = Depends(get_tenant)) -> Response:
    """Object (module) report: composite score and readiness for one module, every rule run,
    top findings, and failing-record samples for its top 3 failing rules. 404 when the module
    is not one the rule catalogue knows about, or the run was not found."""
    return await _pdf(tenant, "object", f"meridian_object_{module}_{version_id}.pdf", version_id, module=module)


@router.get("/reports/record/{version_id}/{matnr}.pdf")
async def record_report_pdf(version_id: uuid.UUID, matnr: str, tenant: Tenant = Depends(get_tenant)) -> Response:
    """Material 360 fix sheet for one material: failing rules by view, with actual values
    and record fixes. 404 when the run has no extracted dataset or the material is not in it."""
    return await _pdf(tenant, "record", f"meridian_record_{matnr}_{version_id}.pdf", version_id, matnr=matnr)


# ── board pack, analyst workbook, catalogue ──────────────────────────────────

async def _audit_export(request: Request, tenant: Tenant, kind: str, version_id: Optional[uuid.UUID],
                        module: Optional[str]) -> None:
    """One audit_log row per board or workbook download. Never breaks the download: building the
    row and the insert are both guarded, and a failure is logged and swallowed."""
    from api.middleware.audit import _insert_audit_row

    try:
        uid = getattr(request.state, "local_user_id", None)
        row = {
            "tenant_id": tenant.id, "actor_user_id": uuid.UUID(str(uid)) if uid else None,
            "actor_email": getattr(request.state, "local_user_email", None), "action": "report.export",
            "entity_type": "report", "entity_id": str(version_id) if version_id else kind, "method": request.method,
            "path": request.url.path, "status_code": 200, "ip": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"), "before_json": None,
            "after_json": {"kind": kind, "version_id": str(version_id) if version_id else None, "module": module},
        }
        await asyncio.to_thread(_insert_audit_row, row)
    except Exception:
        logger.exception("report.export audit failed")


async def _require_run_of_tenant(db: AsyncSession, tenant: Tenant, version_id: uuid.UUID) -> None:
    found = (await db.execute(text("SELECT 1 FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                              {"v": str(version_id), "t": str(tenant.id)})).scalar()
    if not found:
        raise HTTPException(status_code=404, detail="Comparison run not found.")


@router.get("/reports/board/{version_id}.pdf")
async def board_report_pdf(version_id: uuid.UUID, request: Request, compare: Optional[uuid.UUID] = None,
                           db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> Response:
    """Board pack. Deltas are against ``compare`` only; without it they read "no earlier run"."""
    await _rls(db, tenant)
    if compare:
        await _require_run_of_tenant(db, tenant, compare)
    res = await _pdf(tenant, "board", f"meridian_board_{version_id}.pdf", version_id, compare)
    await _audit_export(request, tenant, "board", version_id, None)
    return res


@router.get("/reports/trend.pdf")
async def trend_report_pdf(version_id: uuid.UUID, request: Request, runs: int = Query(12, ge=2, le=52),
                           db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> Response:
    """Trend report: the score over the last ``runs`` finished runs of this run's lineage, dimension
    scores per run, the objects that moved most and the rules that started or stopped failing."""
    await _rls(db, tenant)
    res = await _pdf(tenant, "trend", f"meridian_trend_{version_id}.pdf", version_id, runs=runs)
    await _audit_export(request, tenant, "trend", version_id, None)
    return res


@router.get("/reports/rules.pdf")
async def rules_report_pdf(request: Request, module: Optional[str] = None, db: AsyncSession = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant)) -> Response:
    """Rule catalogue: one object's rules, with severity, dimension, description and SAP field. Needs no run.
    ``module`` is required: the whole catalogue is 8,000 rules and hundreds of pages, which would hold the API
    process for minutes; an unknown module is a 422."""
    await _rls(db, tenant)
    if not module:
        raise HTTPException(status_code=422, detail="Choose an object: module is required for the rule catalogue.")
    if module not in _modules():
        raise HTTPException(status_code=422, detail=f"Unknown module: {module}")
    res = await _pdf(tenant, "rules", f"meridian_rules{'_' + module if module else ''}.pdf", module=module)
    await _audit_export(request, tenant, "rules", None, module)
    return res


@router.get("/reports/dictionary.pdf")
async def dictionary_report_pdf(request: Request, module: Optional[str] = None, db: AsyncSession = Depends(get_db),
                                tenant: Tenant = Depends(get_tenant)) -> Response:
    """Data dictionary: the SAP tables and fields Meridian reads, by table and the objects that read it.
    Needs no run. ``module`` limits it to the tables one object reads."""
    await _rls(db, tenant)
    if module and module not in _modules():
        raise HTTPException(status_code=422, detail=f"Unknown module: {module}")
    res = await _pdf(tenant, "dictionary", f"meridian_dictionary{'_' + module if module else ''}.pdf", module=module)
    await _audit_export(request, tenant, "dictionary", None, module)
    return res


@router.get("/reports/owners/{version_id}.pdf")
async def owners_report_pdf(version_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)) -> Response:
    """Owner workload: each owner's score, open items and objects with their blocking rule, lowest
    score first, then the objects with no owner."""
    await _rls(db, tenant)
    res = await _pdf(tenant, "owners", f"meridian_owners_{version_id}.pdf", version_id)
    await _audit_export(request, tenant, "owners", version_id, None)
    return res


def _workbook_sync(tenant_id: str, vid: str, compare: Optional[str], module: Optional[str]) -> Optional[tuple[bytes, str]]:
    from api.services.workbook_report import build
    from workers.db import get_sync_engine, tenant_session

    with tenant_session(get_sync_engine(), tenant_id) as session:
        return build(session, tenant_id, vid, compare, module)


@router.get("/reports/{version_id}/workbook.xlsx")
async def workbook_xlsx(version_id: uuid.UUID, request: Request, module: Optional[str] = None,
                        compare: Optional[uuid.UUID] = None, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)) -> Response:
    """Analyst workbook: summary, modules, rules, findings, record samples, readiness and trend."""
    from api.services.branded_xlsx import xlsx_response

    await _rls(db, tenant)
    if module and module not in _modules():
        raise HTTPException(status_code=422, detail=f"Unknown module: {module}")
    if compare:
        await _require_run_of_tenant(db, tenant, compare)
    try:
        out = await asyncio.to_thread(_workbook_sync, str(tenant.id), str(version_id),
                                      str(compare) if compare else None, module)
    except Exception:
        logger.exception("Workbook failed")
        raise HTTPException(status_code=500, detail="Failed to generate workbook")
    if out is None:
        raise HTTPException(status_code=404, detail="Run not found.")
    await _audit_export(request, tenant, "workbook", version_id, module)
    return xlsx_response(*out)


# Reports that describe the product or the tenant, not one run: their url is built without a run.
_RUNLESS = frozenset({"rules", "dictionary"})

# id, name, format, about, sections, page_estimate, requires, path template, stored-report flag
_CATALOGUE = (
    ("board", "Board pack", "PDF", "Score, trend, blockers, root causes and impact by L1 for a board audience.",
     ["Headline", "What to do next", "Quality by dimension", "Trend", "Blockers", "Root causes", "Impact by L1",
      "Cleansing funnel", "Modules with commentary", "Rule appendix", "Methodology"], 12, [], "/api/v1/reports/board/{v}.pdf", False),
    ("workbook", "Analyst workbook", "XLSX", "Every module, rule and finding with filters and conditional formats.",
     ["Summary", "Commentary", "Modules", "Objects", "Rules", "Findings", "Records sample", "Readiness", "Trend"], 8, [],
     "/api/v1/reports/{v}/workbook.xlsx", False),
    ("executive", "Executive summary", "PDF", "Readiness, value at risk and owners for the run.",
     ["Summary", "What to do next", "Scores", "Readiness", "Management overview", "Methodology"], 4, [],
     "/api/v1/reports/executive/{v}.pdf", False),
    ("analysis", "Analysis report", "PDF", "Scores, findings and rule results.",
     ["Scores", "What to do next", "What to fix first", "Readiness", "Failing checks", "Methodology"], 6, [],
     "/api/v1/reports/analysis/{v}.pdf", False),
    ("extraction", "Extraction report", "PDF", "Tables read from the source system and their coverage.",
     ["Tables read", "Row counts", "Timings", "Issues"], 3, [], "/api/v1/reports/extraction/{v}.pdf", False),
    ("cleaning", "Cleaning and fixes", "PDF", "Cleaning work across the organisation for this run.",
     ["Queue", "Fixes by status", "Owners"], 3, [], "/api/v1/reports/cleaning.pdf?version_id={v}", False),
    ("compare", "Run comparison", "PDF", "This run against the baseline or previous run.",
     ["Score change", "Module changes", "Rule changes"], 4, [], "/api/v1/reports/compare.pdf?v2={v}", False),
    ("full", "Full report", "PDF", "The stored run report.", ["Stored report"], 10, [],
     "/api/v1/reports/{v}/download", True),
    ("json", "Run data", "JSON", "Run results as JSON.", ["Stored report payload"], 0, [],
     "/api/v1/reports/{v}/export.json", True),
    ("object", "Object report", "PDF", "One object's rules and fields.",
     ["Score", "Rules", "Top findings", "Record samples"], 3, ["module"], "/api/v1/reports/object/{v}/{module}.pdf",
     False),
    ("trend", "Trend report", "PDF", "The score across the last runs of this system, by dimension.",
     ["Score over time", "Scores by dimension", "Objects that moved most", "Rules that started failing",
      "Rules that were fixed", "Methodology"], 6, [], "/api/v1/reports/trend.pdf?version_id={v}&runs=12", False),
    ("owners", "Owner workload", "PDF", "Each owner's score, open items and objects, then the objects with no owner.",
     ["Owners", "Objects by owner", "Objects with no owner", "Methodology"], 4, [],
     "/api/v1/reports/owners/{v}.pdf", False),
    ("rules", "Rule catalogue", "PDF", "One object's validation rules, with severity, dimension and SAP field.",
     ["Contents", "Rules by object"], 60, ["module"], "/api/v1/reports/rules.pdf?module={module}", False),
    ("dictionary", "Data dictionary", "PDF", "The SAP tables and fields Meridian reads, by table and object.",
     ["Contents", "Fields by table"], 40, [], "/api/v1/reports/dictionary.pdf", False),
    ("record", "Record fix sheet", "PDF", "One record's fixes.", ["Failing rules by view", "Fixes"], 1, ["record"],
     None, False),
)


@router.get("/reports/catalogue")
async def report_catalogue(version_id: Optional[uuid.UUID] = None, module: Optional[str] = None,
                           compare: Optional[uuid.UUID] = None, db: AsyncSession = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant)) -> list[dict]:
    """Every report with its sections and download URL for the chosen run. ``url`` is null while a
    required input (module, record) is missing or no run is chosen."""
    await _rls(db, tenant)
    built: Optional[object] = None
    if version_id:
        exists = (await db.execute(text("SELECT 1 FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                                   {"v": str(version_id), "t": str(tenant.id)})).first()
        if not exists:
            raise HTTPException(status_code=404, detail="Run not found.")
        built = (await db.execute(select(Report.generated_at).where(
            Report.tenant_id == tenant.id, Report.version_id == version_id))).scalar_one_or_none()
    out = []
    for rid, name, fmt, about, sections, pages, requires, path, stored in _CATALOGUE:
        url = None
        if path and (version_id or rid in _RUNLESS) and not ("module" in requires and not module):
            url = path.format(v=version_id or "", module=module or "")
            if compare and rid in ("board", "workbook", "compare"):
                key = "v1" if rid == "compare" else "compare"
                url += ("&" if "?" in url else "?") + f"{key}={compare}"
            if module and rid in ("workbook", "dictionary"):
                url += ("&" if "?" in url else "?") + f"module={module}"
        out.append({"id": rid, "name": name, "format": fmt, "about": about, "sections": sections,
                    "page_estimate": pages, "requires": requires, "url": url,
                    "last_built_at": built.isoformat() if stored and built else None})
    return out
