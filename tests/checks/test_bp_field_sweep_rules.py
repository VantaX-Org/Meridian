"""Business partner field-sweep rules (BP300+): each rule fires on its dirty row ("BAD") and passes the clean
one ("OK"). Synthetic data only. Uniqueness and count rules use dedicated clean and dirty frames."""

from datetime import date, timedelta

import pandas as pd
import pytest

from checks.frames import TableFrames
from checks.runner import module_rules, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")
M = "business_partner"

KEYS = {'BUT000': ['PARTNER'], 'BUT020': ['PARTNER', 'ADDRNUMBER'], 'BUT021_FS': ['PARTNER', 'ADDRNUMBER'], 'BUT0BK': ['PARTNER', 'BKVID'], 'BUT0ID': ['PARTNER', 'TYPE', 'IDNUMBER'], 'BUT050': ['RELNR', 'PARTNER1', 'PARTNER2'], 'DFKKBPTAXNUM': ['PARTNER', 'TAXTYPE'], 'ADRC': ['ADDRNUMBER'], 'ADR2': ['ADDRNUMBER', 'CONSNUMBER'], 'ADR6': ['ADDRNUMBER', 'CONSNUMBER'], 'CVI_CUST_LINK': ['PARTNER_GUID', 'CUSTOMER'], 'CVI_VEND_LINK': ['PARTNER_GUID', 'VENDOR']}


def _day(n: int) -> str:
    return (date.today() + timedelta(days=n)).strftime("%Y%m%d")


def _sub(v, n):
    return [_day(-30) if x == "__PAST__" else _day(30) if x == "__FUTURE__" else x for x in v]


def _tbl(table, cols, n):
    out = {k: [f"{k[:3]}{j}" for j in range(n)] for k in KEYS[table] if k not in cols}
    out.update({k: _sub(v, n) for k, v in cols.items()})
    return {table: pd.DataFrame({f"{table}.{k}": v for k, v in out.items()})}


def _multi(tables):
    return {t: pd.DataFrame({f"{t}.{k}": v for k, v in c.items()}) for t, c in tables.items()}


