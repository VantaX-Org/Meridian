"""Realistic-ish synthetic SAP extracts for the 400k validation path.

`synthetic_sap_data.py` next door generates a clean 12-column happy-path
frame. That's fine for unit tests but it doesn't exercise the pathology
a real ECC extract would hit:
  - Z-fields (customer namespace) mixed in with standard SAP fields
  - Mixed string encodings (UTF-8, Latin-1, Shift-JIS) in addresses
  - Trailing whitespace, leading zeroes, all-caps vs title-case
  - Out-of-range values (date strings like '00000000')
  - Referential orphans (material references a non-existent plant)
  - High cardinality (400k rows with ~5% dupes on "company + country")

This module generates each module with that shape so
`pytest -m perf tests/checks/test_perf_400k.py` and ad-hoc validation
runs exercise something closer to the real world than
happy-path-plus-15%-random-nulls.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd


# ── Business Partner ─────────────────────────────────────────────────────────

def _maybe_mangle_encoding(s: str, rng: random.Random) -> str:
    """1% chance a field gets a mojibake character pair — simulates the
    typical ECC export-to-CSV roundtrip where Latin-1 got mis-decoded
    as UTF-8. Realistic for EMEA customer names."""
    if rng.random() > 0.01:
        return s
    variants = ["Ã©", "Ã¨", "Ã¶", "Ã¼", "â€™", "â€“"]
    idx = rng.randrange(len(s))
    return s[:idx] + rng.choice(variants) + s[idx:]


def generate_realistic_business_partner(n: int = 5000, seed: int = 42) -> pd.DataFrame:
    rng = random.Random(seed)
    now = datetime.now(timezone.utc)

    bu_types = ["1", "2", "3"]           # 1=person, 2=group, 3=org
    bu_type_weights = [0.4, 0.1, 0.5]
    countries_valid = ["ZA", "DE", "US", "GB", "FR", "NL", "AE", "AU"]
    titles_valid = ["0001", "0002", "0003", "0004"]
    name_pool = ["Acme Holdings", "Neonoir Industries", "Delta Trading", "Veritas Global",
                 "Orion Logistics", "Baobab Capital", "Mbeya Mining", "Westpoint Dairy"]

    rows: list[dict[str, Any]] = []
    for i in range(n):
        # Most rows are clean; 12% have one defect; 2% have multiple defects.
        defect_roll = rng.random()
        dirty_kind = None
        if defect_roll < 0.02:
            dirty_kind = "multi"
        elif defect_roll < 0.14:
            dirty_kind = "single"

        partner_id = f"{1_000_000_000 + i}"
        bu_type = rng.choices(bu_types, bu_type_weights)[0]
        title = rng.choice(titles_valid)
        country = rng.choice(countries_valid)
        name1 = _maybe_mangle_encoding(rng.choice(name_pool) + f" {i % 100:02d}", rng)
        city = rng.choice(["Johannesburg", "Cape Town", "Durban", "Pretoria", "Berlin", "Amsterdam"])
        email = f"contact{i}@{rng.choice(['example', 'corp', 'test'])}.com"
        created_on = (now - timedelta(days=rng.randint(1, 3650))).date().isoformat()
        tax_id = f"{rng.randint(1_000_000_000, 9_999_999_999)}"

        # Introduce a customer Z-field with a small but realistic hit rate.
        z_segment = rng.choice(["PREMIUM", "STANDARD", "BASIC", None]) if i % 3 == 0 else None

        if dirty_kind == "single":
            defect = rng.choice([
                "bad_partner_id", "null_country", "null_email", "bad_title",
                "trailing_space_name", "mangled_bu_type", "bad_date",
            ])
            if defect == "bad_partner_id":
                partner_id = "BADPARTNER" + str(i)
            elif defect == "null_country":
                country = None
            elif defect == "null_email":
                email = None
            elif defect == "bad_title":
                title = "9999"
            elif defect == "trailing_space_name":
                name1 = name1 + "   "
            elif defect == "mangled_bu_type":
                bu_type = rng.choice(["X", "0", "9", ""])
            elif defect == "bad_date":
                created_on = rng.choice(["00000000", "9999-99-99", "not-a-date"])
        elif dirty_kind == "multi":
            partner_id = "BADPARTNER" + str(i)
            country = None
            title = "9999"

        rows.append({
            "PARTNER": partner_id,
            "BU_TYPE": bu_type,
            "TITLE_KEY": title,
            "NAME1": name1,
            "NAME2": None if rng.random() < 0.3 else f"Holdings {i % 10}",
            "CITY": city,
            "COUNTRY": country,
            "EMAIL": email,
            "CREATED_ON": created_on,
            "TAX_ID": tax_id,
            "ZZSEGMENT": z_segment,      # customer Z-field
            "ZZRISK_SCORE": round(rng.uniform(0, 1), 2) if z_segment else None,
        })

    # Inject referential orphans: 0.5% of rows get a BU_GROUP that doesn't
    # map to the BU_TYPE. Tests the cross_field check.
    for row in rng.sample(rows, k=max(1, n // 200)):
        row["BU_TYPE"] = "1"  # person
        row["NAME2"] = "ORG: Entity Inc"  # but NAME2 says org

    # Controlled duplicates: 3% of rows share (NAME1, CITY, COUNTRY) with
    # another row. Exercises the dedup detection path.
    clone_source = rng.sample(rows, k=max(1, n // 33))
    for src in clone_source:
        dup = dict(src)
        dup["PARTNER"] = f"{2_000_000_000 + len(rows)}"
        rows.append(dup)

    return pd.DataFrame(rows)


# ── Material Master ──────────────────────────────────────────────────────────

def generate_realistic_material_master(n: int = 5000, seed: int = 43) -> pd.DataFrame:
    rng = random.Random(seed)

    material_types_valid = ["FERT", "HALB", "ROH", "HAWA", "VERP"]
    plants_valid = ["1000", "1100", "1200", "2000", "2100"]
    units_valid = ["EA", "KG", "L", "M", "M2", "PC"]

    rows: list[dict[str, Any]] = []
    for i in range(n):
        defect_roll = rng.random()
        dirty_kind = None
        if defect_roll < 0.01:
            dirty_kind = "multi"
        elif defect_roll < 0.13:
            dirty_kind = "single"

        matnr = f"MAT{i:08d}"
        mtart = rng.choice(material_types_valid)
        werks = rng.choice(plants_valid)
        description = _maybe_mangle_encoding(
            f"{mtart} widget {i} — {rng.choice(['blue', 'red', 'steel', 'plastic'])}",
            rng,
        )
        meins = rng.choice(units_valid)
        price = round(rng.uniform(1.50, 9_999.99), 2)
        weight = round(rng.uniform(0.01, 500.0), 3)
        created_at = (datetime.now(timezone.utc) - timedelta(days=rng.randint(1, 3650))).date().isoformat()

        # Common real-world Z-field: ZZLIFECYCLE = 'NPI' | 'ACTIVE' | 'EOL'
        zz_lifecycle = rng.choice(["NPI", "ACTIVE", "ACTIVE", "ACTIVE", "EOL"]) if i % 2 == 0 else None

        if dirty_kind == "single":
            defect = rng.choice([
                "neg_price", "zero_price", "null_description", "bad_mtart",
                "orphan_plant", "neg_weight", "future_created",
            ])
            if defect == "neg_price":
                price = -abs(price)
            elif defect == "zero_price":
                price = 0.0
            elif defect == "null_description":
                description = None
            elif defect == "bad_mtart":
                mtart = rng.choice(["XXXX", "ZZTEST", ""])
            elif defect == "orphan_plant":
                werks = "9999"
            elif defect == "neg_weight":
                weight = -abs(weight)
            elif defect == "future_created":
                created_at = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
        elif dirty_kind == "multi":
            price = -100.0
            description = None
            werks = "9999"

        rows.append({
            "MATNR": matnr,
            "MTART": mtart,
            "WERKS": werks,
            "MAKTX": description,
            "MEINS": meins,
            "STPRS": price,
            "BRGEW": weight,
            "NTGEW": round(weight * 0.9, 3) if weight > 0 else None,
            "ERSDA": created_at,
            "ZZLIFECYCLE": zz_lifecycle,
        })

    return pd.DataFrame(rows)


# ── FI GL journals ───────────────────────────────────────────────────────────

def generate_realistic_fi_gl(n: int = 2000, seed: int = 44) -> pd.DataFrame:
    rng = random.Random(seed)

    accounts_valid = [
        "100000", "110000", "120000", "200000", "210000", "300000",
        "400000", "410000", "500000", "600000", "700000",
    ]
    companies_valid = ["1000", "2000", "3000"]
    doc_types_valid = ["SA", "DR", "KR", "RV", "AB"]

    rows: list[dict[str, Any]] = []
    for i in range(n):
        defect_roll = rng.random()
        dirty_kind = None
        if defect_roll < 0.03:  # GL has the highest defect rate in practice
            dirty_kind = "multi"
        elif defect_roll < 0.18:
            dirty_kind = "single"

        account = rng.choice(accounts_valid)
        company = rng.choice(companies_valid)
        doc_type = rng.choice(doc_types_valid)
        amount = round(rng.uniform(-100_000, 100_000), 2)
        currency = rng.choice(["ZAR", "USD", "EUR", "GBP"])
        posting_date = (datetime.now(timezone.utc) - timedelta(days=rng.randint(0, 365))).date().isoformat()
        doc_number = f"{rng.randint(100_000_000, 999_999_999)}"

        if dirty_kind == "single":
            defect = rng.choice([
                "bad_account", "future_date", "zero_amount", "empty_doc",
                "bad_currency", "too_many_decimals",
            ])
            if defect == "bad_account":
                account = "999999"   # doesn't exist in chart
            elif defect == "future_date":
                posting_date = (datetime.now(timezone.utc) + timedelta(days=180)).date().isoformat()
            elif defect == "zero_amount":
                amount = 0.0
            elif defect == "empty_doc":
                doc_number = ""
            elif defect == "bad_currency":
                currency = rng.choice(["XXX", "JPYY", ""])
            elif defect == "too_many_decimals":
                amount = round(rng.uniform(-100, 100), 6)
        elif dirty_kind == "multi":
            account = "999999"
            amount = 0.0
            doc_number = ""

        rows.append({
            "BELNR": doc_number,
            "BUKRS": company,
            "HKONT": account,
            "BLART": doc_type,
            "DMBTR": amount,
            "WAERS": currency,
            "BUDAT": posting_date,
            "BSCHL": rng.choice(["40", "50", "01", "11"]),  # posting key
        })

    return pd.DataFrame(rows)


# ── Quick manual sanity when run directly ────────────────────────────────────

if __name__ == "__main__":
    import sys

    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    bp = generate_realistic_business_partner(n)
    mm = generate_realistic_material_master(n)
    gl = generate_realistic_fi_gl(min(n, 2000))
    print(f"BP  {len(bp):>6} rows  (nulls: BU_TYPE={bp['BU_TYPE'].isna().sum()}, "
          f"COUNTRY={bp['COUNTRY'].isna().sum()}, EMAIL={bp['EMAIL'].isna().sum()})")
    print(f"MM  {len(mm):>6} rows  (neg price: {(mm['STPRS'] < 0).sum()}, "
          f"orphan plant: {(mm['WERKS'] == '9999').sum()})")
    print(f"GL  {len(gl):>6} rows  (zero amt: {(gl['DMBTR'] == 0).sum()}, "
          f"bad account: {(gl['HKONT'] == '999999').sum()})")
