"""Template integrity: real t-codes, unique ids, rule modules exist, validator clean."""

from pathlib import Path

from api.services.process_model_validator import validate_document
from sap.process_definitions import PROCESS_DEFINITIONS, reference_document

RULES = Path(__file__).resolve().parent.parent / "checks" / "rules"
MODULES = {p.stem for p in RULES.rglob("*.yaml")}
AREAS = {"PTP", "OTC", "R2R", "PP", "PM", "QM", "PS", "WH", "HTR", "MDG", "SFX", "ARB", "CNQ"}


def _l4s():
    return [l4 for l1 in PROCESS_DEFINITIONS for l2 in l1["l2"] for l3 in l2["l3"] for l4 in l3["l4"]]


def test_areas_present():
    assert {l1["id"] for l1 in PROCESS_DEFINITIONS} == AREAS


def test_ptp_otc_ids_stable():
    ids = {l4["id"] for l4 in _l4s()}
    assert {"PTP-VM-FK01", "PTP-PO-ME21N", "PTP-IV-MIRO", "PTP-PAY-F110", "OTC-CM-FD01", "OTC-SO-VA01",
            "OTC-BIL-VF01", "OTC-DUN-F150"} <= ids


def test_every_l4_has_tcode_and_unique_ids():
    seen: list[str] = []
    for l4 in _l4s():
        assert l4["tcode"].strip(), l4["id"]
        seen.append(l4["id"])
        seen += [a["id"] for a in l4["activities"]]
        assert all(a["tcode"].strip() for a in l4["activities"])
    assert len(seen) == len(set(seen))


def test_rule_modules_exist():
    for l4 in _l4s():
        for a in l4["activities"]:
            assert set(a["rule_modules"]) <= MODULES, (a["id"], a["rule_modules"])


def test_every_area_l5_lists_fields_or_probe():
    from sap.process_templates import PROBES
    for l4 in _l4s():
        assert any(a["fields"] for a in l4["activities"]) or l4["id"] in PROBES, l4["id"]


def test_reference_validates():
    assert not validate_document(reference_document()).errors
