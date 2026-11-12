"""Customer master field-sweep rules (SDCM863+): each fires on its dirty row ("BAD")
and passes the clean one ("OK") — population 2, exactly one failure. The ADRC
postal-code rules are checked against the KNA1.PSTLZ rule they mirror."""

from datetime import date, timedelta

import pandas as pd
import pytest

from checks.frames import TableFrames
from checks.runner import module_rules, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")
M = "sd_customer_master"


def _day(n: int) -> str:
    return (date.today() + timedelta(days=n)).strftime("%Y%m%d")


def _f(table: str, **cols) -> pd.DataFrame:
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def kna1(**c):
    return {"KNA1": _f("KNA1", KUNNR=["OK", "BAD"], **c)}


def keyed(t, keys, **c):
    return {t: _f(t, **keys, **c)}


KNB1 = {"KUNNR": ["OK", "BAD"], "BUKRS": ["1000", "1000"]}
KNVV = {"KUNNR": ["OK", "BAD"], "VKORG": ["1000"] * 2, "VTWEG": ["10"] * 2, "SPART": ["00"] * 2}
KNKK = {"KUNNR": ["OK", "BAD"], "KKBER": ["1000", "1000"]}
ADRC = {"ADDRNUMBER": ["OK", "BAD"]}
COMM = {"ADDRNUMBER": ["OK", "BAD"], "CONSNUMBER": ["001", "001"]}

CASES = {
    "SDCM863": kna1(ADRNR=["0000001", ""]),
    "SDCM864": kna1(LAND1=["DE", "DE"], STKZU=["X", "X"], STCEG=["DE123456789", ""]),
    "SDCM865": kna1(LAND1=["ES", "DE"], STKZA=["X", "X"]),
    "SDCM866": kna1(BBBNR=["4012345", "4012345"], BBSNR=["00001", "00000"]),
    "SDCM867": kna1(BBSNR=["00001", "00001"], BBBNR=["4012345", "0000000"]),
    "SDCM868": kna1(UMSAT=["100", "-5"]),
    "SDCM869": kna1(UMSAT=["100", "100"], UMJAH=["2025", "0000"]),
    "SDCM870": kna1(STCD1=["A1", "A1"], STCD3=["B2", "A1"]),
    "SDCM871": kna1(STCD2=["A1", "A1"], STCD4=["B2", "A1"]),
    "SDCM872": kna1(NAME1=["Acme", "Acme"], NAME3=["Mining", "Acme"]),
    "SDCM873": kna1(NAME1=["Acme", "Acme"], NAME4=["Mining", "Acme"]),
    "SDCM874": kna1(LAND1=["BR", "ZA"], XICMS=["X", "X"]),
    "SDCM875": kna1(LAND1=["BR", "ZA"], XXIPI=["X", "X"]),
    "SDCM876": kna1(LAND1=["BR", "ZA"], SUFRAMA=["123456789", "123456789"]),
    "SDCM877": kna1(LAND1=["BR", "BR"], SUFRAMA=["12345678", "12A45"]),
    "SDCM878": kna1(RG=["1", "1"], RGDATE=[_day(-10), _day(10)]),
    "SDCM879": kna1(RG=["1", "1"], RGDATE=[_day(-10), ""]),
    "SDCM880": kna1(LAND1=["BR", "ZA"], RG=["1", "1"]),
    "SDCM881": kna1(RNE=["1", "1"], RNEDATE=[_day(-10), _day(10)]),
    "SDCM882": kna1(RNE=["1", "1"], RNEDATE=[_day(-10), ""]),
    "SDCM883": kna1(LAND1=["BR", "ZA"], RNE=["1", "1"]),
    "SDCM884": kna1(LAND1=["KR", "ZA"], J_1KFREPRE=["Kim", "Kim"]),
    "SDCM885": kna1(INSPBYDEBI=["X", "X"], INSPATDEBI=["", "X"]),
    "SDCM886": kna1(**{"/VSO/R_PALHGT": ["1.2", "-1"]}),
    "SDCM887": keyed("KNB1", KNB1, VRSZL=["2", "-1"]),
    "SDCM888": keyed("KNB1", KNB1, KULTG=["2", "-1"]),
    "SDCM889": keyed("KNVV", KNVV, UNTTO=["10", "150"]),
    "SDCM890": keyed("KNVV", KNVV, KVAWT=["10", "-1"]),
    "SDCM891": keyed("KNKK", KNKK, NXTRV=[_day(30), _day(-30)]),
    "SDCM892": keyed("KNKK", KNKK, DBMON=[_day(-30), _day(30)]),
    "SDCM893": keyed("KNKK", KNKK, SAUFT=["10", "-1"]),
    "SDCM894": keyed("KNKK", KNKK, SKFOR=["10", "-1"]),
    "SDCM895": keyed("KNKK", KNKK, SSOBL=["10", "-1"]),
    "SDCM896": keyed("KNKK", KNKK, ABSBT=["10", "-1"]),
    "SDCM927": keyed("ADRC", ADRC, NAME1=["Acme", "Acme"], MC_NAME1=["ACME", ""]),
    "SDCM928": keyed("ADRC", ADRC, CITY1=["Perth", "Perth"], MC_CITY1=["PERTH", ""]),
    "SDCM929": keyed("ADRC", ADRC, STREET=["Main", "Main"], MC_STREET=["MAIN", ""]),
    "SDCM930": keyed("ADRC", ADRC, HOUSE_NUM1=["5", "5"], HOUSE_NUM2=["A", "5"]),
    "SDCM931": keyed("ADRC", ADRC, STREET=["Main", "Main"], STR_SUPPL1=["Unit 2", "Main"]),
    "SDCM932": keyed("ADRC", ADRC, NAME1=["Acme", "Acme"], NAME_CO=["J Smith", "Acme"]),
    "SDCM933": keyed("ADRC", ADRC, NAME1=["Acme", "Acme"], NAME3=["Mining", "Acme"]),
    "SDCM934": keyed("ADR2", COMM, TEL_NUMBER=["011 555", "011 555"], TELNR_CALL=["011555", ""]),
    "SDCM935": keyed("ADR3", COMM, FAX_NUMBER=["011 555", "011 555"], FAXNR_CALL=["011555", ""]),
    "SDCM936": keyed("ADR2", COMM, FLGDEFAULT=["X", "X"], FLG_NOUSE=["", "X"]),
    "SDCM937": keyed("ADR6", COMM, FLGDEFAULT=["X", "X"], FLG_NOUSE=["", "X"]),
    "SDCM938": keyed("KNBK", {"KUNNR": ["OK", "BAD"], "BANKS": ["ZA"] * 2, "BANKL": ["250655"] * 2},
                     BANKN=["123", "456"], KOINH=["Acme", ""]),
}


