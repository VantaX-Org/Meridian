"""Per-system source overrides for cloud extraction.

The canonical dictionaries describe the *standard* API surface of a system
(``sap/dictionaries/canonical/*.yaml``). A tenant's real surface differs: entity-set names
that are suffixed per tenant (``Goal_<planId>``), vendor spellings that vary
(``workscheduleCode`` vs ``workScheduleCode``), and properties the API user may not read. When
a canonical source does not resolve there, the rule reading it is silently not evaluated.

Corrections have to live somewhere, and putting them in the canonical file is wrong: it would
apply one customer's quirks to every other customer, and it has already caused a confusing
failure - a correction was made to the canonical map, verified in the running image, and still
did not reach extraction because a saved snapshot outranked it.

So an override belongs to the system it was discovered on:

    sap/dictionaries/overrides/<system_type>.yaml

    <system-id>:
      TABLE.FIELD: NewEntity.newProperty

Resolution order, most specific first:

  1. an override for this system id, for this table and field
  2. an override for this system id, for this table and field under an ``*`` system id
     (defaults that have proven true across deployments, and can still be removed)
  3. the canonical ``source``

A file that is absent is not an error - the built-in map below is the shipped default, and a
deployment may add its own.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger("meridian.source_overrides")

ROOT = Path(__file__).resolve().parents[2]
OVERRIDE_DIR = ROOT / "sap" / "dictionaries" / "overrides"

# Corrections that are properties of SuccessFactors itself rather than of one tenant, each
# verified against a live tenant's $metadata. Kept here so a deployment that needs them does
# not have to reproduce the investigation, and so the canonical file stays generic.
BUILTIN: dict[str, dict[str, dict[str, str]]] = {
    "successfactors": {
        "*": {
            # `Goal` is not an entity set in the OData catalogue; goals are served from Goal_1,
            # which carries id/name/state/userId/metric/due/start/weight/flag/lastModified/
            # modifier/currentOwner/category.
            "GOALPLAN.GOAL_ID": "Goal_1.id",
            "GOALPLAN.USERID": "Goal_1.userId",
            "GOALPLAN.GOAL_NAME": "Goal_1.name",
            "GOALPLAN.GOAL_METRIC": "Goal_1.metric",
            "GOALPLAN.GOAL_STATUS": "Goal_1.state",
            "GOALPLAN.GOAL_WEIGHT": "Goal_1.weight",
            "GOALPLAN.VISIBILITY_FLAG": "Goal_1.flag",
            "GOALPLAN.LAST_MODIFIED": "Goal_1.lastModified",
            "GOALPLAN.MODIFIER": "Goal_1.modifier",
            "GOALPLAN.CURRENT_OWNER": "Goal_1.currentOwner",
            "GOALPLAN.GOAL_CATEGORY": "Goal_1.category",
            "GOALPLAN.TARGET_DATE": "Goal_1.due",
            "GOALPLAN.GOAL_START_DATE": "Goal_1.start",
            # EmpJob spells the work-schedule property in lower case.
            "EMPEMPLOYMENT.WORK_SCHEDULE": "EmpJob.workscheduleCode",
            "EMPJOBHIST.WORK_SCHEDULE": "EmpJob.workscheduleCode",
            # Successor carries the nominee id under its own name, and the emergency flag.
            "SUCCESSIONCANDIDATE.NOMINEE_ID": "Successor.nomineeUserId",
            "SUCCESSIONCANDIDATE.EMERGENCY_SUCCESSOR_FLAG": "Successor.isEmergencyCover",
            # TalentPool's identifier property is `code`.
            "SUCCESSIONCANDIDATE.TALENT_POOL_ID": "TalentPool.code",
            # FormHeader spells it formTemplateId; JobApplication exposes `rating`.
            "PMREVIEWRESULT.FORM_TEMPLATE_ID": "FormHeader.formTemplateId",
            "JOBAPPLICATION.RATING": "JobApplication.rating",
        }
    }
}


@lru_cache(maxsize=8)
def _file_overrides(system_type: str) -> dict[str, dict[str, str]]:
    """{system_id: {"TABLE.FIELD": "Entity.property"}} from the on-disk override file."""
    import yaml

    path = OVERRIDE_DIR / f"{system_type}.yaml"
    if not path.exists():
        return {}
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception as e:  # a malformed override must not take extraction down
        logger.warning(f"source override file {path} unreadable, ignoring: {e}")
        return {}
    out: dict[str, dict[str, str]] = {}
    for system_id, mapping in (doc or {}).items():
        if isinstance(mapping, dict):
            out[str(system_id)] = {str(k): str(v) for k, v in mapping.items()}
    return out


def override_for(system_type: str, system_id: str | None, table: str, field: str) -> str | None:
    """The overridden ``Entity.property`` source, or None to keep the canonical one."""
    key = f"{table}.{field}"
    if system_id:
        specific = _file_overrides(system_type).get(str(system_id), {})
        if key in specific:
            return specific[key]
    builtin = BUILTIN.get(system_type, {})
    if system_id and key in (builtin.get(str(system_id)) or {}):
        return builtin[str(system_id)][key]
    if key in (builtin.get("*") or {}):
        return builtin["*"][key]
    return None


def clear_cache() -> None:
    """Drop the cached override files (a deployment may add one without a restart)."""
    _file_overrides.cache_clear()


def resolve_source(system_type: str, system_id: str | None, table: str, field: str,
                   canonical: str | None) -> str | None:
    """The source to use for ``table.field``: override when there is one, else canonical."""
    return override_for(system_type, system_id, table, field) or canonical
