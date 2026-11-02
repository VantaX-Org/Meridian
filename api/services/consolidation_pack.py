"""SAP consolidation action pack: what to do in SAP with each merged-away record.

A steward merge leaves the loser in master_records with ``merged_into`` = its survivor.
SAP still holds both. The pack lists, per loser, the survivor it maps to and the field
changes that retire it in SAP: deletion flag, posting/order block, and on material the
old material number pointing at the survivor so open documents can be traced. Export only:
Meridian never writes these to SAP. Fields are the DDIC ones (MARA, KNA1, BUT000); a status
whose value is customer configuration (MSTAE, AUFSD) is named with no value, for the
customer to fill from their own T141 / TVAST entries.
"""

from typing import Optional

# action: (table, field, value or None, reason). value "{survivor}" is the survivor key.
ACTIONS: dict[str, list[tuple[str, str, Optional[str], str]]] = {
    "material_master": [
        ("MARA", "LVORM", "X", "flag_for_deletion"),
        ("MARA", "BISMT", "{survivor}", "point_to_survivor"),
        ("MARA", "MSTAE", None, "cross_plant_status_block"),
    ],
    "sd_customer_master": [
        ("KNA1", "LOEVM", "X", "flag_for_deletion"),
        ("KNA1", "SPERR", "X", "posting_block"),
        ("KNA1", "AUFSD", None, "order_block"),
    ],
    "business_partner": [
        ("BUT000", "XDELE", "X", "flag_for_deletion"),
        ("BUT000", "XBLCK", "X", "central_block"),
    ],
    # SuccessFactors people are not retired by flag: the mapping is the deliverable.
    "employee_central": [],
}


def pack_rows(domain: str, merged: list[dict]) -> list[dict]:
    """``merged``: ``[{loser, survivor, merged_at}]`` -> one row per loser and action
    (one mapping-only row when the domain has no actions)."""
    actions = ACTIONS.get(domain, [])
    out = []
    for m in merged:
        base = {"loser_key": m["loser"], "survivor_key": m["survivor"], "merged_at": m.get("merged_at")}
        if not actions:
            out.append({**base, "table": None, "field": None, "value": None, "action": "map_to_survivor"})
        for table, field, value, why in actions:
            out.append({**base, "table": table, "field": field, "action": why,
                        "value": m["survivor"] if value == "{survivor}" else value})
    return out