TWO = {'BP300': ('BUT000', {'NAME_ORG2': ['x', 'x'], 'NAME_ORG1': ['x', ''], 'TYPE': ['2', '2']}),
 'BP301': ('BUT000', {'NAME_ORG3': ['x', 'x'], 'NAME_ORG2': ['x', ''], 'TYPE': ['2', '2']}),
 'BP302': ('BUT000', {'NAME_ORG4': ['x', 'x'], 'NAME_ORG3': ['x', ''], 'TYPE': ['2', '2']}),
 'BP303': ('BUT000', {'NAME_LST2': ['x', 'x'], 'NAME_LAST': ['x', ''], 'TYPE': ['1', '1']}),
 'BP304': ('BUT000', {'NAMEMIDDLE': ['x', 'x'], 'NAME_FIRST': ['x', ''], 'TYPE': ['1', '1']}),
 'BP305': ('BUT000', {'INITIALS': ['x', 'x'], 'NAME_FIRST': ['x', ''], 'TYPE': ['1', '1']}),
 'BP306': ('BUT000', {'TITLE_ACA2': ['x', 'x'], 'TITLE_ACA1': ['x', '']}),
 'BP307': ('BUT000', {'PREFIX2': ['x', 'x'], 'PREFIX1': ['x', '']}),
 'BP308': ('BUT000', {'BU_SORT2': ['x', 'x'], 'BU_SORT1': ['x', '']}),
 'BP309': ('BUT000', {'TITLE_LET': ['x', 'x'], 'TITLE': ['x', '']}),
 'BP310': ('BUT000', {'NAME_GRP2': ['x', 'x'], 'NAME_GRP1': ['x', ''], 'TYPE': ['3', '3']}),
 'BP311': ('BUT000', {'TYPE': ['2', '2'], 'NAME_FIRST': ['', 'Jo']}),
 'BP312': ('BUT000', {'TYPE': ['1', '1'], 'NAME_ORG1': ['', 'Acme']}),
 'BP313': ('BUT000', {'TYPE': ['2', '2'], 'BIRTHPL': ['', 'Perth']}),
 'BP314': ('BUT000', {'TYPE': ['2', '2'], 'NOT_LG_COMPETENT': ['', 'X']}),
 'BP315': ('BUT000', {'NAME_ORG1': ['Acme', 'Acme'], 'NAME_LAST': ['', ''], 'MC_NAME1': ['ACME', '']}),
 'BP316': ('BUT000', {'NAME_FIRST': ['Jo', 'Jo'], 'MC_NAME2': ['JO', '']}),
 'BP317': ('BUT000', {'TYPE': ['1', '1'], 'NAME_LAST': ['Doe', 'Doe'], 'NAME1_TEXT': ['Doe', '']}),
 'BP318': ('BUT000', {'NAMEFORMAT': ['01', '01'], 'NAMCOUNTRY': ['ZA', '']}),
 'BP319': ('BUT000', {'NAMCOUNTRY': ['ZA', 'South Africa']}),
 'BP320': ('BUT000', {'LOCATION_1': ['6001234', '6001234'], 'LOCATION_2': ['56789', ''], 'LOCATION_3': ['1', '1']}),
 'BP321': ('BUT000', {'CRDAT': ['20240101', '20240101'], 'CRUSR': ['U1', '']}),
 'BP322': ('BUT000', {'CHDAT': ['20240101', '20240101'], 'CHUSR': ['U1', '']}),
 'BP323': ('BUT000', {'CRDAT': ['20240101', '20240601'], 'CHDAT': ['20240301', '20240301']}),
 'BP324': ('BUT020', {'NATION': ['I', 'Z']}),
 'BP325': ('BUT020', {'MOVE_ADDR': ['2', '2'], 'ADDR_MOVE_DATE': ['20240101120000', '']}),
 'BP326': ('BUT020', {'ADDR_MOVE_DATE': ['20240101120000', '20240101120000'], 'MOVE_ADDR': ['2', '']}),
 'BP327': ('BUT020', {'ADDRNUMBER': ['1', '2'], 'MOVE_ADDR': ['9', '2']}),
 'BP328': ('BUT020', {'ADDRESS_GUID': ['x', '']}),
 'BP331': ('BUT021_FS', {'ADR_KIND': ['SHIP_TO', 'ship to!']}),
 'BP332': ('BUT0BK', {'BKVID': ['0001', '00-1']}),
 'BP333': ('BUT0BK', {'ACCNAME': ['x', 'x'], 'KOINH': ['x', '']}),
 'BP334': ('BUT0BK', {'XEZER': ['X', 'X'], 'BANKN': ['123', ''], 'IBAN': ['', '']}),
 'BP335': ('BUT0BK', {'ACCOUNT_ID': ['A1', 'A1'], 'BANKN': ['123', ''], 'IBAN': ['', '']}),
 'BP336': ('BUT0BK', {'CHECK_DIGIT': ['12', 'A!']}),
 'BP337': ('BUT0BK', {'ACCOUNT_TYPE': ['01', 'a b']}),
 'BP338': ('BUT0BK', {'BKVID': ['0001', '0002'], 'MOVE_BKVID': ['0009', '0002']}),
 'BP339': ('BUT0BK', {'MOVE_BKVID': ['0002', '0002'], 'BK_MOVE_DATE': ['20240101120000', '']}),
 'BP340': ('BUT0BK', {'BK_MOVE_DATE': ['20240101120000', '20240101120000'], 'MOVE_BKVID': ['0002', '']}),
 'BP341': ('BUT0BK', {'BANK_GUID': ['x', '']}),
 'BP342': ('BUT0ID', {'IDNUMBER_GUID': ['x', '']}),
 'BP344': ('BUT050', {'CRDAT': ['20240101', '20240101'], 'CRUSR': ['U1', '']}),
 'BP345': ('BUT050', {'CRDAT': ['20240101', '20240601'], 'CHDAT': ['20240301', '20240301']}),
 'BP346': ('BUT050', {'RELKIND': ['ABCD', 'ab!']}),
 'BP347': ('DFKKBPTAXNUM', {'TAXNUM': ['123456789', '12345678901234567890'], 'TAXNUMXL': ['', '']}),
 'BP348': ('DFKKBPTAXNUM', {'TAXNUM': ['123/456-7', '123#456']}),
 'BP349': ('DFKKBPTAXNUM', {'TAXNUM': ['12345678', '12345678'], 'TAXNUMXL': ['123456789012', '99999999']}),
 'BP350': ('ADRC', {'NAME2': ['x', 'x'], 'NAME1': ['x', '']}),
 'BP351': ('ADRC', {'NAME1': ['Acme', 'Acme'], 'NAME2': ['Mining', 'acme']}),
 'BP352': ('ADRC', {'NAME4': ['x', 'x'], 'NAME3': ['x', '']}),
 'BP353': ('ADRC', {'CITY1': ['Perth', 'Perth'], 'CITY2': ['Northbridge', 'PERTH']}),
 'BP354': ('ADRC', {'STREETCODE': ['x', 'x'], 'CITY_CODE': ['x', '']}),
 'BP355': ('ADRC', {'CITYP_CODE': ['x', 'x'], 'CITY_CODE': ['x', '']}),
 'BP356': ('ADRC', {'POST_CODE2': ['6000', '6000'], 'PO_BOX': ['12', ''], 'PO_BOX_NUM': ['', '']}),
 'BP357': ('ADRC', {'PO_BOX': ['12', '12'], 'POST_CODE2': ['6000', ''], 'POST_CODE1': ['', '']}),
 'BP358': ('ADRC', {'PO_BOX_LOC': ['x', 'x'], 'PO_BOX': ['x', '']}),
 'BP359': ('ADRC', {'PO_BOX_REG': ['x', 'x'], 'PO_BOX_CTY': ['x', '']}),
 'BP360': ('ADRC', {'PO_BOX_NUM': ['X', 'X'], 'PO_BOX': ['', '12']}),
 'BP361': ('ADRC', {'DONT_USE_P': ['01', '01'], 'PO_BOX': ['12', '']}),
 'BP362': ('ADRC', {'DONT_USE_S': ['01', '01'], 'STREET': ['Main', '']}),
 'BP363': ('ADRC', {'STR_SUPPL2': ['x', 'x'], 'STR_SUPPL1': ['x', '']}),
 'BP364': ('ADRC', {'STR_SUPPL3': ['x', 'x'], 'STR_SUPPL2': ['x', '']}),
 'BP365': ('ADRC', {'ROOMNUMBER': ['4', '4'], 'FLOOR': ['', ''], 'STREET': ['Main', '']}),
 'BP366': ('ADRC', {'ADDR_GROUP': ['x', '']}),
 'BP367': ('ADRC', {'NAME1': ['Acme', 'Acme'], 'SORT1': ['ACME', '']}),
 'BP368': ('ADRC', {'SORT2': ['x', 'x'], 'SORT1': ['x', '']}),
 'BP369': ('ADRC', {'DEFLT_COMM': ['FAX', 'FAX'], 'FAX_NUMBER': ['0115551', '']}),
 'BP370': ('ADRC', {'DEFLT_COMM': ['TEL', 'TEL'], 'TEL_NUMBER': ['0115551', '']}),
 'BP371': ('ADRC', {'DEFLT_COMM': ['INT', 'INT'], 'FLAGCOMM6': ['X', '']}),
 'BP372': ('ADRC', {'TEL_EXTENS': ['x', 'x'], 'TEL_NUMBER': ['x', '']}),
 'BP373': ('ADRC', {'FAX_EXTENS': ['x', 'x'], 'FAX_NUMBER': ['x', '']}),
 'BP374': ('ADRC', {'FAX_NUMBER': ['+27 11 555', '011 call me']}),
 'BP375': ('ADRC', {'NAME1': ['Acme', 'Acme'], 'MC_NAME1': ['ACME', '']}),
 'BP376': ('ADRC', {'CITY1': ['Acme', 'Acme'], 'MC_CITY1': ['ACME', '']}),
 'BP377': ('ADRC', {'STREET': ['Acme', 'Acme'], 'MC_STREET': ['ACME', '']}),
 'BP378': ('ADRC', {'TIME_ZONE': ['x', '']}),
 'BP379': ('ADRC', {'COUNTRY': ['US', 'US'], 'TAXJURCODE': ['TX1234', '']}),
 'BP380': ('ADRC', {'ADRC_ERR_STATUS': ['', 'E']}),
 'BP381': ('ADRC', {'COUNTY_CODE': ['x', 'x'], 'COUNTY': ['x', '']}),
 'BP382': ('ADRC', {'TOWNSHIP_CODE': ['x', 'x'], 'TOWNSHIP': ['x', '']}),
 'BP383': ('ADRC', {'DELI_SERV_TYPE': ['PB', 'PB'], 'DELI_SERV_NUMBER': ['12', '']}),
 'BP384': ('ADRC', {'EXTENSION1': ['', 'x'], 'EXTENSION2': ['', '']}),
 'BP385': ('ADRC', {'DATE_FROM': ['20240101', '20240601'], 'DATE_TO': ['20241231', '20240101']}),
 'BP386': ('ADR2', {'TEL_EXTENS': ['x', 'x'], 'TEL_NUMBER': ['x', '']}),
 'BP387': ('ADR2', {'TEL_NUMBER': ['011555', '011555'], 'TELNR_LONG': ['+2711555', '']}),
 'BP388': ('ADR2', {'DFT_RECEIV': ['X', 'X'], 'FLG_NOUSE': ['', 'X']}),
 'BP389': ('ADR2', {'HOME_FLAG': ['X', 'X'], 'PERSNUMBER': ['0001', '']}),
 'BP390': ('ADR2',
           {'VALID_FROM': ['20240101000000', '20240601000000'], 'VALID_TO': ['20241231000000', '20240101000000']}),
 'BP391': ('ADR6', {'SMTP_ADDR': ['a@x.org', 'a@x.org'], 'SMTP_SRCH': ['A@X.ORG', '']}),
 'BP392': ('ADR6', {'DFT_RECEIV': ['X', 'X'], 'FLG_NOUSE': ['', 'X']}),
 'BP393': ('ADR6', {'HOME_FLAG': ['X', 'X'], 'PERSNUMBER': ['0001', '']}),
 'BP394': ('ADR6',
           {'VALID_FROM': ['20240101000000', '20240601000000'], 'VALID_TO': ['20241231000000', '20240101000000']}),
 'BP395': ('CVI_CUST_LINK', {'CRDAT': ['20240101', '20240101'], 'CRUSER': ['U1', '']}),
 'BP396': ('CVI_CUST_LINK', {'CRDAT': ['__PAST__', '__FUTURE__']}),
 'BP398': ('CVI_VEND_LINK', {'CRDAT': ['20240101', '20240101'], 'CRUSER': ['U1', '']}),
 'BP399': ('CVI_VEND_LINK', {'CRDAT': ['__PAST__', '__FUTURE__']})}


