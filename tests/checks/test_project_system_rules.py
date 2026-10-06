"""Project System pack: loads, carries full metadata, resolves in the DDIC, and each dirty
record in a small extract fails the rule written for it while clean records fail none."""

from pathlib import Path

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_checks
import sys

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
from validate_rules import unresolved  # noqa: E402

PACK = Path(__file__).parent.parent.parent / "checks" / "rules" / "ecc" / "project_system.yaml"
META = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters",
        "rule_authority", "sap_impact", "fix_map", "record_fix_template"]
OLD = (pd.Timestamp.today() - pd.Timedelta(days=900)).strftime("%Y%m%d")
STALE = (pd.Timestamp.today() - pd.Timedelta(days=500)).strftime("%Y%m%d")
FUTURE = (pd.Timestamp.today() + pd.Timedelta(days=90)).strftime("%Y%m%d")


def _rules():
    return yaml.safe_load(PACK.read_text())["rules"]


def test_pack_loads_with_full_metadata():
    rules = _rules()
    assert 40 <= len(rules) <= 115
    assert all(r["id"].startswith("PS") for r in rules)
    for r in rules:
        for k in META:
            assert r.get(k), (r["id"], k)


def test_every_field_exists_in_the_ddic():
    assert [u for u in unresolved() if u["file"].endswith("project_system.yaml")] == []


def _proj(pspnr="00000001", pspid="P-1000", **kw):
    d = {"PSPNR": pspnr, "PSPID": pspid, "POST1": "Plant upgrade", "VBUKR": "1000", "VKOKR": "1000",
         "PRCTR": "PC1", "VERNR": "10", "PWHIE": "ZAR", "PLFAZ": "20250101", "PLSEZ": "20251231", "LOEVM": ""}
    d.update(kw)
    return {f"PROJ.{k}": v for k, v in d.items()}


def _prps(pspnr, posid, up="", down="", **kw):
    d = {"PSPNR": pspnr, "POSID": posid, "POST1": "Element", "PSPHI": "00000001", "PBUKR": "1000", "PKOKR": "1000",
         "PRCTR": "PC1", "VERNR": "10", "FKSTL": "CC1", "STUFE": 2 if up else 1, "PLAKZ": "X", "BELKZ": "X",
         "FAKKZ": "", "LOEVM": "", "OBJNR": "PR" + pspnr}
    d.update(kw)
    return {f"PRPS.{k}": v for k, v in d.items()}


def _aufk(aufnr, **kw):
    d = {"AUFNR": aufnr, "AUART": "0100", "AUTYP": "01", "KTEXT": "Order " + aufnr, "BUKRS": "1000", "KOKRS": "1000",
         "PRCTR": "PC1", "KOSTV": "CC1", "PSPEL": "", "LOEKZ": "", "ASTKZ": "", "PHAS1": "X", "PHAS2": "", "PHAS3": "",
         "IDAT1": "20250101", "IDAT2": "", "IDAT3": "", "PDAT1": "", "PDAT2": "", "PDAT3": "", "STDAT": "20260101",
         "ERDAT": "20250101", "AEDAT": "20250301", "OBJNR": "OR" + aufnr}
    d.update(kw)
    return {f"AUFK.{k}": v for k, v in d.items()}


def _frames():
    proj = pd.DataFrame([_proj(), _proj("00000002", "P2000", VBUKR="9999", PLFAZ="20251231", PLSEZ="20250101")])
    prps = pd.DataFrame([
        _prps("00000010", "P-1000.1"),                            # clean root
        _prps("00000011", "P-1000.1.1", up="00000010"),           # clean child
        _prps("00000012", "P-1000.1.2", up="00000010", PKOKR="2000", PRCTR=""),   # PS024, PS026
    ])
    prhi = pd.DataFrame([
        {"PRHI.POSNR": "00000010", "PRHI.PSPHI": "00000001", "PRHI.UP": "", "PRHI.DOWN": "00000011"},
        {"PRHI.POSNR": "00000011", "PRHI.PSPHI": "00000001", "PRHI.UP": "00000010", "PRHI.DOWN": ""},
        {"PRHI.POSNR": "00000012", "PRHI.PSPHI": "00000001", "PRHI.UP": "00000099", "PRHI.DOWN": ""},  # PS037
    ])
    aufk = pd.DataFrame([
        _aufk("000000001001"),                                    # clean
        _aufk("000000001002", AUART="ZZZZ", KTEXT=""),            # PS046, PS048
        _aufk("000000001003", STDAT=OLD, PDAT2=STALE),            # PS068, PS069
        _aufk("000000001004", PHAS1="", PHAS3="X", IDAT3=""),     # PS065
        _aufk("000000001005", IDAT2="20240101", IDAT1="20250101", PHAS2="X", PHAS1=""),  # PS066
        _aufk("000000001006", ERDAT=FUTURE),                      # PS071
        _aufk("000000001007", PSPEL="00000099"),                  # PS058
    ])
    cobrb = pd.DataFrame([
        {"COBRB.OBJNR": "OR000000001001", "COBRB.LFDNR": "001", "COBRB.PERBZ": "PER", "COBRB.PROZS": 100,
         "COBRB.AUFNR": "", "COBRB.PS_PSP_PNR": "", "COBRB.KOKRS": "1000", "COBRB.KOSTL": "CC1"},
        {"COBRB.OBJNR": "ORX", "COBRB.LFDNR": "001", "COBRB.PERBZ": "", "COBRB.PROZS": 150,
         "COBRB.AUFNR": "", "COBRB.PS_PSP_PNR": "", "COBRB.KOKRS": "1000", "COBRB.KOSTL": "CC9"},
    ])
    cobra = pd.DataFrame([{"COBRA.OBJNR": "OR000000001001", "COBRA.APROF": "SETTLE"}])
    cfg = {
        "T001": pd.DataFrame({"T001.BUKRS": ["1000"]}),
        "TKA01": pd.DataFrame({"TKA01.KOKRS": ["1000"]}),
        "TKA02": pd.DataFrame({"TKA02.BUKRS": ["1000"], "TKA02.KOKRS": ["1000"]}),
        "CEPC": pd.DataFrame({"CEPC.KOKRS": ["1000"], "CEPC.PRCTR": ["PC1"]}),
        "CSKS": pd.DataFrame({"CSKS.KOKRS": ["1000"], "CSKS.KOSTL": ["CC1"]}),
        "TCJ04": pd.DataFrame({"TCJ04.VERNR": ["10"]}),
        "T003O": pd.DataFrame({"T003O.AUART": ["0100"], "T003O.AUTYP": ["01"]}),
    }
    return TableFrames({"PROJ": proj, "PRPS": prps, "PRHI": prhi, "AUFK": aufk, "COBRA": cobra, "COBRB": cobrb, **cfg},
                       module="project_system")


def test_dirty_records_fail_their_rules():
    by_id = {r.check_id: r for r in run_checks("project_system", _frames(), "t")}
    expected = {"PS006": 1, "PS012": 1, "PS024": 1, "PS026": 1, "PS037": 1, "PS046": 1, "PS048": 1, "PS058": 1, "PS065": 1,
                "PS066": 1, "PS068": 1, "PS069": 1, "PS071": 1, "PS076": 1, "PS077": 1}
    got = {k: by_id[k].affected_count for k in expected}
    assert got == expected
    for clean in ("PS001", "PS003", "PS004", "PS016", "PS019", "PS022", "PS045", "PS074"):
        assert by_id[clean].affected_count == 0, clean
