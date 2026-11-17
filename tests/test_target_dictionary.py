"""The load's destination picks the dictionary that template fields and column mappings resolve against."""
from unittest import mock

from api.routes import migration as m


def test_destination_picks_the_release_without_a_system():
    assert m.target_dictionary("t", None, None).release == "s4hana"
    assert m.target_dictionary("t", None, "s4hana").release == "s4hana"
    assert m.target_dictionary("t", None, "ecc").release == "ecc6"
    # SuccessFactors entities are canonical tables: the S/4 baseline carries them
    assert m.target_dictionary("t", None, "successfactors").release == "s4hana"


def test_s4_only_table_resolves_only_for_an_s4_destination():
    s4, ecc = m.target_dictionary("t", None, "s4hana"), m.target_dictionary("t", None, "ecc")
    assert "MATDOC" in s4.tables and "MATDOC" not in ecc.tables


def test_named_system_goes_through_the_tenant_session():
    seen = {}

    class S:
        def __enter__(self):
            return "session"

        def __exit__(self, *a):
            return False

    def fake(session, system_id, release):
        seen.update(session=session, system_id=system_id, release=release)
        return "dictionary"

    with mock.patch("workers.db.get_sync_engine", return_value=None), \
         mock.patch("workers.db.tenant_session", side_effect=lambda eng, tid: (seen.update(tenant=tid), S())[1]), \
         mock.patch("api.services.source_design.dictionary_for", side_effect=fake):
        assert m.target_dictionary("tenant-1", "sys-1", "ecc") == "dictionary"
    assert seen == {"tenant": "tenant-1", "session": "session", "system_id": "sys-1", "release": "ecc"}
