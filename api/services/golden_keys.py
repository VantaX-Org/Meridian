"""System-qualified golden record keys.

A golden record is keyed by (tenant, domain, sap_object_key). The same SAP key (KUNNR 1000) can exist in
two connected systems as two different business objects, so the system that built the record first keeps
the plain key and a later system's record is stored as ``<key>@@<system_id>``. Single-system data never
sees a qualified key, so existing rows and their keys are unchanged. Anything that needs the real SAP key
(write-back, display) calls ``plain``.
"""
from __future__ import annotations

SEP = "@@"


def qualify(key: str, system_id: str) -> str:
    return f"{key}{SEP}{system_id}"


def plain(key: str) -> str:
    return key.partition(SEP)[0]


def contribution_systems(contributions: dict | None) -> set[str]:
    """System ids that supplied any value of a record (source_contributions entries carry source_system_id)."""
    return {e["source_system_id"] for e in (contributions or {}).values()
            if isinstance(e, dict) and e.get("source_system_id")}


def pick_key(key: str, system_id: str | None, rows: dict[str, dict | None]) -> str:
    """The master key for (key, system). ``rows``: sap_object_key -> source_contributions of the existing
    plain and qualified records. Plain unless another system already owns the plain record."""
    if not system_id:
        return key
    q = qualify(key, system_id)
    if q in rows:
        return q
    owners = contribution_systems(rows.get(key))
    return q if owners and system_id not in owners else key
