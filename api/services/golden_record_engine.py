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
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.survivorship import (
    FieldContribution,
    SurvivorshipChain,
    SurvivorshipResult,
    TrustedSource,
    apply_most_recent,
    evaluate_field,
    matches_source,
)
from api.services.ai_survivorship import ai_survivorship_available, propose_field_winner
from sap.deterministic import classify_field

logger = logging.getLogger("meridian.golden_record_engine")

# Default confidence threshold — records below this go to pending_review
CONFIDENCE_THRESHOLD = 0.85


def _llm_survivorship_enabled() -> bool:
    """Feature flag — default ON; set MERIDIAN_SURVIVORSHIP_LLM=off for bulk runs."""
    val = os.getenv("MERIDIAN_SURVIVORSHIP_LLM", "on").strip().lower()
    return val not in ("off", "false", "0", "no")


def ai_survivorship_enabled(context: str = "") -> bool:
    """Whether undecided fields may go to the LLM: the feature flag is on and an LLM is
    configured. Call once per run and pass the answer to ``process_sync_batch`` as
    ``use_ai``, so a deployment without an LLM logs this once, not once per field."""
    if not _llm_survivorship_enabled():
        return False
    if not ai_survivorship_available():
        logger.info("AI survivorship off%s: no LLM configured; deterministic survivorship only",
                    f" ({context})" if context else "")
        return False
    return True


async def _load_survivorship_rules(
    db: AsyncSession,
    tenant_id: str,
    domain: str,
) -> dict[str, dict]:
    """Load active survivorship rules for a domain, keyed by field name.

    ``trusted_sources`` comes back resolved: an entry naming a connected system (by name or id) becomes
    that system's aliases ``[id, current name, entry]``, so a rule keeps matching after a rename and
    matches values tagged by system id as well as legacy values labelled by name.
    """
    systems = await _system_aliases(db, tenant_id)
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
            "trusted_sources": resolve_trusted_sources(row[2], systems),
            "weight": row[3],
        }
    return rules


async def _system_aliases(db: AsyncSession, tenant_id: str) -> dict[str, tuple[str, str]]:
    """``{id or name: (id, name)}`` for the tenant's connected systems."""
    rows = (await db.execute(text("SELECT id::text, name FROM sap_systems WHERE tenant_id = :tid"),
                             {"tid": tenant_id})).fetchall()
    out: dict[str, tuple[str, str]] = {}
    for sid, name in rows:
        out[sid] = (sid, name)
        if name:
            out.setdefault(name, (sid, name))
    return out


def resolve_trusted_sources(stored: Optional[list[str]],
                            systems: dict[str, tuple[str, str]]) -> Optional[list[TrustedSource]]:
    """Each stored entry that names a connected system becomes its aliases; any other entry stays as is."""
    if not stored:
        return stored
    out: list[TrustedSource] = []
    for entry in stored:
        hit = systems.get(entry)
        out.append([hit[0], hit[1], entry] if hit else entry)
    return out


def contribution_from_entry(entry: object) -> Optional[FieldContribution]:
    """A stored source_contributions entry as a contender, or None when it carries no value."""
    if not isinstance(entry, dict) or entry.get("value") is None:
        return None
    when = entry.get("extracted_at")
    try:
        extracted = datetime.fromisoformat(str(when).replace("Z", "+00:00")) if when else None
    except ValueError:
        extracted = None
    conf = entry.get("confidence")
    return FieldContribution(
        value=entry["value"],
        source_system=str(entry.get("source_system") or ""),
        extracted_at=extracted or datetime(1970, 1, 1, tzinfo=timezone.utc),
        confidence=float(conf) if conf is not None else 1.0,
        system_id=entry.get("source_system_id"),
        system_name=entry.get("source_system_name"),
    )


def trusted_winner(contributions: list[FieldContribution], prior: Optional[FieldContribution],
                   trusted: list[TrustedSource]) -> tuple[Optional[FieldContribution], bool]:
    """The value of the highest-trust system among this batch and the value the record holds now.

    Returns ``(winner, kept_prior)``. On the same system the incoming (newer) value wins.
    """
    pool = [c for c in contributions if c.value is not None]
    if prior is not None:
        pool.append(prior)
    for rank in trusted:
        hit = next((c for c in pool if matches_source(c, rank)), None)
        if hit is not None:
            return hit, hit is prior
    return None, False


def system_tags(system_id: Optional[str], system_name: Optional[str]) -> dict:
    """The source-system keys a source_contributions entry carries when its system is known."""
    out: dict = {}
    if system_id:
        out["source_system_id"] = system_id
    if system_name:
        out["source_system_name"] = system_name
    return out


