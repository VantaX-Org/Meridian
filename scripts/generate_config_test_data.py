"""Generate config matching test datasets for all 29 SAP modules.

Creates three CSVs per module (clean, data_errors, config_deviation) and a
ground_truth.json under Test Files/config_matching/.
"""

import json
import pathlib
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pandas as pd

# Ensure project root is importable
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from tests.fixtures.synthetic_sap_data import generate_business_partner

# ---------------------------------------------------------------------------
# Output directories
# ---------------------------------------------------------------------------
BASE_DIR = pathlib.Path(__file__).parent.parent / "Test Files" / "config_matching"
DIRS = {
    "ecc": BASE_DIR / "ecc",
    "successfactors": BASE_DIR / "successfactors",
    "warehouse": BASE_DIR / "warehouse",
}

N = 500  # rows per file


# ===========================================================================
# ECC generators
# ===========================================================================

def gen_material_master_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    valid_types = ["FERT", "HALB", "ROH", "HAWA", "DIEN"]
    valid_uom = ["KG", "G", "LB", "T"]
    for i in range(n):
        rows.append({
            "MARA.MATNR": f"MAT{i:06d}",
            "MARA.MTART": random.choice(valid_types),
            "MARA.MATKL": f"{random.randint(1, 99):03d}",
            "MARA.MEINS": random.choice(valid_uom),
            "MARA.MBRSH": random.choice(["M", "C", "P"]),
            "MARD.WERKS": random.choice(["1000", "2000", "3000"]),
            "MARA.NTGEW": round(random.uniform(0.1, 100), 2),
            "MARA.GEWEI": random.choice(valid_uom),
            "MARA.LAEDA": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 300))).isoformat(),
            "MBEW.VPRSV": random.choice(["S", "V"]),
            "MBEW.STPRS": round(random.uniform(10, 10000), 2),
        })
    return pd.DataFrame(rows)


def gen_material_master_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    valid_types = ["FERT", "HALB", "ROH", "HAWA", "DIEN"]
    dirty_count = int(n * 0.18)
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 9
        rows.append({
            "MARA.MATNR": f"mat with spaces {i}" if (is_dirty and bucket == 0) else f"MAT{i:06d}",
            "MARA.MTART": None if (is_dirty and bucket == 1) else ("INVALID" if (is_dirty and bucket == 2) else random.choice(valid_types)),
            "MARA.MATKL": None if (is_dirty and bucket == 3) else f"{random.randint(1, 99):03d}",
            "MARA.MEINS": None if (is_dirty and bucket == 4) else random.choice(["KG", "G", "LB"]),
            "MARA.MBRSH": None if (is_dirty and bucket == 5) else "M",
            "MARD.WERKS": None if (is_dirty and bucket == 6) else "1000",
            "MARA.NTGEW": None if (is_dirty and bucket == 7) else round(random.uniform(0.1, 100), 2),
            "MARA.GEWEI": "INVALID" if (is_dirty and bucket == 8) else "KG",
            "MARA.LAEDA": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 600))).isoformat(),
            "MBEW.VPRSV": None if (is_dirty and bucket == 0) else random.choice(["S", "V"]),
            "MBEW.STPRS": None if (is_dirty and bucket == 1) else round(random.uniform(10, 10000), 2),
        })
    return pd.DataFrame(rows)


def gen_material_master_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: MTART=ZFIN, MATKL starts with Z, MEINS=EA, MATNR=ZFG{5digits}."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "MARA.MATNR": f"ZFG{i:05d}",
            "MARA.MTART": "ZFIN",
            "MARA.MATKL": random.choice(["ZRAW", "ZFIN", "ZPKG"]),
            "MARA.MEINS": "EA",
            "MARA.MBRSH": "Z",
            "MARD.WERKS": "1000",
            "MARA.NTGEW": round(random.uniform(0.1, 100), 2),
            "MARA.GEWEI": "KG",
            "MARA.LAEDA": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 300))).isoformat(),
            "MBEW.VPRSV": random.choice(["S", "V"]),
            "MBEW.STPRS": round(random.uniform(10, 10000), 2),
        })
    return pd.DataFrame(rows)


def gen_fi_gl_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "SKA1.SAKNR": f"{100000 + i:010d}",
            "SKA1.KTOKS": random.choice(["SAKO", "SAKK", "SAKL"]),
            "SKA1.XBILK": random.choice(["X", ""]),
            "SKA1.GVTYP": random.choice(["P", "S", ""]),
            "SKB1.BUKRS": random.choice(["1000", "2000"]),
            "SKB1.WAERS": random.choice(["ZAR", "USD", "EUR"]),
            "SKB1.MWSKZ": random.choice(["V0", "V1", "A0"]),
            "SKB1.XOPVW": random.choice(["X", ""]),
            "SKA1.FUNC_AREA": random.choice(["0100", "0200", "0300"]),
            "SKA1.KTOPL": random.choice(["INT", "CACN"]),
        })
    return pd.DataFrame(rows)


def gen_fi_gl_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 7
        rows.append({
            "SKA1.SAKNR": f"ABC{i}" if (is_dirty and bucket == 0) else f"{100000 + i:010d}",
            "SKA1.KTOKS": None if (is_dirty and bucket == 1) else "SAKO",
            "SKA1.XBILK": "Y" if (is_dirty and bucket == 2) else random.choice(["X", ""]),
            "SKA1.GVTYP": None if (is_dirty and bucket == 3) else "P",
            "SKB1.BUKRS": None if (is_dirty and bucket == 4) else "1000",
            "SKB1.WAERS": "INVALID" if (is_dirty and bucket == 5) else random.choice(["ZAR", "USD"]),
            "SKB1.MWSKZ": None if (is_dirty and bucket == 6) else "V0",
            "SKB1.XOPVW": random.choice(["X", ""]),
            "SKA1.FUNC_AREA": None if (is_dirty and bucket == 0) else "0100",
            "SKA1.KTOPL": random.choice(["INT", "CACN"]),
        })
    return pd.DataFrame(rows)


def gen_fi_gl_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: BUKRS=ZA01, KTOPL=CAZA, SAKNR=6-digit (not 10-digit)."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "SKA1.SAKNR": f"{100000 + i:06d}",  # 6-digit, not 10-digit
            "SKA1.KTOKS": random.choice(["SAKO", "SAKK"]),
            "SKA1.XBILK": random.choice(["X", ""]),
            "SKA1.GVTYP": "P",
            "SKB1.BUKRS": "ZA01",
            "SKB1.WAERS": "ZAR",
            "SKB1.MWSKZ": "V0",
            "SKB1.XOPVW": random.choice(["X", ""]),
            "SKA1.FUNC_AREA": "0100",
            "SKA1.KTOPL": "CAZA",
        })
    return pd.DataFrame(rows)


def gen_accounts_payable_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "LFB1.LIFNR": f"{1000000000 + i:010d}",
            "LFA1.NAME1": f"Vendor {i}",
            "LFA1.LAND1": random.choice(["ZA", "US", "GB"]),
            "LFB1.BUKRS": random.choice(["1000", "2000"]),
            "LFB1.AKONT": f"21{random.randint(100, 999):04d}",
            "LFB1.ZTERM": random.choice(["0001", "ZB30", "ZB60"]),
            "LFA1.STCD1": f"{random.randint(1000000000, 9999999999)}",
            "LFA1.SMTP_ADDR": f"vendor{i}@company.com",
            "LFB1.WAERS": random.choice(["ZAR", "USD", "EUR"]),
        })
    return pd.DataFrame(rows)


def gen_accounts_payable_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 8
        rows.append({
            "LFB1.LIFNR": f"BADLIFNR{i}" if (is_dirty and bucket == 0) else f"{1000000000 + i:010d}",
            "LFA1.NAME1": None if (is_dirty and bucket == 1) else f"Vendor {i}",
            "LFA1.LAND1": None if (is_dirty and bucket == 2) else "ZA",
            "LFB1.BUKRS": None if (is_dirty and bucket == 3) else "1000",
            "LFB1.AKONT": None if (is_dirty and bucket == 4) else "210100",
            "LFB1.ZTERM": None if (is_dirty and bucket == 5) else "ZB30",
            "LFA1.STCD1": None if (is_dirty and bucket == 6) else f"{random.randint(1000000000, 9999999999)}",
            "LFA1.SMTP_ADDR": f"bad-email-{i}" if (is_dirty and bucket == 7) else f"vendor{i}@company.com",
            "LFB1.WAERS": random.choice(["ZAR", "USD"]),
        })
    return pd.DataFrame(rows)


def gen_accounts_payable_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: WAERS=ZAR, ZTERM=ZA30, AKONT=210100 throughout."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "LFB1.LIFNR": f"{1000000000 + i:010d}",
            "LFA1.NAME1": f"Vendor {i}",
            "LFA1.LAND1": "ZA",
            "LFB1.BUKRS": "ZA01",
            "LFB1.AKONT": "210100",
            "LFB1.ZTERM": "ZA30",
            "LFA1.STCD1": f"{random.randint(1000000000, 9999999999)}",
            "LFA1.SMTP_ADDR": f"vendor{i}@company.com",
            "LFB1.WAERS": "ZAR",
        })
    return pd.DataFrame(rows)


