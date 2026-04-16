"""Relationship discovery service — reads SAP link tables via RFC to discover cross-domain relationships.

For BP: reads KNA1 (customers) and LFA1 (vendors), links to BUT000 golden records.
For Material: reads MARC (plant data), links to MARA golden records.
Runs as part of run_sync.py after golden records are updated.
After RFC discovery, calls ai_impact_scorer.py for all golden records that changed in this sync run.
"""

import logging
import os
import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("meridian.relationship_discovery")

# Known SAP link table mappings: domain -> [(link_table, target_domain, relationship_type, key_field)]
# SuccessFactors modules use OData APIs, not RFC link tables — excluded intentionally.
DOMAIN_LINK_MAPS: dict[str, list[tuple[str, str, str, str]]] = {
    # ECC master data
    "business_partner": [
        ("KNA1", "customer", "bp_is_customer", "KUNNR"),
        ("LFA1", "vendor", "bp_is_vendor", "LIFNR"),
    ],
    "material_master": [
        ("MARC", "material_plant", "material_at_plant", "MATNR"),
    ],
    "fi_gl": [
        ("SKB1", "gl_company_code", "gl_in_company_code", "SAKNR"),
    ],
    "accounts_payable": [
        ("LFB1", "vendor_company_code", "vendor_in_company_code", "LIFNR"),
    ],
    "accounts_receivable": [
        ("KNB1", "customer_company_code", "customer_in_company_code", "KUNNR"),
    ],
    "asset_accounting": [
        ("ANLZ", "asset_time_segment", "asset_in_cost_center", "ANLN1"),
    ],
    "mm_purchasing": [
        ("EKPO", "po_item", "po_references_material", "MATNR"),
    ],
    "plant_maintenance": [
        ("EQUZ", "equipment_time_segment", "equipment_in_plant", "EQUNR"),
    ],
    "sd_customer_master": [
        ("KNVV", "customer_sales_area", "customer_in_sales_org", "KUNNR"),
    ],
    "sd_sales_orders": [
        ("VBAP", "sales_order_item", "so_references_material", "MATNR"),
    ],
    "production_planning": [
        ("STPO", "bom_item", "bom_references_material", "IDNRK"),
    ],
    # Warehouse
    "ewms_stock": [
        ("LQUA", "quant", "stock_in_bin", "MATNR"),
    ],
    "batch_management": [
        ("MCH1", "batch_master", "batch_for_material", "MATNR"),
    ],
    "fleet_management": [
        ("EQUI", "plant_maintenance", "fleet_uses_equipment", "EQUNR"),
    ],
    "transport_management": [
        ("VTTP", "sd_sales_orders", "shipment_contains_delivery", "VBELN"),
    ],
    "wm_interface": [
        ("LTAK", "ewms_stock", "interface_routes_to_warehouse", "LGNUM"),
    ],
    "mdg_master_data": [
        ("USMD_CREQU", "business_partner", "mdg_change_for_entity", "ENTITY_ID"),
    ],
    # cross_system_integration: no RFC link tables — validation/reconciliation only
    # grc_compliance: no RFC link tables — audit/control-centric
}

# All domains that could have cross-domain relationships (for AI inference)
ALL_DOMAINS = [
    "business_partner", "customer", "vendor", "material_master",
    "material_plant", "fi_gl", "gl_company_code",
    "accounts_payable", "accounts_receivable", "asset_accounting",
    "mm_purchasing", "plant_maintenance", "sd_customer_master",
    "sd_sales_orders", "production_planning",
    "ewms_stock", "batch_management",
    "fleet_management", "transport_management", "wm_interface", "mdg_master_data",
]


