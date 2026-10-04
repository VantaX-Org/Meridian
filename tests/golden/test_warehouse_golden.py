"""Golden datasets: the warehouse, logistics, governance and integration rule packs
(shipped + generated rules, active population, joins, live configuration) on
records whose correct findings are known. Clean records — what a senior SAP
WM/EWM, logistics, MDG or GRC consultant signs off — must produce no finding at
all; any failure on them is a false positive. Each seeded defect must be found
exactly where it was put, and nowhere else.

Dates that freshness rules judge are relative to today, so the datasets do not
age; everything else is fixed."""

from datetime import date, timedelta

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def _day(days_ago: int) -> str:
    """SAP DATS, ``days_ago`` days before today."""
    return (date.today() - timedelta(days=days_ago)).strftime("%Y%m%d")


def _stamp(days_ago: int, hhmmss: str = "101500") -> str:
    """SAP UTC time stamp (TZNTSTMPS / GRFN_TIMESTAMP, YYYYMMDDhhmmss)."""
    return _day(days_ago) + hhmmss


def _static(module: str) -> list[dict]:
    return yaml.safe_load(_find_module_yaml(module).read_text())["rules"]


def _live_config(rules: list[dict], values: dict[str, set[str]]) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them (keyed by the rule field)."""
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"]]
    return out


def _run(module: str, frames: dict[str, pd.DataFrame], live: dict[str, set[str]] | None = None):
    static = _static(module)
    results = run_checks(module, TableFrames(frames, D, module=module), "t",
                         reference_values=_live_config(static, live or {}),
                         extra_rules=generate(module, static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    return results, found


# ── ewms_stock: storage bins (LAGP) and quants (LQUA) ──────────────────────

def test_ewms_stock_golden():
    # warehouse 100: 001 high rack (SU-managed), 002 shelf, 005 fixed-bin picking,
    # 902 GR interim, 916 shipping interim, 999 differences (dynamic bins)
    bins = [  # LGTYP, LGPLA, LGBER, KOBER, KZDYN, MAXLE, SKZUA, LAEDT, KZLER, KZVOL, ANZQU, LGEWI, GEWEI
        ("001", "01-01-01", "001", "", "", "1", "", "00000000", "", "X", "1", "1000", "KG"),  # reserve pallet bin
        ("001", "01-01-02", "001", "", "", "1", "X", _day(3), "", "X", "1", "1000", ""),      # blocked; DEFECT: no weight unit
        ("001", "01-02-01", "001", "", "", "1", "", "00000000", "", "X", "1", "1000", "KG"),
        ("001", "01-02-02", "001", "", "", "1", "", "00000000", "X", "X", "0", "1000", "KG"),  # DEFECT: empty and full
        ("002", "02-01-01", "001", "K01", "", "0", "", "00000000", "", "", "5", "0", ""),
        ("005", "05-01-01", "001", "K01", "", "0", "", _day(40), "X", "", "1", "0", ""),     # DEFECT: 'empty' with a quant
        ("902", "4500001234", "001", "", "X", "0", "", "00000000", "", "", "1", "0", ""),    # dynamic GR bin = PO number
        ("916", "0080001234", "001", "", "X", "0", "", "00000000", "", "", "1", "0", ""),    # dynamic shipping bin = delivery
        ("999", "INVENTORY", "001", "", "X", "0", "", "00000000", "", "", "1", "0", ""),
        ("003", "03-01-01", "001", "K01", "", "0", "", "00000000", "X", "", "0", "0", ""),   # DEFECT: storage type 003 not in T301
    ]
    lagp = pd.DataFrame({
        "LAGP.LGNUM": ["100"] * len(bins),
        "LAGP.LGTYP": [b[0] for b in bins], "LAGP.LGPLA": [b[1] for b in bins],
        "LAGP.LGBER": [b[2] for b in bins], "LAGP.KOBER": [b[3] for b in bins],
        "LAGP.KZDYN": [b[4] for b in bins], "LAGP.MAXLE": [b[5] for b in bins],
        "LAGP.SKZUA": [b[6] for b in bins], "LAGP.LAEDT": [b[7] for b in bins],
        "LAGP.KZLER": [b[8] for b in bins], "LAGP.KZVOL": [b[9] for b in bins],
        "LAGP.ANZQU": [b[10] for b in bins], "LAGP.LGEWI": [b[11] for b in bins], "LAGP.GEWEI": [b[12] for b in bins],
    })
    quants = [  # LQNUM, MATNR, CHARG, BESTQ, LGTYP, LGPLA, LENUM, LETYP, GESME, MEINS, VERME, SOBKZ, SONUM
        ("0000000001", "PUMP-1000", "", "", "001", "01-01-01", "00000000001000000017", "E1", "12", "ST", "10", "", ""),
        ("0000000002", "PUMP-1000", "", "S", "001", "01-01-02", "00000000001000000024", "E1", "4", "ST", "4", "", ""),
        ("0000000003", "RESIN-200", "0000004711", "", "005", "05-01-01", "", "", "40", "KG", "40", "", ""),
        ("0000000004", "RESIN-200", "0000004712", "Q", "902", "4500001234", "", "", "500", "KG", "500", "", ""),
        ("0000000005", "RESIN-200", "0000004711", "", "916", "0080001234", "", "", "25", "KG", "30", "", ""),  # DEFECT: available > total
        ("0000000006", "PUMP-1000", "", "", "999", "INVENTORY", "", "", "1-", "ST", "1-", "", ""),   # inventory difference
        ("0000000007", "BOLT-M12", "", "", "002", "02-01-01", "", "", "1500", "ST", "1200", "", ""),
        ("0000000008", "RESIN-200", "", "", "002", "02-01-01", "", "", "60", "KG", "60", "", ""),     # DEFECT: no batch
        ("0000000009", "PUMP-1000", "", "", "001", "01-02-01", "00000000001000000031", "", "6", "ST", "6", "", ""),  # DEFECT: SU without SU type
        ("0000000010", "BOLT-M12", "", "", "002", "02-01-01", "", "", "10", "KAR", "10", "", ""),     # DEFECT: not the base unit
        # sales-order stock for order 12345 item 10
        ("0000000011", "PUMP-1000", "", "", "002", "02-01-01", "", "", "2", "ST", "2", "E", "0000012345000010"),
        ("0000000012", "PUMP-1000", "", "", "002", "02-01-01", "", "", "1", "ST", "1", "E", ""),       # DEFECT: owner unknown
        ("0000000013", "PUMP-1000", "0000009999", "", "002", "02-01-01", "", "", "1", "ST", "1", "", ""),  # DEFECT: batch, not batch-managed
    ]
    lqua = pd.DataFrame({
        "LQUA.LGNUM": ["100"] * len(quants), "LQUA.LQNUM": [q[0] for q in quants],
        "LQUA.MATNR": [q[1] for q in quants], "LQUA.WERKS": ["1000"] * len(quants),
        "LQUA.CHARG": [q[2] for q in quants], "LQUA.BESTQ": [q[3] for q in quants],
        "LQUA.LGTYP": [q[4] for q in quants], "LQUA.LGPLA": [q[5] for q in quants],
        "LQUA.LENUM": [q[6] for q in quants], "LQUA.LETYP": [q[7] for q in quants],
        "LQUA.GESME": [q[8] for q in quants], "LQUA.MEINS": [q[9] for q in quants],
        "LQUA.VERME": [q[10] for q in quants], "LQUA.SOBKZ": [q[11] for q in quants],
        "LQUA.SONUM": [q[12] for q in quants],
    })
    mara = pd.DataFrame({"MARA.MATNR": ["PUMP-1000", "RESIN-200", "BOLT-M12"], "MARA.MEINS": ["ST", "KG", "ST"],
                         "MARA.LVORM": [""] * 3})
    marc = pd.DataFrame({"MARC.MATNR": ["PUMP-1000", "RESIN-200", "BOLT-M12"], "MARC.WERKS": ["1000"] * 3,
                         "MARC.XCHPF": ["", "X", ""], "MARC.LVORM": [""] * 3})
    _, found = _run("ewms_stock", {"LAGP": lagp, "LQUA": lqua, "MARA": mara, "MARC": marc},
                    {"LAGP.LGTYP": {"001", "002", "005", "902", "916", "922", "999"},
                     "LQUA.LETYP": {"E1", "E2", "IP"}, "LQUA.SOBKZ": {"E", "K", "M", "O", "Q", "W"}})
    assert found == {
        "EWMS024": {"LGNUM=100|LGTYP=003|LGPLA=03-01-01"},   # storage type not configured
        "EWMS010": {"LGNUM=100|LQNUM=0000000008"},           # batch-managed material without batch
        "EWMS015": {"LGNUM=100|LQNUM=0000000009"},           # storage unit without storage unit type
        "EWMS028": {"LGNUM=100|LQNUM=0000000010"},           # quant not in the base unit of measure
        "EWMS029": {"LGNUM=100|LQNUM=0000000012"},           # special stock without special stock number
        "EWMS031": {"LGNUM=100|LQNUM=0000000005"},           # available quantity above total quantity
        "EWMS033": {"LGNUM=100|LGTYP=001|LGPLA=01-01-02"},   # load capacity without weight unit
        "EWMS034": {"LGNUM=100|LGTYP=005|LGPLA=05-01-01"},   # flagged empty, holds a quant
        "EWMS035": {"LGNUM=100|LGTYP=001|LGPLA=01-02-02"},   # flagged empty and full
        "EWMS042": {"LGNUM=100|LQNUM=0000000013"},           # batch on a non-batch material
    }, found


# ── ewms_transfer_orders: TO headers (LTAK) and items (LTAP) ────────────────

def test_ewms_transfer_orders_golden():
    tos = [  # TANUM, BWLVS, BETYP, BENUM, KQUIT, BDATU, BNAME, QDATU
        ("0000001001", "101", "B", "4500001234", "X", _day(10), "WM_CLERK01", _day(9)),  # putaway from GR, confirmed
        ("0000001002", "601", "L", "0080001234", "", _day(1), "WM_CLERK02", ""),         # picking for delivery, open
        ("0000001003", "319", "", "", "X", _day(75), "WM_CLERK01", _day(75)),            # replenishment, confirmed long ago
        ("0000001004", "999", "", "", "X", _day(0), "WM_SUPER", _day(0)),                # manual transfer, confirmed today
        ("0000001005", "601", "L", "0080000977", "", _day(45), "WM_CLERK02", ""),        # DEFECT: open for 45 days
        ("0000001006", "101", "Z", "4500000877", "X", _day(5), "WM_CLERK01", _day(5)),   # DEFECT: requirement type not in T308
        ("0000001007", "999", "", "", "X", _day(3), "WM_SUPER", _day(4)),                # DEFECT: confirmed before created
        ("0000001008", "319", "", "", "X", _day(2), "WM_CLERK01", _day(2)),              # DEFECT: header confirmed, item open
    ]
    ltak = pd.DataFrame({
        "LTAK.LGNUM": ["100"] * len(tos), "LTAK.TANUM": [t[0] for t in tos], "LTAK.BWLVS": [t[1] for t in tos],
        "LTAK.BETYP": [t[2] for t in tos], "LTAK.BENUM": [t[3] for t in tos], "LTAK.KQUIT": [t[4] for t in tos],
        "LTAK.BDATU": [t[5] for t in tos], "LTAK.BNAME": [t[6] for t in tos], "LTAK.QDATU": [t[7] for t in tos],
    })
    done = {t[0]: (t[7], t[6]) for t in tos if t[4] == "X"}   # confirmation date and user per confirmed TO
    items = [  # TANUM, TAPOS, MATNR, MAKTX, CHARG, VSOLM, MEINS, VLTYP, VLPLA, NLTYP, NLPLA
        ("0000001001", "0001", "PUMP-1000", "Centrifugal pump 7.5 kW", "", "12", "ST", "902", "4500001234", "001", "01-01-01"),
        ("0000001001", "0002", "RESIN-200", "Epoxy resin, 25 kg drum", "0000004712", "500", "KG", "902", "4500001234", "002", "02-01-01"),
        ("0000001002", "0001", "RESIN-200", "Epoxy resin, 25 kg drum", "0000004711", "25", "KG", "005", "05-01-01", "916", "0080001234"),
        ("0000001002", "0002", "RESIN-200", "Epoxy resin, 25 kg drum", "", "50", "KG", "005", "05-01-01", "916", "0080001234"),  # DEFECT
        ("0000001003", "0001", "BOLT-M12", "Hex bolt M12x40 8.8", "", "500", "ST", "001", "01-01-02", "005", "05-01-01"),
        ("0000001004", "0001", "PUMP-1000", "Centrifugal pump 7.5 kW", "", "1", "ST", "001", "01-01-01", "999", "INVENTORY"),
        ("0000001005", "0001", "PUMP-1000", "Centrifugal pump 7.5 kW", "", "2", "ST", "001", "01-01-01", "916", "0080000977"),
        ("0000001006", "0001", "BOLT-M12", "Hex bolt M12x40 8.8", "", "1000", "ST", "902", "4500000877", "002", "02-01-01"),
        ("0000001007", "0001", "BOLT-M12", "Hex bolt M12x40 8.8", "0000004711", "5", "ST", "002", "02-01-01", "999", "INVENTORY"),  # DEFECT: batch
        ("0000001008", "0001", "BOLT-M12", "Hex bolt M12x40 8.8", "", "200", "KG", "001", "01-01-02", "005", "05-01-01"),  # DEFECT: unit
        ("0000001008", "0002", "PUMP-1000", "Centrifugal pump 7.5 kW", "", "2", "ST", "001", "01-01-02", "005", "05-01-01"),
    ]
    # item confirmation: every item of a confirmed TO, plus the first pick of open TO 1002 (partial
    # confirmation is normal); item 1008/0002 was never confirmed and item 1001/0002 lost its user
    pquit = {(i[0], i[1]): "X" for i in items if i[0] in done and (i[0], i[1]) != ("0000001008", "0002")}
    pquit[("0000001002", "0001")] = "X"
    qdatu = {k: done.get(k[0], (_day(1), ""))[0] for k in pquit}
    qname = {k: done.get(k[0], ("", "WM_CLERK02"))[1] for k in pquit}
    qname[("0000001001", "0002")] = ""   # DEFECT: confirmed without confirming user
    keys = [(i[0], i[1]) for i in items]
    ltap = pd.DataFrame({
        "LTAP.LGNUM": ["100"] * len(items), "LTAP.TANUM": [i[0] for i in items], "LTAP.TAPOS": [i[1] for i in items],
        "LTAP.MATNR": [i[2] for i in items], "LTAP.WERKS": ["1000"] * len(items), "LTAP.MAKTX": [i[3] for i in items],
        "LTAP.CHARG": [i[4] for i in items], "LTAP.VSOLM": [i[5] for i in items], "LTAP.MEINS": [i[6] for i in items],
        "LTAP.VLTYP": [i[7] for i in items], "LTAP.VLPLA": [i[8] for i in items],
        "LTAP.NLTYP": [i[9] for i in items], "LTAP.NLPLA": [i[10] for i in items],
        "LTAP.PQUIT": [pquit.get(k, "") for k in keys], "LTAP.QDATU": [qdatu.get(k, "") for k in keys],
        "LTAP.QNAME": [qname.get(k, "") for k in keys],
    })
    mara = pd.DataFrame({"MARA.MATNR": ["PUMP-1000", "RESIN-200", "BOLT-M12"], "MARA.MEINS": ["ST", "KG", "ST"],
                         "MARA.LVORM": [""] * 3})
    marc = pd.DataFrame({"MARC.MATNR": ["PUMP-1000", "RESIN-200", "BOLT-M12"], "MARC.WERKS": ["1000"] * 3,
                         "MARC.XCHPF": ["", "X", ""], "MARC.LVORM": [""] * 3})
    _, found = _run("ewms_transfer_orders", {"LTAK": ltak, "LTAP": ltap, "MARA": mara, "MARC": marc},
                    {"LTAK.BETYP": {"B", "F", "K", "L", "P", "O"}, "LTAK.BWLVS": {"101", "319", "601", "999"},
                     "LTAP.VLTYP": {"001", "002", "005", "902", "916", "999"}})
    assert found == {
        "EWMS_TO019": {"LGNUM=100|TANUM=0000001005"},           # unconfirmed for 45 days
        "EWTO033": {"LGNUM=100|TANUM=0000001005"},              # delivery pick open for more than 7 days
        "EWTO003": {"LGNUM=100|TANUM=0000001006"},              # requirement type Z not configured
        "EWTO014": {"LGNUM=100|TANUM=0000001002|TAPOS=0002"},   # batch-managed item without batch
        "EWTO021": {"LGNUM=100|TANUM=0000001007"},              # confirmed before it was created
        "EWTO023": {"LGNUM=100|TANUM=0000001001|TAPOS=0002"},   # confirmed without confirming user
        "EWTO024": {"LGNUM=100|TANUM=0000001008|TAPOS=0002"},   # header confirmed, item still open
        "EWTO026": {"LGNUM=100|TANUM=0000001008|TAPOS=0001"},   # item not in the base unit of measure
        "EWTO030": {"LGNUM=100|TANUM=0000001007|TAPOS=0001"},   # batch on a non-batch material
    }, found


# ── batch_management: batches (MCH1/MCHA) and batch stock (MCHB) ───────────

def test_batch_management_golden():
    # RESIN-200: shelf-life managed (365 days total shelf life); BOLT-M12: batches for
    # heat traceability only, no shelf life
    mara = pd.DataFrame({
        "MARA.MATNR": ["RESIN-200", "BOLT-M12"], "MARA.MHDHB": ["365", "0"],
        "MARA.ERSDA": ["20190402", "20180115"], "MARA.LAEDA": ["20250610", "00000000"],
        "MARA.MSTAE": ["", ""], "MARA.LVORM": ["", ""],
    })
    makt = pd.DataFrame({"MAKT.MATNR": ["RESIN-200", "BOLT-M12"], "MAKT.SPRAS": ["E", "E"],
                         "MAKT.MAKTX": ["Epoxy resin, 25 kg drum", "Hex bolt M12x40 8.8"]})
    batches = [  # MATNR, CHARG, HSDAT, VFDAT, ZUSTD, ERSDA, LAEDA, LVORM, LWEDT (last goods receipt)
        ("RESIN-200", "0000004711", _day(60), _day(-305), "", _day(55), "00000000", "", _day(55)),
        ("RESIN-200", "0000004712", _day(20), _day(-345), "X", _day(18), _day(17), "", _day(18)),  # restricted, awaiting QM
        ("RESIN-200", "0000004650", _day(420), _day(55), "", _day(415), _day(50), "", _day(415)),  # expired, moved to blocked
        ("BOLT-M12", "H2026-0815", "00000000", "00000000", "", _day(30), "00000000", "", _day(30)),  # vendor heat number
        # created at production-order release: no goods receipt yet, so no SLED yet (set from HSDAT at GR)
        ("RESIN-200", "0000004720", "00000000", "00000000", "", _day(1), "00000000", "", "00000000"),
        ("RESIN-200", "0000004600", _day(800), _day(435), "", _day(795), _day(400), "X", _day(795)),  # deleted: out
        ("RESIN-200", "0000004690", _day(400), _day(35), "", _day(395), "00000000", "", _day(395)),  # DEFECT: expired
        ("RESIN-200", "0000004713", _day(9), "00000000", "", _day(8), "00000000", "", _day(8)),      # DEFECT: no SLED
        ("RESIN-200", "0000004714", _day(-300), _day(5), "", _day(7), "00000000", "", _day(7)),      # DEFECT: swapped
        ("RESIN-200", "0000004715", _day(15), _day(-350), "X", _day(14), _day(13), "", _day(14)),  # DEFECT: restricted, unrestricted stock
        ("RESIN-200", "0000004601", _day(500), _day(135), "", _day(495), _day(100), "X", _day(495)),  # DEFECT: deleted, still stocked
    ]
    origin = {"0000004711": "ZA", "0000004712": "ZA", "0000004650": "DE", "H2026-0815": "RSA"}  # DEFECT: RSA is not ISO
    mch1 = pd.DataFrame({
        "MCH1.MATNR": [b[0] for b in batches], "MCH1.CHARG": [b[1] for b in batches],
        "MCH1.HSDAT": [b[2] for b in batches], "MCH1.VFDAT": [b[3] for b in batches],
        "MCH1.ZUSTD": [b[4] for b in batches], "MCH1.ERSDA": [b[5] for b in batches],
        "MCH1.LAEDA": [b[6] for b in batches], "MCH1.LVORM": [b[7] for b in batches],
        "MCH1.LWEDT": [b[8] for b in batches], "MCH1.HERKL": [origin.get(b[1], "") for b in batches],
    })
    mcha = pd.DataFrame({
        "MCHA.MATNR": [b[0] for b in batches], "MCHA.WERKS": ["1000"] * len(batches),
        "MCHA.CHARG": [b[1] for b in batches], "MCHA.ERSDA": [b[5] for b in batches],
        "MCHA.LAEDA": [b[6] for b in batches], "MCHA.LVORM": [b[7] for b in batches],
    })
    stock = {  # CHARG → (CLABS, CINSM, CSPEM); the order-release batch has no stock segment yet
        "0000004711": ("40", "0", "0"), "0000004712": ("0", "0", "0"), "0000004650": ("0", "0", "12"),
        "H2026-0815": ("1500", "0", "0"), "0000004600": ("0", "0", "0"), "0000004690": ("25", "0", "0"),
        "0000004713": ("100", "0", "0"), "0000004714": ("0", "75", "0"),   # 4714 still in quality inspection
        "0000004715": ("30", "0", "0"), "0000004601": ("0", "0", "8"),
    }
    held = [b for b in batches if b[1] in stock]
    mchb = pd.DataFrame({
        "MCHB.MATNR": [b[0] for b in held], "MCHB.WERKS": ["1000"] * len(held),
        "MCHB.LGORT": ["0001"] * len(held), "MCHB.CHARG": [b[1] for b in held],
        "MCHB.CLABS": [stock[b[1]][0] for b in held], "MCHB.CINSM": [stock[b[1]][1] for b in held],
        "MCHB.CSPEM": [stock[b[1]][2] for b in held],
        "MCHB.ERSDA": [b[5] for b in held], "MCHB.LAEDA": [b[6] for b in held],
    })
    results, found = _run("batch_management", {"MARA": mara, "MAKT": makt, "MCH1": mch1, "MCHA": mcha, "MCHB": mchb},
                          {"MCH1.HERKL": {"ZA", "DE", "US", "CN"}})
    assert found == {
        "BATCH015": {"MATNR=RESIN-200|WERKS=1000|LGORT=0001|CHARG=0000004690"},  # expired, still unrestricted
        "BATCH006": {"MATNR=RESIN-200|CHARG=0000004713"},                        # SLED material, no expiry date
        "BATCH008": {"MATNR=RESIN-200|CHARG=0000004714"},                        # manufactured after expiry
        "BATCH017": {"MATNR=RESIN-200|CHARG=0000004714"},                        # manufactured after goods receipt
        "BATCH016": {"MATNR=RESIN-200|WERKS=1000|LGORT=0001|CHARG=0000004715"},  # restricted, unrestricted stock
        "BATCH018": {"MATNR=RESIN-200|WERKS=1000|LGORT=0001|CHARG=0000004601"},  # deleted, still holds stock
        "BATCH019": {"MATNR=BOLT-M12|CHARG=H2026-0815"},                         # country of origin not in T005
    }, found
    sled = next(r for r in results if r.check_id == "BATCH006")
    assert sled.details["population_excluded"] == {"deleted": 2}


# ── mdg_master_data: change requests (USMD120C/USMD1213), change documents ──

def test_mdg_master_data_golden():
    crs = [  # CREQUEST, TYPE, STATUS, CREATED_AT, CREATED_BY, DATA_ACTIVE, RELEASED_BY, RELEASED_AT
        ("000000004711", "MAT01", "05", _stamp(20), "MDG_REQ01", "X", "MDG_APPR01", _stamp(18, "143000")),
        ("000000004712", "BP1P1", "05", _stamp(700), "MDG_REQ02", "X", "MDG_APPR02", _stamp(698)),  # activated long ago
        ("000000004713", "MAT01", "06", _stamp(730), "MDG_REQ01", "", "", ""),     # rejected two years ago: closed
        ("000000004714", "MAT01", "01", _stamp(4), "MDG_REQ03", "", "", ""),       # in process
        ("000000004715", "CCT1P1", "00", _stamp(1), "FI_MD.LEAD", "", "", ""),     # just submitted
        ("000000004716", "MAT01", "02", _stamp(400), "MDG_REQ02", "", "", ""),     # DEFECT: pending for 400 days
        ("000000004717", "BP1P1", "05", _stamp(30), "MDG_REQ03", "X", "", _stamp(28)),  # DEFECT: no release user
        ("000000004718", "MAT01", "99", _stamp(12), "MDG_REQ01", "", "", ""),      # DEFECT: status not in USMD130C
        ("000000004719", "MAT01", "05", _stamp(10), "MDG_REQ01", "X", "MDG_APPR01", _stamp(11)),  # DEFECT: released first
    ]
    # requested-by dates: closed requests keep theirs (history); 4714 is still open two days after it
    due = {"000000004711": _day(15), "000000004713": _day(700), "000000004714": _day(2), "000000004715": _day(-14)}
    usmd120c = pd.DataFrame({
        "USMD120C.USMD_CREQUEST": [c[0] for c in crs], "USMD120C.USMD_CREQ_TYPE": [c[1] for c in crs],
        "USMD120C.USMD_CREQ_STATUS": [c[2] for c in crs], "USMD120C.USMD_CREATED_AT": [c[3] for c in crs],
        "USMD120C.USMD_CREATED_BY": [c[4] for c in crs], "USMD120C.USMD_DATA_ACTIVE": [c[5] for c in crs],
        "USMD120C.USMD_RELEASED_BY": [c[6] for c in crs], "USMD120C.USMD_RELEASED_AT": [c[7] for c in crs],
        "USMD120C.USMD_DUE_DATE": [due.get(c[0], "") for c in crs],
    })
    objs = [  # CREQUEST, ENTITY, SEQNR, VALUE
        ("000000004711", "MATERIAL", "1", "PUMP-1000"),
        ("000000004712", "BP_HEADER", "1", "0000100200"),
        ("000000004713", "MATERIAL", "1", "PUMP-1001"),
        ("000000004714", "MATERIAL", "1", "RESIN-210"),
        ("000000004714", "MATERIAL", "2", "RESIN-220"),
        ("000000004715", "CCTR", "1", "0000004100"),
        ("000000004716", "MATERIAL", "1", "BOLT-M16"),
        ("000000004717", "BP_HEADER", "1", "0000100300"),
        ("000000004718", "ZOLDMAT", "1", "BOLT-M20"),        # DEFECT: entity type not in the data model
    ]
    usmd1213 = pd.DataFrame({
        "USMD1213.USMD_CREQUEST": [o[0] for o in objs], "USMD1213.USMD_ENTITY": [o[1] for o in objs],
        "USMD1213.USMD_SEQNR": [o[2] for o in objs], "USMD1213.USMD_ENTITY_OBJ": [o[1] for o in objs],
        "USMD1213.USMD_VALUE": [o[3] for o in objs],
    })
    cdpos = pd.DataFrame({
        "CDPOS.MANDANT": ["100"] * 3, "CDPOS.OBJECTCLAS": ["MATERIAL"] * 3,
        "CDPOS.OBJECTID": ["PUMP-1000"] * 3, "CDPOS.CHANGENR": ["0000731201", "0000731201", "0000731388"],
        "CDPOS.TABNAME": ["MARA", "MARC", "MAKT"],
        "CDPOS.TABKEY": ["100PUMP-1000", "100PUMP-1000                              1000", "100PUMP-1000E"],
        "CDPOS.FNAME": ["KEY", "KEY", "MAKTX"], "CDPOS.CHNGIND": ["I", "I", "U"],
    })
    cdhdr = pd.DataFrame({
        "CDHDR.MANDANT": ["100"] * 2, "CDHDR.OBJECTCLAS": ["MATERIAL"] * 2, "CDHDR.OBJECTID": ["PUMP-1000"] * 2,
        "CDHDR.CHANGENR": ["0000731201", "0000731388"], "CDHDR.USERNAME": ["MDG_WF_BATCH", ""],  # DEFECT: no user
        "CDHDR.UDATE": [_day(18), _day(6)], "CDHDR.CHANGE_IND": ["I", "U"],
    })
    _, found = _run("mdg_master_data", {"USMD120C": usmd120c, "USMD1213": usmd1213, "CDPOS": cdpos, "CDHDR": cdhdr},
                    {"USMD1213.USMD_ENTITY": {"MATERIAL", "MARCBASIC", "BP_HEADER", "CCTR", "ACCOUNT"},
                     "USMD120C.USMD_CREQ_STATUS": {"00", "01", "02", "03", "04", "05", "06", "07", "08", "09"},
                     "USMD120C.USMD_CREQ_TYPE": {"MAT01", "BP1P1", "CCT1P1"}})
    assert found == {
        "MDG017": {"USMD_CREQUEST=000000004716"},    # pending for over a year
        "MDG007": {"USMD_CREQUEST=000000004717"},    # activated without a release user
        "MDG004": {"USMD_CREQUEST=000000004718"},    # status not configured
        "MDG002": {"USMD_CREQUEST=000000004718|USMD_ENTITY=ZOLDMAT|USMD_SEQNR=1|USMD_ENTITY_OBJ=ZOLDMAT"},
        "MDG020": {"USMD_CREQUEST=000000004719"},    # released before it was created
        "MDG022": {"USMD_CREQUEST=000000004714"},    # open past its due date
        "MDG023": {"MANDANT=100|OBJECTCLAS=MATERIAL|OBJECTID=PUMP-1000|CHANGENR=0000731388"},  # no user
    }, found


# ── grc_compliance: user-role assignments and SoD risks ────────────────────

def test_grc_compliance_golden():
    roles = {"R01": "Z:FI_AP_CLERK", "R02": "ZC_SD_ORDER_ENTRY", "R03": "/IWFND/RT_GW_USER", "R04": "ZD_MM_BUYER_1000"}
    role_master = {  # ROLEID → ROLE_NAME, CONNECTOR_GRP, ROLE_TYPE, LOCKED, CERTIFY_DUE
        "R01": ("Z:FI_AP_CLERK", "SAP_ECC", "SIN", "", _day(-120)),
        "R02": ("ZC_SD_ORDER_ENTRY", "SAP_ECC", "COM", "", _day(-30)),
        "R03": ("/IWFND/RT_GW_USER", "SAP_ECC", "SIN", "X", _day(200)),     # locked SAP template: not certified
        "R04": ("ZD_MM_BUYER_1000", "SAP_S4", "DER", "", _day(-300)),
        "R05": ("Z:FI_AP_CLERK", "SAP_S4", "SIN", "", _day(-90)),            # same name, other landscape
        "R06": ("ZS_PP_PLANNER", "SAP_ECC", "", "", _day(10)),              # DEFECT: no type; DEFECT: overdue
        "R07": ("ZC_SD_ORDER_ENTRY", "SAP_ECC", "COM", "", _day(-30)),     # DEFECT: duplicate of R02
    }
    rm = list(role_master.items())
    grac_role = pd.DataFrame({
        "GRACROLE.ROLEID": [f"{k}{'0' * 29}" for k, _ in rm], "GRACROLE.ROLE_NAME": [v[0] for _, v in rm],
        "GRACROLE.CONNECTOR_GRP": [v[1] for _, v in rm], "GRACROLE.ROLE_TYPE": [v[2] for _, v in rm],
        "GRACROLE.LOCKED": [v[3] for _, v in rm], "GRACROLE.CERTIFY_DUE": [v[4] for _, v in rm],
    })
    rid = {k: f"{k}{'0' * 29}" for k in list(roles) + ["R99"]}
    assigns = [  # USERROLEID, USER_ID, ROLE, CONNECTOR, VALID_FROM, VALID_TO
        ("UR01", "JSMITH", "R01", "ECPCLNT100", "20240101000000", "99991231235959"),
        ("UR02", "JSMITH", "R03", "ECPCLNT100", "20240101000000", "99991231235959"),
        ("UR03", "M.NAIDOO", "R02", "ECPCLNT100", "20250301000000", _stamp(-90, "235959")),  # contractor, end-dated
        ("UR04", "FF_AP_01", "R01", "ECPCLNT100", _stamp(2, "080000"), _stamp(-1, "080000")),  # firefighter, 3 days
        ("UR05", "PKHUMALO", "R04", "S4PCLNT100", "20230615000000", "99991231235959"),
        ("UR06", "PKHUMALO", "R04", "ECPCLNT100", "20230615000000", "99991231235959"),  # same role, other system
        ("UR07", "TVDMERWE", "R02", "ECPCLNT100", "20260901000000", "20250831235959"),  # DEFECT: from after to
        ("UR08", "LBOTHA", "R01", "ECPCLNT100", "20250101000000", "99991231235959"),    # DEFECT: assigned twice
        ("UR09", "LBOTHA", "R01", "ECPCLNT100", "20250101000000", "99991231235959"),    # DEFECT: assigned twice
        ("UR10", "SDLAMINI", "R99", "ECPCLNT100", "20250101000000", "99991231235959"),  # DEFECT: role not in GRACROLE
    ]
    grac_user_role = pd.DataFrame({
        "GRACUSERROLE.USERROLEID": [f"{a[0]}{'0' * 28}" for a in assigns],
        "GRACUSERROLE.USER_ID": [a[1] for a in assigns], "GRACUSERROLE.ROLE_ID": [rid[a[2]] for a in assigns],
        "GRACUSERROLE.CONNECTOR": [a[3] for a in assigns],
        "GRACUSERROLE.VALID_FROM": [a[4] for a in assigns], "GRACUSERROLE.VALID_TO": [a[5] for a in assigns],
    })
    risks = [  # RISKID, RISKLEVEL, ACTIVE, RISKTYPE, BZPRCID
        ("F001", "1", "X", "1", "FIN"),    # maintain vendor / post payment, high
        ("P002", "3", "X", "1", ""),       # critical; DEFECT: no business process
        ("B001", "1", "X", "2", "BASIS"),  # critical action
        ("S005", "2", "", "1", "OTC"),     # deactivated low risk
        ("F010", "7", "X", "1", "FIN"),    # DEFECT: risk level not configured
        ("M004", "0", "X", "1", "PTP"),    # DEFECT: no description
    ]
    grac_risk = pd.DataFrame({"GRACSODRISK.RISKID": [r[0] for r in risks], "GRACSODRISK.RISKLEVEL": [r[1] for r in risks],
                              "GRACSODRISK.ACTIVE": [r[2] for r in risks], "GRACSODRISK.RISKTYPE": [r[3] for r in risks],
                              "GRACSODRISK.BZPRCID": [r[4] for r in risks]})
    grac_risk_t = pd.DataFrame({
        "GRACSODRISKT.LANG": ["E", "D", "E", "E", "E", "E"], "GRACSODRISKT.RISKID": ["F001", "F001", "P002", "B001", "S005", "F010"],
        "GRACSODRISKT.DESCN": ["Maintain fictitious vendor and initiate payment", "Kreditor anlegen und Zahlung ausführen",
                               "Create purchase order and approve own invoice", "Administer user master records",
                               "Maintain sales prices and post goods issue", "Post GL journal and release own journal"],
    })
    _, found = _run("grc_compliance", {"GRACUSERROLE": grac_user_role, "GRACROLE": grac_role,
                                       "GRACSODRISK": grac_risk, "GRACSODRISKT": grac_risk_t},
                    {"GRACSODRISK.RISKLEVEL": {"0", "1", "2", "3"},
                     "GRACUSERROLE.CONNECTOR": {"ECPCLNT100", "S4PCLNT100"},
                     "GRACROLE.ROLE_TYPE": {"SIN", "COM", "DER", "BUS"}})
    assert found == {
        "GRC005": {f"USERROLEID=UR07{'0' * 28}"},
        "GRC024": {f"USERROLEID=UR07{'0' * 28}"},                                    # assignment expired over a year ago
        "GRC013": {f"USERROLEID=UR08{'0' * 28}", f"USERROLEID=UR09{'0' * 28}"},
        "GRC002": {f"USERROLEID=UR10{'0' * 28}"},
        "GRC007": {"RISKID=F010"},
        "GRC008": {"RISKID=M004"},
        "GRC018": {f"ROLEID=R06{'0' * 29}"},                                    # role without role type
        "GRC020": {f"ROLEID=R06{'0' * 29}"},                                    # certification overdue
        "GRC021": {"RISKID=P002"},                                              # risk without business process
        "GRC023": {f"ROLEID=R02{'0' * 29}", f"ROLEID=R07{'0' * 29}"},           # role name twice in one landscape
    }, found


# ── fleet_management: fleet objects (EQUI + FLEET + derived readings) ──────

def test_fleet_management_golden():
    def eq(n: int) -> str:
        return f"{n:018d}"
    vehicles = [  # n, S_FLEET, HERST, TYPBZ, BAUJJ, ERDAT, AEDAT, INBDT
        (10000001, "X", "Mercedes-Benz", "Actros 2645", "2021", "20210305", "20250910", "20210320"),   # truck
        (10000002, "X", "Toyota", "Hiace 2.8 GD-6", "2022", "20220711", "00000000", "20220801"),        # van
        (10000003, "X", "Volkswagen", "Polo Vivo 1.4", "2023", "20230120", "20240402", "20230201"),     # pool car
        (10000004, "X", "Henred Fruehauf", "Tri-axle tautliner", "2020", "20200610", "20250115", "20200701"),  # trailer
        (10000005, "X", "Isuzu", "NPR 400", "2026", _day(70), "00000000", _day(60)),                   # new: in first interval
        (10000006, "", "KSB", "Etanorm 65-200", "2015", "20150812", "00000000", "20150901"),           # pump, not fleet
        (10000007, "X", "Toyota", "Hilux 2.4 GD-6", "2019", "20190404", "20250301", "20190415"),        # DEFECT: VIN typo
        (10000008, "X", "Mercedes-Benz", "Actros 2645", "2021", "20210305", "20250910", "20210320"),   # DEFECT: plate duplicated
        (10000009, "X", "Scania", "R 460", "2018", "20180201", "20250711", "20180215"),                # DEFECT: overdue by km
        (10000010, "X", "Nissan", "NP200", "2017", "20170601", "20240101", "20170610"),                # DEFECT: not serviced
        (10000011, "X", "Ford", "Ranger 2.2", "2020", "20200301", "20250301", "20200310"),             # DEFECT: no cost centre
        (10000012, "X", "Hino", "300 714", "2024", _day(760), _day(700), _day(730)),                   # DEFECT: never serviced
        (10000013, "X", "Toyota", "Hiace 2.8 GD-6", "2022", "20240115", "00000000", "20220801"),        # DEFECT: van entered twice
    ]
    equi = pd.DataFrame({
        "EQUI.EQUNR": [eq(v[0]) for v in vehicles], "EQUI.OBJNR": [f"IE{eq(v[0])}" for v in vehicles],
        "EQUI.S_FLEET": [v[1] for v in vehicles], "EQUI.HERST": [v[2] for v in vehicles],
        "EQUI.TYPBZ": [v[3] for v in vehicles], "EQUI.BAUJJ": [v[4] for v in vehicles],
        "EQUI.ERDAT": [v[5] for v in vehicles], "EQUI.AEDAT": [v[6] for v in vehicles], "EQUI.INBDT": [v[7] for v in vehicles],
    })
    fleet_rows = [  # n, FLEET_CAT, VIN, LICENSE_NUM, EXPIRY_DATE
        (10000001, "TRUCK", "WDB9634031L123456", "GP 123-456", _day(-120)),
        (10000002, "VAN", "JTFSS22P400123457", "ND 456-789", _day(-200)),
        (10000003, "CAR", "AAVZZZ6SZPU012345", "CA 789-012", _day(-45)),
        (10000004, "TRAILER", "ADV3TT4E0LH100234", "GP 234-567", _day(-300)),
        (10000005, "TRUCK", "JAANPR85HT7100456", "GP 345-678", _day(-305)),
        (10000007, "VAN", "AHTFR22G00612345", "GP 456-789", _day(-90)),       # DEFECT: 16 characters
        (10000008, "TRUCK", "WDB9634031L123999", "GP 123-456", _day(-150)),   # DEFECT: same plate as 10000001
        (10000009, "TRUCK", "YS2R4X20001234567", "GP 567-890", _day(-60)),
        (10000010, "CAR", "MDHFBUD22U0123456", "GP 678-901", _day(12)),      # DEFECT: licence expired
        (10000011, "VAN", "AFAPXXMJ2PL123456", "GP 789-012", _day(-180)),
        (10000012, "TRUCK", "JHHAFJ4H70K012345", "GP 890-123", _day(-210)),
        (10000013, "VAN", "JTFSS22P400123457", "GP 901-234", _day(-200)),    # DEFECT: VIN of 10000002
    ]
    weights = {  # GROSS_WGT, LOAD_WGT, WGT_UNIT (permissible total / payload)
        10000001: ("26000", "15500", "KG"), 10000002: ("3500", "4200", "KG"),  # DEFECT: payload above total weight
        10000004: ("34000", "28000", "KG"), 10000005: ("4500", "2500", ""),   # DEFECT: weights without unit
        10000009: ("40", "26", "TO"),
    }
    fleet = pd.DataFrame({
        "FLEET.OBJNR": [f"IE{eq(f[0])}" for f in fleet_rows], "FLEET.FLEET_CAT": [f[1] for f in fleet_rows],
        "FLEET.FLEET_VIN": [f[2] for f in fleet_rows], "FLEET.LICENSE_NUM": [f[3] for f in fleet_rows],
        "FLEET.EXPIRY_DATE": [f[4] for f in fleet_rows],
        "FLEET.GROSS_WGT": [weights.get(f[0], ("0",))[0] for f in fleet_rows],
        "FLEET.LOAD_WGT": [weights.get(f[0], ("", "0"))[1] for f in fleet_rows],
        "FLEET.WGT_UNIT": [weights.get(f[0], ("", "", ""))[2] for f in fleet_rows],
    })
    readings = [  # n, CURRENT_KM, SERVICE_KM, LAST_SERVICE, NEXT_DUE, DRIVER, INSURANCE
        (10000001, "412300", "420000", _day(80), _day(-100), "D1001", _day(-200)),
        (10000002, "98400", "105000", _day(150), _day(-30), "D1002", _day(-200)),
        (10000003, "41250", "45000", _day(200), _day(-165), "POOL", _day(-200)),
        (10000004, "", "", _day(120), _day(-60), "", _day(-200)),          # trailer: no odometer, no driver
        (10000005, "6200", "15000", "00000000", _day(-120), "D1005", _day(-300)),  # new: no service done yet
        (10000007, "152000", "165000", _day(90), _day(-90), "D1007", _day(-200)),
        (10000008, "388000", "400000", _day(60), _day(70), "D1008", _day(-200)),  # DEFECT: next due before last
        (10000009, "604800", "600000", _day(150), _day(-10), "D1009", _day(-200)),  # DEFECT: 4,800 km past service
        (10000010, "176000", "180000", _day(420), _day(-30), "D1010", _day(-200)),  # DEFECT: serviced 14 months ago
        (10000011, "88000", "90000", _day(100), _day(-80), "D1011", _day(20)),    # DEFECT: insurance lapsed
        (10000012, "14000", "20000", "00000000", _day(365), "D1012", _day(-200)),  # annual service never done
        (10000013, "98400", "105000", _day(150), _day(-30), "D1002", _day(-200)),
    ]
    fleet_master = pd.DataFrame({
        "FLEET_MASTER.EQUNR": [eq(r[0]) for r in readings], "FLEET_MASTER.CURRENT_KM": [r[1] for r in readings],
        "FLEET_MASTER.SERVICE_KM": [r[2] for r in readings], "FLEET_MASTER.LAST_SERVICE_DATE": [r[3] for r in readings],
        "FLEET_MASTER.NEXT_SERVICE_DUE": [r[4] for r in readings], "FLEET_MASTER.DRIVER_ID": [r[5] for r in readings],
        "FLEET_MASTER.INSURANCE_EXPIRY": [r[6] for r in readings],
    })
    # current time segment per vehicle; 10000005 also keeps the segment from goods receipt to
    # commissioning, when it stood in the workshop with no cost centre yet (history, not a defect)
    equz = pd.DataFrame({
        "EQUZ.EQUNR": [eq(v[0]) for v in vehicles] + [eq(10000005)],
        "EQUZ.DATBI": ["99991231"] * len(vehicles) + [_day(61)],
        "EQUZ.EQLFN": ["002" if v[0] == 10000005 else "001" for v in vehicles] + ["001"],
        "EQUZ.ILOAN": [f"L{v[0]}" for v in vehicles] + ["L10000005H"],
    })
    iloa = pd.DataFrame({"ILOA.ILOAN": [f"L{v[0]}" for v in vehicles] + ["L10000005H"],
                         "ILOA.KOSTL": ["" if v[0] == 10000011 else "0000004410" for v in vehicles] + [""]})
    _, found = _run("fleet_management", {"EQUI": equi, "FLEET": fleet, "FLEET_MASTER": fleet_master,
                                         "EQUZ": equz, "ILOA": iloa},
                    {"FLEET.FLEET_CAT": {"CAR", "VAN", "TRUCK", "BUS", "TRAILER", "MOTORCYCLE"}})
    assert found == {
        "FLEET006": {f"EQUNR={eq(10000012)}"},                          # two years in service, never serviced
        "FLEET004": {f"EQUNR={eq(10000007)}"},                          # VIN with 16 characters
        "FLEET017": {f"EQUNR={eq(10000001)}", f"EQUNR={eq(10000008)}"},  # one plate, two vehicles
        "FLEET008": {f"EQUNR={eq(10000009)}"},                          # past next-service odometer
        "FLEET018": {f"EQUNR={eq(10000010)}"},                          # last service over a year ago
        "FLEET009": {f"EQUNR={eq(10000011)}"},                          # no cost centre
        "FLEET019": {f"EQUNR={eq(10000002)}", f"EQUNR={eq(10000013)}"},  # one VIN, two fleet objects
        "FLEET020": {f"EQUNR={eq(10000010)}"},                          # licence expired
        "FLEET021": {f"EQUNR={eq(10000011)}"},                          # insurance expired
        "FLEET022": {f"EQUNR={eq(10000008)}"},                          # next service due before the last one
        "FLEET023": {f"EQUNR={eq(10000002)}"},                          # payload above permissible total weight
        "FLEET024": {f"EQUNR={eq(10000005)}"},                          # weights without unit
    }, found


# ── transport_management: shipments (VTTK/VTTP) and routes (TVRO) ──────────

def test_transport_management_golden():
    ships = [  # TKNUM, STTRG, TDLNR, ROUTE, ERDAT, AEDAT, DPTBG, DPTEN, DATBG, DATEN
        ("0000012001", "7", "0000300100", "ZA0001", _day(10), _day(8), _day(9), _day(8), _day(9), _day(8)),
        ("0000012002", "0", "", "ZA0002", _day(1), "00000000", _day(-1), _day(-2), "00000000", "00000000"),  # planned
        ("0000012003", "6", "0000300110", "ZA0001", _day(3), _day(1), _day(1), _day(0), _day(1), "00000000"),  # en route
        ("0000012004", "7", "0000300100", "ZA0002", _day(190), _day(185), _day(188), _day(187), _day(188), _day(186)),
        ("0000012005", "4", "0000300110", "ZA0001", _day(120), _day(118), _day(119), _day(118), "00000000", "00000000"),  # DEFECT
        ("0000012006", "7", "0000300100", "ZA0009", _day(6), _day(4), _day(5), _day(4), _day(5), _day(4)),  # DEFECT
        ("0000012007", "7", "0000300110", "ZA0002", _day(15), _day(13), _day(14), _day(13), _day(14), "00000000"),  # DEFECT
        ("0000012008", "0", "", "ZA0001", _day(2), "00000000", _day(-3), _day(-4), "00000000", "00000000"),  # DEFECT
        ("0000012009", "7", "0000300100", "ZA0001", _day(7), _day(5), _day(6), _day(5), _day(5), _day(6)),  # DEFECT
    ]
    extra = {  # TKNUM → TPLST, MEDST, STLAD, DALEN (loading end), STABF, DTABF (shipment completion)
        "0000012001": ("1000", "KM", "X", _day(10), "X", _day(9)),
        "0000012002": ("1000", "KM", "", "", "", ""),
        "0000012003": ("1000", "", "X", _day(1), "X", _day(1)),          # DEFECT: distance without unit
        "0000012004": ("1000", "KM", "X", _day(188), "X", ""),           # DEFECT: completed without date
        "0000012005": ("1000", "KM", "X", _day(119), "", ""),
        "0000012006": ("1000", "KM", "X", _day(5), "X", _day(5)),
        "0000012007": ("1000", "KM", "X", _day(14), "X", _day(14)),
        "0000012008": ("", "KM", "", "", "", ""),                        # DEFECT: no planning point
        "0000012009": ("1000", "KM", "X", _day(6), "X", _day(6)),
    }
    vttk = pd.DataFrame({
        "VTTK.TKNUM": [s[0] for s in ships], "VTTK.SHTYP": ["0001"] * len(ships), "VTTK.VSART": ["01"] * len(ships),
        "VTTK.STTRG": [s[1] for s in ships], "VTTK.TDLNR": [s[2] for s in ships], "VTTK.ROUTE": [s[3] for s in ships],
        "VTTK.DISTZ": ["580", "1270", "580", "1270", "580", "95", "1270", "580", "580"],
        "VTTK.TPLST": [extra[s[0]][0] for s in ships], "VTTK.MEDST": [extra[s[0]][1] for s in ships],
        "VTTK.STLAD": [extra[s[0]][2] for s in ships], "VTTK.DALEN": [extra[s[0]][3] for s in ships],
        "VTTK.STABF": [extra[s[0]][4] for s in ships], "VTTK.DTABF": [extra[s[0]][5] for s in ships],
        "VTTK.ERDAT": [s[4] for s in ships], "VTTK.AEDAT": [s[5] for s in ships],
        "VTTK.DPTBG": [s[6] for s in ships], "VTTK.DPTEN": [s[7] for s in ships],
        "VTTK.DATBG": [s[8] for s in ships], "VTTK.DATEN": [s[9] for s in ships],
    })
    tvro = pd.DataFrame({"TVRO.ROUTE": ["ZA0001", "ZA0002"], "TVRO.TRAZTD": ["1", "2"]})
    vttp = pd.DataFrame({
        "VTTP.TKNUM": [s[0] for s in ships for _ in (1, 2)], "VTTP.TPNUM": ["0001", "0002"] * len(ships),
        "VTTP.VBELN": [f"008{int(s[0][-4:]) * 10 + i:07d}" for s in ships for i in (1, 2)],
        "VTTP.ERDAT": [s[4] for s in ships for _ in (1, 2)],
    })
    _, found = _run("transport_management", {"VTTK": vttk, "VTTP": vttp, "TVRO": tvro},
                    {"VTTK.SHTYP": {"0001", "0002"}, "VTTK.TPLST": {"1000", "2000"}, "VTTK.VSART": {"01", "03"}})
    assert found == {
        "TM017": {"TKNUM=0000012005"},   # open for four months
        "TM014": {"TKNUM=0000012006"},   # route not in TVRO
        "TM013": {"TKNUM=0000012007"},   # shipment ended without an end date
        "TM020": {"TKNUM=0000012008"},   # no transportation planning point
        "TM023": {"TKNUM=0000012009"},   # arrived before it departed
        "TM031": {"TKNUM=0000012004"},   # completion status without completion date
        "TM032": {"TKNUM=0000012003"},   # distance without unit
    }, found


# ── wm_interface: material warehouse data (MLGN/MLGT) and storage locations ─

def test_wm_interface_golden():
    mara = pd.DataFrame({"MARA.MATNR": ["PUMP-1000", "RESIN-200", "BOLT-M12", "BOLT-M10", "GASKET-50"],
                         "MARA.LVORM": ["", "", "", "", "X"]})
    mlgn_rows = [  # MATNR, LGNUM, LGBKZ, LTKZE, LTKZA, LVORM
        ("PUMP-1000", "100", "HVY", "HR", "HR"),
        ("RESIN-200", "100", "", "SHF", "FIX"),
        ("BOLT-M12", "100", "", "", ""),       # storage type search by movement type only (T334T, blank indicator)
        ("BOLT-M10", "10", "", "", ""),         # DEFECT: warehouse 100 lost a digit... loaded as '10'
        ("GASKET-50", "100", "", "", ""),       # deleted material: out
    ]
    pallet = {"PUMP-1000": ("4", "ST"), "RESIN-200": ("800", "KG"), "BOLT-M12": ("5000", "")}  # DEFECT: no unit
    mlgn = pd.DataFrame({"MLGN.MATNR": [m[0] for m in mlgn_rows], "MLGN.LGNUM": [m[1] for m in mlgn_rows],
                         "MLGN.LGBKZ": [m[2] for m in mlgn_rows], "MLGN.LTKZE": [m[3] for m in mlgn_rows],
                         "MLGN.LTKZA": [m[4] for m in mlgn_rows], "MLGN.LVORM": [""] * len(mlgn_rows),
                         "MLGN.LHMG1": [pallet.get(m[0], ("0",))[0] for m in mlgn_rows],
                         "MLGN.LHME1": [pallet.get(m[0], ("", ""))[1] for m in mlgn_rows]})
    mlgt = pd.DataFrame({"MLGT.MATNR": ["RESIN-200", "BOLT-M12"], "MLGT.LGNUM": ["100", "100"],
                         "MLGT.LGTYP": ["005", "005"], "MLGT.LGPLA": ["05-01-01", "05-02-01"],
                         "MLGT.LPMIN": ["50", "500"], "MLGT.LPMAX": ["200", "300"]})  # DEFECT: BOLT min above max
    mard = pd.DataFrame({"MARD.MATNR": ["PUMP-1000", "RESIN-200", "BOLT-M12", "BOLT-M12"],
                         "MARD.WERKS": ["1000"] * 4, "MARD.LGORT": ["0001", "0001", "0001", "0002"],
                         "MARD.ERSDA": ["20190402", "20190402", "20180115", "20200303"], "MARD.LVORM": [""] * 4})
    marc = pd.DataFrame({"MARC.MATNR": ["PUMP-1000", "RESIN-200", "BOLT-M12"], "MARC.WERKS": ["1000"] * 3,
                         "MARC.LVORM": [""] * 3})
    results, found = _run("wm_interface", {"MARA": mara, "MARC": marc, "MLGN": mlgn, "MLGT": mlgt, "MARD": mard},
                          {"MLGN.LGNUM": {"100", "200"}, "MLGN.LTKZE": {"HR", "SHF", "FIX", "BLK"},
                           "MLGN.LGBKZ": {"HVY", "FST"}, "MLGT.LGTYP": {"001", "002", "005", "902", "916", "999"},
                           "MARD.LGORT": {"0001", "0002", "0088"}})
    assert found == {
        "WMI008": {"MATNR=BOLT-M10|LGNUM=10"},   # warehouse 100 loaded as '10'
        "WMI020": {"MATNR=BOLT-M10|LGNUM=10"},   # ... so it is not a configured warehouse either
        "WMI012": {"MATNR=BOLT-M12|LGNUM=100|LGTYP=005"},   # minimum bin quantity above maximum
        "WMI013": {"MATNR=BOLT-M12|LGNUM=100"},             # palletization quantity without unit
    }, found
    # GASKET-50 is flagged for deletion at client level: out of the population, counted
    lgnum = next(r for r in results if r.check_id == "WMI001")
    assert lgnum.details["population_excluded"] == {"deleted": 1}


# ── cross_system_integration: the same objects across connected systems ───

def test_cross_system_integration_golden():
    rows = [  # SOURCE_SYSTEM, OBJECT_TYPE, OBJECT_KEY, MATNR, LIFNR, KUNNR, BUKRS, WAERS, GJAHR, BELNR, BUDAT, BLDAT
        ("ECC_PRD", "MATERIAL", "PUMP-1000", "PUMP-1000", "", "", "", "", "", "", "", ""),
        ("S4_PRD", "MATERIAL", "PUMP-1000", "PUMP-1000", "", "", "", "", "", "", "", ""),
        ("EWM_PRD", "MATERIAL", "PUMP-1000", "PUMP-1000", "", "", "", "", "", "", "", ""),
        ("ECC_PRD", "VENDOR", "0000100200", "", "0000100200", "", "1000", "ZAR", "", "", "", ""),
        ("S4_PRD", "VENDOR", "0000100200", "", "0000100200", "", "1000", "ZAR", "", "", "", ""),
        ("ECC_PRD", "CUSTOMER", "0000200300", "", "", "0000200300", "1000", "EUR", "", "", "", ""),
        ("ECC_PRD", "FI_DOCUMENT", "100051000001232026", "", "0000100200", "", "1000", "ZAR", "2026", "5100000123",
         "20260831", "20260828"),
        # supplier invoice dated 1 September for August goods, posted into August at period-end close
        ("S4_PRD", "FI_DOCUMENT", "100051000001242026", "", "0000100200", "", "1000", "ZAR", "2026", "5100000124",
         "20260831", "20260901"),
        ("S4_PRD", "MATERIAL", "pump-1001", "pump-1001", "", "", "", "", "", "", "", ""),          # DEFECT: lower case
        ("ECC_PRD", "VENDOR", "0000100300", "", "", "", "1000", "ZAR", "", "", "", ""),             # DEFECT: no vendor
        ("ECC_PRD", "CUSTOMER", "0000200400", "", "", "0000200400", "1000", "EURO", "", "", "", ""),  # DEFECT: currency
        ("EWM_PRD", "MATERIAL", "RESIN-200", "RESIN-200", "", "", "", "", "", "", "", ""),         # DEFECT: twice in EWM
        ("EWM_PRD", "MATERIAL", "0050568F3A2B1EE0", "RESIN-200", "", "", "", "", "", "", "", ""),  # DEFECT: twice in EWM
        ("S4_PRD", "FI_DOCUMENT", "100051000001252026", "", "0000100200", "", "1000", "ZAR", "2026", "5100000125",
         "20260905", ""),                                                                          # DEFECT: no document date
        ("ECC_PRD", "FI_DOCUMENT", "1000-5100000123-2026", "", "0000100200", "", "1000", "ZAR", "2026", "5100000123",
         "20260831", "20260828"),                                                                  # DEFECT: same document again
        ("S4_PRD", "VENDOR", "100400", "", "100400", "", "1000", "ZAR", "", "", "", ""),            # DEFECT: no leading zeros
    ]
    cols = ["SOURCE_SYSTEM", "OBJECT_TYPE", "OBJECT_KEY", "MATNR", "LIFNR", "KUNNR", "BUKRS", "WAERS", "GJAHR",
            "BELNR", "BUDAT", "BLDAT"]
    xsys = pd.DataFrame({f"XSYS.{c}": [r[i] for r in rows] for i, c in enumerate(cols)})
    _, found = _run("cross_system_integration", {"XSYS": xsys})
    k = "SOURCE_SYSTEM={}|OBJECT_TYPE={}|OBJECT_KEY={}".format
    assert found == {
        "XSYS002": {k("S4_PRD", "MATERIAL", "pump-1001")},
        "XSYS003": {k("ECC_PRD", "VENDOR", "0000100300")},
        "XSYS007": {k("ECC_PRD", "CUSTOMER", "0000200400")},
        "XSYS013": {k("EWM_PRD", "MATERIAL", "RESIN-200"), k("EWM_PRD", "MATERIAL", "0050568F3A2B1EE0")},
        "XSYS018": {k("S4_PRD", "FI_DOCUMENT", "100051000001252026")},
        "XSYS020": {k("S4_PRD", "VENDOR", "100400")},
        "XSYS023": {k("ECC_PRD", "FI_DOCUMENT", "100051000001232026"), k("ECC_PRD", "FI_DOCUMENT", "1000-5100000123-2026")},
    }, found