def gen_accounts_receivable_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "KNB1.KUNNR": f"{1000000000 + i:010d}",
            "KNA1.NAME1": f"Customer {i}",
            "KNA1.LAND1": random.choice(["ZA", "US", "GB"]),
            "KNB1.BUKRS": random.choice(["1000", "2000"]),
            "KNB1.AKONT": f"14{random.randint(100, 999):04d}",
            "KNB1.ZTERM": random.choice(["0001", "ZB14", "ZB30"]),
            "KNB1.KLIMK": round(random.uniform(5000, 500000), 2),
            "KNA1.STCD1": f"{random.randint(1000000000, 9999999999)}",
            "KNA1.SMTP_ADDR": f"customer{i}@company.com",
            "KNB1.MAHNS": random.choice(["0001", "0002"]),
        })
    return pd.DataFrame(rows)


def gen_accounts_receivable_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 8
        rows.append({
            "KNB1.KUNNR": f"BADKUNNR{i}" if (is_dirty and bucket == 0) else f"{1000000000 + i:010d}",
            "KNA1.NAME1": None if (is_dirty and bucket == 1) else f"Customer {i}",
            "KNA1.LAND1": None if (is_dirty and bucket == 2) else "ZA",
            "KNB1.BUKRS": None if (is_dirty and bucket == 3) else "1000",
            "KNB1.AKONT": None if (is_dirty and bucket == 4) else "140100",
            "KNB1.ZTERM": None if (is_dirty and bucket == 5) else "ZB14",
            "KNB1.KLIMK": None if (is_dirty and bucket == 6) else round(random.uniform(5000, 500000), 2),
            "KNA1.STCD1": None if (is_dirty and bucket == 7) else f"{random.randint(1000000000, 9999999999)}",
            "KNA1.SMTP_ADDR": f"bad-email-{i}" if (is_dirty and bucket == 0) else f"customer{i}@company.com",
            "KNB1.MAHNS": random.choice(["0001", "0002"]),
        })
    return pd.DataFrame(rows)


def gen_accounts_receivable_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: KLIMK=0 throughout, ZTERM=ZA14, AKONT=140100."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "KNB1.KUNNR": f"{1000000000 + i:010d}",
            "KNA1.NAME1": f"Customer {i}",
            "KNA1.LAND1": "ZA",
            "KNB1.BUKRS": "ZA01",
            "KNB1.AKONT": "140100",
            "KNB1.ZTERM": "ZA14",
            "KNB1.KLIMK": 0,
            "KNA1.STCD1": f"{random.randint(1000000000, 9999999999)}",
            "KNA1.SMTP_ADDR": f"customer{i}@company.com",
            "KNB1.MAHNS": "0001",
        })
    return pd.DataFrame(rows)


def gen_asset_accounting_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    valid_classes = ["1000", "2000", "3000", "4000"]
    for i in range(n):
        rows.append({
            "ANLA.ANLN1": f"{i:06d}",
            "ANLA.BUKRS": random.choice(["1000", "2000"]),
            "ANLA.ANLKL": random.choice(valid_classes),
            "ANLA.TXT50": f"Asset {i}",
            "ANLA.AKTIV": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 3000))).strftime("%Y-%m-%d"),
            "ANLB.AFABE": random.choice(["01", "20"]),
            "ANLB.AFASL": random.choice(["LINR", "DEGR"]),
            "ANLB.NDJAR": random.randint(3, 20),
        })
    return pd.DataFrame(rows)


def gen_asset_accounting_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 6
        rows.append({
            "ANLA.ANLN1": f"{i:06d}",
            "ANLA.BUKRS": None if (is_dirty and bucket == 0) else "1000",
            "ANLA.ANLKL": None if (is_dirty and bucket == 1) else "1000",
            "ANLA.TXT50": None if (is_dirty and bucket == 2) else f"Asset {i}",
            "ANLA.AKTIV": "not-a-date" if (is_dirty and bucket == 3) else (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 3000))).strftime("%Y-%m-%d"),
            "ANLB.AFABE": None if (is_dirty and bucket == 4) else "01",
            "ANLB.AFASL": "INVALID" if (is_dirty and bucket == 5) else "LINR",
            "ANLB.NDJAR": random.randint(3, 20),
        })
    return pd.DataFrame(rows)


