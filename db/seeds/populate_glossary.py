"""Populate glossary_terms from YAML rule files (api/services/glossary_populate.py) and enrich with AI.

Run once after `alembic upgrade head` for Phase K.
Idempotent: uses INSERT ... ON CONFLICT DO NOTHING.

Usage:
    TENANT_ID=00000000-0000-0000-0000-000000000001 python -m db.seeds.populate_glossary
"""

import logging
import os
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("meridian.seed.glossary")

# Resolve paths relative to project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
RULES_DIR = PROJECT_ROOT / "checks" / "rules"
BATCH_SIZE = 20

DEV_TENANT_ID = "00000000-0000-0000-0000-000000000001"


def _get_sync_engine():
    url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return create_engine(url)


def main():
    tenant_id = os.getenv("TENANT_ID", DEV_TENANT_ID)
    logger.info(f"Populating glossary for tenant {tenant_id}")
    logger.info(f"Rules directory: {RULES_DIR}")

    engine = _get_sync_engine()

    # Steps 1-3: terms and rule links from the rule library (api/services/glossary_populate.py)
    from api.services.glossary_populate import populate
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        out = populate(session, str(tenant_id), None, changed_by="seed_script")
        session.commit()
    logger.info(f"Inserted {out['created']} glossary terms, linked {out['linked']} rule associations")

    # Step 4: AI enrichment in batches
    enriched_count = 0
    try:
        from api.services.ai_glossary_enricher import enrich_term

        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

            # Get all terms that haven't been AI-enriched yet
            result = session.execute(
                text("""
                    SELECT id, technical_name, sap_table, sap_field, why_it_matters, sap_impact
                    FROM glossary_terms
                    WHERE tenant_id = :tenant_id AND ai_drafted = false
                      AND business_definition IS NULL
                    ORDER BY domain, sap_table, sap_field
                """),
                {"tenant_id": tenant_id},
            )
            unenriched = result.fetchall()

        logger.info(f"Found {len(unenriched)} terms to AI-enrich")

        for i in range(0, len(unenriched), BATCH_SIZE):
            batch = unenriched[i : i + BATCH_SIZE]
            for row in batch:
                term_id, technical_name, sap_table, sap_field, why_it_matters, sap_impact = row
                try:
                    draft = enrich_term(
                        tenant_id=tenant_id,
                        technical_name=technical_name,
                        sap_table=sap_table,
                        sap_field=sap_field,
                        why_it_matters=why_it_matters or "",
                        sap_impact=sap_impact or "",
                        skip_rate_limit=True,
                    )

                    with Session(engine) as session:
                        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                        session.execute(
                            text("""
                                UPDATE glossary_terms
                                SET business_definition = :bd,
                                    why_it_matters = :wim,
                                    ai_drafted = true,
                                    updated_at = now()
                                WHERE id = :id AND tenant_id = :tenant_id
                            """),
                            {
                                "bd": draft.get("business_definition", ""),
                                "wim": draft.get("why_it_matters_business", ""),
                                "id": str(term_id),
                                "tenant_id": tenant_id,
                            },
                        )
                        session.execute(
                            text("""
                                INSERT INTO glossary_change_log
                                  (tenant_id, term_id, changed_by, field_changed,
                                   new_value, change_reason)
                                VALUES
                                  (:tenant_id, :term_id, 'ai_enricher', 'business_definition',
                                   :val, 'Initial AI enrichment from seed script')
                            """),
                            {
                                "tenant_id": tenant_id,
                                "term_id": str(term_id),
                                "val": draft.get("business_definition", ""),
                            },
                        )
                        session.commit()
                    enriched_count += 1

                except Exception as e:
                    logger.warning(f"Enrichment failed for {technical_name}: {e}")

            logger.info(f"Enriched batch {i // BATCH_SIZE + 1} — {enriched_count} total so far")

    except ImportError:
        logger.warning("ai_glossary_enricher not available — skipping AI enrichment")
    except Exception as e:
        logger.warning(f"AI enrichment phase failed (non-fatal): {e}")

    logger.info(f"Done. {out['created']} terms inserted, {out['linked']} rules linked, {enriched_count} AI-enriched.")


if __name__ == "__main__":
    main()
