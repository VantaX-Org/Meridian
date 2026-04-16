"""LangGraph orchestrator — wires five sub-agents into a StateGraph.

Graph: analyst → config_matching → remediation → readiness → report_agent → END
Each node checks for errors and routes to END if state["error"] is set.
"""

import json
import logging

from langgraph.graph import END, StateGraph
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.ext.asyncio import async_sessionmaker

from agents.analyst import analyst_node
from agents.config_impact import config_impact_node
from agents.config_matching import config_matching_node
from agents.readiness import readiness_node
from agents.remediation import remediation_node
from agents.report_agent import report_node
from agents.state import AgentState
from api.config import settings

logger = logging.getLogger("meridian.agents.orchestrator")


# Build the graph once at module level
_graph_builder = StateGraph(AgentState)

_graph_builder.add_node("analyst", analyst_node)
_graph_builder.add_node("config_matching", config_matching_node)
_graph_builder.add_node("config_impact", config_impact_node)
_graph_builder.add_node("remediation", remediation_node)
_graph_builder.add_node("readiness", readiness_node)
_graph_builder.add_node("report_agent", report_node)

_graph_builder.set_entry_point("analyst")
_graph_builder.add_edge("analyst", "config_matching")
_graph_builder.add_edge("config_matching", "config_impact")
_graph_builder.add_edge("config_impact", "remediation")
_graph_builder.add_edge("remediation", "readiness")
_graph_builder.add_edge("readiness", "report_agent")
_graph_builder.add_edge("report_agent", END)

graph = _graph_builder.compile()


async def run_graph(version_id: str, tenant_id: str) -> AgentState:
    """Load data from Postgres and invoke the full agent pipeline.

    Returns the final AgentState with all fields populated.
    """
    engine = create_async_engine(settings.database_url, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))

        # Load version
        result = await db.execute(
            text("SELECT dqs_summary, metadata, status FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        row = result.fetchone()
        if not row:
            raise ValueError(f"Version {version_id} not found for tenant {tenant_id}")

        dqs_summary = row[0] or {}
        metadata = row[1] or {}
        modules = metadata.get("modules", [])

        # Load findings — summaries only, never raw data
        # Include rule_context and value_fix_map so agents know about
        # deterministic fixes (no raw SAP records are included)
        findings_result = await db.execute(
            text("""
                SELECT check_id, module, severity, dimension,
                       affected_count, total_count, pass_rate,
                       details->>'message' as message,
                       rule_context, value_fix_map
                FROM findings
                WHERE version_id = :vid AND tenant_id = :tid
            """),
            {"vid": version_id, "tid": tenant_id},
        )
        findings_rows = findings_result.fetchall()

    await engine.dispose()

    findings_summary = []
    for r in findings_rows:
        entry = {
            "check_id": r[0],
            "module": r[1],
            "severity": r[2],
            "dimension": r[3],
            "affected_count": r[4],
            "total_count": r[5],
            "pass_rate": float(r[6]) if r[6] is not None else 0.0,
            "message": r[7] or "",
        }
        # Include deterministic fix context for agents (no raw records)
        if r[8]:
            entry["rule_context"] = r[8]
        if r[9]:
            entry["value_fix_map"] = r[9]
        findings_summary.append(entry)

    # Trim fields that bloat the LLM payload — agents don't need them
    def _trim_for_agents(finding: dict) -> dict:
        return {k: v for k, v in finding.items()
                if k not in ("value_fix_map", "record_fixes", "details")}

    findings_summary = [_trim_for_agents(f) for f in findings_summary]

    # Only send failing findings to the LLM — passing checks are noise
    findings_summary = [f for f in findings_summary if f.get("pass_rate", 100) < 100]

    # Sort by severity (critical first) and cap at 30 to limit token count
    SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    findings_summary.sort(key=lambda f: (SEVERITY_ORDER.get(f.get("severity", "low"), 9), f.get("pass_rate", 100)))
    if len(findings_summary) > 30:
        logger.warning(f"Capping findings for agents: {len(findings_summary)} → 30")
        findings_summary = findings_summary[:30]

    # Build DQS scores dict for state
    dqs_scores = {}
    for mod, scores in dqs_summary.items():
        if isinstance(scores, dict):
            dqs_scores[mod] = {
                "composite_score": scores.get("composite_score", 0.0),
                "dimension_scores": scores.get("dimension_scores", {}),
                "critical_count": scores.get("critical_count", 0),
                "capped": scores.get("capped", False),
            }

    initial_state: AgentState = {
        "version_id": version_id,
        "tenant_id": tenant_id,
        "module_names": modules,
        "findings_summary": findings_summary,
        "dqs_scores": dqs_scores,
        "root_causes": [],
        "remediations": {},
        "readiness_scores": {},
        "report": None,
        "config_matches": [],
        "config_match_summary": {},
        "config_impact_results": [],
        "config_impact_summary": {},
        "error": None,
    }

    logger.info(f"Running agent graph for version={version_id}, modules={modules}, findings={len(findings_summary)}")

    final_state = await graph.ainvoke(initial_state)

    # Store report to Postgres
    if final_state.get("report") and not final_state.get("error"):
        report_engine = create_async_engine(settings.database_url, echo=False)
        report_session_factory = async_sessionmaker(report_engine, expire_on_commit=False)

        async with report_session_factory() as db:
            await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))
            await db.execute(
                text("""
                    INSERT INTO reports (id, version_id, tenant_id, report_json, generated_at)
                    VALUES (gen_random_uuid(), :vid, :tid, CAST(:report AS jsonb), now())
                    ON CONFLICT (version_id, tenant_id) DO UPDATE SET report_json = CAST(:report AS jsonb)
                """),
                {
                    "vid": version_id,
                    "tid": tenant_id,
                    "report": json.dumps(final_state["report"]),
                },
            )
            await db.commit()

        await report_engine.dispose()
        logger.info(f"Report stored for version={version_id}")

    return final_state
