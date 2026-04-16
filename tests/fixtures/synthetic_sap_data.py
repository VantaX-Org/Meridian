"""Generate realistic synthetic SAP data for testing."""

import random
import uuid
from datetime import datetime, timedelta, timezone

import pandas as pd


def generate_business_partner(n: int = 1000, seed: int = 42) -> pd.DataFrame:
    """Generate synthetic Business Partner data with ~85% clean, ~15% dirty."""
    random.seed(seed)
    now = datetime.now(timezone.utc)

    rows = []
    dirty_count = int(n * 0.15)

    for i in range(n):
        is_dirty = i < dirty_count

        if is_dirty:
            # Distribute dirty rows across different failure types
            bucket = i % 10
            bu_type = None if bucket < 2 else random.choice(["1", "2", "3"])  # 5% missing BU_TYPE
            partner = f"BADPARTNER{i}" if bucket in (2, 3, 4, 5) else f"{1000000000 + i}"  # 4% bad format
            email = None if bucket in (6, 7, 8) else f"user{i}@example.com"  # 3% missing email
            name_org1 = None if bucket == 0 else f"Org {i}"
            title = "9999" if bucket == 1 else random.choice(["0001", "0002", "0003"])
            country = None if bucket == 2 else "ZA"
            city = None if bucket == 3 else "Johannesburg"
            post_code = None if bucket == 4 else "2000"
            partner_guid = "not-a-uuid" if bucket == 5 else str(uuid.uuid4())
            rltyp = None if bucket == 6 else "FLCU01"
            bu_sort1 = None if bucket == 7 else f"SEARCH{i}"
            created_at = (now - timedelta(days=400 + random.randint(0, 100))).isoformat()
            smtp_addr = email if email else (f"bad-email-{i}" if bucket == 8 else None)
        else:
            bu_type = random.choice(["1", "2", "3"])
            partner = f"{1000000000 + i}"
            name_org1 = f"Organisation {i}"
            title = random.choice(["0001", "0002", "0003", "0004", "0005"])
            country = random.choice(["ZA", "ZA", "ZA", "US", "GB"])
            city = random.choice(["Johannesburg", "Cape Town", "Pretoria", "Durban"])
            post_code = random.choice(["2000", "8000", "0001", "4000"])
            partner_guid = str(uuid.uuid4())
            rltyp = random.choice(["FLCU01", "FLVN01", "FLCU00"])
            bu_sort1 = f"SEARCH{i:04d}"
            created_at = (now - timedelta(days=random.randint(1, 300))).isoformat()
            smtp_addr = f"user{i}@company.co.za"

        rows.append({
            "BUT000.BU_TYPE": bu_type,
            "BUT000.PARTNER": partner,
            "BUT000.NAME_ORG1": name_org1,
            "BUT000.TITLE": title,
            "BUT000.PARTNER_GUID": partner_guid,
            "BUT000.BU_SORT1": bu_sort1,
            "BUT000.CREATED_AT": created_at,
            "ADR6.SMTP_ADDR": smtp_addr,
            "ADRC.COUNTRY": country,
            "ADRC.CITY1": city,
            "ADRC.POST_CODE1": post_code,
            "BUT100.RLTYP": rltyp,
        })

    return pd.DataFrame(rows)


