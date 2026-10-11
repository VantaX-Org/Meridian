"""Source dictionary entries match standard SAP schemas."""
import yaml

from sap.extraction_registry import get_extraction_targets

_SF = yaml.safe_load(open("sap/dictionaries/canonical/successfactors.yaml"))["tables"]


def _src(table: str, field: str) -> str:
    return _SF[table]["fields"][field]["source"]


def test_job_requisition_nav_fields_are_expanded():
    assert _src("JOBREQUISITION", "STATUS") == "JobRequisition.status.externalCode"
    assert _src("JOBREQUISITION", "HIRING_MANAGER") == "JobRequisition.hiringManager.userId"
    assert _src("JOBREQUISITION", "RECRUITER") == "JobRequisition.recruiter.userId"


def test_cost_center_and_benefit_user_mappings():
    assert _src("FOCOSTCENTER", "LEGAL_ENTITY") == "FOCostCenter.cust_LegalEntity.externalCode"
    assert _src("BENEFITENROLLMENT", "USERID") == "BenefitEnrollment.userId"


def _fields(module: str, system: str, table: str) -> set[str]:
    return {f for t in get_extraction_targets(system, module) if t.source == table for f in t.fields}


def test_ecc_extraction_has_new_fields():
    assert "SPRAS" in _fields("project_system", "ecc", "T001")
    assert "DIMID" in _fields("material_master", "ecc", "T006")
    assert {"MTART", "BWKEY"} <= _fields("material_master", "ecc", "T134M")
    assert "PRSFD" in _fields("process_discovery", "ecc", "TVAP")
