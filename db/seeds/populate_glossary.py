"""Populate glossary_terms from YAML rule files and enrich with AI.

Run once after `alembic upgrade head` for Phase K.
Idempotent: uses INSERT ... ON CONFLICT DO NOTHING.

Usage:
    TENANT_ID=00000000-0000-0000-0000-000000000001 python -m db.seeds.populate_glossary
"""

import json
import logging
import os
import sys
from pathlib import Path

import yaml
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


def parse_yaml_field(field_str: str, domain: str) -> tuple[str, str, str]:
    """Split TABLE.FIELD format into (technical_name, sap_table, sap_field).

    Input:  'BUT000.BU_TYPE'
    Output: ('BUT000.BU_TYPE', 'BUT000', 'BU_TYPE')

    Edge case (no dot): use domain as sap_table.
    """
    if "." in field_str:
        table, field = field_str.split(".", 1)
        return field_str, table, field
    return field_str, domain, field_str


def derive_business_name(rule: dict, technical_name: str) -> str:
    """Derive a human-readable business name from rule metadata."""
    # Use 'label' if present, else fall back to message, else technical_name
    if rule.get("label"):
        return rule["label"]
    if rule.get("message"):
        # Take message but truncate if very long
        msg = rule["message"]
        return msg[:120] if len(msg) > 120 else msg
    return technical_name


def is_mandatory_for_s4hana(rule: dict) -> bool:
    """Determine if a field is mandatory for S/4HANA based on severity and rule authority."""
    return (
        rule.get("severity") in ("critical", "high")
        and rule.get("rule_authority") in ("sap_hard_constraint", "s4hana_migration")
    )


def extract_approved_values(rule: dict) -> str | None:
    """Extract approved values from rule as JSON string."""
    # Prefer valid_values_with_labels (dict), then allowed_values (list)
    if rule.get("valid_values_with_labels"):
        return json.dumps(rule["valid_values_with_labels"])
    if rule.get("allowed_values") and rule["allowed_values"] is not None:
        return json.dumps(rule["allowed_values"])
    return None


def main():
    tenant_id = os.getenv("TENANT_ID", DEV_TENANT_ID)
    logger.info(f"Populating glossary for tenant {tenant_id}")
    logger.info(f"Rules directory: {RULES_DIR}")

    engine = _get_sync_engine()

    # Step 1: Parse all YAML files and collect unique terms + rule links
    seen: set[tuple[str, str, str]] = set()  # (domain, sap_table, sap_field)
    terms_to_insert: list[dict] = []
    rule_links: list[dict] = []  # (domain, sap_table, sap_field, rule_id)

    yaml_files = sorted(RULES_DIR.glob("**/*.yaml"))
    for yaml_path in yaml_files:
        # Skip column_map files
        if yaml_path.stem == "column_map":
            continue

        with open(yaml_path) as f:
            data = yaml.safe_load(f)

        if not data or not isinstance(data, dict):
            continue

        module = data.get("module", yaml_path.stem)
        rules = data.get("rules", [])
        if not isinstance(rules, list):
            continue

        for rule in rules:
            field_str = rule.get("field", "")
            if not field_str:
                continue

            technical_name, sap_table, sap_field = parse_yaml_field(field_str, module)
            key = (module, sap_table, sap_field)

            # Track rule link regardless of whether term is new
            rule_id = rule.get("id", "")
            if rule_id:
                rule_links.append({
                    "domain": module,
                    "sap_table": sap_table,
                    "sap_field": sap_field,
                    "rule_id": rule_id,
                })

            if key in seen:
                continue
            seen.add(key)

            terms_to_insert.append({
                "domain": module,
                "sap_table": sap_table,
                "sap_field": sap_field,
                "technical_name": technical_name,
                "business_name": derive_business_name(rule, technical_name),
                "why_it_matters": rule.get("why_it_matters", ""),
                "sap_impact": rule.get("sap_impact", ""),
                "approved_values": extract_approved_values(rule),
                "mandatory_for_s4hana": is_mandatory_for_s4hana(rule),
                "rule_authority": rule.get("rule_authority", ""),
            })

    logger.info(f"Found {len(terms_to_insert)} unique terms across {len(yaml_files)} YAML files")
    logger.info(f"Found {len(rule_links)} rule links")

    # Step 2: Insert glossary_term rows (idempotent)
    inserted_count = 0
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

        for row in terms_to_insert:
            result = session.execute(
                text("""
                    INSERT INTO glossary_terms
                      (tenant_id, domain, sap_table, sap_field, technical_name, business_name,
                       why_it_matters, sap_impact, approved_values, mandatory_for_s4hana,
                       rule_authority, status, ai_drafted)
                    VALUES
                      (:tenant_id, :domain, :sap_table, :sap_field, :technical_name,
                       :business_name, :why_it_matters, :sap_impact,
                       :approved_values::jsonb, :mandatory_for_s4hana, :rule_authority,
                       'active', false)
                    ON CONFLICT (tenant_id, sap_table, sap_field) DO NOTHING
                    RETURNING id
                """),
                {"tenant_id": tenant_id, **row},
            )
            row_id = result.scalar()
            if row_id:
                inserted_count += 1
                # Log creation to change log
                session.execute(
                    text("""
                        INSERT INTO glossary_change_log
                          (tenant_id, term_id, changed_by, field_changed, new_value, change_reason)
                        VALUES
                          (:tenant_id, :term_id, 'seed_script', 'created',
                           :technical_name, 'Initial population from YAML rule files')
                    """),
                    {"tenant_id": tenant_id, "term_id": str(row_id), "technical_name": row["technical_name"]},
                )
        session.commit()
    logger.info(f"Inserted {inserted_count} glossary terms ({len(terms_to_insert) - inserted_count} already existed)")

    # Step 3: Insert glossary_term_rules links
    linked_count = 0
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

        for link in rule_links:
            # Look up term_id by (tenant_id, sap_table, sap_field)
            result = session.execute(
                text("""
                    INSERT INTO glossary_term_rules (tenant_id, term_id, rule_id, domain)
                    SELECT :tenant_id, gt.id, :rule_id, :domain
                    FROM glossary_terms gt
                    WHERE gt.tenant_id = :tenant_id
                      AND gt.sap_table = :sap_table
                      AND gt.sap_field = :sap_field
                    ON CONFLICT (tenant_id, term_id, rule_id) DO NOTHING
                    RETURNING id
                """),
                {"tenant_id": tenant_id, **link},
            )
            if result.scalar():
                linked_count += 1
        session.commit()
    logger.info(f"Linked {linked_count} rule associations")

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

    logger.info(f"Done. {inserted_count} terms inserted, {linked_count} rules linked, {enriched_count} AI-enriched.")


if __name__ == "__main__":
    main()
