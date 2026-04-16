"""Shared PDF report generation (synchronous).

Used by both the Celery worker (``workers.tasks.generate_pdf``) and the API
download endpoint (``api.routes.reports``). The worker runs this in the
background after agents complete; the API endpoint calls it on demand when
the PDF is missing so customers can always retrieve their report even if the
background task silently failed or was never enqueued.

Behaviour is identical in both paths — one code path means one set of
errors, one place to log, one place to fix.
"""

import io
import logging
import os

from jinja2 import Environment, FileSystemLoader
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

logger = logging.getLogger("meridian.report_pdf")

# Template directory — resolve from project root
# api/services/report_pdf.py -> ../../templates
TEMPLATE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "templates",
)

MINIO_BUCKET = os.getenv("MINIO_BUCKET_REPORTS", "meridian-reports")


class ReportNotAssembled(Exception):
    """Raised when no ``reports.report_json`` row exists for a version.

    Indicates the agent pipeline hasn't produced (or failed to persist) a
    report yet — the analysis must be re-run before a PDF can be generated.
    """


def _get_sync_engine():
    url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return create_engine(url)


def _get_minio_client():
    from minio import Minio

    return Minio(
        endpoint=os.getenv("MINIO_ENDPOINT", "minio:9000"),
        access_key=os.getenv("MINIO_ACCESS_KEY", "meridian"),
        secret_key=os.getenv("MINIO_SECRET_KEY", ""),
        secure=False,
    )


def _load_report_json(session: Session, version_id: str, tenant_id: str) -> dict | None:
    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    result = session.execute(
        text(
            "SELECT report_json FROM reports "
            "WHERE version_id = :vid AND tenant_id = :tid "
            "ORDER BY generated_at DESC LIMIT 1"
        ),
        {"vid": version_id, "tid": tenant_id},
    )
    row = result.fetchone()
    if not row or not row[0]:
        return None
    return row[0]


def _load_supplementary(session: Session, version_id: str, tenant_id: str) -> dict:
    """Load Phase A–N supplementary data used by ``executive_report.html``.

    All sections are optional — a missing or empty table returns an empty
    value so the template still renders.
    """
    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

    cleaning = session.execute(text("""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
               SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
               SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) AS applied
        FROM cleaning_queue
        WHERE version_id = :vid AND tenant_id = :tid
    """), {"vid": version_id, "tid": tenant_id}).fetchone()

    dedup = session.execute(text("""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
               SUM(CASE WHEN status='merged' THEN 1 ELSE 0 END) AS merged
        FROM dedup_candidates
        WHERE tenant_id = :tid
    """), {"tid": tenant_id}).fetchone()

    exceptions = session.execute(text("""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
               SUM(CASE WHEN severity='high' THEN 1 ELSE 0 END) AS high,
               SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open_count
        FROM exceptions
        WHERE tenant_id = :tid
    """), {"tid": tenant_id}).fetchone()

    impact = session.execute(text("""
        SELECT SUM(annual_risk_zar) AS total_risk,
               SUM(mitigated_zar) AS total_avoidance,
               COUNT(*) AS record_count
        FROM impact_records
        WHERE version_id = :vid AND tenant_id = :tid
    """), {"vid": version_id, "tid": tenant_id}).fetchone()

    contracts = session.execute(text("""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
               SUM(CASE WHEN status='breached' THEN 1 ELSE 0 END) AS breached
        FROM contracts
        WHERE tenant_id = :tid
    """), {"tid": tenant_id}).fetchone()

    dqs_trend_rows = session.execute(text("""
        SELECT recorded_at, dqs_score, module_id
        FROM dqs_history
        WHERE tenant_id = :tid
        ORDER BY recorded_at DESC
        LIMIT 10
    """), {"tid": tenant_id}).fetchall()

    glossary_rows = session.execute(text("""
        SELECT gt.sap_table, gt.sap_field, gt.business_name, gt.business_definition,
               gt.mandatory_for_s4hana, COUNT(gtr.id) AS rule_count
        FROM glossary_terms gt
        LEFT JOIN glossary_term_rules gtr
               ON gtr.term_id = gt.id AND gtr.tenant_id = gt.tenant_id
        WHERE gt.tenant_id = :tid
        GROUP BY gt.id
        ORDER BY rule_count DESC
        LIMIT 30
    """), {"tid": tenant_id}).fetchall()
    glossary_terms = [
        {
            "sap_table": r[0],
            "sap_field": r[1],
            "business_name": r[2],
            "business_definition": r[3],
            "mandatory": r[4],
            "rule_count": r[5],
        }
        for r in glossary_rows
    ]

    # MDM Health Score (Phase N) — table may be empty; omit section if so
    mdm_snapshot = None
    try:
        mdm_row = session.execute(text("""
            SELECT mdm_health_score, golden_record_coverage_pct,
                   avg_match_confidence, steward_sla_compliance_pct,
                   source_consistency_pct, ai_projected_score, ai_narrative
            FROM mdm_metrics
            WHERE tenant_id = :tid
            ORDER BY snapshot_date DESC LIMIT 1
        """), {"tid": tenant_id}).fetchone()
        if mdm_row:
            mdm_snapshot = dict(mdm_row._mapping)
    except Exception as e:
        logger.warning(f"MDM metrics query failed for PDF: {e}")

    # Golden Record Summary (Phase I) — table may be empty
    golden_summary: list[dict] = []
    try:
        gr_rows = session.execute(text("""
            SELECT domain, status, COUNT(*) AS record_count
            FROM master_records
            WHERE tenant_id = :tid
            GROUP BY domain, status
            ORDER BY domain, status
        """), {"tid": tenant_id}).fetchall()
        golden_summary = [dict(r._mapping) for r in gr_rows]
    except Exception as e:
        logger.warning(f"Golden records query failed for PDF: {e}")

    return {
        "cleaning": cleaning._asdict() if cleaning else {},
        "dedup": dedup._asdict() if dedup else {},
        "exceptions": exceptions._asdict() if exceptions else {},
        "impact": impact._asdict() if impact else {},
        "contracts": contracts._asdict() if contracts else {},
        "dqs_trend": [
            {
                "recorded_at": str(r[0]),
                "dqs_score": float(r[1]) if r[1] else 0,
                "module_id": r[2],
            }
            for r in dqs_trend_rows
        ],
        "glossary_terms": glossary_terms,
        "mdm_snapshot": mdm_snapshot,
        "golden_summary": golden_summary,
    }


