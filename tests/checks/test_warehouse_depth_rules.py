"""Warehouse depth rules: each fires on its dirty record ("BAD") and passes the
clean one ("OK") — population 2, exactly one failure, keyed on the dirty record."""

from datetime import date, timedelta

import pandas as pd
import pytest

from checks.frames import TableFrames
from checks.runner import run_checks
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def _day(n: int) -> str:
    return (date.today() - timedelta(days=n)).strftime("%Y%m%d")


def _f(table: str, **cols) -> pd.DataFrame:
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


LAGP = dict(LGNUM=["100", "100"], LGTYP=["001", "001"], LGPLA=["OK", "BAD"])
LQUA = dict(LGNUM=["100", "100"], LQNUM=["OK", "BAD"], MATNR=["M1", "M2"], WERKS=["1000", "1000"],
            LGTYP=["001", "001"], LGPLA=["OK", "OK"])
MCH1 = dict(MATNR=["M1", "M1"], CHARG=["OK", "BAD"])
MCHB = dict(MATNR=["M1", "M1"], WERKS=["1000", "1000"], LGORT=["0001", "0001"], CHARG=["OK", "BAD"])
LTAK = dict(LGNUM=["100", "100"], TANUM=["OK", "BAD"])
VTTK = dict(TKNUM=["OK", "BAD"])
EQUI = dict(EQUNR=["OK", "BAD"], S_FLEET=["X", "X"])
EQUZ = dict(EQUNR=["OK", "BAD"], DATBI=["99991231", "99991231"], EQLFN=["001", "001"], ILOAN=["L1", "L2"])

