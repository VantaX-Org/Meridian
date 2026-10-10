import pandas as pd

from api.services.migration import load_sim
from api.services.s4_readiness import membership
from checks.frames import TableFrames


def _tf(**tables: pd.DataFrame) -> TableFrames:
    return TableFrames(dict(tables))


def _ids(gaps):
    return sorted({g.detail.split(" ", 1)[0] for g in gaps})


def test_matnr_alpha_collision_and_length():
    mara = pd.DataFrame({"MATNR": ["000000000000012345", "12345", "A" * 41, "OK-1", "lower"]})
    gaps = load_sim.check_matnr(_tf(MARA=mara), "material_master")
    by_key = {(g.record_key, g.detail.split(" ", 1)[0]) for g in gaps}
    assert ("MATNR=000000000000012345", "S4L-MM-MATNR-ALPHA") in by_key
    assert ("MATNR=12345", "S4L-MM-MATNR-ALPHA") in by_key
    assert ("MATNR=" + "A" * 41, "S4L-MM-MATNR-LEN") in by_key
    assert ("MATNR=lower", "S4L-MM-MATNR-CHARS") in by_key
    assert not any(k == "MATNR=OK-1" for k, _ in by_key)
    assert all(g.gap_type == "s4_load" and g.target_table == "MARA" for g in gaps)


def test_matnr_absent_table_is_noop():
    assert load_sim.check_matnr(_tf(), "material_master") == []


def test_catalogue_ids_are_prefixed_unique_and_linked():
    rules = load_sim.rules()
    assert rules, "catalogue must not be empty"
    assert all(r.id.startswith("S4L-") for r in rules.values())
    assert len(rules) == len({r.id for r in rules.values()})
    for r in rules.values():
        assert r.severity in {"critical", "high", "medium", "low"}
        assert r.reason and r.target
        assert r.area in {"material", "business_partner", "credit_management", "mrp",
                          "material_ledger", "sales", "output_management", "finance"}


def test_related_ids_exist_in_readiness_pack_or_cvi():
    known = set(membership())
    for r in load_sim.rules().values():
        for cid in r.related:
            assert cid in known or cid.startswith("S4-CVI-") or cid.startswith("S4-CRM-"), (r.id, cid)
