"""A saved per-system snapshot must not freeze an external system's field mapping.

``dictionary_for(session, system_id)`` overlays the system's saved snapshot on the
canonical dictionary, and ``Dictionary.overlay`` preferred the snapshot's ``source`` over
the canonical one. A canonical table (SuccessFactors/Ariba/Concur) has no DDIC to read a
``source`` from, so its snapshot carries whatever the canonical file said when it was
taken — and preferring that froze the mapping for the system's lifetime.

The consequence was concrete: the canonical SuccessFactors file was corrected from
``Goal.*`` to ``Goal_1.*`` (``Goal`` is not an entity set on that tenant), the running
image confirmed the new dictionary, and extraction still read ``Goal`` because a stale
snapshot said so. The module's rules silently went unevaluated and the coverage number
never moved. The canonical file is the authority for a canonical table; the snapshot is
the authority only for the DDIC of an ABAP one.
"""

import pytest

from sap.ddic import get_dictionary


def _stale_snapshot(source: str) -> dict:
    return {
        "GOALPLAN": {
            "description": "Goals",
            "category": "VIEW",
            "fields": [{"name": "GOAL_ID", "key": True, "type": "STRING", "length": 38,
                        "source": source}],
            "foreign_keys": [],
        }
    }


def test_canonical_source_survives_a_stale_snapshot():
    canonical = get_dictionary("s4hana")
    wanted = canonical.table("GOALPLAN").fields["GOAL_ID"].source

    overlaid = canonical.overlay(_stale_snapshot("Goal.id"))
    got = overlaid.table("GOALPLAN").fields["GOAL_ID"].source

    assert got == wanted, (
        f"the snapshot's source {got!r} overrode the canonical {wanted!r}; a corrected "
        f"canonical mapping would never reach extraction"
    )


def test_an_abap_table_snapshot_still_refines_the_dictionary():
    """The other half: ABAP tables must keep taking their fields from the snapshot.

    Only the external-system ``source`` is canonical-owned; a live DDIC read still
    supplies the length, type and check table of an ABAP field.
    """
    canonical = get_dictionary("s4hana")
    live = {
        "MARA": {
            "description": "General material data",
            "category": "TRANSP",
            "fields": [{"name": "MATNR", "key": True, "type": "CHAR", "length": 40,
                        "check_table": None, "domain": None}],
            "foreign_keys": [],
        }
    }
    overlaid = canonical.overlay(live)
    f = overlaid.table("MARA").fields["MATNR"]
    assert f.length == 40 and f.key is True
