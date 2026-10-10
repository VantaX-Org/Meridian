"""Deterministic source/target config matching, the baseline fallback and the pair rules."""

from api.services.config_pairing import (
    BASELINE_DETAIL, DESC_MATCH_MAX, MatchRow, baseline_snapshot, compare_object, normalise, normalise_key,
    pair_error, parse_key, with_baseline,
)
from sap.config_snapshot import NOT_AVAILABLE, ConfigItem, ConfigSnapshot


def _i(obj: str, key: str, **vals: str) -> ConfigItem:
    return ConfigItem(obj, key, {**dict(p.split("=", 1) for p in key.split(",")), **vals})


def test_normalise_strips_case_and_leading_zeros():
    assert normalise(" 0001 ") == "1"
    assert normalise("000") == "0"
    assert normalise("kred") == "KRED"
    assert normalise("") == ""


def test_parse_and_normalise_key():
    assert parse_key("WERKS=0001,LGORT=a1") == {"WERKS": "0001", "LGORT": "a1"}
    assert normalise_key("WERKS=0001,LGORT=a1") == "WERKS=1,LGORT=A1"


def test_compare_object_classifies_in_order():
    source = [_i("T077K", "KTOKK=KRED", TXT30="Vendors general"),
              _i("T077K", "KTOKK=kred2", TXT30="Second group"),
              _i("T077K", "KTOKK=LIEF", TXT30="Supplier"),
              _i("T077K", "KTOKK=ZZZZ", TXT30="Nothing like it")]
    target = [_i("T077K", "KTOKK=KRED", TXT30="Vendors general"),
              _i("T077K", "KTOKK=KRED2", TXT30="Other"),
              _i("T077K", "KTOKK=SUPL", TXT30="Supplier")]
    rows = {r.source_key: r for r in compare_object("T077K", source, target)}
    assert rows["KTOKK=KRED"].status == "exists" and not rows["KTOKK=KRED"].proposable
    km = rows["KTOKK=kred2"]
    assert (km.status, km.target_key, km.score, km.field, km.source_value, km.target_value) == \
        ("key_match", "KTOKK=KRED2", 1.0, "KTOKK", "kred2", "KRED2")
    assert km.proposable
    dm = rows["KTOKK=LIEF"]
    assert (dm.status, dm.target_key, dm.field, dm.target_value, dm.score) == \
        ("desc_match", "KTOKK=SUPL", "KTOKK", "SUPL", 1.0)
    assert rows["KTOKK=ZZZZ"].status == "missing" and rows["KTOKK=ZZZZ"].target_key is None


def test_a_match_on_two_key_fields_is_not_proposable():
    source = [_i("T001L", "WERKS=A,LGORT=X", LGOBE="Main store")]
    target = [_i("T001L", "WERKS=B,LGORT=Y", LGOBE="Main store")]
    row = compare_object("T001L", source, target)[0]
    assert row.status == "desc_match" and row.field is None and not row.proposable


def test_description_matching_is_skipped_above_the_cap():
    target = [_i("T006", f"MSEHI=U{n}", MSEHL=f"Unit {n}") for n in range(DESC_MATCH_MAX + 1)]
    row = compare_object("T006", [_i("T006", "MSEHI=XX", MSEHL="Unit 1")], target)[0]
    assert row.status == "missing"


def test_match_row_as_dict_includes_proposable():
    d = MatchRow("T134", "MTART=FERT", "exists", "MTART=FERT", 1.0).as_dict()
    assert d["proposable"] is False and d["object"] == "T134"


def test_baseline_snapshot_and_with_baseline():
    b = baseline_snapshot("s4hana_cloud")
    assert b.origin == "best_practice"
    assert any(i.object == "T001" and i.key == "BUKRS=1010" for i in b.items)
    assert all(st.detail == BASELINE_DETAIL for st in b.objects.values())

    empty = ConfigSnapshot("btp", system_id="sys-1", role="target")
    empty.mark("T001", NOT_AVAILABLE, "no API")
    snap, origin = with_baseline(empty, "btp")
    assert origin == "best_practice" and snap.items and snap.system_id == "sys-1" and snap.role == "target"

    live = ConfigSnapshot("ecc")
    live.mark("T001", NOT_AVAILABLE, "no API")
    live.items.append(_i("T001", "BUKRS=1000"))
    assert with_baseline(live, "ecc") == (live, "connection")


def test_pair_error_messages():
    assert pair_error("source", "target", same=True) == "A system cannot be its own target."
    assert pair_error("source", "source", same=False) == "The assigned system must have the target role."
    assert pair_error("target", "target", same=False) == "A target system cannot have a target of its own."
    assert pair_error("source", "target", same=False) is None
