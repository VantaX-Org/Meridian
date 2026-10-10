"""One wave's cockpit: objects, verdict, trend and top blockers (spec 2, build 3).

S/4 areas are not here: the UI calls GET /findings/s4-readiness with source_version_id.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.insights_readiness import build_wave_cells, wave_verdict
from api.services.migration import object_label

TOP_BLOCKERS = 20


async def load_cockpit(db: AsyncSession, tenant_id: str, wave) -> dict:
    run = (await db.execute(text("""
        SELECT id, gap_summary, readiness_score, records_total, records_blocked, source_version_id
          FROM migration_runs WHERE tenant_id = :t AND wave_id = :w AND status = 'analysed'
         ORDER BY completed_at DESC LIMIT 1"""), {"t": tenant_id, "w": str(wave.id)})).fetchone()
    dest_type = wave.target_release
    if wave.target_system_id:
        dest_type = (await db.execute(text("SELECT system_type FROM sap_systems WHERE id = :s"),
                                      {"s": str(wave.target_system_id)})).scalar() or dest_type
    dqs: dict[str, float | None] = {}
    if run and run.source_version_id:
        summary = (await db.execute(text("SELECT dqs_summary FROM analysis_versions WHERE id = :v"),
                                    {"v": str(run.source_version_id)})).scalar() or {}
        dqs = {m: (d or {}).get("composite_score") for m, d in summary.items()}
    gap_summary = (run.gap_summary if run else None) or {}
    min_dqs = wave.min_dqs
    cells = build_wave_cells(wave.name, list(wave.modules or []), gap_summary, dqs, wave.min_readiness, min_dqs)
    objects = [{"module": c.module, "label": object_label(c.module), "verdict": c.verdict, "score": c.score,
                "records": int((gap_summary.get(c.module) or {}).get("records") or 0),
                "records_blocked": c.records_blocked, "blocker_count": c.blocker_count, "dqs": c.dqs}
               for c in cells]

    trend = (await db.execute(text("""
        SELECT id AS run_id, completed_at, readiness_score AS score FROM (
            SELECT id, completed_at, readiness_score FROM migration_runs
             WHERE tenant_id = :t AND wave_id = :w AND status = 'analysed' AND readiness_score IS NOT NULL
             ORDER BY completed_at DESC LIMIT 30) t
         ORDER BY completed_at"""), {"t": tenant_id, "w": str(wave.id)})).fetchall()

    blockers = []
    if run:
        blockers = (await db.execute(text("""
            SELECT module, gap_type, field, MIN(severity) AS severity,
                   COUNT(DISTINCT record_key) AS records, COUNT(*) AS gaps
              FROM migration_gap_findings
             WHERE run_id = :r AND severity IN ('critical', 'high')
             GROUP BY module, gap_type, field
             ORDER BY COUNT(DISTINCT record_key) DESC, COUNT(*) DESC, module, gap_type
             LIMIT :n"""), {"r": str(run.id), "n": TOP_BLOCKERS})).fetchall()

    return {
        "wave": dict(wave._mapping),
        "run_id": str(run.id) if run else None,
        "source_version_id": str(run.source_version_id) if run and run.source_version_id else None,
        "dest_system_type": dest_type,
        "verdict": wave_verdict(cells),
        "score": run.readiness_score if run else None,
        "records_total": run.records_total if run else 0,
        "records_blocked": run.records_blocked if run else 0,
        "objects": objects,
        "trend": [{"run_id": str(t.run_id), "completed_at": t.completed_at, "score": t.score} for t in trend],
        "blockers": [{**dict(b._mapping), "label": object_label(b.module)} for b in blockers],
    }
