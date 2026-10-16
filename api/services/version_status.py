"""Which ``analysis_versions.status`` values are a finished run.

A run that ran its checks ends as ``complete`` (checks only), ``agents_complete``
or ``ai_enriched`` (the agents ran afterwards), ``agents_failed`` (the checks
finished and their report was kept, only the LLM enrichment failed) or
``partial`` (some checks were skipped). All five carry findings and a score,
and are what every "latest run", comparison, analytics and freshness reader
must accept. ``failed`` ended too, but has nothing to read: it is archivable
(``ENDED``) and nothing else.
"""

FINISHED: tuple[str, ...] = ("complete", "agents_complete", "ai_enriched", "agents_failed", "partial")
ENDED: tuple[str, ...] = FINISHED + ("failed",)


def finished_sql(column: str = "status") -> str:
    """SQL predicate ``<column> IN ('complete', ...)`` for use inside a text() query."""
    return f"{column} IN ({', '.join(repr(s) for s in FINISHED)})"