def discover_relationships_rfc(
    conn,
    tenant_id: str,
    domain: str,
    session: Session,
) -> list[dict]:
    """Discover cross-domain relationships by reading SAP link tables via RFC.

    Args:
        conn: Active PyRFC connection
        tenant_id: Tenant UUID string
        domain: SAP domain being synced
        session: SQLAlchemy session (RLS already set)

    Returns:
        List of discovered relationship dicts
    """
    link_maps = DOMAIN_LINK_MAPS.get(domain, [])
    if not link_maps:
        logger.info(f"No link table mappings for domain '{domain}' — skipping RFC discovery")
        return []

    discovered = []

    for link_table, target_domain, rel_type, key_field in link_maps:
        try:
            result = conn.call("RFC_READ_TABLE", QUERY_TABLE=link_table)
            fields_meta = result.get("FIELDS", [])
            data_rows = result.get("DATA", [])

            if not fields_meta or not data_rows:
                logger.info(f"No data in {link_table} — skipping")
                continue

            field_names = [f["FIELDNAME"].strip() for f in fields_meta]
            field_offsets = []
            for f in fields_meta:
                offset = int(f.get("OFFSET", 0))
                length = int(f.get("LENGTH", 0))
                field_offsets.append((offset, offset + length))

            # Find the key field index
            key_idx = None
            for i, fn in enumerate(field_names):
                if fn == key_field:
                    key_idx = i
                    break

            if key_idx is None:
                logger.warning(f"Key field {key_field} not found in {link_table} fields: {field_names}")
                continue

            # Extract unique keys from link table
            link_keys = set()
            for row in data_rows:
                wa = row.get("WA", "")
                start, end = field_offsets[key_idx]
                key_value = wa[start:end].strip()
                if key_value:
                    link_keys.add(key_value)

            logger.info(f"Found {len(link_keys)} keys in {link_table} for {rel_type}")

            # Match against existing golden records in the source domain
            for key_value in link_keys:
                # Upsert into record_relationships
                session.execute(
                    text("""
                        INSERT INTO record_relationships (
                            id, tenant_id, from_domain, from_key,
                            to_domain, to_key, relationship_type,
                            sap_link_table, ai_inferred
                        ) VALUES (
                            gen_random_uuid(), :tid, :from_domain, :from_key,
                            :to_domain, :to_key, :rel_type,
                            :link_table, false
                        )
                        ON CONFLICT ON CONSTRAINT uq_record_relationships_pair
                        DO UPDATE SET
                            active = true,
                            discovered_at = now(),
                            sap_link_table = :link_table
                    """),
                    {
                        "tid": tenant_id,
                        "from_domain": domain,
                        "from_key": key_value,
                        "to_domain": target_domain,
                        "to_key": key_value,
                        "rel_type": rel_type,
                        "link_table": link_table,
                    },
                )
                discovered.append({
                    "from_domain": domain,
                    "from_key": key_value,
                    "to_domain": target_domain,
                    "to_key": key_value,
                    "relationship_type": rel_type,
                    "sap_link_table": link_table,
                    "ai_inferred": False,
                })

            session.commit()
            logger.info(f"Upserted {len(link_keys)} relationships from {link_table}")

        except Exception as e:
            logger.warning(f"Failed to read link table {link_table}: {e}")
            continue

    return discovered


def discover_relationships_from_data(
    tenant_id: str,
    domain: str,
    session: Session,
) -> list[dict]:
    """Discover relationships from existing data in record_relationships and master_records.

    Used when RFC connection is unavailable — scans master_records for cross-domain keys.
    """
    link_maps = DOMAIN_LINK_MAPS.get(domain, [])
    if not link_maps:
        return []

    discovered = []

    for _link_table, target_domain, rel_type, _key_field in link_maps:
        # Check if target domain records exist in master_records
        result = session.execute(
            text("""
                SELECT mr_from.sap_object_key
                FROM master_records mr_from
                WHERE mr_from.tenant_id = :tid
                  AND mr_from.domain = :domain
                  AND mr_from.status IN ('candidate', 'pending_review', 'golden')
                  AND EXISTS (
                      SELECT 1 FROM master_records mr_to
                      WHERE mr_to.tenant_id = :tid
                        AND mr_to.domain = :target_domain
                        AND mr_to.sap_object_key = mr_from.sap_object_key
                  )
            """),
            {"tid": tenant_id, "domain": domain, "target_domain": target_domain},
        )

        for row in result.fetchall():
            key_value = row[0]
            session.execute(
                text("""
                    INSERT INTO record_relationships (
                        id, tenant_id, from_domain, from_key,
                        to_domain, to_key, relationship_type,
                        ai_inferred
                    ) VALUES (
                        gen_random_uuid(), :tid, :from_domain, :from_key,
                        :to_domain, :to_key, :rel_type, false
                    )
                    ON CONFLICT ON CONSTRAINT uq_record_relationships_pair
                    DO UPDATE SET active = true, discovered_at = now()
                """),
                {
                    "tid": tenant_id,
                    "from_domain": domain,
                    "from_key": key_value,
                    "to_domain": target_domain,
                    "to_key": key_value,
                    "rel_type": rel_type,
                },
            )
            discovered.append({
                "from_domain": domain,
                "from_key": key_value,
                "to_domain": target_domain,
                "to_key": key_value,
                "relationship_type": rel_type,
                "ai_inferred": False,
            })

        session.commit()

    return discovered