def gen_asset_accounting_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: BUKRS=ZA01, ANLKL follows ZA{3digits} pattern."""
    random.seed(seed)
    rows = []
    za_classes = [f"ZA{j:03d}" for j in range(100, 200)]
    for i in range(n):
        rows.append({
            "ANLA.ANLN1": f"{i:06d}",
            "ANLA.BUKRS": "ZA01",
            "ANLA.ANLKL": random.choice(za_classes),
            "ANLA.TXT50": f"Asset {i}",
            "ANLA.AKTIV": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 3000))).strftime("%Y-%m-%d"),
            "ANLB.AFABE": "01",
            "ANLB.AFASL": "LINR",
            "ANLB.NDJAR": random.randint(3, 20),
        })
    return pd.DataFrame(rows)


def gen_mm_purchasing_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "EKKO.EBELN": f"{4500000000 + i:010d}",
            "EKKO.BUKRS": random.choice(["1000", "2000"]),
            "EKKO.EKORG": random.choice(["1000", "2000"]),
            "EKKO.BSART": random.choice(["NB", "ZB", "FO"]),
            "EKPO.WERKS": random.choice(["1000", "2000", "3000"]),
            "EKPO.MATNR": f"MAT{i:06d}",
            "EKPO.MENGE": round(random.uniform(1, 1000), 2),
            "EKPO.MEINS": random.choice(["KG", "EA", "LB"]),
            "EKPO.NETPR": round(random.uniform(10, 50000), 2),
            "EKPO.LIFNR": f"{1000000000 + i:010d}",
        })
    return pd.DataFrame(rows)


def gen_mm_purchasing_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 7
        rows.append({
            "EKKO.EBELN": f"{4500000000 + i:010d}",
            "EKKO.BUKRS": None if (is_dirty and bucket == 0) else "1000",
            "EKKO.EKORG": None if (is_dirty and bucket == 1) else "1000",
            "EKKO.BSART": "INVALID" if (is_dirty and bucket == 2) else "NB",
            "EKPO.WERKS": None if (is_dirty and bucket == 3) else "1000",
            "EKPO.MATNR": None if (is_dirty and bucket == 4) else f"MAT{i:06d}",
            "EKPO.MENGE": None if (is_dirty and bucket == 5) else round(random.uniform(1, 1000), 2),
            "EKPO.MEINS": None if (is_dirty and bucket == 6) else "KG",
            "EKPO.NETPR": round(random.uniform(10, 50000), 2),
            "EKPO.LIFNR": f"{1000000000 + i:010d}",
        })
    return pd.DataFrame(rows)


def gen_mm_purchasing_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: WERKS=P001 or P002 only, EKORG=ZA01 throughout."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "EKKO.EBELN": f"{4500000000 + i:010d}",
            "EKKO.BUKRS": "ZA01",
            "EKKO.EKORG": "ZA01",
            "EKKO.BSART": "NB",
            "EKPO.WERKS": random.choice(["P001", "P002"]),
            "EKPO.MATNR": f"MAT{i:06d}",
            "EKPO.MENGE": round(random.uniform(1, 1000), 2),
            "EKPO.MEINS": "EA",
            "EKPO.NETPR": round(random.uniform(10, 50000), 2),
            "EKPO.LIFNR": f"{1000000000 + i:010d}",
        })
    return pd.DataFrame(rows)


def gen_plant_maintenance_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "EQUI.EQUNR": f"EQ{i:08d}",
            "EQUI.SWERK": random.choice(["P001", "P002", "P003"]),
            "EQUI.EQTYP": random.choice(["A", "B", "P"]),
            "EQUI.TXT50": f"Equipment {i}",
            "EQUI.INBDT": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 5000))).strftime("%Y-%m-%d"),
            "EQUI.TPLNR": f"FL-{i:04d}",
            "EQUI.BUKRS": random.choice(["1000", "2000"]),
        })
    return pd.DataFrame(rows)


def gen_plant_maintenance_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "EQUI.EQUNR": f"EQ{i:08d}",
            "EQUI.SWERK": None if (is_dirty and bucket == 0) else "P001",
            "EQUI.EQTYP": None if (is_dirty and bucket == 1) else "A",
            "EQUI.TXT50": None if (is_dirty and bucket == 2) else f"Equipment {i}",
            "EQUI.INBDT": "not-a-date" if (is_dirty and bucket == 3) else (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 5000))).strftime("%Y-%m-%d"),
            "EQUI.TPLNR": None if (is_dirty and bucket == 4) else f"FL-{i:04d}",
            "EQUI.BUKRS": random.choice(["1000", "2000"]),
        })
    return pd.DataFrame(rows)


def gen_plant_maintenance_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: SWERK=P001 throughout, EQTYP=Z throughout."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "EQUI.EQUNR": f"EQ{i:08d}",
            "EQUI.SWERK": "P001",
            "EQUI.EQTYP": "Z",
            "EQUI.TXT50": f"Equipment {i}",
            "EQUI.INBDT": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 5000))).strftime("%Y-%m-%d"),
            "EQUI.TPLNR": f"FL-{i:04d}",
            "EQUI.BUKRS": "ZA01",
        })
    return pd.DataFrame(rows)


def gen_production_planning_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "MARA.MATNR": f"MAT{i:06d}",
            "MARA.DISMM": random.choice(["PD", "VB", "MK", "VV"]),
            "MARD.WERKS": random.choice(["1000", "2000", "3000"]),
            "MARA.DISPO": f"D{random.randint(1, 9):03d}",
            "MARC.MINBE": round(random.uniform(0, 1000), 2),
            "MARC.EISBE": round(random.uniform(0, 500), 2),
            "MARC.PLIFZ": random.randint(1, 30),
            "MARC.LOSGR": round(random.uniform(10, 500), 2),
        })
    return pd.DataFrame(rows)


def gen_production_planning_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "MARA.MATNR": f"MAT{i:06d}",
            "MARA.DISMM": None if (is_dirty and bucket == 0) else ("INVALID" if (is_dirty and bucket == 1) else "PD"),
            "MARD.WERKS": None if (is_dirty and bucket == 2) else "1000",
            "MARA.DISPO": None if (is_dirty and bucket == 3) else "D001",
            "MARC.MINBE": None if (is_dirty and bucket == 4) else round(random.uniform(0, 1000), 2),
            "MARC.EISBE": round(random.uniform(0, 500), 2),
            "MARC.PLIFZ": random.randint(1, 30),
            "MARC.LOSGR": round(random.uniform(10, 500), 2),
        })
    return pd.DataFrame(rows)


def gen_production_planning_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: DISMM=PD throughout, WERKS=P001 throughout."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "MARA.MATNR": f"MAT{i:06d}",
            "MARA.DISMM": "PD",
            "MARD.WERKS": "P001",
            "MARA.DISPO": "D001",
            "MARC.MINBE": round(random.uniform(0, 1000), 2),
            "MARC.EISBE": round(random.uniform(0, 500), 2),
            "MARC.PLIFZ": random.randint(1, 30),
            "MARC.LOSGR": round(random.uniform(10, 500), 2),
        })
    return pd.DataFrame(rows)


def gen_sd_customer_master_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    vkorgs = ["ZA01", "ZA02", "GB01", "US01"]
    vtwgs = ["10", "20", "30"]
    sparts = ["00", "10", "20"]
    for i in range(n):
        rows.append({
            "KNA1.KUNNR": f"{1000000000 + i:010d}",
            "KNA1.NAME1": f"Customer {i}",
            "KNA1.LAND1": random.choice(["ZA", "GB", "US"]),
            "KNVV.VKORG": random.choice(vkorgs),
            "KNVV.VTWEG": random.choice(vtwgs),
            "KNVV.SPART": random.choice(sparts),
            "KNVV.KDGRP": random.choice(["01", "02", "ZA"]),
            "KNVV.ZTERM": random.choice(["0001", "ZB14", "ZB30"]),
            "KNA1.SMTP_ADDR": f"customer{i}@company.com",
        })
    return pd.DataFrame(rows)


def gen_sd_customer_master_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 7
        rows.append({
            "KNA1.KUNNR": f"BADCUST{i}" if (is_dirty and bucket == 0) else f"{1000000000 + i:010d}",
            "KNA1.NAME1": None if (is_dirty and bucket == 1) else f"Customer {i}",
            "KNA1.LAND1": None if (is_dirty and bucket == 2) else "ZA",
            "KNVV.VKORG": None if (is_dirty and bucket == 3) else "ZA01",
            "KNVV.VTWEG": None if (is_dirty and bucket == 4) else "10",
            "KNVV.SPART": None if (is_dirty and bucket == 5) else "00",
            "KNVV.KDGRP": None if (is_dirty and bucket == 6) else "01",
            "KNVV.ZTERM": "INVALID" if (is_dirty and bucket == 0) else "ZB14",
            "KNA1.SMTP_ADDR": f"bad-email-{i}" if (is_dirty and bucket == 1) else f"customer{i}@company.com",
        })
    return pd.DataFrame(rows)


def gen_sd_customer_master_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: VKORG=ZA01, VTWEG=10, SPART=00 throughout, KDGRP=ZA."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "KNA1.KUNNR": f"{1000000000 + i:010d}",
            "KNA1.NAME1": f"Customer {i}",
            "KNA1.LAND1": "ZA",
            "KNVV.VKORG": "ZA01",
            "KNVV.VTWEG": "10",
            "KNVV.SPART": "00",
            "KNVV.KDGRP": "ZA",
            "KNVV.ZTERM": "ZB14",
            "KNA1.SMTP_ADDR": f"customer{i}@company.com",
        })
    return pd.DataFrame(rows)


def gen_sd_sales_orders_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "VBAK.VBELN": f"{100000 + i:010d}",
            "VBAK.KUNNR": f"{1000000000 + i:010d}",
            "VBAK.VKORG": random.choice(["ZA01", "ZA02", "GB01"]),
            "VBAK.VTWEG": random.choice(["10", "20"]),
            "VBAK.SPART": random.choice(["00", "10"]),
            "VBAK.AUDAT": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "VBAK.NETWR": round(random.uniform(100, 500000), 2),
            "VBAK.WAERK": random.choice(["ZAR", "USD", "EUR"]),
            "VBAP.MATNR": f"MAT{i:06d}",
        })
    return pd.DataFrame(rows)


def gen_sd_sales_orders_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 7
        rows.append({
            "VBAK.VBELN": f"{100000 + i:010d}",
            "VBAK.KUNNR": None if (is_dirty and bucket == 0) else f"{1000000000 + i:010d}",
            "VBAK.VKORG": None if (is_dirty and bucket == 1) else "ZA01",
            "VBAK.VTWEG": None if (is_dirty and bucket == 2) else "10",
            "VBAK.SPART": None if (is_dirty and bucket == 3) else "00",
            "VBAK.AUDAT": "not-a-date" if (is_dirty and bucket == 4) else (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "VBAK.NETWR": None if (is_dirty and bucket == 5) else round(random.uniform(100, 500000), 2),
            "VBAK.WAERK": "INVALID" if (is_dirty and bucket == 6) else "ZAR",
            "VBAP.MATNR": f"MAT{i:06d}",
        })
    return pd.DataFrame(rows)


def gen_sd_sales_orders_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: all KUNNR starts with ZA, VKORG=ZA01 throughout."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "VBAK.VBELN": f"{100000 + i:010d}",
            "VBAK.KUNNR": f"ZA{i:08d}",
            "VBAK.VKORG": "ZA01",
            "VBAK.VTWEG": "10",
            "VBAK.SPART": "00",
            "VBAK.AUDAT": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "VBAK.NETWR": round(random.uniform(100, 500000), 2),
            "VBAK.WAERK": "ZAR",
            "VBAP.MATNR": f"MAT{i:06d}",
        })
    return pd.DataFrame(rows)


# ===========================================================================
# SuccessFactors generators
# ===========================================================================

def gen_employee_central_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "EMPEMPLOYMENT.USERID": f"user{i:05d}",
            "EMPEMPLOYMENT.COMPANY_ID": random.choice(["ZA001", "GB001", "US001"]),
            "EMPEMPLOYMENT.LOCATION_ID": random.choice(["GB-LON", "US-NYC", "ZA-JHB"]),
            "EMPEMPLOYMENT.START_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 3650))).strftime("%Y-%m-%d"),
            "EMPEMPLOYMENT.STATUS": random.choice(["active", "inactive"]),
            "EMPEMPLOYMENT.EMPL_TYPE": random.choice(["fulltime", "parttime", "contractor"]),
            "EMPJOBINFO.DEPARTMENT": f"DEPT{random.randint(1, 50):03d}",
            "EMPJOBINFO.JOB_CODE": f"J{random.randint(100, 999)}",
        })
    return pd.DataFrame(rows)


def gen_employee_central_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 6
        rows.append({
            "EMPEMPLOYMENT.USERID": None if (is_dirty and bucket == 0) else f"user{i:05d}",
            "EMPEMPLOYMENT.COMPANY_ID": None if (is_dirty and bucket == 1) else "ZA001",
            "EMPEMPLOYMENT.LOCATION_ID": None if (is_dirty and bucket == 2) else "ZA-JHB",
            "EMPEMPLOYMENT.START_DATE": "not-a-date" if (is_dirty and bucket == 3) else (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 3650))).strftime("%Y-%m-%d"),
            "EMPEMPLOYMENT.STATUS": "INVALID" if (is_dirty and bucket == 4) else "active",
            "EMPEMPLOYMENT.EMPL_TYPE": None if (is_dirty and bucket == 5) else "fulltime",
            "EMPJOBINFO.DEPARTMENT": f"DEPT{random.randint(1, 50):03d}",
            "EMPJOBINFO.JOB_CODE": f"J{random.randint(100, 999)}",
        })
    return pd.DataFrame(rows)


def gen_employee_central_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: COMPANY_ID=ZA001, LOCATION_ID follows ZA-{city} pattern."""
    random.seed(seed)
    za_locations = ["ZA-JHB", "ZA-CPT", "ZA-DBN"]
    rows = []
    for i in range(n):
        rows.append({
            "EMPEMPLOYMENT.USERID": f"user{i:05d}",
            "EMPEMPLOYMENT.COMPANY_ID": "ZA001",
            "EMPEMPLOYMENT.LOCATION_ID": random.choice(za_locations),
            "EMPEMPLOYMENT.START_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 3650))).strftime("%Y-%m-%d"),
            "EMPEMPLOYMENT.STATUS": "active",
            "EMPEMPLOYMENT.EMPL_TYPE": "fulltime",
            "EMPJOBINFO.DEPARTMENT": f"DEPT{random.randint(1, 50):03d}",
            "EMPJOBINFO.JOB_CODE": f"J{random.randint(100, 999)}",
        })
    return pd.DataFrame(rows)


