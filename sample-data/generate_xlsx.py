"""Generate 200-row business_partner test workbooks for the Meridian upload pipeline.

Produces three .xlsx files:
  * business-partner-200-clean.xlsx    — 200 valid rows               (DQS 100)
  * business-partner-200-1error.xlsx   — 199 valid + 1 broken row     (DQS capped)
  * business-partner-200-allbad.xlsx   — 200 broken rows              (DQS ~floor)

Headers use canonical SAP TABLE.FIELD names so the check engine resolves them
directly. Run from the repo root:  python sample-data/generate_xlsx.py
"""
import pandas as pd

COLUMNS = [
    "BUT000.PARTNER", "BUT000.BU_TYPE", "BUT000.BU_GROUP", "BUT000.NAME_ORG1",
    "BUT000.NAME_ORG2", "BUT000.NAME_FIRST", "BUT000.NAME_LAST", "BUT000.TITLE",
    "BUT000.PARTNER_GUID", "BUT000.BU_SORT1", "BUT000.BU_SORT2", "BUT000.XDELE",
    "BUT000.XBLCK", "BUT000.NATPERS", "BUT000.NATIO", "BUT000.BPEXT",
    "BUT000.BPKIND", "BUT000.LANGU_CORR", "BUT000.STCEG", "BUT000.CREATED_AT",
    "BUT000.CHANGED_AT", "BUT100.RLTYP", "BUT100.VALID_FROM", "BUT100.VALID_TO",
    "ADR6.SMTP_ADDR", "ADRC.COUNTRY", "ADRC.CITY1", "ADRC.CITY2",
    "ADRC.POST_CODE1", "ADRC.STREET", "ADRC.HOUSE_NUM1", "ADRC.REGION",
    "ADRC.TEL_NUMBER", "ADRC.FAX_NUMBER", "ADRC.LANGU",
]

N = 200


def valid_row(i: int) -> dict:
    """A fully conformant Business Partner record."""
    return {
        "BUT000.PARTNER": f"{1000000000 + i:010d}",       # 10-digit numeric, unique
        "BUT000.BU_TYPE": "2",                            # organisation
        "BUT000.BU_GROUP": "BP01",                        # valid grouping (TB003)
        "BUT000.NAME_ORG1": f"Company {i:03d} Ltd",
        "BUT000.NAME_ORG2": f"Division {i}",
        "BUT000.NAME_FIRST": "Alex",
        "BUT000.NAME_LAST": "Morgan",
        "BUT000.TITLE": "Company",
        "BUT000.PARTNER_GUID": f"550e8400-e29b-41d4-a716-{i:012d}",
        "BUT000.BU_SORT1": f"SRCH{i:04d}",
        "BUT000.BU_SORT2": f"SR{i:04d}",
        "BUT000.XDELE": "",                               # not flagged for deletion
        "BUT000.XBLCK": "",                               # not blocked
        "BUT000.NATPERS": "",                             # organisation, not a person
        "BUT000.NATIO": "DE",
        "BUT000.BPEXT": f"EXT-{i:04d}",
        "BUT000.BPKIND": "STD",
        "BUT000.LANGU_CORR": "EN",
        "BUT000.STCEG": f"GB{i:09d}",                     # valid VAT format
        "BUT000.CREATED_AT": "2024-01-15",
        "BUT000.CHANGED_AT": "2026-05-01",                # fresh (< 1 year)
        "BUT100.RLTYP": "BUR001",
        "BUT100.VALID_FROM": "2020-01-01",
        "BUT100.VALID_TO": "2030-12-31",
        "ADR6.SMTP_ADDR": f"user{i}@example.com",
        "ADRC.COUNTRY": "DE",
        "ADRC.CITY1": "Berlin",
        "ADRC.CITY2": "Mitte",
        "ADRC.POST_CODE1": "10115",
        "ADRC.STREET": "Hauptstrasse",
        "ADRC.HOUSE_NUM1": "12",
        "ADRC.REGION": "BE",
        "ADRC.TEL_NUMBER": "+49 30 1000000",
        "ADRC.FAX_NUMBER": "+49 30 2000000",
        "ADRC.LANGU": "EN",
    }


def bad_row() -> dict:
    """A broadly broken record — fails checks across every DQS dimension."""
    return {
        "BUT000.PARTNER": "BADPARTNER",                   # invalid format
        "BUT000.BU_TYPE": "9",                            # invalid category
        "BUT000.BU_GROUP": "ZZZZ",                        # not a real grouping
        "BUT000.NAME_ORG1": None,
        "BUT000.NAME_ORG2": None,
        "BUT000.NAME_FIRST": None,
        "BUT000.NAME_LAST": None,
        "BUT000.TITLE": None,
        "BUT000.PARTNER_GUID": "not-a-guid",              # invalid UUID
        "BUT000.BU_SORT1": None,
        "BUT000.BU_SORT2": None,
        "BUT000.XDELE": "Y",                              # invalid flag
        "BUT000.XBLCK": "Y",                              # invalid flag
        "BUT000.NATPERS": "Y",                            # invalid flag
        "BUT000.NATIO": None,
        "BUT000.BPEXT": None,
        "BUT000.BPKIND": None,
        "BUT000.LANGU_CORR": None,
        "BUT000.STCEG": "12",                             # invalid VAT format
        "BUT000.CREATED_AT": None,
        "BUT000.CHANGED_AT": "2019-01-01",                # stale (> 1 year)
        "BUT100.RLTYP": None,
        "BUT100.VALID_FROM": "2030-01-01",                # after VALID_TO
        "BUT100.VALID_TO": "2020-01-01",
        "ADR6.SMTP_ADDR": "notanemail",                   # invalid email
        "ADRC.COUNTRY": None,
        "ADRC.CITY1": None,
        "ADRC.CITY2": None,
        "ADRC.POST_CODE1": None,
        "ADRC.STREET": None,
        "ADRC.HOUSE_NUM1": None,
        "ADRC.REGION": None,
        "ADRC.TEL_NUMBER": None,
        "ADRC.FAX_NUMBER": None,
        "ADRC.LANGU": None,
    }


def write(path: str, rows: list[dict]) -> None:
    df = pd.DataFrame(rows, columns=COLUMNS)
    df.to_excel(path, index=False, engine="openpyxl")
    print(f"wrote {path}  ({len(df)} rows)")


if __name__ == "__main__":
    base = "sample-data"

    # 1. All valid
    write(f"{base}/business-partner-200-clean.xlsx", [valid_row(i) for i in range(1, N + 1)])

    # 2. 199 valid + 1 broken (row 200)
    one_error = [valid_row(i) for i in range(1, N)] + [bad_row()]
    write(f"{base}/business-partner-200-1error.xlsx", one_error)

    # 3. All broken
    write(f"{base}/business-partner-200-allbad.xlsx", [bad_row() for _ in range(N)])
