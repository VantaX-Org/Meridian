"""A live metadata snapshot of a canonical (cloud) table keeps the canonical source mapping."""

from sap.ddic import dictionary_for_system


def test_overlay_keeps_canonical_source_and_provenance():
    base = dictionary_for_system("successfactors")
    live = {"PEREMAIL": {"table": "PEREMAIL", "fields": [
        {"key": True, "name": "PERSON_ID", "type": "STRING", "length": 100, "source": "PerEmail.personIdExternal"},
        {"key": False, "name": "EMAIL_TYPE", "type": "STRING", "length": 128},
    ]}}
    t = base.overlay(live).table("PEREMAIL")
    assert t.provenance == "canonical:successfactors"
    assert t.note == base.table("PEREMAIL").note
    assert t.fields["PERSON_ID"].source == "PerEmail.personIdExternal"
    assert t.fields["EMAIL_TYPE"].source == "PerEmail.emailType"  # live row without source: bundle's
    assert t.fields["EMAIL_TYPE"].picklist == "ecEmailType"


def test_overlay_of_abap_table_stays_live():
    base = dictionary_for_system("ecc")
    live = {"MARA": {"table": "MARA", "fields": [{"key": True, "name": "MATNR", "type": "CHAR", "length": 40}]}}
    assert base.overlay(live).table("MARA").provenance == "live"
