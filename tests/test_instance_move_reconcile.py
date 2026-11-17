"""Instance move reconciliation, DQS reasons and delta selection."""

from datetime import datetime

from api.services.migration import instance_move as im


def test_reconcile_counts_missing_extra_and_diffs():
    src = [{"toyId": "1", "v": "a"}, {"toyId": "2", "v": "b"}]
    tgt = [{"toyId": "2", "v": "c"}, {"toyId": "3", "v": "x"}]
    r = im.reconcile_entity("ToyEntity", src, tgt, ["toyId"])
    assert r["missing_in_target"] == ["toyId=1"] and r["extra_in_target"] == ["toyId=3"]
    assert r["field_diffs"] == {"v": 1} and r["sample"] == [{"key": "toyId=2", "field": "v", "source": "b", "target": "c"}]


def test_dqs_block_reasons():
    b = im.dqs_block(70.0, 82.0, None, cells_changed=5, failed_records=2)
    assert (b["source"], b["projected_target"], b["actual_target"]) == (70.0, 82.0, None)
    assert len(b["reasons"]) == 3 and "has not been extracted" in b["reasons"][2]
    assert "applied its own defaults" in im.dqs_block(70.0, 82.0, 80.0)["reasons"][0]
    assert im.dqs_block(70.0, 82.0, 82.0)["reasons"] == []


def test_delta_by_hash_and_modified_date():
    old = {"toyId": "1", "v": "a"}
    recs = [("k1", old), ("k2", {"toyId": "2", "v": "b", "lastModified": "/Date(1767225600000)/"}),
            ("k3", {"toyId": "3", "v": "c", "lastModified": "/Date(1577836800000)/"})]
    hashes = {"k1": im.row_hash(old), "k2": im.row_hash(recs[1][1]), "k3": im.row_hash(recs[2][1])}
    got = im.delta_records(recs, datetime(2025, 1, 1), hashes, ["lastModified"])
    assert [k for k, _ in got] == ["k2"]  # 2026-01-01 is after the cut-off, 2020 is not
    changed = [("k1", {**old, "v": "z"})]
    assert im.delta_records(changed, datetime(2030, 1, 1), hashes) == changed
