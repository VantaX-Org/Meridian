"""Config-derived field status: which fields each account group makes required
or suppressed, read from the source system's own customizing.

SAP stores a field-status string per account group (vendor T077K, customer
T077D): one character per *position* of a field-selection definition —
``+`` required, ``-`` suppressed, ``.`` optional, ``*`` display. Long strings
continue in further columns that share the data element (e.g. vendor general
data = FAUSA + FAUS1 + FAUS2, all ``FAUSA_077K``). The meaning of each
position comes from the system itself:

  TMODO  (FAUNA, MODIF → GGRUP)                 positions of a definition
  TMODU  (FAUNA, MODIF → TABNM, FELDN, KOART)   fields each position controls

Which definition (FAUNA) a segment uses is not published by SAP, so it is
*resolved from the system's metadata*: the one definition whose positions
control the segment's table (LFA1 for vendor general data, …) and fit the
segment's length. If that is not unique, the segment produces no rules and
the reason is reported — nothing is guessed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

STATUS = {"+": "required", "-": "suppressed", ".": "optional", "*": "display"}


@dataclass(frozen=True)
class Segment:
    id: str
    module: str
    config_table: str        # T077K / T077D
    group_field: str         # key of the config table (KTOKK / KTOKD)
    status_fields: tuple[str, ...]
    record_table: str        # table whose fields the positions control
    group_source: str        # TABLE.FIELD giving each record's account group
    koart: str               # account type in TMODU (K vendor, D customer)
    label: str


SEGMENTS: tuple[Segment, ...] = (
    Segment("vendor_general", "accounts_payable", "T077K", "KTOKK", ("FAUSA", "FAUS1", "FAUS2"),
            "LFA1", "LFA1.KTOKK", "K", "vendor general data"),
    Segment("vendor_company_code", "accounts_payable", "T077K", "KTOKK", ("FAUSF", "FAUSG"),
            "LFB1", "LFA1.KTOKK", "K", "vendor company-code data"),
    Segment("vendor_purchasing", "mm_purchasing", "T077K", "KTOKK", ("FAUSM", "FAUSN"),
            "LFM1", "LFA1.KTOKK", "K", "vendor purchasing data"),
    Segment("customer_general", "accounts_receivable", "T077D", "KTOKD", ("FAUSA", "FAUS1", "FAUS2"),
            "KNA1", "KNA1.KTOKD", "D", "customer general data"),
    Segment("customer_company_code", "accounts_receivable", "T077D", "KTOKD", ("FAUSF", "FAUSG"),
            "KNB1", "KNA1.KTOKD", "D", "customer company-code data"),
    Segment("customer_sales", "sd_customer_master", "T077D", "KTOKD", ("FAUSV", "FAUSU"),
            "KNVV", "KNA1.KTOKD", "D", "customer sales-area data"),
)

# customizing read at discovery (config_snapshots) — see workers/tasks/run_discovery.py
CONFIG_TABLES = {
    "T077K": ["KTOKK", "FAUSA", "FAUS1", "FAUS2", "FAUSF", "FAUSG", "FAUSM", "FAUSN"],
    "T077D": ["KTOKD", "FAUSA", "FAUS1", "FAUS2", "FAUSF", "FAUSG", "FAUSV", "FAUSU"],
    "TMODO": ["FAUNA", "MODIF", "GGRUP"],
    "TMODU": ["FAUNA", "MODIF", "TABNM", "FELDN", "KOART"],
}
_SEGMENT_LEN = 40  # every FAUS* column is CHAR 40


@dataclass
class Resolution:
    segment: Segment
    fauna: str | None = None
    reason: str = ""
    # position (1-based) → fields of the record table it controls
    positions: dict[int, list[str]] = field(default_factory=dict)
    # account group → {field: status}
    groups: dict[str, dict[str, str]] = field(default_factory=dict)


def _pos(modif) -> int | None:
    s = str(modif or "").strip()
    return int(s) if s.isdigit() else None


def resolve(segment: Segment, tmodo: list[dict], tmodu: list[dict], config_rows: list[dict]) -> Resolution:
    res = Resolution(segment)
    length = _SEGMENT_LEN * len(segment.status_fields)
    by_def: dict[str, list[dict]] = {}
    for r in tmodu:
        if str(r.get("TABNM", "")).strip() == segment.record_table and \
                str(r.get("KOART", "")).strip() in ("", segment.koart):
            by_def.setdefault(str(r["FAUNA"]).strip(), []).append(r)
    max_pos = {}
    for r in tmodo:
        p = _pos(r.get("MODIF"))
        if p:
            f = str(r["FAUNA"]).strip()
            max_pos[f] = max(max_pos.get(f, 0), p)
    candidates = [f for f in by_def if 0 < max_pos.get(f, 0) <= length]
    if len(candidates) != 1:
        res.reason = (f"no field-selection definition controls {segment.record_table}" if not candidates else
                      f"ambiguous: {', '.join(sorted(candidates))} all control {segment.record_table}")
        return res
    res.fauna = candidates[0]
    for r in by_def[res.fauna]:
        p = _pos(r.get("MODIF"))
        name = str(r.get("FELDN", "")).strip()
        if p and name:
            res.positions.setdefault(p, [])
            col = f"{segment.record_table}.{name}"
            if col not in res.positions[p]:
                res.positions[p].append(col)
    for row in config_rows:
        group = str(row.get(segment.group_field, "")).strip()
        string = "".join(str(row.get(c) or "").ljust(_SEGMENT_LEN) for c in segment.status_fields)
        statuses = {}
        for p, cols in res.positions.items():
            st = STATUS.get(string[p - 1]) if p <= len(string) else None
            if st in ("required", "suppressed"):
                for c in cols:
                    statuses[c] = st
        if group:
            res.groups[group] = statuses
    return res


def resolve_all(config: dict[str, list[dict]]) -> list[Resolution]:
    """Every segment whose customizing is present in ``config`` ({table: rows})."""
    if not config.get("TMODO") or not config.get("TMODU"):
        return []
    return [resolve(s, config["TMODO"], config["TMODU"], config[s.config_table])
            for s in SEGMENTS if config.get(s.config_table)]