def gen_compensation_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "COMPINFO.USERID": f"user{i:05d}",
            "COMPINFO.CURRENCY": random.choice(["ZAR", "USD", "EUR", "GBP"]),
            "COMPINFO.COMP_FREQUENCY": random.choice(["A", "M", "B"]),
            "COMPINFO.PAY_GRADE": f"GR{random.randint(1, 15):02d}",
            "COMPINFO.SALARY": round(random.uniform(15000, 500000), 2),
            "COMPINFO.EFFECTIVE_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 730))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_compensation_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "COMPINFO.USERID": None if (is_dirty and bucket == 0) else f"user{i:05d}",
            "COMPINFO.CURRENCY": "INVALID" if (is_dirty and bucket == 1) else random.choice(["ZAR", "USD", "EUR"]),
            "COMPINFO.COMP_FREQUENCY": "X" if (is_dirty and bucket == 2) else random.choice(["A", "M"]),
            "COMPINFO.PAY_GRADE": None if (is_dirty and bucket == 3) else f"GR{random.randint(1, 15):02d}",
            "COMPINFO.SALARY": None if (is_dirty and bucket == 4) else round(random.uniform(15000, 500000), 2),
            "COMPINFO.EFFECTIVE_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 730))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_compensation_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: CURRENCY=ZAR, COMP_FREQUENCY=M throughout."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "COMPINFO.USERID": f"user{i:05d}",
            "COMPINFO.CURRENCY": "ZAR",
            "COMPINFO.COMP_FREQUENCY": "M",
            "COMPINFO.PAY_GRADE": f"GR{random.randint(1, 15):02d}",
            "COMPINFO.SALARY": round(random.uniform(15000, 500000), 2),
            "COMPINFO.EFFECTIVE_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 730))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_benefits_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "EMPBENEFITS.USERID": f"user{i:05d}",
            "EMPBENEFITS.BENEFIT_PLAN": random.choice(["MED_BASIC", "MED_COMP", "PENSION_A", "PENSION_B"]),
            "EMPBENEFITS.BENEFIT_TYPE": random.choice(["MEDICAL", "RETIREMENT", "LIFE"]),
            "EMPBENEFITS.START_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 1825))).strftime("%Y-%m-%d"),
            "EMPBENEFITS.CONTRIBUTION": round(random.uniform(500, 5000), 2),
            "EMPBENEFITS.CURRENCY": random.choice(["ZAR", "USD", "EUR"]),
        })
    return pd.DataFrame(rows)


def gen_benefits_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "EMPBENEFITS.USERID": None if (is_dirty and bucket == 0) else f"user{i:05d}",
            "EMPBENEFITS.BENEFIT_PLAN": None if (is_dirty and bucket == 1) else "MED_BASIC",
            "EMPBENEFITS.BENEFIT_TYPE": "INVALID" if (is_dirty and bucket == 2) else "MEDICAL",
            "EMPBENEFITS.START_DATE": "not-a-date" if (is_dirty and bucket == 3) else (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 1825))).strftime("%Y-%m-%d"),
            "EMPBENEFITS.CONTRIBUTION": None if (is_dirty and bucket == 4) else round(random.uniform(500, 5000), 2),
            "EMPBENEFITS.CURRENCY": random.choice(["ZAR", "USD"]),
        })
    return pd.DataFrame(rows)


def gen_benefits_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: all BENEFIT_PLAN starts with ZA_ prefix."""
    random.seed(seed)
    za_plans = ["ZA_MED_BASIC", "ZA_MED_COMP", "ZA_PENSION_A", "ZA_PENSION_B", "ZA_LIFE"]
    rows = []
    for i in range(n):
        rows.append({
            "EMPBENEFITS.USERID": f"user{i:05d}",
            "EMPBENEFITS.BENEFIT_PLAN": random.choice(za_plans),
            "EMPBENEFITS.BENEFIT_TYPE": random.choice(["MEDICAL", "RETIREMENT", "LIFE"]),
            "EMPBENEFITS.START_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 1825))).strftime("%Y-%m-%d"),
            "EMPBENEFITS.CONTRIBUTION": round(random.uniform(500, 5000), 2),
            "EMPBENEFITS.CURRENCY": "ZAR",
        })
    return pd.DataFrame(rows)


def gen_payroll_integration_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "PAYRESULT.USERID": f"user{i:05d}",
            "PAYRESULT.ABKRS": random.choice(["M1", "M2", "W1"]),
            "PAYRESULT.MOLGA": random.choice(["24", "10", "08"]),
            "PAYRESULT.PERNR": f"{i:08d}",
            "PAYRESULT.BEGDA": (datetime.now(timezone.utc).replace(day=1) - timedelta(days=random.randint(30, 365))).strftime("%Y-%m-%d"),
            "PAYRESULT.ENDDA": datetime.now(timezone.utc).replace(day=28).strftime("%Y-%m-%d"),
            "PAYRESULT.WAERS": random.choice(["ZAR", "USD", "EUR"]),
        })
    return pd.DataFrame(rows)


def gen_payroll_integration_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "PAYRESULT.USERID": None if (is_dirty and bucket == 0) else f"user{i:05d}",
            "PAYRESULT.ABKRS": "INVALID" if (is_dirty and bucket == 1) else "M1",
            "PAYRESULT.MOLGA": "99" if (is_dirty and bucket == 2) else "24",
            "PAYRESULT.PERNR": None if (is_dirty and bucket == 3) else f"{i:08d}",
            "PAYRESULT.BEGDA": "not-a-date" if (is_dirty and bucket == 4) else (datetime.now(timezone.utc).replace(day=1) - timedelta(days=random.randint(30, 365))).strftime("%Y-%m-%d"),
            "PAYRESULT.ENDDA": datetime.now(timezone.utc).replace(day=28).strftime("%Y-%m-%d"),
            "PAYRESULT.WAERS": random.choice(["ZAR", "USD"]),
        })
    return pd.DataFrame(rows)


def gen_payroll_integration_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: ABKRS=ZA, MOLGA=24 throughout."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "PAYRESULT.USERID": f"user{i:05d}",
            "PAYRESULT.ABKRS": "ZA",
            "PAYRESULT.MOLGA": "24",
            "PAYRESULT.PERNR": f"{i:08d}",
            "PAYRESULT.BEGDA": (datetime.now(timezone.utc).replace(day=1) - timedelta(days=random.randint(30, 365))).strftime("%Y-%m-%d"),
            "PAYRESULT.ENDDA": datetime.now(timezone.utc).replace(day=28).strftime("%Y-%m-%d"),
            "PAYRESULT.WAERS": "ZAR",
        })
    return pd.DataFrame(rows)


def gen_performance_goals_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "PMREVIEW.USERID": f"user{i:05d}",
            "PMREVIEW.REVIEW_PERIOD": random.choice(["FY2024", "FY2023", "H1_2024"]),
            "PMREVIEW.GOAL_ID": str(uuid.uuid4()),
            "PMREVIEW.RATING": random.choice(["1", "2", "3", "4", "5"]),
            "PMREVIEW.STATUS": random.choice(["completed", "in_progress", "not_started"]),
            "PMREVIEW.WEIGHT": round(random.uniform(5, 40), 1),
        })
    return pd.DataFrame(rows)


def gen_performance_goals_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "PMREVIEW.USERID": None if (is_dirty and bucket == 0) else f"user{i:05d}",
            "PMREVIEW.REVIEW_PERIOD": None if (is_dirty and bucket == 1) else "FY2024",
            "PMREVIEW.GOAL_ID": None if (is_dirty and bucket == 2) else str(uuid.uuid4()),
            "PMREVIEW.RATING": "9" if (is_dirty and bucket == 3) else random.choice(["1", "2", "3", "4", "5"]),
            "PMREVIEW.STATUS": "INVALID" if (is_dirty and bucket == 4) else "completed",
            "PMREVIEW.WEIGHT": round(random.uniform(5, 40), 1),
        })
    return pd.DataFrame(rows)


def gen_performance_goals_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: REVIEW_PERIOD=ZA_FY throughout."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "PMREVIEW.USERID": f"user{i:05d}",
            "PMREVIEW.REVIEW_PERIOD": "ZA_FY",
            "PMREVIEW.GOAL_ID": str(uuid.uuid4()),
            "PMREVIEW.RATING": random.choice(["1", "2", "3", "4", "5"]),
            "PMREVIEW.STATUS": random.choice(["completed", "in_progress"]),
            "PMREVIEW.WEIGHT": round(random.uniform(5, 40), 1),
        })
    return pd.DataFrame(rows)


def gen_succession_planning_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "SUCCESSION.USERID": f"user{i:05d}",
            "SUCCESSION.TALENT_POOL": random.choice(["EXEC", "MGMT", "TECH", "GLOBAL"]),
            "SUCCESSION.READINESS": random.choice(["now", "1year", "2year"]),
            "SUCCESSION.RISK_LEVEL": random.choice(["high", "medium", "low"]),
            "SUCCESSION.POSITION_ID": f"POS{random.randint(1000, 9999)}",
        })
    return pd.DataFrame(rows)


def gen_succession_planning_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 4
        rows.append({
            "SUCCESSION.USERID": None if (is_dirty and bucket == 0) else f"user{i:05d}",
            "SUCCESSION.TALENT_POOL": None if (is_dirty and bucket == 1) else "EXEC",
            "SUCCESSION.READINESS": "INVALID" if (is_dirty and bucket == 2) else "now",
            "SUCCESSION.RISK_LEVEL": None if (is_dirty and bucket == 3) else "high",
            "SUCCESSION.POSITION_ID": f"POS{random.randint(1000, 9999)}",
        })
    return pd.DataFrame(rows)


def gen_succession_planning_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: TALENT_POOL=ZA_EXEC or ZA_MGMT."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "SUCCESSION.USERID": f"user{i:05d}",
            "SUCCESSION.TALENT_POOL": random.choice(["ZA_EXEC", "ZA_MGMT"]),
            "SUCCESSION.READINESS": random.choice(["now", "1year", "2year"]),
            "SUCCESSION.RISK_LEVEL": random.choice(["high", "medium", "low"]),
            "SUCCESSION.POSITION_ID": f"POS{random.randint(1000, 9999)}",
        })
    return pd.DataFrame(rows)


def gen_recruiting_onboarding_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "JOBAPP.APPLICANT_ID": str(uuid.uuid4()),
            "JOBAPP.JOB_REQ_ID": f"JR{i:06d}",
            "JOBAPP.STATUS": random.choice(["applied", "screening", "interview", "offer", "hired", "rejected"]),
            "JOBAPP.SOURCE": random.choice(["internal", "linkedin", "indeed", "referral"]),
            "JOBAPP.POSITION_ID": f"POS{random.randint(1000, 9999)}",
            "JOBAPP.APPLY_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 180))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_recruiting_onboarding_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "JOBAPP.APPLICANT_ID": None if (is_dirty and bucket == 0) else str(uuid.uuid4()),
            "JOBAPP.JOB_REQ_ID": None if (is_dirty and bucket == 1) else f"JR{i:06d}",
            "JOBAPP.STATUS": "INVALID" if (is_dirty and bucket == 2) else "applied",
            "JOBAPP.SOURCE": None if (is_dirty and bucket == 3) else "linkedin",
            "JOBAPP.POSITION_ID": None if (is_dirty and bucket == 4) else f"POS{random.randint(1000, 9999)}",
            "JOBAPP.APPLY_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 180))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_recruiting_onboarding_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: JOB_REQ_ID follows ZAJR{6digits} pattern."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "JOBAPP.APPLICANT_ID": str(uuid.uuid4()),
            "JOBAPP.JOB_REQ_ID": f"ZAJR{i:06d}",
            "JOBAPP.STATUS": random.choice(["applied", "screening", "interview", "offer"]),
            "JOBAPP.SOURCE": random.choice(["internal", "linkedin", "indeed", "referral"]),
            "JOBAPP.POSITION_ID": f"POS{random.randint(1000, 9999)}",
            "JOBAPP.APPLY_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 180))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_learning_management_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    depts = ["FINANCE", "HR", "IT", "SALES", "OPS", "LEGAL"]
    rows = []
    for i in range(n):
        rows.append({
            "LEARNING.USERID": f"user{i:05d}",
            "LEARNING.COURSE_ID": f"COURSE{i:04d}",
            "LEARNING.COMPLETION_STATUS": random.choice(["completed", "in_progress", "not_started"]),
            "LEARNING.COMPLETION_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "LEARNING.SCORE": random.randint(0, 100),
            "LEARNING.REQUIRED": random.choice(["Y", "N"]),
        })
    return pd.DataFrame(rows)


def gen_learning_management_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "LEARNING.USERID": None if (is_dirty and bucket == 0) else f"user{i:05d}",
            "LEARNING.COURSE_ID": None if (is_dirty and bucket == 1) else f"COURSE{i:04d}",
            "LEARNING.COMPLETION_STATUS": "INVALID" if (is_dirty and bucket == 2) else "completed",
            "LEARNING.COMPLETION_DATE": "not-a-date" if (is_dirty and bucket == 3) else (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "LEARNING.SCORE": 999 if (is_dirty and bucket == 4) else random.randint(0, 100),
            "LEARNING.REQUIRED": random.choice(["Y", "N"]),
        })
    return pd.DataFrame(rows)


def gen_learning_management_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: COURSE_ID follows ZA_{department} pattern."""
    random.seed(seed)
    depts = ["ZA_FINANCE", "ZA_HR", "ZA_IT", "ZA_SALES", "ZA_OPS", "ZA_LEGAL"]
    rows = []
    for i in range(n):
        rows.append({
            "LEARNING.USERID": f"user{i:05d}",
            "LEARNING.COURSE_ID": random.choice(depts),
            "LEARNING.COMPLETION_STATUS": random.choice(["completed", "in_progress"]),
            "LEARNING.COMPLETION_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "LEARNING.SCORE": random.randint(0, 100),
            "LEARNING.REQUIRED": random.choice(["Y", "N"]),
        })
    return pd.DataFrame(rows)


