"""S/4HANA Cloud and BTP have an SAP standard baseline (no configuration API)."""

from sap.baseline_config import BASELINE_CONFIG

_KEYS = {"T001": "BUKRS", "T001W": "WERKS", "T001L": "LGORT", "T134": "MTART", "T006": "MSEHI",
         "T052": "ZTERM", "T077K": "KTOKK", "T077D": "KTOKD"}


def test_s4hana_cloud_baseline_covers_the_compared_objects():
    tables = {t: rows for module in BASELINE_CONFIG["s4hana_cloud"].values() for t, rows in module.items()}
    assert set(_KEYS) <= set(tables)
    for table, key in _KEYS.items():
        assert tables[table], table
        assert all(r.get(key) for r in tables[table]), table


def test_btp_shares_the_s4hana_cloud_baseline():
    assert BASELINE_CONFIG["btp"] is BASELINE_CONFIG["s4hana_cloud"]