async def _get_or_create_master_record(
    db: AsyncSession,
    tenant_id: str,
    domain: str,
    sap_object_key: str,
) -> tuple[str, dict, dict, bool]:
    """Find existing master record or prepare for creation.

    Returns: (record_id, golden_fields, source_contributions, is_new). For a record in a merge
    cluster the fields and contributions are its own pre-merge ones (own_fields /
    own_contributions, migration 090), so the fused values of merged members never leak into
    the record's own_fields on the next sync.
    """
    result = await db.execute(
        text("""
            SELECT id, COALESCE(own_fields, golden_fields),
                   CASE WHEN own_fields IS NULL THEN source_contributions
                        ELSE COALESCE(own_contributions, source_contributions) END
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
      - source_system_id / source_system_name: the connected system (optional)
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
                    system_id=record.get("source_system_id"),
                    system_name=record.get("source_system_name"),
                )
            )

    return field_contributions


async def process_sync_batch(
    db: AsyncSession,
    tenant_id: str,
    domain: str,
    sap_object_key: str,
    incoming_records: list[dict],
    use_ai: Optional[bool] = None,
) -> Optional[str]:
    """Process a batch of incoming records for a single SAP object key.

    Args:
        db: Async database session (RLS context must already be set)
        tenant_id: Tenant UUID string
        domain: SAP domain (e.g. 'business_partner')
        sap_object_key: The SAP object key to match
        incoming_records: List of source records, each with source_system, extracted_at, fields
        use_ai: ``ai_survivorship_enabled()`` decided once by the caller; resolved here when None

    Returns:
        master_record_id on success, None on failure
    """
    if use_ai is None:
        use_ai = ai_survivorship_enabled()
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

            # Trusted system wins across runs: the value the record holds now competes with this batch,
            # so a lower-trust system's newer extraction does not replace a higher-trust system's value.
            trusted = rule.get("trusted_sources") if rule else None
            if trusted and rule["rule_type"] in ("trusted_source", "chain"):
                prior = contribution_from_entry(existing_contributions.get(field_name))
                winner, kept_prior = trusted_winner(contributions, prior, trusted)
                if kept_prior:
                    new_golden_fields[field_name] = winner.value
                    new_source_contributions[field_name] = existing_contributions[field_name]
                    confidence_scores.append(winner.confidence)
                    continue
                if winner is not None:
                    result = SurvivorshipResult(winner.value, winner.source_system, "trusted_source",
                                                winner.confidence, winner.system_id, winner.system_name)

            if result is None and rule:
                result = evaluate_field(
                    field_name=field_name,
                    contributions=contributions,
                    rule_type=rule["rule_type"],
                    trusted_sources=rule.get("trusted_sources"),
                    all_field_contributions=field_contributions,
                )

            # Deterministic SAP-aware chain before ever touching the LLM.
            # This is the main LLM-avoidance path at 400k-record scale.
            if result is None and contributions:
                field_type = classify_field(
                    field_name,
                    sample_value=next((c.value for c in contributions if c.value is not None), None),
                )
                chain = SurvivorshipChain(
                    field_name=field_name,
                    field_type=field_type,
                    trusted_sources=rule.get("trusted_sources") if rule else None,
                    all_field_contributions=field_contributions,
                )
                result = chain.evaluate(contributions)

            # LLM fallback (only for genuinely undecided fields, and only when
            # the feature flag is on and an LLM is configured)
            ai_recommendation = None
            if result is None and len(contributions) >= 2 and use_ai:
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
                    **system_tags(result.system_id, result.system_name),
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
                        CAST(:golden_fields AS jsonb), CAST(:source_contributions AS jsonb),
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
                        'created', CAST(:new_fields AS jsonb), :ai
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
                    -- A record in a merge cluster (own_fields set) keeps its fused golden values;
                    -- the sync refreshes its own pre-merge values instead (migration 060).
                    -- ponytail: the cluster is not re-fused on sync; a steward override or
                    -- re-merge recomputes it.
                    SET golden_fields = CASE WHEN own_fields IS NULL THEN CAST(:golden_fields AS jsonb)
                                             ELSE golden_fields END,
                        own_fields = CASE WHEN own_fields IS NULL THEN NULL
                                          ELSE CAST(:golden_fields AS jsonb) END,
                        source_contributions = CASE WHEN own_fields IS NULL
                                                    THEN CAST(:source_contributions AS jsonb)
                                                    ELSE source_contributions END,
                        own_contributions = CASE WHEN own_fields IS NULL THEN own_contributions
                                                 ELSE CAST(:source_contributions AS jsonb) END,
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
                        'updated', CAST(:prev_fields AS jsonb), CAST(:new_fields AS jsonb), :ai
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
