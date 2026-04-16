"""NLP query service — intent classification, data retrieval, answer synthesis.

Uses the existing get_llm() provider. Never passes raw SAP record data to the LLM —
only aggregated statistics and finding summaries.
"""

import json
import logging
import re
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from llm.provider import get_llm

logger = logging.getLogger("meridian.nlp")

INTENT_SYSTEM_PROMPT = (
    "You are a data quality assistant for SAP systems. "
    "Classify the user question into one of these intents: "
    "findings_query, cleaning_query, exception_query, analytics_query, module_status, "
    "golden_record_query, glossary_query, relationship_query, sync_query, stewardship_query, "
    "ai_rules_query, general. "
    "golden_record_query: questions about golden records, confidence scores, survivorship or promoted records. "
    "glossary_query: questions about SAP field business meanings, mandatory fields, approved values. "
    "relationship_query: questions about cross-domain links — BPs as customers/vendors, material at plant. "
    "sync_query: questions about sync runs, anomaly scores, batch quality, last sync time. "
    "stewardship_query: questions about pending work items, queue backlog, SLA compliance, merge decisions. "
    "ai_rules_query: questions about AI-proposed match rules pending human review. "
    "Also extract any filters mentioned (module name, severity, date range, status). "
    'Respond in JSON only: {"intent": "...", "filters": {"module": null, "severity": null, '
    '"date_from": null, "date_to": null, "status": null}, '
    '"answer_type": "table|chart|summary"}'
)

ANSWER_SYSTEM_PROMPT = (
    "You are Meridian, a data quality assistant for SAP systems. "
    "Given the retrieved data context below, answer the user's question conversationally "
    "in 2-3 sentences maximum. Be specific with numbers. "
    "If the data includes a list, also output a structured JSON array under the key 'data'. "
    "Respond in JSON: {\"answer\": \"...\", \"data\": [...] or null, \"chart_type\": \"bar|line|pie\" or null}"
)

MAX_RETRIEVE = 50

# ── NLP filter sanitisation — allowlists for LLM-extracted filter values ──────

VALID_MODULES = {
    "business_partner", "material_master", "fi_gl", "employee_central",
    "accounts_payable", "accounts_receivable", "sd_customer_master",
    "sd_sales_orders", "mm_purchasing", "asset_accounting",
    "plant_maintenance", "production_planning", "compensation",
    "benefits", "payroll_integration", "performance_goals",
    "succession_planning", "recruiting_onboarding", "learning_management",
    "time_attendance", "ewms_stock", "ewms_transfer_orders",
    "batch_management", "mdg_master_data", "grc_compliance",
    "fleet_management", "transport_management", "wm_interface",
    "cross_system_integration",
}
VALID_SEVERITIES = {"critical", "high", "medium", "low", "warning"}
VALID_STATUSES = {
    "open", "pending", "approved", "applied", "rejected", "resolved",
    "in_progress", "escalated", "detected", "investigating",
    "pending_approval", "verified", "closed", "golden", "promoted",
    "pending_review", "superseded",
}
VALID_DOMAINS = {
    "business_partner", "material", "gl_account", "vendor",
    "customer", "employee", "asset",
}


def sanitise_nlp_filters(filters: dict) -> dict:
    """Validate LLM-extracted filter values against known-safe allowlists.

    Any value not in the allowlist is silently dropped — never passed to SQL.
    """
    safe: dict = {}
    if v := filters.get("module"):
        if str(v).lower() in VALID_MODULES:
            safe["module"] = str(v).lower()
    if v := filters.get("severity"):
        if str(v).lower() in VALID_SEVERITIES:
            safe["severity"] = str(v).lower()
    if v := filters.get("status"):
        if str(v).lower() in VALID_STATUSES:
            safe["status"] = str(v).lower()
    if v := filters.get("domain"):
        if str(v).lower() in VALID_DOMAINS:
            safe["domain"] = str(v).lower()
    # date filters — pass through only ISO-format dates
    for date_key in ("date_from", "date_to"):
        if v := filters.get(date_key):
            import re as _re
            if _re.match(r"^\d{4}-\d{2}-\d{2}$", str(v)):
                safe[date_key] = str(v)
    return safe


def _strip_json_fences(text_str: str) -> str:
    """Remove markdown code fences from LLM output."""
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", text_str.strip())
    cleaned = re.sub(r"\n?```\s*$", "", cleaned)
    return cleaned.strip()


