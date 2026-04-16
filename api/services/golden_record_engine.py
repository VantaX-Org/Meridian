"""Golden record survivorship engine.

For each incoming sync batch:
1. Match records to existing golden records via sap_object_key
2. Apply survivorship_rules field by field (deterministic first)
3. For fields with no deterministic winner, call ai_survivorship.py
4. Store ai_recommendation in source_contributions JSONB
5. Compute overall_confidence
6. Set status to candidate or pending_review based on confidence threshold

Writes to master_records table.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.survivorship import (
    FieldContribution,
    SurvivorshipResult,
    evaluate_field,
    apply_most_recent,
)
from api.services.ai_survivorship import propose_field_winner

logger = logging.getLogger("meridian.golden_record_engine")

# Default confidence threshold — records below this go to pending_review
CONFIDENCE_THRESHOLD = 0.85


async def _load_survivorship_rules(
    db: AsyncSession,
    tenant_id: str,
    domain: str,
) -> dict[str, dict]:
    """Load active survivorship rules for a domain, keyed by field name."""
    result = await db.execute(
        text("""
            SELECT field, rule_type, trusted_sources, weight
            FROM survivorship_rules
            WHERE tenant_id = :tid AND domain = :domain AND active = true
        """),
        {"tid": tenant_id, "domain": domain},
    )
    rules = {}
    for row in result.fetchall():
        rules[row[0]] = {
            "rule_type": row[1],
            "trusted_sources": row[2],
            "weight": row[3],
        }
    return rules


async def _get_or_create_master_record(
    db: AsyncSession,
    tenant_id: str,
    domain: str,
    sap_object_key: str,
) -> tuple[str, dict, dict, bool]:
    """Find existing master record or prepare for creation.

    Returns: (record_id, golden_fields, source_contributions, is_new)
    """
    result = await db.execute(
        text("""
            SELECT id, golden_fields, source_contributions
            FROM master_records
            WHERE tenant_id = :tid AND domain = :domain AND sap_object_key = :key
        """),
        {"tid": tenant_id, "domain": domain, "key": sap_object_key},
    )
    row = result.fetchone()
    if row:
        return str(row[0]), row[1] or {}, row[2] or {}, False

    new_id = str(uuid.uuid4())
    return new_id, {}, {}, True


def _build_contributions(
    incoming_records: list[dict],
) -> dict[str, list[FieldContribution]]:
    """Build field-level contributions from incoming source records.

    Each incoming record should have:
      - source_system: str
      - extracted_at: str (ISO timestamp)
      - fields: dict[str, value]
      - confidence: float (optional, default 1.0)
    """
    field_contributions: dict[str, list[FieldContribution]] = {}

    for record in incoming_records:
        source = record["source_system"]
        extracted = record.get("extracted_at", datetime.now(timezone.utc).isoformat())
        if isinstance(extracted, str):
            extracted = datetime.fromisoformat(extracted.replace("Z", "+00:00"))
        conf = float(record.get("confidence", 1.0))

        for field_name, value in record.get("fields", {}).items():
            if field_name not in field_contributions:
                field_contributions[field_name] = []
            field_contributions[field_name].append(
                FieldContribution(
                    value=value,
                    source_system=source,
                    extracted_at=extracted,
                    confidence=conf,
                )
            )

    return field_contributions


async def process_sync_batch(
    db: AsyncSession,
    tenant_id: str,
    domain: str,
    sap_object_key: str,
    incoming_records: list[dict],
) -> Optional[str]:
    """Process a batch of incoming records for a single SAP object key.

    Args:
        db: Async database session (RLS context must already be set)
        tenant_id: Tenant UUID string
        domain: SAP domain (e.g. 'business_partner')
        sap_object_key: The SAP object key to match
        incoming_records: List of source records, each with source_system, extracted_at, fields

    Returns:
        master_record_id on success, None on failure
    """
    try:
        # Load survivorship rules for this domain
        rules = await _load_survivorship_rules(db, tenant_id, domain)

        # Get or create the master record
        record_id, existing_golden, existing_contributions, is_new = (
            await _get_or_create_master_record(db, tenant_id, domain, sap_object_key)
        )

        # Build field contributions from incoming data
        field_contributions = _build_contributions(incoming_records)

        # Evaluate each field
        new_golden_fields: dict = dict(existing_golden)
        new_source_contributions: dict = dict(existing_contributions)
        confidence_scores: list[float] = []
        ai_involved = False

        for field_name, contributions in field_contributions.items():
            rule = rules.get(field_name)
            result: Optional[SurvivorshipResult] = None

            if rule:
                result = evaluate_field(
                    field_name=field_name,
                    contributions=contributions,
                    rule_type=rule["rule_type"],
                    trusted_sources=rule.get("trusted_sources"),
                    all_field_contributions=field_contributions,
                )

            # If no deterministic winner, try AI
            ai_recommendation = None
            if result is None and len(contributions) >= 2:
                ai_result = propose_field_winner(
                    tenant_id=tenant_id,
                    field_name=field_name,
                    domain=domain,
                    contributions=[
                        {
                            "source_system": c.source_system,
                            "extracted_at": c.extracted_at.isoformat(),
                            "confidence": c.confidence,
                            "value": c.value,
                        }
                        for c in contributions
                    ],
                )

                if ai_result:
                    ai_involved = True
                    ai_recommendation = ai_result
                    # Find the contribution matching the AI recommendation
                    recommended_source = ai_result["recommended_value_source"]
                    matching = [c for c in contributions if c.source_system == recommended_source]
                    if matching:
                        result = SurvivorshipResult(
                            value=matching[0].value,
                            source_system=matching[0].source_system,
                            rule_type="ai_recommended",
                            confidence=ai_result["confidence"],
                        )

            # Final fallback: most_recent
            if result is None and contributions:
                result = apply_most_recent(contributions)

            if result is not None:
                new_golden_fields[field_name] = result.value
                confidence_scores.append(result.confidence)

                # Build source contribution entry
                contribution_entry = {
                    "value": result.value,
                    "source_system": result.source_system,
                    "extracted_at": max(c.extracted_at for c in contributions).isoformat(),
                    "confidence": result.confidence,
                }
                if ai_recommendation:
                    contribution_entry["ai_recommendation"] = ai_recommendation["recommended_value_source"]
                    contribution_entry["ai_confidence"] = ai_recommendation["confidence"]
                    contribution_entry["ai_reasoning"] = ai_recommendation["reasoning"]

                new_source_contributions[field_name] = contribution_entry

        # Compute overall confidence
        overall_confidence = (
            sum(confidence_scores) / len(confidence_scores)
            if confidence_scores
            else 0.0
        )

        # Determine status
        status = "candidate" if overall_confidence >= CONFIDENCE_THRESHOLD else "pending_review"

        now = datetime.now(timezone.utc)

        if is_new:
            await db.execute(
                text("""
                    INSERT INTO master_records (
                        id, tenant_id, domain, sap_object_key,
                        golden_fields, source_contributions,
                        overall_confidence, status, created_at, updated_at
                    ) VALUES (
                        :id, :tid, :domain, :key,
                        :golden_fields::jsonb, :source_contributions::jsonb,
                        :confidence, :status, :now, :now
                    )
                """),
                {
                    "id": record_id,
                    "tid": tenant_id,
                    "domain": domain,
                    "key": sap_object_key,
                    "golden_fields": _json_dumps(new_golden_fields),
                    "source_contributions": _json_dumps(new_source_contributions),
                    "confidence": overall_confidence,
                    "status": status,
                    "now": now,
                },
            )

            # Insert history entry
            await db.execute(
                text("""
                    INSERT INTO master_record_history (
                        id, tenant_id, master_record_id, changed_at,
                        change_type, new_fields, ai_was_involved
                    ) VALUES (
                        gen_random_uuid(), :tid, :rid, :now,
                        'created', :new_fields::jsonb, :ai
                    )
                """),
                {
                    "tid": tenant_id,
                    "rid": record_id,
                    "now": now,
                    "new_fields": _json_dumps(new_golden_fields),
                    "ai": ai_involved,
                },
            )
        else:
            # Update existing record
            await db.execute(
                text("""
                    UPDATE master_records
                    SET golden_fields = :golden_fields::jsonb,
                        source_contributions = :source_contributions::jsonb,
                        overall_confidence = :confidence,
                        status = CASE
                            WHEN status = 'golden' THEN 'golden'
                            WHEN status = 'superseded' THEN 'superseded'
                            ELSE :status
                        END,
                        updated_at = :now
                    WHERE id = :id AND tenant_id = :tid
                """),
                {
                    "id": record_id,
                    "tid": tenant_id,
                    "golden_fields": _json_dumps(new_golden_fields),
                    "source_contributions": _json_dumps(new_source_contributions),
                    "confidence": overall_confidence,
                    "status": status,
                    "now": now,
                },
            )

            # Insert history entry for update
            await db.execute(
                text("""
                    INSERT INTO master_record_history (
                        id, tenant_id, master_record_id, changed_at,
                        change_type, previous_fields, new_fields, ai_was_involved
                    ) VALUES (
                        gen_random_uuid(), :tid, :rid, :now,
                        'updated', :prev_fields::jsonb, :new_fields::jsonb, :ai
                    )
                """),
                {
                    "tid": tenant_id,
                    "rid": record_id,
                    "now": now,
                    "prev_fields": _json_dumps(existing_golden),
                    "new_fields": _json_dumps(new_golden_fields),
                    "ai": ai_involved,
                },
            )

        await db.commit()
        logger.info(
            f"Golden record {record_id} {'created' if is_new else 'updated'} "
            f"for {domain}/{sap_object_key} — confidence={overall_confidence:.2f}, status={status}"
        )
        return record_id

    except Exception as e:
        logger.error(f"Golden record engine failed for {domain}/{sap_object_key}: {e}")
        await db.rollback()
        return None


def _json_dumps(obj: dict) -> str:
    """Serialize dict to JSON string for parameterized queries."""
    import json
    return json.dumps(obj, default=str)
