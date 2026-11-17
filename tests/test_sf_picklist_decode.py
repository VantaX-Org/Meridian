from types import SimpleNamespace

import pandas as pd

from api.services.connectivity_manager import unique_option_codes


def test_unique_option_codes_drops_ambiguous_ids():
    opts = {"employee-status": {"101": "A", "102": "T"}, "jobCode": {"102": "X", "200": "J1"}}
    assert unique_option_codes(opts) == {"101": "A", "200": "J1"}


def test_discovery_reads_every_picklist_once():
    from workers.tasks import run_discovery

    calls, stored = [], {}

    class Conn:
        def metadata(self, ent):
            raise RuntimeError("skip")

        def read_entity_set(self, name, select=None, filter_expr=None):
            calls.append(filter_expr)
            return pd.DataFrame([
                {"PickListV2_id": "ecEmplStatus", "externalCode": "A", "status": "A", "optionId": 101},
                {"PickListV2_id": "ecEmplStatus", "externalCode": "T", "status": "I", "optionId": 102},
            ])

    orig_store, orig_snap = run_discovery._store_config, None
    run_discovery._store_config = lambda s, t, sid, m, table, recs: stored.__setitem__(table, recs)
    import api.services.source_design as sd
    orig_snap, sd.store_snapshot = sd.store_snapshot, lambda *a, **k: {}
    try:
        run_discovery._discover_successfactors(SimpleNamespace(), "t", "s", "snap", Conn())
    finally:
        run_discovery._store_config, sd.store_snapshot = orig_store, orig_snap
    assert calls == [None]
    assert stored["PICKLIST"] == [{"ecEmplStatus": "A"}]
    assert {o["optionId"] for o in stored["PICKLIST_OPTION"]} == {"101", "102"}
