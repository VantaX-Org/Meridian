"""Embedded EWM (/SCWM/ namespace) tables: refs, DDIC, frames, bundle names and the EWM rules."""
from urllib.parse import unquote

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary
from scripts.validate_rules import rule_refs
from workers.dataset import parquet_name

DDIC = get_dictionary("ecc6")
RULES = {r["id"]: r for f in ("ewms_stock", "ewms_transfer_orders")
         for r in yaml.safe_load(open(f"checks/rules/warehouse/{f}.yaml"))["rules"]}
NOW = pd.Timestamp.now().strftime("%Y%m%d%H%M%S")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


CLEAN = {
    "/SCWM/T300": frame("/SCWM/T300", LGNUM=["W1"]),
    "/SCWM/T301": frame("/SCWM/T301", LGNUM=["W1", "W1"], LGTYP=["0010", "9010"]),
    "/SCWM/LAGP": frame("/SCWM/LAGP", LGNUM=["W1", "W1"], LGPLA=["B1", "B2"], LGTYP=["0010", "9010"],
                        SKZUA=["", ""], KZLER=["", ""], KZVOL=["", ""], ANZLE=["1", "1"],
                        WEIGHT=["10", "10"], MAX_WEIGHT=["100", "100"], UNIT_W=["KG", "KG"],
                        FCAPA=["5", "5"], MAX_CAPA=["10", "10"]),
    "/SCWM/AQUA": frame("/SCWM/AQUA", GUID_PARENT=["H1", "H2"], GUID_STOCK=["S1", "S2"], LGNUM=["W1", "W1"],
                        LGPLA=["B1", "B2"], LGTYP=["0010", "9010"], QUAN=["5", "-3"], UNIT=["EA", "EA"],
                        CHARG=["C1", "C2"], VFDAT=["20991231", "00000000"]),
    "/SCWM/HUHDR": frame("/SCWM/HUHDR", GUID_HU=["H1", "H2"], HUIDENT=["HU1", "HU2"], BOTTOM=["X", "X"]),
    "/SCWM/WHO": frame("/SCWM/WHO", LGNUM=["W1"], WHO=["0000000001"]),
    "/SCWM/ORDIM_O": frame("/SCWM/ORDIM_O", LGNUM=["W1", "W1"], TANUM=["T1", "T2"], CREATED_AT=[NOW, NOW],
                           VLPLA=["B1", "B1"], NLPLA=["B2", "B2"], VLTYP=["0010", "0010"], NLTYP=["9010", "9010"],
                           WHO=["0000000001", "0000000001"], FLGHUTO=["", "X"], VSOLM=["1", "0"],
                           MEINS=["EA", "EA"]),
    "/SCWM/ORDIM_C": frame("/SCWM/ORDIM_C", LGNUM=["W1", "W1"], TANUM=["T3", "T4"], TAPOS=["1", "1"],
                           CREATED_AT=["20260101000000", "20260101000000"],
                           CONFIRMED_AT=["20260101010000", "0"]),
}

# rule → the change to the clean data that must make it flag exactly one record
DIRTY = {
    "EWMS101": ("/SCWM/AQUA", "LGTYP", ["0010", "0010"]),     # negative quant outside interim 9xxx
    "EWMS102": ("/SCWM/AQUA", "LGPLA", ["B1", "BX"]),         # bin missing
    "EWMS103": ("/SCWM/LAGP", "SKZUA", ["X", ""]),            # stock in removal-blocked bin
    "EWMS104": ("/SCWM/LAGP", "FCAPA", ["5", "-1"]),          # over capacity
    "EWMS105": ("/SCWM/LAGP", "WEIGHT", ["10", "200"]),       # over max weight
    "EWMS106": ("/SCWM/AQUA", "VFDAT", ["20991231", "20200101"]),  # expired
    "EWMS107": ("/SCWM/AQUA", "GUID_PARENT", ["H1", "HX"]),   # HU H2 without content
    "EWMS108": ("/SCWM/LAGP", "KZLER", ["", "X"]),            # empty flag with HUs in bin
    "EWMS109": ("/SCWM/LAGP", "KZVOL", ["X", ""], "KZLER", ["X", ""]),  # empty and full
    "EWMS110": ("/SCWM/LAGP", "LGTYP", ["0010", "0099"]),     # storage type not configured
    "EWMS111": ("/SCWM/LAGP", "LGNUM", ["W1", "W9"]),         # warehouse not configured
    "EWMS112": ("/SCWM/AQUA", "UNIT", ["EA", ""]),            # no unit
    "EWTO101": ("/SCWM/ORDIM_O", "CREATED_AT", [NOW, "20200101000000"]),  # open > 30 days
    "EWTO102": ("/SCWM/ORDIM_O", "VLPLA", ["B1", "BX"]),
    "EWTO103": ("/SCWM/ORDIM_O", "NLPLA", ["B2", "BX"]),
    "EWTO104": ("/SCWM/ORDIM_O", "FLGHUTO", ["", ""]),        # product task with quantity 0
    "EWTO105": ("/SCWM/ORDIM_O", "WHO", ["0000000001", "0000000009"]),
    "EWTO106": ("/SCWM/ORDIM_O", "VLTYP", ["0010", "0099"]),
    "EWTO107": ("/SCWM/ORDIM_O", "NLTYP", ["9010", "0099"]),
    "EWTO108": ("/SCWM/ORDIM_C", "CONFIRMED_AT", ["20260101010000", "20251231000000"]),
}


def frames(change=()):
    data = {t: df.copy() for t, df in CLEAN.items()}
    table, rest = change[:1], change[1:]
    for field, values in zip(rest[::2], rest[1::2]):
        data[table[0]][f"{table[0]}.{field}"] = values
    return TableFrames(data, DDIC, module="ewms_stock")


def test_slash_refs_parse():
    assert rule_refs({"field": "/SCWM/AQUA.QUAN", "fail_when": "`/SCWM/LAGP.FCAPA` < 0"}) >= {
        "/SCWM/AQUA.QUAN", "/SCWM/LAGP.FCAPA"}


def test_dictionary_resolves_namespaced_tables():
    assert DDIC.resolve("/SCWM/AQUA.QUAN") is not None
    assert list(DDIC.tables["/SCWM/LAGP"].keys) == ["LGNUM", "LGPLA"]


def test_parquet_name_round_trip():
    name = parquet_name("/SCWM/AQUA")
    assert "/" not in name and unquote(name[: -len(".parquet")]) == "/SCWM/AQUA"
    assert parquet_name("MARA") == "MARA.parquet"


def test_bin_columns_join_onto_quant_grain():
    df, grain, _ = frames().frame_for(["/SCWM/AQUA.QUAN", "/SCWM/LAGP.SKZUA"])
    assert grain == "/SCWM/AQUA" and len(df) == 2 and "/SCWM/LAGP.SKZUA" in df


@pytest.mark.parametrize("rid", sorted(DIRTY))
def test_ewm_rule_flags_dirty_and_passes_clean(rid):
    _, clean = run_rule(dict(RULES[rid]), frames())
    _, dirty = run_rule(dict(RULES[rid]), frames(DIRTY[rid]))
    assert clean is not None and not clean.error and clean.affected_count == 0, (rid, clean)
    assert dirty.affected_count == 1, (rid, dirty.affected_count, dirty.total_count)
