"""Golden dataset: the whole business-partner pipeline (shipped + generated rules,
active population, BUT000 → BUT020 → ADRC/ADR6 joins, live configuration) on
partners whose correct findings are known. Clean partners must produce no finding
at all — any failure on them is a false positive; each seeded defect must be found
exactly where it was put."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")

# PARTNER, TYPE, BU_GROUP, TITLE, NAME_ORG1, NAME_ORG2, NAME_FIRST, NAME_LAST, BU_SORT1, BU_SORT2,
# LANGU_CORR, NATIO, NATPERS, XDELE, XBLCK, CRDAT, CHDAT, PARTNER_GUID
PARTNERS = [
    # clean
    ("0001000012", "2", "0001", "0003", "Karoo Industrial Supplies (Pty) Ltd", "", "", "", "KAROO", "SANDTON",
     "E", "", "", "", "", "20190412", "20240220", "005056A1B2C31EDB9FA3E8D4C7A1B2F0"),
    ("0001000013", "2", "0001", "0003", "Rheinwerk Antriebstechnik GmbH", "", "", "", "RHEINWERK", "KOELN",
     "D", "", "", "", "", "20200115", "00000000", "005056A1B2C31EDB9FA3E8D4C7A1C401"),
    ("0001000014", "1", "0001", "0001", "", "", "Thandiwe", "Mokoena", "MOKOENA", "CAPE TOWN",
     "E", "ZA", "X", "", "", "20210708", "20230911", "005056A1B2C31EDB9FA3E8D4C7A1D512"),
    ("0001000015", "2", "0001", "0003", "Van der Berg Logistiek B.V.", "", "", "", "VANDERBERG", "ROTTERDAM",
     "N", "", "", "", "", "20200302", "20250114", "005056A1B2C31EDB9FA3E8D4C7A1E623"),
    ("0001000016", "2", "0001", "0003", "Lakeshore Instruments Inc.", "", "", "", "LAKESHORE", "CHICAGO",
     "E", "", "", "", "", "20220519", "00000000", "005056A1B2C31EDB9FA3E8D4C7A1F734"),
    # clean: Dubai has no postal codes (T005 AE: no postal code, none required)
    ("0001000017", "2", "0001", "0003", "Gulf Marine Trading LLC", "", "", "", "GULFMARINE", "DUBAI",
     "E", "", "", "", "", "20230227", "00000000", "005056A1B2C31EDB9FA3E8D4C7A20845"),
    # clean: marked in text and centrally blocked (consistent)
    ("0001000018", "2", "0001", "0003", "Highveld Packaging (Pty) Ltd", "", "", "", "HIGHVELD", "DO NOT USE",
     "E", "", "", "", "X", "20180911", "20250602", "005056A1B2C31EDB9FA3E8D4C7A21956"),
    # defects
    ("0001000019", "2", "0001", "0003", "Rheinwerk Antriebstechnik", "", "", "", "RHEINWERK", "KOELN",
     "D", "", "", "", "", "20240819", "00000000", "005056A1B2C31EDB9FA3E8D4C7A22A67"),   # XDUP006 with ...13
    ("0001000020", "2", "0001", "0003", "Mopani Engineering CC", "", "", "", "MOPANI", "POLOKWANE",
     "E", "", "", "", "", "20210114", "00000000", "005056A1B2C31EDB9FA3E8D4C7A23B78"),   # BP017 no e-mail
    ("0001000021", "1", "0001", "MR", "", "", "Pieter", "Botha", "BOTHA", "STELLENBOSCH",
     "E", "ZA", "X", "", "", "20220301", "00000000", "005056A1B2C31EDB9FA3E8D4C7A24C89"),  # BP009 'MR'
    ("0001000022", "2", "0001", "0003", "Sedibeng Freight (Pty) Ltd", "", "", "", "SEDIBENG", "VEREENIGING",
     "E", "", "", "", "", "20230605", "00000000", "005056A1B2C31EDB9FA3E8D4C7A25D9A"),   # BP024 role dates
    ("0001000023", "2", "0001", "0003", "Umgeni Paper Mills (Pty) Ltd", "accounts@umgenipaper.co.za", "", "",
     "UMGENI", "DURBAN", "E", "", "", "", "", "20200910", "00000000",
     "005056A1B2C31EDB9FA3E8D4C7A26EAB"),                                                 # VP-BUT000-NAME_ORG2
    ("0001000024", "2", "0001", "0003", "Obsidian Mining Supplies (Pty) Ltd", "", "", "", "OBSIDIAN", "OBSOLETE",
     "E", "", "", "", "", "20170420", "20220810", "005056A1B2C31EDB9FA3E8D4C7A27FBC"),   # ST-BUT000
    ("0001000025", "2", "0001", "0003", "Kalahari Agri Co-operative Ltd", "", "", "", "KALAHARI", "UPINGTON",
     "E", "", "", "", "", "20210929", "00000000", "005056A1B2C31EDB9FA3E8D4C7A280CD"),   # PH-ADRC-TEL_NUMBER
    ("0001000026", "2", "0001", "0003", "Tshwane Office Furniture (Pty) Ltd", "", "", "", "TSHWANEOFF", "PRETORIA",
     "E", "", "", "", "", "20220117", "00000000", "005056A1B2C31EDB9FA3E8D4C7A291DE"),   # BP018 e-mail
    # population: flagged for archiving — no e-mail, no search term any more
    ("0001000027", "2", "0001", "0003", "Bushveld Timber Traders", "", "", "", "", "",
     "E", "", "", "X", "", "20110303", "20190128", "005056A1B2C31EDB9FA3E8D4C7A2A2EF"),
]
# PARTNER → (ADDRNUMBER, STREET, HOUSE_NUM1, POST_CODE1, CITY1, COUNTRY, REGION, LANGU, TEL_NUMBER, SMTP_ADDR)
ADDRESSES = {
    "0001000012": ("0000045101", "Rivonia Road", "155", "2196", "Sandton", "ZA", "GP", "E", "011 555 0142",
                   "accounts@karoo-industrial.co.za"),
    "0001000013": ("0000045102", "Industriestraße", "14", "50829", "Köln", "DE", "05", "D", "0221 5550314",
                   "einkauf@rheinwerk-antriebe.de"),
    "0001000014": ("0000045103", "Bree Street", "88", "8001", "Cape Town", "ZA", "WC", "E", "021 555 0177",
                   "thandiwe.mokoena@outlook.com"),
    "0001000015": ("0000045104", "Waalhaven Zuidzijde", "21", "3089 JH", "Rotterdam", "NL", "", "N",
                   "010 555 2190", "crediteuren@vdberg-logistiek.nl"),
    "0001000016": ("0000045105", "W Wacker Dr", "233", "60606", "Chicago", "US", "IL", "E", "312 555 0187",
                   "ap@lakeshore-instruments.com"),
    "0001000017": ("0000045106", "Al Khaleej Street", "17", "", "Dubai", "AE", "", "E", "04 555 0123",
                   "finance@gulfmarine.ae"),
    "0001000018": ("0000045107", "Main Reef Road", "300", "1709", "Roodepoort", "ZA", "GP", "E", "011 555 0168",
                   "orders@highveldpack.co.za"),
    "0001000019": ("0000045108", "Industriestraße", "14", "50829", "Köln", "DE", "05", "D", "0221 5550314",
                   "einkauf@rheinwerk-antriebe.de"),
    "0001000020": ("0000045109", "Grobler Street", "42", "0699", "Polokwane", "ZA", "LP", "E", "015 555 0133",
                   None),
    "0001000021": ("0000045110", "Dorp Street", "7", "7600", "Stellenbosch", "ZA", "WC", "E", "021 555 0101",
                   "pieter.botha@sun-wine.co.za"),
    "0001000022": ("0000045111", "General Hertzog Road", "19", "1939", "Vereeniging", "ZA", "GP", "E",
                   "016 555 0145", "ops@sedibengfreight.co.za"),
    "0001000023": ("0000045112", "Umgeni Road", "250", "4001", "Durban", "ZA", "KZN", "E", "031 555 0119",
                   "accounts@umgenipaper.co.za"),
    "0001000024": ("0000045113", "Voortrekker Road", "61", "0250", "Brits", "ZA", "NW", "E", "012 555 0175",
                   "sales@obsidianmining.co.za"),
    "0001000025": ("0000045114", "Schröder Street", "5", "8801", "Upington", "ZA", "NC", "E", "0000000000",
                   "admin@kalahari-agri.co.za"),
    "0001000026": ("0000045115", "Church Street", "380", "0002", "Pretoria", "ZA", "GP", "E", "012 555 0190",
                   "accounts@tshwane-office,co.za"),
    "0001000027": ("0000045116", "Market Street", "9", "0700", "Polokwane", "ZA", "LP", "E", "015 555 0110",
                   None),
}
# BP roles: (PARTNER, RLTYP, VALID_FROM, VALID_TO) — role validity is a UTC timestamp (DEC 15)
OPEN = "99991231235959"
ROLES = [(p[0], r, p[15] + "090000", OPEN) for p in PARTNERS for r in ("000000", "FLCU00", "FLCU01")
         if p[0] != "0001000022"] + [
    ("0001000022", "000000", "20230605090000", OPEN),
    ("0001000022", "FLVN00", "20250101000000", "20241231235959"),  # defect: role ends before it starts
]
TAX = [  # EU VAT registration numbers (DE0 / NL0); ...19 is a second BP for the same German company
    ("0001000013", "DE0", "DE814563217"),
    ("0001000015", "NL0", "NL853746392B01"),
    ("0001000019", "DE0", "DE814563217"),
]


# BP bank details: (PARTNER, BKVID, BANKS, BANKL, BANKN, IBAN, BK_VALID_FROM, BK_VALID_TO)
BANKS = [
    ("0001000012", "0001", "ZA", "250655", "62012345678", "", "20190412000000", OPEN),        # no IBAN in ZA
    ("0001000013", "0001", "DE", "37040044", "0532013000", "DE89370400440532013000", "20200115000000", OPEN),
    ("0001000015", "0001", "NL", "ABNA", "0417164300", "NL91ABNA0417164300", "20200302000000", OPEN),
    ("0001000020", "0001", "ZA", "632005", "4055512345", "", "20250101000000", "20241231235959"),  # ends first
    ("0001000021", "0001", "DE", "37040044", "0532013001", "DE89370400440532013001", "20220301000000", OPEN),
]                                                                       # ...21: IBAN check digits do not match


def _frames() -> TableFrames:
    cols = ["PARTNER", "TYPE", "BU_GROUP", "TITLE", "NAME_ORG1", "NAME_ORG2", "NAME_FIRST", "NAME_LAST",
            "BU_SORT1", "BU_SORT2", "LANGU_CORR", "NATIO", "NATPERS", "XDELE", "XBLCK", "CRDAT", "CHDAT",
            "PARTNER_GUID"]
    but000 = pd.DataFrame({f"BUT000.{c}": [p[i] for p in PARTNERS] for i, c in enumerate(cols)})
    but000["BUT000.CRUSR"] = "SDLAMINI"
    but000["BUT000.NAME_ORG3"] = ""
    but000["BUT000.NAMEMIDDLE"] = but000["BUT000.PARTNER"].map({"0001000014": "Nomvula"}).fillna("")
    # founding / liquidation dates: ...24 was liquidated before it was founded
    but000["BUT000.FOUND_DAT"] = but000["BUT000.PARTNER"].map({"0001000012": "19870301", "0001000024": "20200101"}
                                                              ).fillna("")
    but000["BUT000.LIQUID_DAT"] = but000["BUT000.PARTNER"].map({"0001000024": "20190101"}).fillna("")
    but020 = pd.DataFrame({"BUT020.PARTNER": list(ADDRESSES), "BUT020.ADDRNUMBER": [a[0] for a in ADDRESSES.values()],
                           "BUT020.XDFADR": ["X"] * len(ADDRESSES)})
    adrc = pd.DataFrame({
        "ADRC.ADDRNUMBER": [a[0] for a in ADDRESSES.values()], "ADRC.DATE_FROM": ["00010101"] * len(ADDRESSES),
        "ADRC.NATION": [""] * len(ADDRESSES), "ADRC.DATE_TO": ["99991231"] * len(ADDRESSES),
        "ADRC.STREET": [a[1] for a in ADDRESSES.values()], "ADRC.HOUSE_NUM1": [a[2] for a in ADDRESSES.values()],
        "ADRC.POST_CODE1": [a[3] for a in ADDRESSES.values()], "ADRC.CITY1": [a[4] for a in ADDRESSES.values()],
        "ADRC.COUNTRY": [a[5] for a in ADDRESSES.values()], "ADRC.REGION": [a[6] for a in ADDRESSES.values()],
        "ADRC.LANGU": [a[7] for a in ADDRESSES.values()], "ADRC.TEL_NUMBER": [a[8] for a in ADDRESSES.values()],
    })
    extra = {  # ADDRNUMBER → (CITY2 district, STR_SUPPL1, FAX_NUMBER)
        "0000045101": ("Morningside", "Rivonia Office Park, Block C", "011 555 0143"),
        "0000045102": ("Ossendorf", "", "0221 5550315"),
        "0000045106": ("Deira", "Al Moosa Tower 2, Office 1204", ""),
    }
    for i, c in enumerate(("CITY2", "STR_SUPPL1", "FAX_NUMBER")):
        adrc[f"ADRC.{c}"] = adrc["ADRC.ADDRNUMBER"].map({k: v[i] for k, v in extra.items()}).fillna("")
    mail = [(a[0], a[9]) for a in ADDRESSES.values() if a[9]]
    adr6 = pd.DataFrame({"ADR6.ADDRNUMBER": [m[0] for m in mail], "ADR6.PERSNUMBER": [""] * len(mail),
                         "ADR6.DATE_FROM": ["00010101"] * len(mail), "ADR6.CONSNUMBER": ["001"] * len(mail),
                         "ADR6.FLGDEFAULT": ["X"] * len(mail), "ADR6.SMTP_ADDR": [m[1] for m in mail]})
    but100 = pd.DataFrame(ROLES, columns=["BUT100.PARTNER", "BUT100.RLTYP", "BUT100.VALID_FROM", "BUT100.VALID_TO"])
    but100.insert(2, "BUT100.DFVAL", "")
    tax = pd.DataFrame(TAX, columns=["DFKKBPTAXNUM.PARTNER", "DFKKBPTAXNUM.TAXTYPE", "DFKKBPTAXNUM.TAXNUM"])
    tax["DFKKBPTAXNUM.TAXNUMXL"] = ""
    bank = pd.DataFrame(BANKS, columns=["BUT0BK.PARTNER", "BUT0BK.BKVID", "BUT0BK.BANKS", "BUT0BK.BANKL",
                                        "BUT0BK.BANKN", "BUT0BK.IBAN", "BUT0BK.BK_VALID_FROM",
                                        "BUT0BK.BK_VALID_TO"])
    return TableFrames({"BUT000": but000, "BUT020": but020, "ADRC": adrc, "ADR6": adr6, "BUT100": but100,
                        "DFKKBPTAXNUM": tax, "BUT0BK": bank}, D, module="business_partner")


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them."""
    values = {"TITLE": {"0001", "0002", "0003", "0004"}, "BU_GROUP": {"0001", "0002"},
              "BANKS": {"ZA", "DE", "NL", "US"}, "RLTYP": {"000000", "FLCU00", "FLCU01", "FLVN00", "FLVN01"},
              "TAXTYPE": {"DE0", "NL0", "ZA1"}, "COUNTRY": {"ZA", "DE", "NL", "US", "AE"}}
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