def run_ai_inference_pass(
    tenant_id: str,
    domain: str,
    changed_keys: list[str],
    session: Session,
) -> None:
    """Run AI inference for changed golden records — discovers probable relationships
    and scores impact for all related domains.

    Args:
        tenant_id: Tenant UUID string
        domain: SAP domain that was synced
        changed_keys: List of sap_object_keys that changed in this sync
        session: SQLAlchemy session (RLS already set)
    """
    from api.services.ai_impact_scorer import score_impact, infer_relationships

    for sap_key in changed_keys:
        # 1. Load existing RFC-discovered relationships for this key
        result = session.execute(
            text("""
                SELECT to_domain, relationship_type, sap_link_table
                FROM record_relationships
                WHERE tenant_id = :tid
                  AND from_domain = :domain AND from_key = :key
                  AND active = true AND ai_inferred = false
            """),
            {"tid": tenant_id, "domain": domain, "key": sap_key},
        )
        known_rels = [
            {"to_domain": r[0], "relationship_type": r[1], "sap_link_table": r[2]}
            for r in result.fetchall()
        ]

        # 2. Score impact for each changed record
        if known_rels:
            # Identify the most recently changed field from master_record_history
            field_result = session.execute(
                text("""
                    SELECT mrh.new_fields
                    FROM master_record_history mrh
                    JOIN master_records mr ON mr.id = mrh.master_record_id
                    WHERE mr.tenant_id = :tid
                      AND mr.domain = :domain AND mr.sap_object_key = :key
                    ORDER BY mrh.changed_at DESC
                    LIMIT 1
                """),
                {"tid": tenant_id, "domain": domain, "key": sap_key},
            )
            field_row = field_result.fetchone()
            changed_field = "unknown"
            if field_row and field_row[0]:
                new_fields = field_row[0] if isinstance(field_row[0], dict) else {}
                if new_fields:
                    changed_field = next(iter(new_fields.keys()), "unknown")

            impact = score_impact(tenant_id, changed_field, domain, known_rels)
            if impact:
                # Write impact_score to all relationships for this key
                session.execute(
                    text("""
                        UPDATE record_relationships
                        SET impact_score = :score
                        WHERE tenant_id = :tid
                          AND from_domain = :domain AND from_key = :key
                          AND active = true
                    """),
                    {
                        "score": impact["impact_score"],
                        "tid": tenant_id,
                        "domain": domain,
                        "key": sap_key,
                    },
                )
                session.commit()
                logger.info(
                    f"Impact scored for {domain}/{sap_key}: "
                    f"{impact['impact_score']:.2f}, affects {impact['affected_domains']}"
                )

        # 3. AI inference pass — find probable relationships not in RFC
        known_target_domains = {r["to_domain"] for r in known_rels}
        candidate_domains = [d for d in ALL_DOMAINS if d != domain and d not in known_target_domains]

        if candidate_domains:
            inferred = infer_relationships(
                tenant_id, domain, sap_key, known_rels, candidate_domains
            )
            for rel in inferred:
                session.execute(
                    text("""
                        INSERT INTO record_relationships (
                            id, tenant_id, from_domain, from_key,
                            to_domain, to_key, relationship_type,
                            ai_inferred, ai_confidence
                        ) VALUES (
                            gen_random_uuid(), :tid, :from_domain, :from_key,
                            :to_domain, :to_key, :rel_type,
                            true, :confidence
                        )
                        ON CONFLICT ON CONSTRAINT uq_record_relationships_pair
                        DO UPDATE SET
                            ai_confidence = :confidence,
                            active = true,
                            discovered_at = now()
                    """),
                    {
                        "tid": tenant_id,
                        "from_domain": domain,
                        "from_key": sap_key,
                        "to_domain": rel["to_domain"],
                        "to_key": sap_key,
                        "rel_type": rel["relationship_type"],
                        "confidence": rel["confidence"],
                    },
                )
                logger.info(
                    f"AI-inferred relationship: {domain}/{sap_key} -> "
                    f"{rel['to_domain']} ({rel['relationship_type']}, "
                    f"confidence={rel['confidence']:.2f})"
                )

            session.commit()
