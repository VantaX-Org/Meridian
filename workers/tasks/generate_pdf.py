"""Celery task: generate PDF report from report JSON using WeasyPrint.

Thin wrapper around ``api.services.report_pdf.build_and_store_pdf``.
All real logic lives in the shared helper so the API download endpoint
can use the same code path as a self-healing fallback.
"""

import logging
import traceback

from api.services.report_pdf import ReportNotAssembled, build_and_store_pdf
from workers.celery_app import celery_app

logger = logging.getLogger("meridian.worker.pdf")


@celery_app.task(bind=True, name="workers.tasks.generate_pdf.generate_pdf",
                 soft_time_limit=120, time_limit=180)
def generate_pdf(self, version_id: str, tenant_id: str):
    """Generate a PDF report and store it in MinIO."""
    logger.info(f"generate_pdf started: version_id={version_id}")

    try:
        pdf_bytes, object_path = build_and_store_pdf(version_id, tenant_id)
    except ReportNotAssembled as e:
        # Not an error the worker can fix — the agent pipeline needs to run.
        logger.warning(f"generate_pdf skipped: {e}")
        return {"version_id": version_id, "status": "no_report"}
    except Exception:
        # Log full traceback so the real failure is visible in worker logs
        # even if Celery's result backend swallows the exception details.
        logger.error(f"generate_pdf failed: {traceback.format_exc()}")
        raise

    logger.info(
        f"generate_pdf complete: {object_path} ({len(pdf_bytes)} bytes)"
    )
    return {
        "version_id": version_id,
        "status": "complete",
        "pdf_path": object_path,
    }
