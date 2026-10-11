"""False-positive calibration: guards that keep rules off data valid under standard SAP configuration."""
import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

DDIC = get_dictionary("ecc6")


def rule(pack: str, rid: str) -> dict:
    return next(r for r in yaml.safe_load(open(f"checks/rules/ecc/{pack}.yaml"))["rules"] if r["id"] == rid)


def frame(table: str, **cols: list) -> pd.DataFrame:
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(pack: str, rid: str, tables: dict[str, pd.DataFrame]) -> tuple[int, int]:
    _, res = run_rule(dict(rule(pack, rid)), TableFrames(tables, DDIC, module=pack))
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def test_mm604_unmaintained_weight_and_float_noise_do_not_fire():
    mara = frame("MARA", MATNR=["M1", "M2", "M3", "M4"], MEINS=["KG"] * 4, GEWEI=["KG"] * 4,
                 NTGEW=["0", "1.0001", "25", "1"])
    assert fire("material_master", "MM604", {"MARA": mara}) == (1, 4)


def test_mm878_skips_subcontracting_and_pipeline_info_records():
    eine = frame("EINE", INFNR=["1", "2", "3"], EKORG=["1000"] * 3, ESOKZ=["0", "2", "P"], APLFZ=["0", "0", "0"])
    assert fire("material_master", "MM878", {"EINE": eine})[0] == 1


def test_mm305_skips_non_valuated_material_types():
    mara = frame("MARA", MATNR=["M1", "M2"], MTART=["ROH", "NLAG"])
    marc = frame("MARC", MATNR=["M1", "M2"], WERKS=["1000", "1000"])
    mbew = frame("MBEW", MATNR=["X"], BWKEY=["1000"])
    assert fire("material_master", "MM305", {"MARA": mara, "MARC": marc, "MBEW": mbew})[0] == 1


def test_pur013_zero_quantity_fires_on_standard_po_only():
    ekpo = frame("EKPO", EBELN=["1", "2"], EBELP=["10", "10"], BSTYP=["F", "K"], PSTYP=["0", "0"], MENGE=["0", "0"])
    assert fire("mm_purchasing", "PUR013", {"EKPO": ekpo}) == (1, 1)


def test_sdso018_zero_value_free_of_charge_item_is_valid():
    vbap = frame("VBAP", VBELN=["1", "1"], POSNR=["10", "20"], PSTYV=["TAN", "TANN"], NETWR=["0", "0"])
    assert fire("sd_sales_orders", "SDSO018", {"VBAP": vbap}) == (1, 1)