def test_business_partner_golden():
    static = yaml.safe_load(_find_module_yaml("business_partner").read_text())["rules"]
    results = run_checks("business_partner", _frames(), "t", reference_values=_live_config(static),
                         extra_rules=generate("business_partner", static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "XDUP006": {"PARTNER=0001000013|TAXTYPE=DE0", "PARTNER=0001000019|TAXTYPE=DE0"},  # one VAT no., two BPs
        "BP017": {"PARTNER=0001000020"},                         # no e-mail address
        "BP009": {"PARTNER=0001000021"},                         # 'MR' is not a form-of-address key
        "BP024": {"PARTNER=0001000022|RLTYP=FLVN00|DFVAL="},     # role valid-to before valid-from
        "VP-BUT000-NAME_ORG2": {"PARTNER=0001000023"},           # e-mail in the second name line
        "ST-BUT000": {"PARTNER=0001000024"},                     # 'OBSOLETE' search term, not blocked
        "PH-ADRC-TEL_NUMBER": {"PARTNER=0001000025|ADDRNUMBER=0000045114"},  # 0000000000 as telephone
        "BP018": {"PARTNER=0001000026"},                         # comma instead of dot in the domain
        "BP049": {"PARTNER=0001000024"},                         # liquidated before it was founded
        "BP052": {"PARTNER=0001000020|BKVID=0001"},              # bank details end before they start
        "BP055": {"PARTNER=0001000021|BKVID=0001"},              # IBAN fails the mod-97 check
        "BP216": {"PARTNER=0001000024"},                         # liquidated, neither blocked nor archived
        "BP218": {"PARTNER=0001000027"},                         # archiving flag without the central block
        "BP226": {"PARTNER=0001000013", "PARTNER=0001000019"},   # near-identical names at the same postal code
    }, found
    # ...27 is flagged for archiving: out of the population, counted — on its address and
    # e-mail too, which are judged at the partner's grain
    for check_id in ("BP011", "BP005", "BP017", "BP018", "BP019", "BP020", "BP021", "BP022", "BP023", "BP030",
                     "BP031", "BP032"):
        r = next(r for r in results if r.check_id == check_id)
        assert r.details["population_excluded"] == {"deleted": 1}, check_id
        assert r.grain == "BUT000", check_id
    # the general role 000000 every BP carries is a role, not an initial value
    # (the archived partner's roles are out of the population, counted)
    roles = next(r for r in results if r.check_id == "BP024")
    archived = sum(1 for r in ROLES if r[0] == "0001000027")
    assert archived and roles.details["population_excluded"] == {"deleted": archived}
    assert roles.total_count == len(ROLES) - archived