def _render_pdf(report_json: dict, supplementary: dict) -> bytes:
    """Render the executive report template and convert to PDF bytes."""
    env = Environment(loader=FileSystemLoader(TEMPLATE_DIR))
    template = env.get_template("executive_report.html")
    html_content = template.render(
        report=report_json,
        **supplementary,
    )

    # Imported lazily — WeasyPrint pulls in a lot of native libs.
    from weasyprint import HTML

    return HTML(string=html_content, base_url=TEMPLATE_DIR).write_pdf()


def _store_pdf_in_minio(pdf_bytes: bytes, version_id: str, tenant_id: str) -> str:
    object_path = f"reports/{tenant_id}/{version_id}.pdf"
    client = _get_minio_client()
    if not client.bucket_exists(MINIO_BUCKET):
        client.make_bucket(MINIO_BUCKET)
        logger.info(f"Created missing MinIO bucket: {MINIO_BUCKET}")
    client.put_object(
        MINIO_BUCKET,
        object_path,
        io.BytesIO(pdf_bytes),
        length=len(pdf_bytes),
        content_type="application/pdf",
    )
    return object_path


def _update_pdf_path(session: Session, version_id: str, tenant_id: str, object_path: str) -> None:
    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    session.execute(
        text(
            "UPDATE reports SET pdf_path = :path "
            "WHERE version_id = :vid AND tenant_id = :tid"
        ),
        {"path": object_path, "vid": version_id, "tid": tenant_id},
    )
    session.commit()


def build_and_store_pdf(version_id: str, tenant_id: str) -> tuple[bytes, str]:
    """Generate the PDF, store it in MinIO, and update ``reports.pdf_path``.

    Returns ``(pdf_bytes, minio_object_path)``.

    Raises:
        ReportNotAssembled: If there is no ``report_json`` for this version.
            The agent pipeline must run successfully before a PDF can exist.
    """
    logger.info(f"build_and_store_pdf: version_id={version_id}")
    engine = _get_sync_engine()

    try:
        with Session(engine) as session:
            report_json = _load_report_json(session, version_id, tenant_id)

        if not report_json:
            raise ReportNotAssembled(
                f"No report_json found for version {version_id} — agent pipeline did not persist a report"
            )

        with Session(engine) as session:
            supplementary = _load_supplementary(session, version_id, tenant_id)

        pdf_bytes = _render_pdf(report_json, supplementary)

        object_path = _store_pdf_in_minio(pdf_bytes, version_id, tenant_id)

        with Session(engine) as session:
            _update_pdf_path(session, version_id, tenant_id, object_path)

        logger.info(
            f"build_and_store_pdf complete: version_id={version_id} "
            f"path={object_path} size={len(pdf_bytes)} bytes"
        )
        return pdf_bytes, object_path
    finally:
        engine.dispose()