@pytest.mark.parametrize("check_id", list(CASES))
def test_rule_fires_on_dirty_and_passes_clean(check_id):
    rule = {**next(r for r in module_rules(M) if r["id"] == check_id), "module": M}
    _, res = run_rule(rule, TableFrames(CASES[check_id], D, module=M))
    assert res.error is None, res.error
    assert res.affected_count == 1, (res.total_count, res.affected_count)


def test_central_address_without_postcode():
    rule = {**next(r for r in module_rules(M) if r["id"] == "SDCM926"),
            "module": M}
    frames = keyed("ADRC", {"ADDRNUMBER": ["OK", "BAD", "AE"]}, COUNTRY=["DE", "DE", "AE"],
                   CITY1=["Berlin", "Berlin", "Dubai"], POST_CODE1=["10115", "", ""])
    _, res = run_rule(rule, TableFrames(frames, D, module=M))
    assert res.error is None, res.error
    assert res.affected_count == 1


SAMPLES = ["12345", "1234", "123456", "1234567", "12345-6789", "123-4567", "12-345", "123 45", "1234 AB",
           "SW1A 1AA", "K1A 0B1", "A1234BCD", "AB12", "9490", "LV-1050", "LT-01100", "AD100", "!!", "0123"]


def _pairs():
    rules = module_rules(M)
    src = [r for r in rules if r.get("field") == "KNA1.PSTLZ" and "applies_when" in r]
    dst = [r for r in rules if r.get("field") == "ADRC.POST_CODE1" and r.get("grain") == "ADRC"
           and "applies_when" in r]
    assert len(src) == len(dst) == 29
    return list(zip(src, dst))


@pytest.mark.parametrize("pair", _pairs(), ids=lambda p: p[1]["id"])
def test_adrc_postcode_mirrors_kna1(pair):
    src, dst = pair
    land = src["applies_when"]["KNA1.LAND1"][0]
    n = len(SAMPLES)
    k = {"KNA1": _f("KNA1", KUNNR=[str(i) for i in range(n)], LAND1=[land] * n, PSTLZ=SAMPLES)}
    a = {"ADRC": _f("ADRC", ADDRNUMBER=[str(i) for i in range(n)], COUNTRY=[land] * n, POST_CODE1=SAMPLES)}
    _, rk = run_rule({**src, "module": M}, TableFrames(k, D, module=M))
    _, ra = run_rule({**dst, "module": M}, TableFrames(a, D, module=M))
    assert rk.error is None and ra.error is None, (rk.error, ra.error)
    assert ra.affected_count == rk.affected_count
    assert ra.total_count == rk.total_count