def _safe_parse_json(text_str: str) -> dict:
    """Parse JSON from LLM output, stripping fences if needed."""
    try:
        return json.loads(_strip_json_fences(text_str))
    except json.JSONDecodeError:
        return {}


async def _classify_intent(question: str) -> dict:
    """Step 1: Classify user intent and extract filters."""
    llm = get_llm()
    from langchain_core.messages import SystemMessage, HumanMessage

    response = llm.invoke([
        SystemMessage(content=INTENT_SYSTEM_PROMPT),
        HumanMessage(content=question),
    ])
    parsed = _safe_parse_json(response.content)
    return {
        "intent": parsed.get("intent", "general"),
        "filters": parsed.get("filters", {}),
        "answer_type": parsed.get("answer_type", "summary"),
    }


async def _retrieve_findings(
    db: AsyncSession, tenant_id: str, filters: dict
) -> list[dict]:
    """Retrieve finding summaries (never raw record data)."""
    conditions = ["f.tenant_id = :tid"]
    params: dict = {"tid": tenant_id}

    if filters.get("module"):
        conditions.append("f.module = :module")
        params["module"] = filters["module"]
    if filters.get("severity"):
        conditions.append("f.severity = :severity")
        params["severity"] = filters["severity"]

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT f.id, f.module, f.check_id, f.severity, f.dimension,
                   f.affected_count, f.total_count, f.pass_rate,
                   f.details->>'message' as message, f.created_at
            FROM findings f
            JOIN analysis_versions v ON f.version_id = v.id
            WHERE {where}
            ORDER BY f.created_at DESC
            LIMIT :lim
        """),
        {**params, "lim": MAX_RETRIEVE},
    )
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_cleaning(
    db: AsyncSession, tenant_id: str, filters: dict
) -> list[dict]:
    """Retrieve cleaning queue summaries (no raw record_data_before/after)."""
    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": tenant_id}

    if filters.get("status"):
        conditions.append("status = :status")
        params["status"] = filters["status"]

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT id, object_type, status, confidence, record_key,
                   priority, detected_at, applied_at
            FROM cleaning_queue
            WHERE {where}
            ORDER BY detected_at DESC
            LIMIT :lim
        """),
        {**params, "lim": MAX_RETRIEVE},
    )
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_exceptions(
    db: AsyncSession, tenant_id: str, filters: dict
) -> list[dict]:
    """Retrieve exception summaries."""
    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": tenant_id}

    if filters.get("severity"):
        conditions.append("severity = :severity")
        params["severity"] = filters["severity"]
    if filters.get("status"):
        conditions.append("status = :status")
        params["status"] = filters["status"]

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT id, type, category, severity, status, title, description,
                   estimated_impact_zar, escalation_tier, sla_deadline, created_at
            FROM exceptions
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT :lim
        """),
        {**params, "lim": MAX_RETRIEVE},
    )
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_analytics(
    db: AsyncSession, tenant_id: str, filters: dict
) -> list[dict]:
    """Retrieve DQS history and module status."""
    result = await db.execute(
        text("""
            SELECT module_id, dqs_score, completeness, accuracy, consistency,
                   timeliness, uniqueness, validity, finding_count, recorded_at
            FROM dqs_history
            WHERE tenant_id = :tid
            ORDER BY recorded_at DESC
            LIMIT :lim
        """),
        {"tid": tenant_id, "lim": MAX_RETRIEVE},
    )
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_module_status(
    db: AsyncSession, tenant_id: str, filters: dict
) -> list[dict]:
    """Retrieve latest DQS per module from the most recent version."""
    result = await db.execute(
        text("""
            SELECT DISTINCT ON (module_id) module_id, dqs_score,
                   completeness, accuracy, consistency, timeliness,
                   uniqueness, validity, finding_count, recorded_at
            FROM dqs_history
            WHERE tenant_id = :tid
            ORDER BY module_id, recorded_at DESC
        """),
        {"tid": tenant_id},
    )
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_golden_records(
    db: AsyncSession, tenant_id: str, filters: dict,
    user_role: str = 'viewer',
) -> list[dict]:
    """Retrieve golden record summaries. Strips AI confidence for non-privileged roles."""
    from api.services.rbac import has_permission
    conditions = ["tenant_id = :tid", "status != 'superseded'"]
    params: dict = {"tid": tenant_id, "lim": MAX_RETRIEVE}
    if filters.get("module"):
        conditions.append("domain = :domain")
        params["domain"] = filters["module"]
    where = " AND ".join(conditions)
    ai_col = "overall_confidence" if has_permission(user_role, "view_ai_confidence") else "NULL as overall_confidence"
    result = await db.execute(text(f"""
        SELECT id, domain, sap_object_key, status, {ai_col},
               promoted_at, promoted_by
        FROM master_records WHERE {where}
        ORDER BY promoted_at DESC NULLS LAST LIMIT :lim
    """), params)
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_glossary(
    db: AsyncSession, tenant_id: str, filters: dict,
    user_role: str = 'viewer',
) -> list[dict]:
    """Retrieve glossary term summaries."""
    conditions = ["tenant_id = :tid", "status = 'active'"]
    params: dict = {"tid": tenant_id, "lim": MAX_RETRIEVE}
    if filters.get("module"):
        conditions.append("domain = :domain")
        params["domain"] = filters["module"]
    where = " AND ".join(conditions)
    result = await db.execute(text(f"""
        SELECT technical_name, business_name, business_definition,
               mandatory_for_s4hana, domain, sap_table, sap_field
        FROM glossary_terms WHERE {where}
        ORDER BY mandatory_for_s4hana DESC, business_name LIMIT :lim
    """), params)
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_relationships(
    db: AsyncSession, tenant_id: str, filters: dict,
    user_role: str = 'viewer',
) -> list[dict]:
    """Retrieve cross-domain relationship summaries."""
    from api.services.rbac import has_permission
    conditions = ["tenant_id = :tid", "active = true"]
    params: dict = {"tid": tenant_id, "lim": MAX_RETRIEVE}
    if filters.get("module"):
        conditions.append("from_domain = :domain")
        params["domain"] = filters["module"]
    where = " AND ".join(conditions)
    ai_col = "ai_confidence, impact_score" if has_permission(user_role, "view_ai_confidence") else "NULL as ai_confidence, NULL as impact_score"
    result = await db.execute(text(f"""
        SELECT from_domain, from_key, to_domain, to_key,
               relationship_type, ai_inferred, {ai_col}, discovered_at
        FROM record_relationships WHERE {where}
        ORDER BY discovered_at DESC LIMIT :lim
    """), params)
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_sync_runs(
    db: AsyncSession, tenant_id: str, filters: dict,
    user_role: str = 'viewer',
) -> list[dict]:
    """Retrieve recent sync run summaries."""
    from api.services.rbac import has_permission
    params: dict = {"tid": tenant_id, "lim": 20}
    ai_cols = "ai_quality_score, anomaly_flags" if has_permission(user_role, "view_ai_confidence") else "NULL as ai_quality_score, NULL as anomaly_flags"
    result = await db.execute(text(f"""
        SELECT sr.id, sr.status, sr.started_at, sr.completed_at,
               sr.rows_extracted, sr.findings_delta, {ai_cols},
               sp.domain
        FROM sync_runs sr
        JOIN sync_profiles sp ON sp.id = sr.profile_id
        WHERE sr.tenant_id = :tid
        ORDER BY sr.started_at DESC LIMIT :lim
    """), params)
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_stewardship(
    db: AsyncSession, tenant_id: str, filters: dict,
    user_role: str = 'viewer',
) -> list[dict]:
    """Retrieve stewardship queue summaries."""
    from api.services.rbac import has_permission
    conditions = ["tenant_id = :tid", "status != 'resolved'"]
    params: dict = {"tid": tenant_id, "lim": MAX_RETRIEVE}
    if filters.get("module"):
        conditions.append("domain = :domain")
        params["domain"] = filters["module"]
    if filters.get("status"):
        conditions.append("status = :status")
        params["status"] = filters["status"]
    where = " AND ".join(conditions)
    ai_cols = "ai_recommendation, ai_confidence" if has_permission(user_role, "view_ai_confidence") else "NULL as ai_recommendation, NULL as ai_confidence"
    result = await db.execute(text(f"""
        SELECT id, item_type, domain, priority, due_at, status,
               sla_hours, {ai_cols}
        FROM stewardship_queue WHERE {where}
        ORDER BY priority ASC, due_at ASC NULLS LAST LIMIT :lim
    """), params)
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_ai_rules(
    db: AsyncSession, tenant_id: str, filters: dict,
    user_role: str = 'viewer',
) -> list[dict]:
    """Retrieve pending AI-proposed rules. Restricted to roles with review_ai_rules."""
    from api.services.rbac import has_permission
    if not has_permission(user_role, "review_ai_rules"):
        return []
    result = await db.execute(text("""
        SELECT id, domain, rationale, supporting_correction_count,
               status, created_at
        FROM ai_proposed_rules
        WHERE tenant_id = :tid AND status = 'pending'
        ORDER BY created_at DESC LIMIT 20
    """), {"tid": tenant_id})
    return [dict(r._mapping) for r in result.fetchall()]


_RETRIEVERS = {
    "findings_query": _retrieve_findings,
    "cleaning_query": _retrieve_cleaning,
    "exception_query": _retrieve_exceptions,
    "analytics_query": _retrieve_analytics,
    "module_status": _retrieve_module_status,
    "general": _retrieve_findings,
    "golden_record_query": _retrieve_golden_records,
    "glossary_query": _retrieve_glossary,
    "relationship_query": _retrieve_relationships,
    "sync_query": _retrieve_sync_runs,
    "stewardship_query": _retrieve_stewardship,
    "ai_rules_query": _retrieve_ai_rules,
}


async def _synthesise_answer(
    question: str, intent: str, data: list[dict], answer_type: str
) -> dict:
    """Step 3: LLM synthesises a conversational answer from retrieved data."""
    llm = get_llm()
    from langchain_core.messages import SystemMessage, HumanMessage

    # Serialise data — convert non-serialisable types
    safe_data = []
    for row in data[:20]:  # Cap context to 20 rows for LLM
        safe_row = {}
        for k, v in row.items():
            if hasattr(v, "isoformat"):
                safe_row[k] = v.isoformat()
            elif isinstance(v, (int, float, str, bool, type(None))):
                safe_row[k] = v
            else:
                safe_row[k] = str(v)
        safe_data.append(safe_row)

    context = (
        f"Intent: {intent}\n"
        f"Answer type requested: {answer_type}\n"
        f"Retrieved {len(data)} records. Sample:\n"
        f"{json.dumps(safe_data[:10], indent=2, default=str)}"
    )

    response = llm.invoke([
        SystemMessage(content=ANSWER_SYSTEM_PROMPT),
        HumanMessage(content=f"Data context:\n{context}\n\nUser question: {question}"),
    ])

    parsed = _safe_parse_json(response.content)
    return {
        "answer": parsed.get("answer", response.content[:500]),
        "data": parsed.get("data"),
        "chart_type": parsed.get("chart_type"),
    }


async def process_query(
    question: str, tenant_context: dict, db: AsyncSession,
    user_role: str = 'viewer',
) -> dict:
    """Main NLP query pipeline: classify → retrieve → synthesise.

    Args:
        question: Natural language question from the user.
        tenant_context: Must contain 'tenant_id'.
        db: Active async database session with RLS already set.
        user_role: Caller's RBAC role — controls AI field visibility in retrievers.

    Returns:
        {answer: str, sources: [{type, id, relevance}], data?: list, chart_type?: str}
    """
    import inspect

    tenant_id = str(tenant_context["tenant_id"])

    # Step 1 — Intent classification
    classification = await _classify_intent(question)
    intent = classification["intent"]
    filters = sanitise_nlp_filters(classification["filters"])
    answer_type = classification["answer_type"]

    logger.info(f"NLP query: intent={intent}, filters={filters}, answer_type={answer_type}")

    # Step 2 — Data retrieval
    retriever = _RETRIEVERS.get(intent, _retrieve_findings)
    sig = inspect.signature(retriever)
    if 'user_role' in sig.parameters:
        data = await retriever(db, tenant_id, filters, user_role=user_role)
    else:
        data = await retriever(db, tenant_id, filters)

    # Build sources list
    sources = []
    for row in data[:10]:
        source_type = intent.replace("_query", "").replace("_status", "")
        sources.append({
            "type": source_type,
            "id": str(row.get("id", "")),
            "relevance": "direct",
        })

    # Step 3 — Answer synthesis
    synthesis = await _synthesise_answer(question, intent, data, answer_type)

    return {
        "answer": synthesis["answer"],
        "sources": sources,
        "data": synthesis.get("data"),
        "chart_type": synthesis.get("chart_type"),
    }
