"""Which runs belong to one lineage, so a comparison or a trend never mixes objects.

A run downloaded from a system belongs to that system: its key is the raw
``metadata.system_id``, unchanged. An upload has no system, so uploads are
grouped by the objects they carry: ``upload:<sorted metadata.modules joined by +>``
(falling back to the ``dqs_summary`` keys, then to the label without its size
suffix), the same key ``frontend/lib/runs.ts:lineageOf`` builds, minus its
``system:`` prefix for system runs. A controlling upload therefore never compares
with a business_partner upload, and the baseline of an upload is resolved among
uploads of the same objects only.

``record_issues.scope`` and the monitor's ``scope`` stay the coarse
``system_id or 'upload'``: they key stored data, not run comparisons.
"""

# The label without a trailing size or count ("business_partner_100k" -> "business_partner"),
# as labelFamily() in frontend/lib/runs.ts. No (?:...) groups: text() would read ":records" as a bind.
_LABEL_FAMILY = r"[\s_-]*\d+([.,]\d+)?\s*[km]?\s*(records?|rows?)?$"


def lineage_sql(alias: str = "") -> str:
    """SQL expression for the lineage key of the ``analysis_versions`` row ``alias`` (none: unqualified)."""
    p = f"{alias}." if alias else ""
    return (
        f"COALESCE({p}metadata->>'system_id', 'upload' || COALESCE(':' || COALESCE("
        f"(SELECT string_agg(m, '+' ORDER BY m COLLATE \"C\") FROM jsonb_array_elements_text("
        f"CASE WHEN jsonb_typeof({p}metadata->'modules') = 'array' THEN {p}metadata->'modules' "
        f"ELSE '[]'::jsonb END) AS m), "
        f"(SELECT string_agg(k, '+' ORDER BY k COLLATE \"C\") FROM jsonb_object_keys("
        f"CASE WHEN jsonb_typeof({p}dqs_summary) = 'object' THEN {p}dqs_summary ELSE '{{}}'::jsonb END) AS k), "
        f"NULLIF(btrim(regexp_replace(lower(btrim({p}label)), '{_LABEL_FAMILY}', '', 'i')), '')), ''))"
    )


def same_lineage_as(param: str = "v", alias: str = "") -> str:
    """SQL predicate: the row ``alias`` is in the lineage of the version bound to ``:param``."""
    return (f"{lineage_sql(alias)} = (SELECT {lineage_sql('lin_ref')} FROM analysis_versions lin_ref "
            f"WHERE lin_ref.id = CAST(:{param} AS uuid))")


def lineage_key(metadata: dict | None, dqs_summary: dict | None = None, label: str | None = None) -> str:
    """Python twin of ``lineage_sql`` for a run already loaded (tests and fakes)."""
    import re

    md = metadata or {}
    if md.get("system_id"):
        return str(md["system_id"])
    mods = md.get("modules") if isinstance(md.get("modules"), list) else []
    if not mods and isinstance(dqs_summary, dict):
        mods = list(dqs_summary)
    if mods:
        return "upload:" + "+".join(sorted(str(m) for m in mods))
    family = re.sub(_LABEL_FAMILY, "", (label or "").strip().lower(), flags=re.I).strip()
    return f"upload:{family}" if family else "upload"