def gen_time_attendance_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "TIMESHEET.USERID": f"user{i:05d}",
            "TIMESHEET.WORK_SCHEDULE": random.choice(["STD", "SHIFT_A", "SHIFT_B", "FLEX"]),
            "TIMESHEET.QUOTA_UNIT": random.choice(["H", "D"]),
            "TIMESHEET.QUOTA_BALANCE": round(random.uniform(0, 30), 2),
            "TIMESHEET.PERIOD_START": (datetime.now(timezone.utc).replace(day=1) - timedelta(days=30)).strftime("%Y-%m-%d"),
            "TIMESHEET.HOURS_WORKED": round(random.uniform(0, 200), 2),
        })
    return pd.DataFrame(rows)


def gen_time_attendance_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "TIMESHEET.USERID": None if (is_dirty and bucket == 0) else f"user{i:05d}",
            "TIMESHEET.WORK_SCHEDULE": None if (is_dirty and bucket == 1) else "STD",
            "TIMESHEET.QUOTA_UNIT": "INVALID" if (is_dirty and bucket == 2) else "H",
            "TIMESHEET.QUOTA_BALANCE": None if (is_dirty and bucket == 3) else round(random.uniform(0, 30), 2),
            "TIMESHEET.PERIOD_START": "not-a-date" if (is_dirty and bucket == 4) else (datetime.now(timezone.utc).replace(day=1) - timedelta(days=30)).strftime("%Y-%m-%d"),
            "TIMESHEET.HOURS_WORKED": round(random.uniform(0, 200), 2),
        })
    return pd.DataFrame(rows)


def gen_time_attendance_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: WORK_SCHEDULE=ZA_STD, QUOTA_UNIT=D throughout."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "TIMESHEET.USERID": f"user{i:05d}",
            "TIMESHEET.WORK_SCHEDULE": "ZA_STD",
            "TIMESHEET.QUOTA_UNIT": "D",
            "TIMESHEET.QUOTA_BALANCE": round(random.uniform(0, 30), 2),
            "TIMESHEET.PERIOD_START": (datetime.now(timezone.utc).replace(day=1) - timedelta(days=30)).strftime("%Y-%m-%d"),
            "TIMESHEET.HOURS_WORKED": round(random.uniform(0, 200), 2),
        })
    return pd.DataFrame(rows)


# ===========================================================================
# Warehouse generators
# ===========================================================================

def gen_ewms_stock_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "LGPLA.LGNUM": random.choice(["W001", "W002", "W003"]),
            "LGPLA.LGTYP": random.choice(["001", "002", "003", "010"]),
            "LGPLA.LGPLA": f"BIN{i:06d}",
            "LGPLA.MATNR": f"MAT{i:06d}",
            "LGPLA.WERKS": random.choice(["1000", "2000"]),
            "LGPLA.LGMNG": round(random.uniform(0, 1000), 3),
            "LGPLA.MEINS": random.choice(["KG", "EA", "LB"]),
        })
    return pd.DataFrame(rows)


def gen_ewms_stock_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "LGPLA.LGNUM": None if (is_dirty and bucket == 0) else "W001",
            "LGPLA.LGTYP": None if (is_dirty and bucket == 1) else "001",
            "LGPLA.LGPLA": f"BIN{i:06d}",
            "LGPLA.MATNR": None if (is_dirty and bucket == 2) else f"MAT{i:06d}",
            "LGPLA.WERKS": None if (is_dirty and bucket == 3) else "1000",
            "LGPLA.LGMNG": None if (is_dirty and bucket == 4) else round(random.uniform(0, 1000), 3),
            "LGPLA.MEINS": random.choice(["KG", "EA"]),
        })
    return pd.DataFrame(rows)


def gen_ewms_stock_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: LGNUM=W001, LGTYP=001 or 002 only."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "LGPLA.LGNUM": "W001",
            "LGPLA.LGTYP": random.choice(["001", "002"]),
            "LGPLA.LGPLA": f"BIN{i:06d}",
            "LGPLA.MATNR": f"MAT{i:06d}",
            "LGPLA.WERKS": "1000",
            "LGPLA.LGMNG": round(random.uniform(0, 1000), 3),
            "LGPLA.MEINS": "EA",
        })
    return pd.DataFrame(rows)


def gen_ewms_transfer_orders_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "LTAP.LGNUM": random.choice(["W001", "W002"]),
            "LTAP.TANUM": f"TO{i:07d}",
            "LTAP.MATNR": f"MAT{i:06d}",
            "LTAP.NLTYP": random.choice(["001", "010", "020"]),
            "LTAP.Nlgpla": f"BIN{i:06d}",
            "LTAP.MENGE": round(random.uniform(1, 100), 3),
            "LTAP.MEINS": random.choice(["KG", "EA"]),
            "LTAP.STATUS": random.choice(["A", "B", "C"]),
        })
    return pd.DataFrame(rows)


