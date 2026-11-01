"""Per-record context snapshot: the classification codes a flagged record carried.

checks/self_tune.py can only propose an exclusion on a column whose value it knows
for each reviewed issue. The record key gives it the key parts (WERKS, BUKRS); this
snapshot gives it the low-cardinality codes around the record (material type,
account group, employee class) so a false-positive cluster on MARA.MTART=DIEN can be
excluded too.

What is kept is deliberately narrow. Codes only, never free text, names, amounts,
dates, IDs or personal data:

* ``CODES`` lists, per module, classification code columns that the module's own
  shipped rules already read (tests/test_record_context.py proves each one against
  the YAML). Nothing here is a new SAP field.
* A rule's own ``applies_when`` / ``field`` / ``fields`` columns are kept only when
  they are one of these known code columns, so an amount or text field the rule
  checks never lands in the snapshot.
* ``checks.profiling.is_sensitive`` drops anything on an HR/personal table or with a
  personal field name, whatever the list says.
* At most ``MAX_FIELDS`` columns and ``MAX_CHARS`` characters per value.
"""

from __future__ import annotations

import pandas as pd

MAX_FIELDS = 8
MAX_CHARS = 40

# Module -> classification code columns used by that module's shipped rules.
# SuccessFactors: organisational codes only; gender, nationality, address/bank
# country, pay grade, event reason, absence type and assessments are left out.
CODES: dict[str, tuple[str, ...]] = {
    "material_master": ("MARA.MTART", "MARA.MATKL", "MARA.MBRSH", "MARA.SPART", "MARC.BESKZ",
                        "MARC.DISMM", "MBEW.VPRSV", "MARA.MSTAE"),
    "sd_customer_master": ("KNA1.KTOKD", "KNA1.LAND1", "KNVV.KDGRP", "KNVV.VTWEG", "KNVV.SPART",
                           "KNVP.PARVW"),
    "accounts_payable": ("LFA1.KTOKK", "LFA1.LAND1", "LFB1.AKONT", "LFB1.ZWELS", "BSIK.UMSKZ"),
    "accounts_receivable": ("KNA1.KTOKD", "KNA1.LAND1", "KNB1.AKONT", "BSID.UMSKZ"),
    "business_partner": ("BUT000.TYPE", "BUT000.BU_GROUP", "BUT100.RLTYP"),
    "fi_gl": ("BKPF.BSTAT", "BSEG.KOART", "BKPF.AWTYP", "CSKB.KATYP", "SKB1.MITKZ"),
    "controlling": ("AUFK.AUTYP", "CSKB.KATYP", "CSLA.LATYP"),
    "mm_purchasing": ("EKKO.BSTYP", "EKPO.PSTYP", "EKPO.KNTTP", "EKBE.VGABE"),
    "sd_sales_orders": ("VBAK.VBTYP", "VBAP.PSTYV", "KONH.KAPPL", "VBPA.PARVW"),
    "production_planning": ("PLPO.PLNTY", "CRHD.OBJTY", "STPO.POSTP", "STKO.STLTY", "MARC.BESKZ",
                            "MARC.SOBSL"),
    "plant_maintenance": ("PLPO.PLNTY", "QMEL.QMART", "STPO.STLTY", "MPLA.STRAT"),
    "quality_management": ("QMEL.QMART", "PLMK.PLNTY", "PLKO.PLNTY", "QALS.ART"),
    "asset_accounting": ("ANLB.AFASL", "ANLA.ANLKL", "ANKB.AFASL"),
    "project_system": ("AUFK.AUTYP", "COBRB.KONTY"),
    "hcm": ("HRP1000.OTYPE", "HRP1000.ISTAT", "HRP1000.PLVAR", "HRP1001.RELAT"),
    "interface_health": ("EDIDC.DIRECT", "EDIDC.STATUS", "EDIDC.MESTYP"),
    "cross_system_integration": ("XSYS.OBJECT_TYPE",),
    # EMPEMPLOYMENT is a sensitive table (checks.profiling), so its codes are read from EMPJOBHIST.
    "employee_central": ("EMPJOBHIST.STATUS", "EMPJOBHIST.COMPANY", "EMPJOBHIST.EMPLOYEE_CLASS",
                         "EMPJOBHIST.EMPLOYMENT_TYPE", "POSITION.EFFECTIVE_STATUS"),
    "compensation": ("COMPINFO.PAY_COMPONENT_TYPE", "COMPINFO.PAY_TYPE", "COMPINFO.PAY_SCALE_TYPE",
                     "COMPINFO.COMP_FREQUENCY"),
    "learning_management": ("LEARNINGASSIGNMENT.STATUS", "LEARNINGASSIGNMENT.ITEM_TYPE",
                            "LEARNINGASSIGNMENT.REQUIRED"),
    "performance_goals": ("PMREVIEWRESULT.FORM_STATUS", "GOALPLAN.GOAL_STATUS"),
    "recruiting_onboarding": ("JOBREQUISITION.STATUS",),
    "time_attendance": ("TIMESHEET.APPROVAL_STATUS", "TIMESHEET.TIME_ACCOUNT_TYPE"),
    "ariba_contracts": ("ARIBA_CONTRACT.STATUS",),
    "concur_expense": ("CONCUR_REPORT.APPROVAL_STATUS_CODE",),
    "fleet_management": ("FLEET.FLEET_CAT",),
    "transport_management": ("VTTK.STTRG",),
    "mdg_master_data": ("USMD120C.USMD_CREQ_STATUS",),
}
_ALL = frozenset(c for cols in CODES.values() for c in cols)


def _allowed(column: str) -> bool:
    from checks.profiling import is_sensitive  # profiling imports checks.base
    table, _, field = column.rpartition(".")
    return column in _ALL and not is_sensitive(table, field)


def columns(rule: dict) -> list[str]:
    """Context columns of a rule, before checking what the frame holds: the rule's own
    code columns first, then its module's, capped later at MAX_FIELDS."""
    refs = [*(rule.get("applies_when") or {}), *([rule["field"]] if rule.get("field") else []),
            *(rule.get("fields") or [])]
    return [c for c in dict.fromkeys([*refs, *CODES.get(rule.get("module") or "", ())])
            if isinstance(c, str) and _allowed(c)]


def snapshot(failing_df: pd.DataFrame, rule: dict) -> list[dict]:
    """{column: code} per failing row, parallel to the failing keys; blanks left out."""
    cols = [c for c in columns(rule) if c in failing_df.columns][:MAX_FIELDS]
    if not cols:
        return [{} for _ in range(len(failing_df))]
    vals = failing_df[cols].astype("string").fillna("")
    for c in cols:
        vals[c] = vals[c].str.strip().str.slice(0, MAX_CHARS)
    return [{c: v for c, v in row.items() if v} for row in vals.to_dict("records")]