PAIR = {'BP329': ('BUT020', {'ADEXT': ['A1', 'A2']}, {'ADEXT': ['A1', 'A1']})}


COUNT = {'BP330': ('BUT021_FS',
           {'PARTNER': ['P1', 'P1', 'P1', 'P1'],
            'ADR_KIND': ['XXDEFAULT', 'XXDEFAULT', 'XXDEFAULT', 'XXDEFAULT'],
            'VALID_TO': ['99991231235959', '99991231235959', '99991231235959', '99991231235959'],
            'XDFADU': ['X', 'X', 'X', '']},
           4),
 'BP343': ('BUT050',
           {'PARTNER1': ['P1', 'P1', 'P1'], 'RELTYP': ['BUR001', 'BUR001', 'BUR001'], 'XDFREL': ['X', 'X', '']},
           3)}


MULTI = {'BP397': {'BUT000': {'PARTNER': ['B1', 'B2'],
                      'PARTNER_GUID': ['G1', 'G2'],
                      'TYPE': ['2', '2'],
                      'NAME_ORG1': ['Acme', 'Acme']},
           'KNA1': {'KUNNR': ['C1', 'C2'], 'NAME1': ['ACME', 'Other']},
           'CVI_CUST_LINK': {'PARTNER_GUID': ['G1', 'G2'], 'CUSTOMER': ['C1', 'C2']}},
 'BP400': {'BUT000': {'PARTNER': ['B1', 'B2'],
                      'PARTNER_GUID': ['G1', 'G2'],
                      'TYPE': ['2', '2'],
                      'NAME_ORG1': ['Acme', 'Acme']},
           'LFA1': {'LIFNR': ['C1', 'C2'], 'NAME1': ['ACME', 'Other']},
           'CVI_VEND_LINK': {'PARTNER_GUID': ['G1', 'G2'], 'VENDOR': ['C1', 'C2']}},
 'BP401': {'BUT000': {'PARTNER': ['B1', 'B2'], 'PARTNER_GUID': ['G1', 'G2'], 'BU_SORT1': ['ACME', 'ACME']},
           'KNA1': {'KUNNR': ['C1', 'C2'], 'SORTL': ['ACME', '']},
           'CVI_CUST_LINK': {'PARTNER_GUID': ['G1', 'G2'], 'CUSTOMER': ['C1', 'C2']}}}