def gen_ewms_transfer_orders_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "LTAP.LGNUM": None if (is_dirty and bucket == 0) else "W001",
            "LTAP.TANUM": None if (is_dirty and bucket == 1) else f"TO{i:07d}",
            "LTAP.MATNR": None if (is_dirty and bucket == 2) else f"MAT{i:06d}",
            "LTAP.NLTYP": None if (is_dirty and bucket == 3) else "001",
            "LTAP.Nlgpla": None if (is_dirty and bucket == 4) else f"BIN{i:06d}",
            "LTAP.MENGE": round(random.uniform(1, 100), 3),
            "LTAP.MEINS": "INVALID" if (is_dirty and bucket == 0) else "KG",
            "LTAP.STATUS": random.choice(["A", "B", "C"]),
        })
    return pd.DataFrame(rows)


def gen_ewms_transfer_orders_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: LGNUM=W001, TANUM follows TO{7digits} pattern."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "LTAP.LGNUM": "W001",
            "LTAP.TANUM": f"TO{i:07d}",
            "LTAP.MATNR": f"MAT{i:06d}",
            "LTAP.NLTYP": "001",
            "LTAP.Nlgpla": f"BIN{i:06d}",
            "LTAP.MENGE": round(random.uniform(1, 100), 3),
            "LTAP.MEINS": "EA",
            "LTAP.STATUS": random.choice(["A", "B"]),
        })
    return pd.DataFrame(rows)