CASES = {
    "EWMS044": ("ewms_stock", {"LQUA": _f("LQUA", **LQUA, GESME=["-5", "-5"]).assign(**{"LQUA.LGTYP": ["999", "001"]})}),
    "EWMS045": ("ewms_stock", {"LAGP": _f("LAGP", **LAGP, SKZUA=["X", "X"], SKZUE=["", ""], SPGRU=["1", ""])}),
    "EWMS046": ("ewms_stock", {"LAGP": _f("LAGP", **LAGP, ANZQU=["2", "3"], MAXQU=["2", "2"])}),
    "EWMS047": ("ewms_stock", {"LAGP": _f("LAGP", **LAGP, ANZLE=["1", "4"], MAXLE=["2", "2"])}),
    "EWMS048": ("ewms_stock", {"LAGP": _f("LAGP", **LAGP, MGEWI=["900", "1200"], LGEWI=["1000", "1000"])}),
    "EWMS049": ("ewms_stock", {"LQUA": _f("LQUA", **LQUA, GESME=["5", "5"], VFDAT=[_day(-30), _day(3)])}),
    "EWMS050": ("ewms_stock", {"LQUA": _f("LQUA", **LQUA, GESME=["5", "5"]),
                               "MARC": _f("MARC", MATNR=["M1", "M2"], WERKS=["1000", "1000"], LVORM=["", "X"])}),
    "EWTO033": ("ewms_transfer_orders", {"LTAK": _f("LTAK", **LTAK, KQUIT=["", ""], BETYP=["L", "L"],
                                                   BDATU=[_day(2), _day(10)])}),
    "EWTO034": ("ewms_transfer_orders", {"LTAP": _f("LTAP", LGNUM=["100", "100"], TANUM=["T1", "T1"],
                                                   TAPOS=["OK", "BAD"], WERKS=["1000", ""])}),
    "BATCH020": ("batch_management", {"MCH1": _f("MCH1", **MCH1, CUOBJ_BM=["000000000000000001", ""]),
                                      "MARA": _f("MARA", MATNR=["M1"], MHDHB=["365"])}),
    "BATCH021": ("batch_management", {"MCH1": _f("MCH1", **MCH1, VFDAT=["20270101", "20260101"],
                                                 LWEDT=["20260601", "20260601"])}),
    "BATCH022": ("batch_management", {"MCH1": _f("MCH1", **MCH1, HSDAT=["20260101", "20260101"],
                                                 VFDAT=["20261231", "20270601"]),
                                      "MARA": _f("MARA", MATNR=["M1"], MHDHB=["365"], IPRKZ=[""])}),
    "BATCH023": ("batch_management", {"MCHB": _f("MCHB", **MCHB, CLABS=["10", "-3"])}),
    "BATCH024": ("batch_management", {"MCHB": _f("MCHB", **MCHB, CLABS=["10", "10"]),
                                      "MCHA": _f("MCHA", MATNR=["M1", "M1"], WERKS=["1000", "1000"], CHARG=["OK", "BAD"]),
                                      "MCH1": _f("MCH1", **MCH1, QNDAT=[_day(-30), _day(5)])}),
    "TM035": ("transport_management", {"VTTK": _f("VTTK", **VTTK, STTRG=["4", "4"]),
                                       "VTTP": _f("VTTP", TKNUM=["OK"], TPNUM=["0001"], VBELN=["80000001"])}),
    "TM036": ("transport_management", {"VTTP": _f("VTTP", TKNUM=["S1", "S1"], TPNUM=["OK", "BAD"],
                                                  VBELN=["80000001", "80000002"]),
                                       "LIKP": _f("LIKP", VBELN=["80000001"])}),
    "TM037": ("transport_management", {"VTTK": _f("VTTK", **VTTK, TDLNR=["CARRIER1", "CARRIER2"]),
                                       "LFA1": _f("LFA1", LIFNR=["CARRIER1", "CARRIER2"], LOEVM=["", "X"])}),
    "FLEET033": ("fleet_management", {"EQUI": _f("EQUI", **EQUI), "EQUZ": _f("EQUZ", **EQUZ, IWERK=["1000", ""])}),
    "FLEET034": ("fleet_management", {"EQUI": _f("EQUI", **EQUI), "EQUZ": _f("EQUZ", **EQUZ),
                                      "ILOA": _f("ILOA", ILOAN=["L1", "L2"], TPLNR=["DEPOT-01", ""])}),
    "FLEET035": ("fleet_management", {"EQUI": _f("EQUI", **EQUI, IMRC_POINT=["P1", "P9"]),
                                      "IMPTT": _f("IMPTT", POINT=["P1"])}),
    "GRC024": ("grc_compliance", {"GRACUSERROLE": _f("GRACUSERROLE", USERROLEID=["OK", "BAD"],
                                                     VALID_TO=[_day(30) + "235959", _day(400) + "235959"])}),
    "GRC025": ("grc_compliance", {"GRACROLE": _f("GRACROLE", ROLEID=["OK", "BAD"], LOCKED=["", ""],
                                                 REAFFIRM_DUE=[_day(-30), _day(5)])}),
    "GRC026": ("grc_compliance", {"GRACSODRISK": _f("GRACSODRISK", RISKID=["OK", "BAD"], RISKLEVEL=["3", "3"],
                                                    ACTIVE=["X", ""])}),
    "MDG026": ("mdg_master_data", {"USMD120C": _f("USMD120C", USMD_CREQUEST=["OK", "BAD"],
                                                  USMD_CREQ_STATUS=["06", "06"], USMD_REASON_REJ=["01", ""])}),
    "WMI023": ("wm_interface", {"MLGT": _f("MLGT", MATNR=["M1", "M2"], LGNUM=["100", "100"], LGTYP=["OK", "BAD"],
                                           NSMNG=["50", "150"], LPMAX=["100", "100"])}),
    "XSYS026": ("cross_system_integration", {"XSYS": _f("XSYS", SOURCE_SYSTEM=["OK", "BAD"],
                                                        OBJECT_TYPE=["MATERIAL", "MATERIAL"], OBJECT_KEY=["M1", ""])}),
    "XSYS027": ("cross_system_integration", {"XSYS": _f("XSYS", SOURCE_SYSTEM=["S1", ""],
                                                        OBJECT_TYPE=["MATERIAL", "MATERIAL"], OBJECT_KEY=["OK", "BAD"])}),
}


@pytest.mark.parametrize("check_id", list(CASES))
def test_rule_fires_on_dirty_and_passes_clean(check_id):
    module, frames = CASES[check_id]
    results = run_checks(module, TableFrames(frames, D, module=module), "t")
    res = next((r for r in results if r.check_id == check_id), None)
    assert res is not None, f"{check_id} did not run"
    assert res.error is None, res.error
    assert (res.total_count, res.affected_count) == (2, 1), (res.total_count, res.affected_count)
    assert "BAD" in res.failing_record_keys[0], res.failing_record_keys