def _run(rid, frames):
    rule = next(r for r in module_rules(M) if r["id"] == rid)
    _, res = run_rule(rule, TableFrames(frames, D, module=M))
    assert res.error is None, res.error
    return res


@pytest.mark.parametrize("rid", list(TWO))
def test_rule_fires_on_dirty_and_passes_clean(rid):
    table, cols = TWO[rid]
    res = _run(rid, _tbl(table, cols, 2))
    assert res.affected_count == 1, (res.total_count, res.affected_count)


@pytest.mark.parametrize("rid", list(MULTI))
def test_cvi_rule_fires_on_dirty_and_passes_clean(rid):
    res = _run(rid, _multi(MULTI[rid]))
    assert res.affected_count == 1, (res.total_count, res.affected_count)


@pytest.mark.parametrize("rid", list(PAIR))
def test_uniqueness_rule_passes_clean_and_fires_on_duplicate(rid):
    table, ok, bad = PAIR[rid]
    assert _run(rid, _tbl(table, ok, 2)).affected_count == 0
    assert _run(rid, _tbl(table, bad, 2)).affected_count >= 1


@pytest.mark.parametrize("rid", list(COUNT))
def test_count_rule_fires_only_over_the_limit(rid):
    table, cols, n = COUNT[rid]
    flag = next(iter(c for c in cols if c.startswith("XDF")))
    bad = _run(rid, _tbl(table, cols, n))
    assert bad.affected_count >= 1
    ok_cols = {**cols, flag: ["X"] + [""] * (n - 1)}
    assert _run(rid, _tbl(table, ok_cols, n)).affected_count == 0


def test_every_new_rule_has_a_case():
    ids = {r["id"] for r in module_rules(M) if r["id"][2:].isdigit() and 300 <= int(r["id"][2:]) < 900}
    assert ids == set(TWO) | set(MULTI) | set(PAIR) | set(COUNT)
