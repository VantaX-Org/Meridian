"""Data lineage service — builds D3-compatible graph from Postgres relationships.

Traces record relationships across findings, cleaning_queue, dedup_candidates,
and exceptions to construct a force-directed graph.
"""

import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("meridian.lineage")


def _node(id: str, label: str, node_type: str, data: Optional[dict] = None) -> dict:
    return {"id": id, "label": label, "type": node_type, "data": data or {}}


def _edge(source: str, target: str, label: str) -> dict:
    return {"source": source, "target": target, "label": label}


async def get_lineage(
    object_type: str,
    record_key: str,
    tenant_id: str,
    db: AsyncSession,
    depth: int = 2,
) -> dict:
    """Build a lineage graph by tracing record relationships in Postgres.

    Returns D3-compatible: {nodes: [...], edges: [...]}
    """
    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    tid = str(tenant_id)

    # ── Start node: the requested record ──
    # Look up latest known state from cleaning_queue
    record_result = await db.execute(
        text("""
            SELECT id, record_key, object_type, status, confidence, detected_at
            FROM cleaning_queue
            WHERE tenant_id = :tid AND record_key = :rk AND object_type = :ot
            ORDER BY detected_at DESC
            LIMIT 1
        """),
        {"tid": tid, "rk": record_key, "ot": object_type},
    )
    record_row = record_result.fetchone()

    root_id = f"record:{object_type}:{record_key}"
    root_label = f"{object_type} / {record_key}"
    root_data = {}
    if record_row:
        root_data = {
            "status": record_row[3],
            "confidence": float(record_row[4]) if record_row[4] else None,
        }
    nodes[root_id] = _node(root_id, root_label, "record", root_data)

    # ── Level 1: Findings linked to this record_key ──
    findings_result = await db.execute(
        text("""
            SELECT id, check_id, module, severity, dimension, affected_count, pass_rate
            FROM findings
            WHERE tenant_id = :tid
              AND (
                  details->'sample_failing_records' @> :pattern
                  OR details->>'field_checked' IS NOT NULL
              )
            ORDER BY created_at DESC
            LIMIT 20
        """),
        {"tid": tid, "pattern": f'[{{"{object_type}": "{record_key}"}}]'},
    )
    # Fallback: search by check_id prefix matching object_type
    if not findings_result.rowcount:
        prefix_map = {
            "business_partner": "BP", "material_master": "MM", "fi_gl": "GL",
            "accounts_payable": "AP", "accounts_receivable": "AR",
            "asset_accounting": "AA", "mm_purchasing": "PO",
            "plant_maintenance": "PM", "production_planning": "PP",
            "sd_customer_master": "SD", "sd_sales_orders": "SO",
            "employee_central": "EC", "compensation": "CO", "benefits": "BN",
            "payroll_integration": "PY", "performance_goals": "PG",
            "succession_planning": "SP", "recruiting_onboarding": "RC",
            "learning_management": "LM", "time_attendance": "TA",
            "ewms_stock": "WS", "ewms_transfer_orders": "WT",
            "batch_management": "BM", "mdg_master_data": "MD",
            "grc_compliance": "GR", "fleet_management": "FL",
            "transport_management": "TM", "wm_interface": "WI",
            "cross_system_integration": "XI",
        }
        prefix = prefix_map.get(object_type, object_type[:2].upper())
        findings_result = await db.execute(
            text("""
                SELECT id, check_id, module, severity, dimension, affected_count, pass_rate
                FROM findings
                WHERE tenant_id = :tid AND module = :ot AND check_id LIKE :prefix
                ORDER BY created_at DESC
                LIMIT 10
            """),
            {"tid": tid, "ot": object_type, "prefix": f"{prefix}%"},
        )

    for row in findings_result.fetchall():
        fid = f"finding:{row[0]}"
        nodes[fid] = _node(fid, f"{row[1]} ({row[3]})", "finding", {
            "check_id": row[1],
            "module": row[2],
            "severity": row[3],
            "dimension": row[4],
            "affected_count": row[5],
            "pass_rate": float(row[6]) if row[6] else None,
        })
        edges.append(_edge(root_id, fid, "has finding"))

    # ── Level 2: Cleaning queue items linked to this record_key ──
    cleaning_result = await db.execute(
        text("""
            SELECT id, object_type, status, confidence, record_key, priority, detected_at
            FROM cleaning_queue
            WHERE tenant_id = :tid AND record_key = :rk
            ORDER BY detected_at DESC
            LIMIT 10
        """),
        {"tid": tid, "rk": record_key},
    )
    for row in cleaning_result.fetchall():
        cid = f"cleaning:{row[0]}"
        if cid not in nodes:
            nodes[cid] = _node(cid, f"Clean: {row[2]}", "cleaning", {
                "object_type": row[1],
                "status": row[2],
                "confidence": float(row[3]) if row[3] else None,
                "priority": row[5],
            })
            edges.append(_edge(root_id, cid, "cleaning action"))

    # ── Level 3: Dedup candidates (if depth >= 2) ──
    if depth >= 2:
        dedup_result = await db.execute(
            text("""
                SELECT id, record_key_a, record_key_b, match_score, match_method, status
                FROM dedup_candidates
                WHERE tenant_id = :tid AND (record_key_a = :rk OR record_key_b = :rk)
                ORDER BY match_score DESC
                LIMIT 10
            """),
            {"tid": tid, "rk": record_key},
        )
        for row in dedup_result.fetchall():
            did = f"dedup:{row[0]}"
            other_key = row[2] if row[1] == record_key else row[1]
            nodes[did] = _node(did, f"Dedup: {other_key}", "dedup", {
                "record_key_a": row[1],
                "record_key_b": row[2],
                "match_score": float(row[3]) if row[3] else None,
                "match_method": row[4],
                "status": row[5],
            })
            edges.append(_edge(root_id, did, f"dedup match ({row[4]})"))

    # ── Level 4: Exceptions with source_reference matching record_key ──
    if depth >= 2:
        exceptions_result = await db.execute(
            text("""
                SELECT id, type, category, severity, status, title, source_reference
                FROM exceptions
                WHERE tenant_id = :tid AND source_reference = :rk
                ORDER BY created_at DESC
                LIMIT 10
            """),
            {"tid": tid, "rk": record_key},
        )
        for row in exceptions_result.fetchall():
            eid = f"exception:{row[0]}"
            nodes[eid] = _node(eid, f"Exception: {row[5][:40]}", "exception", {
                "type": row[1],
                "category": row[2],
                "severity": row[3],
                "status": row[4],
                "title": row[5],
            })
            edges.append(_edge(root_id, eid, "exception"))

    # ── Level 5: Cross-domain relationships from record_relationships ──
    rel_result = await db.execute(
        text("""
            SELECT id, from_domain, from_key, to_domain, to_key,
                   relationship_type, ai_inferred, ai_confidence, impact_score
            FROM record_relationships
            WHERE tenant_id = :tid
              AND active = true
              AND (
                  (from_domain = :ot AND from_key = :rk)
                  OR (to_domain = :ot AND to_key = :rk)
              )
            ORDER BY impact_score DESC NULLS LAST
            LIMIT 20
        """),
        {"tid": tid, "rk": record_key, "ot": object_type},
    )
    for row in rel_result.fetchall():
        rel_id = f"relationship:{row[0]}"
        # Determine the "other" side of the relationship
        if row[1] == object_type and row[2] == record_key:
            other_domain, other_key = row[3], row[4]
        else:
            other_domain, other_key = row[1], row[2]

        other_node_id = f"record:{other_domain}:{other_key}"
        if other_node_id not in nodes:
            nodes[other_node_id] = _node(
                other_node_id,
                f"{other_domain} / {other_key}",
                "relationship",
                {
                    "domain": other_domain,
                    "relationship_type": row[5],
                    "ai_inferred": row[6],
                    "ai_confidence": float(row[7]) if row[7] else None,
                    "impact_score": float(row[8]) if row[8] else None,
                },
            )
        edges.append(_edge(
            root_id,
            other_node_id,
            row[5],
        ))

    return {
        "nodes": list(nodes.values()),
        "edges": edges,
    }