def generate_material_master(n: int = 1000, seed: int = 43) -> pd.DataFrame:
    """Generate synthetic Material Master data with ~85% clean, ~15% dirty."""
    random.seed(seed)
    now = datetime.now(timezone.utc)

    rows = []
    dirty_count = int(n * 0.15)

    valid_types = ["FERT", "HALB", "ROH", "HAWA", "DIEN", "NLAG", "ERSA", "IBAU"]
    valid_uom = ["KG", "G", "LB", "OZ", "T"]
    valid_status = ["10", "20", "30", "40", "KK", "KL", "KP", "KW", "VP"]

    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 10

        if is_dirty:
            mtart = None if bucket < 2 else random.choice(valid_types)
            if bucket == 2:
                mtart = "INVALID"
            matnr = f"MAT{i:06d}" if bucket != 3 else f"mat with spaces {i}"
            meins = None if bucket == 4 else random.choice(valid_uom)
            mbrsh = None if bucket == 5 else "M"
            matkl = None if bucket == 6 else "001"
            werks = None if bucket == 7 else "1000"
            ntgew = None if bucket == 8 else round(random.uniform(0.1, 100), 2)
            gewei = "INVALID" if bucket == 9 else random.choice(valid_uom)
            bismt = None
            laeda = (now - timedelta(days=800)).isoformat()
            ean11 = "ABCDE" if bucket == 0 else f"{random.randint(10000000, 99999999999999)}"
            mstae = "ZZ" if bucket == 1 else random.choice(valid_status)
            vprsv = None if bucket == 3 else random.choice(["S", "V"])
            stprs = None if bucket == 4 else round(random.uniform(10, 10000), 2)
        else:
            mtart = random.choice(valid_types)
            matnr = f"MAT{i:06d}"
            meins = random.choice(valid_uom)
            mbrsh = random.choice(["M", "C", "P"])
            matkl = f"{random.randint(1, 99):03d}"
            werks = random.choice(["1000", "2000", "3000"])
            ntgew = round(random.uniform(0.1, 100), 2)
            gewei = random.choice(valid_uom)
            bismt = f"OLD{i:06d}"
            laeda = (now - timedelta(days=random.randint(1, 600))).isoformat()
            ean11 = f"{random.randint(10000000, 99999999999999)}"
            mstae = random.choice(valid_status)
            vprsv = random.choice(["S", "V"])
            stprs = round(random.uniform(10, 10000), 2)

        rows.append({
            "MARA.MTART": mtart,
            "MARA.MATNR": matnr,
            "MARA.MEINS": meins,
            "MARA.MBRSH": mbrsh,
            "MARA.MATKL": matkl,
            "MARD.WERKS": werks,
            "MARA.NTGEW": ntgew,
            "MARA.GEWEI": gewei,
            "MARA.BISMT": bismt,
            "MARA.LAEDA": laeda,
            "MARA.EAN11": ean11,
            "MARA.MSTAE": mstae,
            "MBEW.VPRSV": vprsv,
            "MBEW.STPRS": stprs,
        })

    return pd.DataFrame(rows)


def generate_fi_gl(n: int = 500, seed: int = 44) -> pd.DataFrame:
    """Generate synthetic FI GL data with ~85% clean, ~15% dirty."""
    random.seed(seed)

    rows = []
    dirty_count = int(n * 0.15)

    valid_currencies = ["ZAR", "USD", "EUR", "GBP", "AUD"]

    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 8

        if is_dirty:
            saknr = f"ABC{i}" if bucket == 0 else f"{100000 + i}"
            ktoks = None if bucket == 1 else "SAKO"
            xbilk = "Y" if bucket == 2 else random.choice(["X", ""])
            gvtyp = None if bucket == 3 else "P"
            bukrs = None if bucket == 4 else "1000"
            waers = "INVALID" if bucket == 5 else random.choice(valid_currencies)
            mwskz = None if bucket == 6 else "V0"
            xopvw = "Y" if bucket == 7 else random.choice(["X", ""])
            xkres = random.choice(["X", ""])
            func_area = None if bucket == 0 else "0100"
            altkt = None
        else:
            saknr = f"{100000 + i}"
            ktoks = random.choice(["SAKO", "SAKK", "SAKL"])
            xbilk = random.choice(["X", ""])
            gvtyp = random.choice(["P", "S", ""])
            bukrs = random.choice(["1000", "2000"])
            waers = random.choice(valid_currencies)
            mwskz = random.choice(["V0", "V1", "A0"])
            xopvw = random.choice(["X", ""])
            xkres = random.choice(["X", ""])
            func_area = random.choice(["0100", "0200", "0300"])
            altkt = f"{200000 + i}"

        rows.append({
            "SKA1.SAKNR": saknr,
            "SKA1.KTOKS": ktoks,
            "SKA1.XBILK": xbilk,
            "SKA1.GVTYP": gvtyp,
            "SKB1.BUKRS": bukrs,
            "SKB1.WAERS": waers,
            "SKB1.MWSKZ": mwskz,
            "SKB1.XOPVW": xopvw,
            "SKB1.XKRES": xkres,
            "SKA1.FUNC_AREA": func_area,
            "SKB1.ALTKT": altkt,
        })

    return pd.DataFrame(rows)