def gen_batch_management_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(n):
        rows.append({
            "MCH1.MATNR": f"MAT{i:06d}",
            "MCH1.CHARG": f"B{i:08d}",
            "MCH1.WERKS": random.choice(["1000", "2000"]),
            "MCHA.MHDRZ": random.randint(30, 365),
            "MCHA.MHDLP": (now + timedelta(days=random.randint(10, 365))).strftime("%Y-%m-%d"),
            "MCHA.HSDAT": (now - timedelta(days=random.randint(1, 180))).strftime("%Y-%m-%d"),
            "MCH1.EINDT": (now - timedelta(days=random.randint(1, 180))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_batch_management_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "MCH1.MATNR": None if (is_dirty and bucket == 0) else f"MAT{i:06d}",
            "MCH1.CHARG": None if (is_dirty and bucket == 1) else f"B{i:08d}",
            "MCH1.WERKS": None if (is_dirty and bucket == 2) else "1000",
            "MCHA.MHDRZ": None if (is_dirty and bucket == 3) else random.randint(30, 365),
            "MCHA.MHDLP": "not-a-date" if (is_dirty and bucket == 4) else (now + timedelta(days=random.randint(10, 365))).strftime("%Y-%m-%d"),
            "MCHA.HSDAT": (now - timedelta(days=random.randint(1, 180))).strftime("%Y-%m-%d"),
            "MCH1.EINDT": (now - timedelta(days=random.randint(1, 180))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_batch_management_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: CHARG follows YYYYMM{4digits}, MHDRZ=90 throughout."""
    random.seed(seed)
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(n):
        ym = (now - timedelta(days=random.randint(0, 365))).strftime("%Y%m")
        rows.append({
            "MCH1.MATNR": f"MAT{i:06d}",
            "MCH1.CHARG": f"{ym}{i:04d}",
            "MCH1.WERKS": "1000",
            "MCHA.MHDRZ": 90,
            "MCHA.MHDLP": (now + timedelta(days=90)).strftime("%Y-%m-%d"),
            "MCHA.HSDAT": (now - timedelta(days=random.randint(1, 90))).strftime("%Y-%m-%d"),
            "MCH1.EINDT": (now - timedelta(days=random.randint(1, 90))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_mdg_master_data_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "USMD_RECORD.ID": str(uuid.uuid4()),
            "USMD_RECORD.ENTITY_TYPE": random.choice(["MATERIAL", "VENDOR", "CUSTOMER", "ACCOUNT"]),
            "USMD_RECORD.STATUS": random.choice(["ACTV", "COMPL", "INACT"]),
            "USMD_RECORD.CHANGED_ON": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "USMD_RECORD.RESPONSIBLE": f"user{i % 50:05d}",
            "USMD_RECORD.SOURCE_SYSTEM": random.choice(["ECC", "MDG", "CRM"]),
        })
    return pd.DataFrame(rows)


def gen_mdg_master_data_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "USMD_RECORD.ID": None if (is_dirty and bucket == 0) else str(uuid.uuid4()),
            "USMD_RECORD.ENTITY_TYPE": None if (is_dirty and bucket == 1) else "MATERIAL",
            "USMD_RECORD.STATUS": "INVALID" if (is_dirty and bucket == 2) else "ACTV",
            "USMD_RECORD.CHANGED_ON": "not-a-date" if (is_dirty and bucket == 3) else (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "USMD_RECORD.RESPONSIBLE": None if (is_dirty and bucket == 4) else f"user{i % 50:05d}",
            "USMD_RECORD.SOURCE_SYSTEM": random.choice(["ECC", "MDG"]),
        })
    return pd.DataFrame(rows)


def gen_mdg_master_data_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: all records pending approval (STATUS=PEND)."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "USMD_RECORD.ID": str(uuid.uuid4()),
            "USMD_RECORD.ENTITY_TYPE": random.choice(["MATERIAL", "VENDOR", "CUSTOMER"]),
            "USMD_RECORD.STATUS": "PEND",
            "USMD_RECORD.CHANGED_ON": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "USMD_RECORD.RESPONSIBLE": f"user{i % 50:05d}",
            "USMD_RECORD.SOURCE_SYSTEM": random.choice(["ECC", "MDG"]),
        })
    return pd.DataFrame(rows)


def gen_grc_compliance_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "GRFN_CTRL.CTRL_ID": f"CTRL{i:06d}",
            "GRFN_CTRL.RISK_RATING": random.choice(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
            "GRFN_CTRL.RISK_CATEGORY": random.choice(["FINANCIAL", "OPERATIONAL", "COMPLIANCE"]),
            "GRFN_CTRL.STATUS": random.choice(["active", "inactive", "pending"]),
            "GRFN_CTRL.OWNER": f"user{i % 30:05d}",
            "GRFN_CTRL.LAST_TEST_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_grc_compliance_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "GRFN_CTRL.CTRL_ID": None if (is_dirty and bucket == 0) else f"CTRL{i:06d}",
            "GRFN_CTRL.RISK_RATING": "INVALID" if (is_dirty and bucket == 1) else "HIGH",
            "GRFN_CTRL.RISK_CATEGORY": None if (is_dirty and bucket == 2) else "FINANCIAL",
            "GRFN_CTRL.STATUS": "INVALID" if (is_dirty and bucket == 3) else "active",
            "GRFN_CTRL.OWNER": None if (is_dirty and bucket == 4) else f"user{i % 30:05d}",
            "GRFN_CTRL.LAST_TEST_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_grc_compliance_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: RISK_RATING=LOW (not yet configured), RISK_CATEGORY=ZA_REG."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "GRFN_CTRL.CTRL_ID": f"CTRL{i:06d}",
            "GRFN_CTRL.RISK_RATING": "LOW",
            "GRFN_CTRL.RISK_CATEGORY": "ZA_REG",
            "GRFN_CTRL.STATUS": "active",
            "GRFN_CTRL.OWNER": f"user{i % 30:05d}",
            "GRFN_CTRL.LAST_TEST_DATE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_fleet_management_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "FLEET.FLEET_ID": f"{random.choice(['ZA', 'GB', 'US'])}-{i:04d}",
            "FLEET.VEHICLE_TYPE": random.choice(["TRUCK", "VAN", "CAR", "FORKLIFT"]),
            "FLEET.STATUS": random.choice(["active", "maintenance", "inactive"]),
            "FLEET.LAST_SERVICE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "FLEET.MILEAGE": random.randint(0, 500000),
            "FLEET.WERKS": random.choice(["1000", "2000"]),
        })
    return pd.DataFrame(rows)


def gen_fleet_management_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "FLEET.FLEET_ID": None if (is_dirty and bucket == 0) else f"ZA-{i:04d}",
            "FLEET.VEHICLE_TYPE": None if (is_dirty and bucket == 1) else "TRUCK",
            "FLEET.STATUS": "INVALID" if (is_dirty and bucket == 2) else "active",
            "FLEET.LAST_SERVICE": "not-a-date" if (is_dirty and bucket == 3) else (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "FLEET.MILEAGE": None if (is_dirty and bucket == 4) else random.randint(0, 500000),
            "FLEET.WERKS": random.choice(["1000", "2000"]),
        })
    return pd.DataFrame(rows)


def gen_fleet_management_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: all FLEET_ID starts with ZA-."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "FLEET.FLEET_ID": f"ZA-{i:04d}",
            "FLEET.VEHICLE_TYPE": random.choice(["TRUCK", "VAN", "CAR", "FORKLIFT"]),
            "FLEET.STATUS": "active",
            "FLEET.LAST_SERVICE": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 365))).strftime("%Y-%m-%d"),
            "FLEET.MILEAGE": random.randint(0, 500000),
            "FLEET.WERKS": "P001",
        })
    return pd.DataFrame(rows)


def gen_transport_management_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "VTTK.TKNUM": f"TK{i:08d}",
            "VTTK.SHIPMENT_TYPE": random.choice(["0001", "0002", "ZA01", "GB01"]),
            "VTTK.VSTEL": random.choice(["1000", "2000"]),
            "VTTK.ABFER": random.choice(["01", "02", "10"]),
            "VTTK.STATUS": random.choice(["A", "B", "C"]),
            "VTTK.SDABW": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 180))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_transport_management_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "VTTK.TKNUM": None if (is_dirty and bucket == 0) else f"TK{i:08d}",
            "VTTK.SHIPMENT_TYPE": None if (is_dirty and bucket == 1) else "0001",
            "VTTK.VSTEL": None if (is_dirty and bucket == 2) else "1000",
            "VTTK.ABFER": "INVALID" if (is_dirty and bucket == 3) else "01",
            "VTTK.STATUS": None if (is_dirty and bucket == 4) else "A",
            "VTTK.SDABW": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 180))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_transport_management_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: all SHIPMENT_TYPE=ZA01."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "VTTK.TKNUM": f"TK{i:08d}",
            "VTTK.SHIPMENT_TYPE": "ZA01",
            "VTTK.VSTEL": "1000",
            "VTTK.ABFER": "01",
            "VTTK.STATUS": random.choice(["A", "B"]),
            "VTTK.SDABW": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 180))).strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


def gen_wm_interface_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "LQUA.LGNUM": random.choice(["W001", "W002", "W003"]),
            "LQUA.LGTYP": random.choice(["001", "010", "020"]),
            "LQUA.LGPLA": f"BIN{i:06d}",
            "LQUA.MATNR": f"MAT{i:06d}",
            "LQUA.WERKS": random.choice(["1000", "2000"]),
            "LQUA.BESTQ": random.choice(["", "B", "Q", "S"]),
            "LQUA.MENGE": round(random.uniform(0, 1000), 3),
            "LQUA.MEINS": random.choice(["KG", "EA"]),
        })
    return pd.DataFrame(rows)


def gen_wm_interface_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "LQUA.LGNUM": None if (is_dirty and bucket == 0) else "W001",
            "LQUA.LGTYP": None if (is_dirty and bucket == 1) else "001",
            "LQUA.LGPLA": f"BIN{i:06d}",
            "LQUA.MATNR": None if (is_dirty and bucket == 2) else f"MAT{i:06d}",
            "LQUA.WERKS": None if (is_dirty and bucket == 3) else "1000",
            "LQUA.BESTQ": "INVALID" if (is_dirty and bucket == 4) else "",
            "LQUA.MENGE": round(random.uniform(0, 1000), 3),
            "LQUA.MEINS": random.choice(["KG", "EA"]),
        })
    return pd.DataFrame(rows)


def gen_wm_interface_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: all LGNUM=W001."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "LQUA.LGNUM": "W001",
            "LQUA.LGTYP": random.choice(["001", "010", "020"]),
            "LQUA.LGPLA": f"BIN{i:06d}",
            "LQUA.MATNR": f"MAT{i:06d}",
            "LQUA.WERKS": "1000",
            "LQUA.BESTQ": "",
            "LQUA.MENGE": round(random.uniform(0, 1000), 3),
            "LQUA.MEINS": "EA",
        })
    return pd.DataFrame(rows)


def gen_cross_system_integration_clean(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "IDOC.DOCNUM": f"{i:016d}",
            "IDOC.SOURCE_SYSTEM": random.choice(["ECC_1000", "CRM_001", "MDG_MAIN"]),
            "IDOC.STATUS": random.choice(["03", "51", "53"]),
            "IDOC.MESTYP": random.choice(["ORDERS", "MATMAS", "DEBMAS", "CREMAS"]),
            "IDOC.CREDAT": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 90))).strftime("%Y-%m-%d"),
            "IDOC.DIRECT": random.choice(["1", "2"]),
        })
    return pd.DataFrame(rows)


def gen_cross_system_integration_errors(n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    dirty_count = int(n * 0.18)
    rows = []
    for i in range(n):
        is_dirty = i < dirty_count
        bucket = i % 5
        rows.append({
            "IDOC.DOCNUM": None if (is_dirty and bucket == 0) else f"{i:016d}",
            "IDOC.SOURCE_SYSTEM": None if (is_dirty and bucket == 1) else "ECC_1000",
            "IDOC.STATUS": "INVALID" if (is_dirty and bucket == 2) else "03",
            "IDOC.MESTYP": None if (is_dirty and bucket == 3) else "ORDERS",
            "IDOC.CREDAT": "not-a-date" if (is_dirty and bucket == 4) else (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 90))).strftime("%Y-%m-%d"),
            "IDOC.DIRECT": random.choice(["1", "2"]),
        })
    return pd.DataFrame(rows)


def gen_cross_system_integration_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: all SOURCE_SYSTEM=ECC_ZA01."""
    random.seed(seed)
    rows = []
    for i in range(n):
        rows.append({
            "IDOC.DOCNUM": f"{i:016d}",
            "IDOC.SOURCE_SYSTEM": "ECC_ZA01",
            "IDOC.STATUS": random.choice(["03", "53"]),
            "IDOC.MESTYP": random.choice(["ORDERS", "MATMAS", "DEBMAS"]),
            "IDOC.CREDAT": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 90))).strftime("%Y-%m-%d"),
            "IDOC.DIRECT": random.choice(["1", "2"]),
        })
    return pd.DataFrame(rows)


# ===========================================================================
# Business partner variants (wraps imported generator + adds deviation)
# ===========================================================================

def gen_business_partner_clean(n: int, seed: int) -> pd.DataFrame:
    return generate_business_partner(n=n, seed=seed)


def gen_business_partner_errors(n: int, seed: int) -> pd.DataFrame:
    # generate_business_partner already produces ~15% dirty — use a different seed
    # to get an independent dirty sample
    return generate_business_partner(n=n, seed=seed + 1000)


def gen_business_partner_deviation(n: int, seed: int) -> pd.DataFrame:
    """Config deviation: 8-digit PARTNER (10000001+), LAND1=ZA, BUKRS=ZA01."""
    random.seed(seed)
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(n):
        rows.append({
            "BUT000.BU_TYPE": random.choice(["1", "2", "3"]),
            "BUT000.PARTNER": f"{10000001 + i:08d}",  # 8-digit, not 10-digit
            "BUT000.NAME_ORG1": f"Organisation {i}",
            "BUT000.TITLE": random.choice(["0001", "0002", "0003"]),
            "BUT000.PARTNER_GUID": str(uuid.uuid4()),
            "BUT000.BU_SORT1": f"SEARCH{i:04d}",
            "BUT000.CREATED_AT": (now - timedelta(days=random.randint(1, 300))).isoformat(),
            "ADR6.SMTP_ADDR": f"user{i}@company.co.za",
            "ADRC.COUNTRY": "ZA",
            "ADRC.CITY1": random.choice(["Johannesburg", "Cape Town", "Pretoria"]),
            "ADRC.POST_CODE1": random.choice(["2000", "8000", "0001"]),
            "BUT100.RLTYP": random.choice(["FLCU01", "FLVN01"]),
            "LFB1.BUKRS": "ZA01",
        })
    return pd.DataFrame(rows)


# ===========================================================================
# Module registry — (category, module_name, clean_fn, errors_fn, deviation_fn)
# ===========================================================================

MODULES: list[tuple[str, str, callable, callable, callable]] = [
    # ECC
    ("ecc", "business_partner", gen_business_partner_clean, gen_business_partner_errors, gen_business_partner_deviation),
    ("ecc", "material_master", gen_material_master_clean, gen_material_master_errors, gen_material_master_deviation),
    ("ecc", "fi_gl", gen_fi_gl_clean, gen_fi_gl_errors, gen_fi_gl_deviation),
    ("ecc", "accounts_payable", gen_accounts_payable_clean, gen_accounts_payable_errors, gen_accounts_payable_deviation),
    ("ecc", "accounts_receivable", gen_accounts_receivable_clean, gen_accounts_receivable_errors, gen_accounts_receivable_deviation),
    ("ecc", "asset_accounting", gen_asset_accounting_clean, gen_asset_accounting_errors, gen_asset_accounting_deviation),
    ("ecc", "mm_purchasing", gen_mm_purchasing_clean, gen_mm_purchasing_errors, gen_mm_purchasing_deviation),
    ("ecc", "plant_maintenance", gen_plant_maintenance_clean, gen_plant_maintenance_errors, gen_plant_maintenance_deviation),
    ("ecc", "production_planning", gen_production_planning_clean, gen_production_planning_errors, gen_production_planning_deviation),
    ("ecc", "sd_customer_master", gen_sd_customer_master_clean, gen_sd_customer_master_errors, gen_sd_customer_master_deviation),
    ("ecc", "sd_sales_orders", gen_sd_sales_orders_clean, gen_sd_sales_orders_errors, gen_sd_sales_orders_deviation),
    # SuccessFactors
    ("successfactors", "employee_central", gen_employee_central_clean, gen_employee_central_errors, gen_employee_central_deviation),
    ("successfactors", "compensation", gen_compensation_clean, gen_compensation_errors, gen_compensation_deviation),
    ("successfactors", "benefits", gen_benefits_clean, gen_benefits_errors, gen_benefits_deviation),
    ("successfactors", "payroll_integration", gen_payroll_integration_clean, gen_payroll_integration_errors, gen_payroll_integration_deviation),
    ("successfactors", "performance_goals", gen_performance_goals_clean, gen_performance_goals_errors, gen_performance_goals_deviation),
    ("successfactors", "succession_planning", gen_succession_planning_clean, gen_succession_planning_errors, gen_succession_planning_deviation),
    ("successfactors", "recruiting_onboarding", gen_recruiting_onboarding_clean, gen_recruiting_onboarding_errors, gen_recruiting_onboarding_deviation),
    ("successfactors", "learning_management", gen_learning_management_clean, gen_learning_management_errors, gen_learning_management_deviation),
    ("successfactors", "time_attendance", gen_time_attendance_clean, gen_time_attendance_errors, gen_time_attendance_deviation),
    # Warehouse
    ("warehouse", "ewms_stock", gen_ewms_stock_clean, gen_ewms_stock_errors, gen_ewms_stock_deviation),
    ("warehouse", "ewms_transfer_orders", gen_ewms_transfer_orders_clean, gen_ewms_transfer_orders_errors, gen_ewms_transfer_orders_deviation),
    ("warehouse", "batch_management", gen_batch_management_clean, gen_batch_management_errors, gen_batch_management_deviation),
    ("warehouse", "mdg_master_data", gen_mdg_master_data_clean, gen_mdg_master_data_errors, gen_mdg_master_data_deviation),
    ("warehouse", "grc_compliance", gen_grc_compliance_clean, gen_grc_compliance_errors, gen_grc_compliance_deviation),
    ("warehouse", "fleet_management", gen_fleet_management_clean, gen_fleet_management_errors, gen_fleet_management_deviation),
    ("warehouse", "transport_management", gen_transport_management_clean, gen_transport_management_errors, gen_transport_management_deviation),
    ("warehouse", "wm_interface", gen_wm_interface_clean, gen_wm_interface_errors, gen_wm_interface_deviation),
    ("warehouse", "cross_system_integration", gen_cross_system_integration_clean, gen_cross_system_integration_errors, gen_cross_system_integration_deviation),
]


# ===========================================================================
# Ground-truth deviation pattern descriptions
# ===========================================================================

DEVIATION_PATTERNS: dict[str, list[str]] = {
    "business_partner": [
        "PARTNER is 8-digit numeric (10000001–10500000) — legacy range, not SAP standard 10-digit",
        "ADRC.COUNTRY=ZA throughout — single-country deployment",
        "LFB1.BUKRS=ZA01 throughout — custom company code, not standard 1000",
    ],
    "material_master": [
        "MARA.MTART=ZFIN throughout — custom Z-type material type",
        "MARA.MATKL starts with Z (ZRAW/ZFIN/ZPKG) — custom material groups",
        "MARA.MEINS=EA throughout — single unit of measure",
        "MARA.MATNR follows ZFG{5digits} pattern — non-standard numbering",
    ],
    "fi_gl": [
        "SKB1.BUKRS=ZA01 throughout — custom company code",
        "SKA1.KTOPL=CAZA throughout — custom chart of accounts",
        "SKA1.SAKNR is 6-digit (100000–899999) — not SAP standard 10-digit",
    ],
    "accounts_payable": [
        "LFB1.WAERS=ZAR throughout — single currency",
        "LFB1.ZTERM=ZA30 throughout — custom payment term",
        "LFB1.AKONT=210100 throughout — single reconciliation account",
    ],
    "accounts_receivable": [
        "KNB1.KLIMK=0 throughout — credit management disabled",
        "KNB1.ZTERM=ZA14 throughout — custom payment term",
        "KNB1.AKONT=140100 throughout — single reconciliation account",
    ],
    "asset_accounting": [
        "ANLA.BUKRS=ZA01 throughout — custom company code",
        "ANLA.ANLKL follows ZA{3digits} pattern — custom asset classes",
    ],
    "mm_purchasing": [
        "EKPO.WERKS=P001 or P002 only — two-plant operation",
        "EKKO.EKORG=ZA01 throughout — custom purchasing organisation",
    ],
    "plant_maintenance": [
        "EQUI.SWERK=P001 throughout — single maintenance plant",
        "EQUI.EQTYP=Z throughout — custom equipment category",
    ],
    "production_planning": [
        "MARA.DISMM=PD throughout — all make-to-stock",
        "MARD.WERKS=P001 throughout — single plant",
    ],
    "sd_customer_master": [
        "KNVV.VKORG=ZA01, VTWEG=10, SPART=00 throughout — single sales area",
        "KNVV.KDGRP=ZA throughout — custom customer group",
    ],
    "sd_sales_orders": [
        "VBAK.KUNNR starts with ZA throughout — customer numbering convention",
        "VBAK.VKORG=ZA01 throughout — single sales organisation",
    ],
    "employee_central": [
        "EMPEMPLOYMENT.COMPANY_ID=ZA001 throughout — single company",
        "EMPEMPLOYMENT.LOCATION_ID follows ZA-{city} pattern (ZA-JHB, ZA-CPT, ZA-DBN)",
    ],
    "compensation": [
        "COMPINFO.CURRENCY=ZAR throughout — single currency",
        "COMPINFO.COMP_FREQUENCY=M throughout — monthly frequency (non-standard)",
    ],
    "benefits": [
        "EMPBENEFITS.BENEFIT_PLAN starts with ZA_ prefix throughout — localised plan codes",
    ],
    "payroll_integration": [
        "PAYRESULT.ABKRS=ZA throughout — ZA payroll area",
        "PAYRESULT.MOLGA=24 throughout — South Africa country grouping",
    ],
    "performance_goals": [
        "PMREVIEW.REVIEW_PERIOD=ZA_FY throughout — custom fiscal year identifier",
    ],
    "succession_planning": [
        "SUCCESSION.TALENT_POOL=ZA_EXEC or ZA_MGMT throughout — localised pool codes",
    ],
    "recruiting_onboarding": [
        "JOBAPP.JOB_REQ_ID follows ZAJR{6digits} pattern throughout",
    ],
    "learning_management": [
        "LEARNING.COURSE_ID follows ZA_{department} pattern throughout",
    ],
    "time_attendance": [
        "TIMESHEET.WORK_SCHEDULE=ZA_STD throughout",
        "TIMESHEET.QUOTA_UNIT=D throughout — days not hours",
    ],
    "ewms_stock": [
        "LGPLA.LGNUM=W001 throughout — single warehouse",
        "LGPLA.LGTYP=001 or 002 only — two storage types",
    ],
    "ewms_transfer_orders": [
        "LTAP.LGNUM=W001 throughout — single warehouse",
        "LTAP.TANUM follows TO{7digits} pattern throughout",
    ],
    "batch_management": [
        "MCH1.CHARG follows YYYYMM{4digits} pattern throughout",
        "MCHA.MHDRZ=90 throughout — 90-day shelf life",
    ],
    "mdg_master_data": [
        "USMD_RECORD.STATUS=PEND throughout — all records pending approval",
    ],
    "grc_compliance": [
        "GRFN_CTRL.RISK_RATING=LOW throughout — not yet configured",
        "GRFN_CTRL.RISK_CATEGORY=ZA_REG throughout — custom category",
    ],
    "fleet_management": [
        "FLEET.FLEET_ID starts with ZA- throughout",
    ],
    "transport_management": [
        "VTTK.SHIPMENT_TYPE=ZA01 throughout — custom shipment type",
    ],
    "wm_interface": [
        "LQUA.LGNUM=W001 throughout — single warehouse",
    ],
    "cross_system_integration": [
        "IDOC.SOURCE_SYSTEM=ECC_ZA01 throughout — single source system identifier",
    ],
}


# ===========================================================================
# Main
# ===========================================================================

def main() -> None:
    # Create directories
    for d in DIRS.values():
        d.mkdir(parents=True, exist_ok=True)

    ground_truth: dict = {}
    summary_rows: list[tuple] = []

    base_seed = 42
    for idx, (category, module, clean_fn, errors_fn, deviation_fn) in enumerate(MODULES):
        seed = base_seed + idx * 7

        out_dir = DIRS[category]

        # Generate
        df_clean = clean_fn(N, seed)
        df_errors = errors_fn(N, seed + 1)
        df_deviation = deviation_fn(N, seed + 2)

        # Save
        df_clean.to_csv(out_dir / f"{module}_clean.csv", index=False)
        df_errors.to_csv(out_dir / f"{module}_data_errors.csv", index=False)
        df_deviation.to_csv(out_dir / f"{module}_config_deviation.csv", index=False)

        # Ground truth
        dev_key = f"{category}/{module}_config_deviation"
        err_key = f"{category}/{module}_data_errors"
        ground_truth[dev_key] = {
            "file": f"{category}/{module}_config_deviation.csv",
            "expected_majority_classification": "config_deviation",
            "expected_config_deviation_min_pct": 75,
            "expected_data_error_max_pct": 10,
            "known_deviation_patterns": DEVIATION_PATTERNS.get(module, []),
        }
        ground_truth[err_key] = {
            "file": f"{category}/{module}_data_errors.csv",
            "expected_majority_classification": "data_error",
            "expected_data_error_min_pct": 70,
            "expected_config_deviation_max_pct": 10,
        }

        summary_rows.append((module, len(df_clean), len(df_errors), len(df_deviation), "OK"))

    # Write ground truth
    gt_path = BASE_DIR / "ground_truth.json"
    with open(gt_path, "w") as f:
        json.dump(ground_truth, f, indent=2)

    # Print summary table
    col_w = [30, 12, 12, 16, 8]
    headers = ["Module", "Clean rows", "Error rows", "Deviation rows", "Status"]
    sep = "  ".join("-" * w for w in col_w)

    print()
    print("  ".join(h.ljust(w) for h, w in zip(headers, col_w)))
    print(sep)
    for row in summary_rows:
        print("  ".join(str(v).ljust(w) for v, w in zip(row, col_w)))
    print(sep)
    print(f"\nTotal modules: {len(summary_rows)}")
    print(f"Files written to: {BASE_DIR}")
    print(f"Ground truth:    {gt_path}")
    print()


if __name__ == "__main__":
    main()
