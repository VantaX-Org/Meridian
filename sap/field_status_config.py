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
    # material master field selection
    "T130F": ["FNAME", "FGRUP"],        # field (TABLE-FIELD) → field selection group
    "T130A": ["FLREF", "FAUSW"],        # field reference → status per group (position = group)
    "T134": ["MTART", "FLREF"],         # material type → field reference
    "T137": ["MBRSH", "FLREF"],         # industry sector → field reference
    # conversion exits: external (language-dependent) → internal codes, for uploaded values
    "T006A": ["SPRAS", "MSEHI", "MSEH3"],        # CUNIT: 'PC' (EN) / 'ST' (DE) → internal 'ST'
    "TAUUM": ["SPRAS", "AUART", "AUART_SPR"],    # AUART: 'OR' (EN) → internal 'TA'
    # country settings and bank directory (checks/country_rules.py)
    "T005": ["LAND1", "LNPLZ", "PRPLZ", "XPLZS", "LNST1", "PRST1", "LNST2", "PRST2", "LNBKN", "PRBKN", "LNBLZ", "PRBLZ"],
    "BNKA": ["BANKS", "BANKL"],
    # pricing condition types and HR infotype time constraints (checks/config_rules.py)
    "T685A": ["KAPPL", "KSCHL", "KNEGA", "KRECH", "KOAID"],
    "T683S": ["KVEWE", "KAPPL", "KALSM", "KSCHL"],   # pricing procedure steps
    "T582A": ["INFTY", "ZEITB"],
}

# Reference lists the customer uploads (licensed data that never comes from SAP):
# stored as config snapshots with source 'reference' (api/routes/system_objects.py).
REFERENCE_TABLES = {
    "REF_POSTAL": ["COUNTRY", "POSTCODE"],  # official postal codes per country (SAP country key)
    "REF_BIC": ["BIC", "COUNTRY"],          # licensed SWIFT BIC directory (BIC11; COUNTRY = BIC characters 5-6)
}


def conversion_maps(config: dict[str, list[dict]]) -> dict[str, dict[str, str]]:
    """{conversion exit: {external: internal}} from this system's own tables. English
    first; a code from another language is used only when it maps to one internal code."""
    out: dict[str, dict[str, str]] = {}
    for exit_, table, internal, external in (("CUNIT", "T006A", "MSEHI", "MSEH3"), ("AUART", "TAUUM", "AUART", "AUART_SPR")):
        rows = config.get(table) or []
        if not rows:
            continue
        internals = {str(r.get(internal) or "").strip() for r in rows} - {""}
        english = {str(r.get(external) or "").strip(): str(r.get(internal) or "").strip()
                   for r in rows if str(r.get("SPRAS") or "").strip() == "E"}
        other: dict[str, set[str]] = {}
        for r in rows:
            other.setdefault(str(r.get(external) or "").strip(), set()).add(str(r.get(internal) or "").strip())
        m = {ext: next(iter(ints)) for ext, ints in other.items() if len(ints) == 1}
        m.update(english)
        out[exit_] = {ext: i for ext, i in m.items() if ext and i and ext not in internals}  # internal codes stay as they are
    return out

# SAP's documented priority when several references set a material field: hide > display > required > optional
_PRIORITY = {"-": 3, "*": 2, "+": 1, ".": 0}
MATERIAL_TABLES = ("MARA", "MAKT")  # client-level data, controlled by material type and industry sector


def resolve_material(config: dict[str, list[dict]], dictionary) -> dict[str, dict[str, str]]:
    """{TABLE.FIELD: {"MTART|MBRSH": "required" | "suppressed"}} from this system's
    material field selection. Empty unless all four tables were read."""
    if not all(config.get(t) for t in ("T130F", "T130A", "T134", "T137")):
        return {}
    strings = {str(r["FLREF"]).strip(): str(r.get("FAUSW") or "") for r in config["T130A"]}
    mtart = {str(r["MTART"]).strip(): strings.get(str(r.get("FLREF") or "").strip()) for r in config["T134"]}
    mbrsh = {str(r["MBRSH"]).strip(): strings.get(str(r.get("FLREF") or "").strip()) for r in config["T137"]}
    out: dict[str, dict[str, str]] = {}
    for r in config["T130F"]:
        table, _, name = str(r.get("FNAME", "")).strip().partition("-")
        group = str(r.get("FGRUP") or "").strip()
        f = dictionary.field(table, name) if table in MATERIAL_TABLES else None
        if f is None or f.key or not group.isdigit() or int(group) < 1:
            continue
        pos = int(group) - 1
        for mt, s1 in mtart.items():
            for mb, s2 in mbrsh.items():
                chars = [s[pos] for s in (s1, s2) if s and pos < len(s) and s[pos] in _PRIORITY]
                if not chars:
                    continue
                st = STATUS[max(chars, key=_PRIORITY.get)]
                if st in ("required", "suppressed"):
                    out.setdefault(f"{table}.{name}", {})[f"{mt}|{mb}"] = st
    return out
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
