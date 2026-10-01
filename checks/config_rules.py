"""Rules from the system's own pricing and HR configuration.

T685A (condition types), per usage/application: KNEGA restricts a condition
type to negative ('X') or positive ('A') rates, KRECH fixes its calculation
type, KOAID 'B' marks price conditions. Records loaded or kept after the
condition type changed contradict it: a surcharge stored as a discount, a
quantity price on a percentage condition, a zero price.

T582A (infotype attributes): the time constraint ZEITB. 1 = the infotype must
exist without gaps from hire to 31.12.9999 (org assignment, personal data);
2 = no overlaps, gaps allowed. Subtype-dependent constraints ('T', T591A) and
constraint 3 are not judged. Nothing is generated without the tables.
"""

from __future__ import annotations

MODULE_KAPPL = {"sd_sales_orders": "V", "mm_purchasing": "M"}
_SIGN = {"X": ("negative", "`KONP.KBETR` > 0"), "A": ("positive", "`KONP.KBETR` < 0")}
_KRECH = {"A": "percentage", "B": "fixed amount", "C": "quantity", "D": "gross weight", "E": "net weight",
          "F": "volume", "G": "formula", "H": "percentage (in hundreds)", "L": "points"}
HR_MODULE = "employee_central"


def _s(row: dict, f: str) -> str:
    return str(row.get(f) or "").strip()


def _pricing(module: str, config: dict[str, list[dict]]) -> list[dict]:
    kappl = MODULE_KAPPL.get(module)
    rows = [r for r in config.get("T685A") or [] if _s(r, "KAPPL") == kappl and _s(r, "KSCHL")]
    if not kappl or not rows:
        return []
    base = {"module": module, "grain": "KONH", "check_class": "cross_field_check",
            "rule_authority": "system_pricing_configuration", "dimension": "consistency"}
    rec = "Condition record {KONH.KNUMH} ({KONP.KSCHL})"
    out = []
    for flag, (sign, expr) in _SIGN.items():
        types = sorted({_s(r, "KSCHL") for r in rows if _s(r, "KNEGA") == flag})
        if types:
            out.append({**base, "id": f"KS-{kappl}-{flag}", "field": "KONP.KBETR", "fail_when": expr,
                        "applies_when": {"KONP.KAPPL": [kappl], "KONP.KSCHL": types}, "severity": "high",
                        "message": f"Condition rate has the wrong sign: its condition type allows {sign} rates only "
                                   "(T685A-KNEGA)",
                        "why_it_matters": "The condition type defines whether it is a surcharge or a deduction. A "
                                          "record with the opposite sign turns a discount into a surcharge (or back).",
                        "sap_impact": "Every document using the record is priced in the wrong direction.",
                        "fix_map": {"__other__": "Correct the rate's sign on the record (VK12 / MEK2)."},
                        "record_fix_template": rec + " has rate {KONP.KBETR}."})
    for krech in sorted({_s(r, "KRECH") for r in rows} - {""}):
        types = sorted({_s(r, "KSCHL") for r in rows if _s(r, "KRECH") == krech})
        out.append({**base, "id": f"KC-{kappl}-{krech}", "field": "KONP.KRECH",
                    "fail_when": f"`KONP.KRECH`.notna() & (`KONP.KRECH` != '{krech}')",
                    "applies_when": {"KONP.KAPPL": [kappl], "KONP.KSCHL": types}, "severity": "high",
                    "message": f"Condition record's calculation type differs from its condition type's "
                               f"({_KRECH.get(krech, krech)}, T685A-KRECH)",
                    "why_it_matters": "The calculation type was changed on the condition type after these records "
                                      "were created; old records keep the old one, so the same condition type "
                                      "computes as a percentage on some records and an amount on others.",
                    "sap_impact": "Condition values are wrong by orders of magnitude (5 % read as 5 per unit).",
                    "fix_map": {"__other__": "Recreate the record under the current calculation type and delete the "
                                             "old one (VK11 / MEK1)."},
                    "record_fix_template": rec + " is calculated as '{KONP.KRECH}'."})
    prices = sorted({_s(r, "KSCHL") for r in rows if _s(r, "KOAID") == "B"})
    if prices:
        out.append({**base, "id": f"KZ-{kappl}", "field": "KONP.KBETR", "fail_when": "`KONP.KBETR` == 0",
                    "applies_when": {"KONP.KAPPL": [kappl], "KONP.KSCHL": prices}, "severity": "high",
                    "dimension": "accuracy",
                    "message": "Price condition record has a zero rate (condition class 'price', T685A-KOAID)",
                    "why_it_matters": "A price of zero is found by pricing like any other price: the goods are sold "
                                      "or bought for nothing instead of the document stopping for a missing price.",
                    "sap_impact": "Revenue or valuation of zero on every document using the record.",
                    "fix_map": {"__other__": "Maintain the price, or delete the record so the document stops "
                                             "for a missing price."},
                    "record_fix_template": rec + " has a zero rate."})
    return out


def _time_constraints(module: str, config: dict[str, list[dict]], dictionary) -> list[dict]:
    if module != HR_MODULE or not config.get("T582A"):
        return []
    out = []
    for row in config["T582A"]:
        infty, zeitb = _s(row, "INFTY"), _s(row, "ZEITB")
        t = f"PA{infty}"
        if zeitb not in ("1", "2") or not infty.isdigit() or dictionary.table(t) is None:
            continue
        one = zeitb == "1"
        # the constraint holds per subtype and object (an SAP user and an e-mail address coexist)
        group = [f"{t}.{f}" for f in ("PERNR", "SUBTY", "OBJPS") if dictionary.field(t, f) is not None]
        out.append({"module": module, "id": f"TC-{t}", "field": f"{t}.BEGDA", "check_class": "interval_check",
                    "grain": t, "group_by": group, "start": f"{t}.BEGDA", "end": f"{t}.ENDDA",
                    **({"mode": "continuous", "open_ended": True} if one else {}),
                    "rule_authority": "system_hr_configuration", "severity": "high", "dimension": "consistency",
                    "message": f"Infotype {infty} records of an employee " +
                               ("overlap, leave a gap, or stop before 31.12.9999 (time constraint 1, T582A)" if one
                                else "overlap (time constraint 2, T582A)"),
                    "why_it_matters": "The system's own time constraint for the infotype " +
                                      ("requires exactly one record on every day from hire onwards; payroll, time "
                                       "evaluation and reporting read 'the' record for a date and find none or two."
                                       if one else "allows at most one record on any day; two valid records make "
                                       "payroll and reporting pick one at random."),
                    "sap_impact": "Payroll and time evaluation reject or mis-process the employee for the affected "
                                  "periods.",
                    "fix_map": {"__other__": f"Display the infotype {infty} history (PA20, overview) and delimit or "
                                             "extend the records so the periods follow on without overlap."},
                    "record_fix_template": f"Employee {{{t}.PERNR}}: infotype {infty} record from {{{t}.BEGDA}} to "
                                           f"{{{t}.ENDDA}}."})
    return out


def generate(module: str, config: dict[str, list[dict]], dictionary) -> list[dict]:
    return _pricing(module, config) + _time_constraints(module, config, dictionary)


def fields_for(table: str, dictionary) -> set[str]:
    """Fields these rules read on ``table`` (extraction and column pruning)."""
    return {"KAPPL", "KSCHL", "KBETR", "KRECH"} if table == "KONP" else set()
