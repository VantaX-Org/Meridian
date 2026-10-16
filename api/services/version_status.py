"""Which ``analysis_versions.status`` values are a finished run.

A run that ran its checks ends as ``complete`` (checks only), ``agents_complete``
or ``ai_enriched`` (the agents ran afterwards) or ``partial`` (some checks were
skipped). All four carry findings and a score, and are what every "latest run",
comparison, analytics and freshness reader must accept. ``failed`` and
``agents_failed`` ended too, but have nothing to read: they are archivable
(``ENDED``) and nothing else.
"""

FINISHED: tuple[str, ...] = ("complete", "agents_complete", "ai_enriched", "partial")
ENDED: tuple[str, ...] = FINISHED + ("agents_failed", "failed")


def finished_sql(column: str = "status") -> str:
    """SQL predicate ``<column> IN ('complete', ...)`` for use inside a text() query."""
    return f"{column} IN ({', '.join(repr(s) for s in FINISHED)})"
