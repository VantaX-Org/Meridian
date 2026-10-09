"""SuccessFactors EC depth batch, task A: new extraction targets, canonical dictionary
tables/fields, and column_map entries for EmpJob, PerPerson, User, Position,
PerAddressDEFLT, PerEmergencyContacts, EmpJobRelationships, FOBusinessUnit, FODivision.

No DQ rules are asserted here (task B owns rules) — only that the extraction
registry, canonical dictionary and column_map agree on the new entities.
"""
import yaml

from sap.ddic import get_dictionary
from sap.extraction_registry import get_extraction_targets

D = get_dictionary("s4hana")  # canonical schemas (incl. successfactors.yaml) merge into every release
COLUMN_MAP = yaml.safe_load(open("checks/rules/successfactors/column_map.yaml"))["employee_central"]

NEW_SOURCES = {
    "EmpJob": {"userId", "startDate", "seqNumber"},
    "PerPerson": {"personIdExternal"},
    "User": {"userId"},
    "Position": {"code", "effectiveStartDate"},
    "PerAddressDEFLT": {"personIdExternal", "addressType", "startDate"},
    "PerEmergencyContacts": {"personIdExternal", "name", "relationship"},
    "EmpJobRelationships": {"userId", "relationshipType", "startDate"},
    "FOBusinessUnit": {"externalCode"},
    "FODivision": {"externalCode"},
}


def _targets_by_source():
    targets = get_extraction_targets("successfactors", "employee_central")
    return {t.source: t for t in targets}


def test_new_entities_registered_in_employee_central():
    by_source = _targets_by_source()
    for source, key_fields in NEW_SOURCES.items():
        assert source in by_source, source
        t = by_source[source]
        assert key_fields <= set(t.fields), (source, key_fields - set(t.fields))


def test_new_targets_are_not_config_rows():
    # FOBusinessUnit/FODivision deliberately stay plain targets (is_config=False):
    # is_config=True would flow into sap.config_loader.planned_objects(), which
    # api/services/config_areas.py must also list — out of this task's scope.
    by_source = _targets_by_source()
    for source in NEW_SOURCES:
        assert by_source[source].is_config is False, source


def test_empjobhist_matches_brief_key_fields_and_has_depth_fields():
    # EmpJob's brief-specified keys (userId, startDate, seqNumber) match EMPJOBHIST
    # (the full effective-dated history table), not EMPEMPLOYMENT (current record only).
    t = D.table("EMPJOBHIST")
    assert t is not None
    assert t.keys == ("USERID", "START_DATE", "SEQ_NUMBER")
    for f in ("BUSINESS_UNIT", "DIVISION", "DEPARTMENT", "LOCATION", "COST_CENTER", "JOB_CODE",
              "EMPLOYEE_CLASS", "EMPLOYMENT_TYPE", "PAY_GRADE", "PAY_GROUP", "STANDARD_HOURS",
              "FTE", "TIMEZONE", "COUNTRY_OF_COMPANY", "IS_FULLTIME", "WORK_SCHEDULE",
              "HOLIDAY_CALENDAR", "TIME_TYPE_PROFILE"):
        assert f in t.fields, f
        assert t.fields[f].source.startswith("EmpJob."), f


def test_empemployment_has_the_fields_it_was_missing():
    t = D.table("EMPEMPLOYMENT")
    for f in ("PAY_GRADE", "WORK_SCHEDULE", "HOLIDAY_CALENDAR", "TIME_TYPE_PROFILE", "JOB_END_DATE"):
        assert f in t.fields, f


def test_perinfo_has_bio_fields():
    t = D.table("PERINFO")
    assert t.fields["PLACE_OF_BIRTH"].source == "PerPerson.placeOfBirth"
    assert t.fields["PERSON_UUID"].source == "PerPerson.perPersonUuid"


def test_peraddress_keyed_by_start_date_too():
    t = D.table("PERADDRESS")
    assert t.keys == ("PERSON_ID", "ADDRESS_TYPE", "START_DATE")
    assert t.fields["START_DATE"].source == "PerAddressDEFLT.startDate"


def test_position_has_depth_fields():
    t = D.table("POSITION")
    assert t.keys == ("CODE",)  # current-record convention, matches EMPEMPLOYMENT
    for f, source in {
        "EFFECTIVE_START_DATE": "Position.effectiveStartDate",
        "EFFECTIVE_END_DATE": "Position.effectiveEndDate",
        "BUSINESS_UNIT": "Position.businessUnit",
        "DIVISION": "Position.division",
        "LOCATION": "Position.location",
        "PAY_GRADE": "Position.payGrade",
        "EXTERNAL_NAME": "Position.externalName_defaultValue",
    }.items():
        assert t.fields[f].source == source, f


def test_useraccount_table_exists():
    t = D.table("USERACCOUNT")
    assert t is not None
    assert t.keys == ("USER_ID",)
    assert t.fields["USER_ID"].source == "User.userId"
    assert "MANAGER_ID" not in t.fields  # navigation-only; omitted, see extraction_registry.py comment


def test_empjobrelationships_table_exists():
    t = D.table("EMPJOBRELATIONSHIPS")
    assert t is not None
    assert t.keys == ("USERID", "RELATIONSHIP_TYPE", "START_DATE")
    assert t.fields["RELATED_USER_ID"].source == "EmpJobRelationships.relUserId"


def test_folegalentity_not_added_focompany_covers_it():
    # Decision (see report): FOCompany already models legal entity (EMPEMPLOYMENT.COMPANY
    # description: "Legal entity"); adding a separate FOLegalEntity table would duplicate it.
    assert D.table("FOLEGALENTITY") is None
    assert D.table("FOCOMPANY") is not None


def test_new_dictionary_fields_have_column_map_entries():
    expected = {
        "PAY_GRADE": "EMPEMPLOYMENT.PAY_GRADE",
        "WORK_SCHEDULE": "EMPEMPLOYMENT.WORK_SCHEDULE",
        "HOLIDAY_CALENDAR": "EMPEMPLOYMENT.HOLIDAY_CALENDAR",
        "TIME_TYPE_PROFILE": "EMPEMPLOYMENT.TIME_TYPE_PROFILE",
        "JOB_END_DATE": "EMPEMPLOYMENT.JOB_END_DATE",
        "PLACE_OF_BIRTH": "PERINFO.PLACE_OF_BIRTH",
        "PERSON_UUID": "PERINFO.PERSON_UUID",
        "ADDRESS_START_DATE": "PERADDRESS.START_DATE",
        "JOBHIST_USERID": "EMPJOBHIST.USERID",
        "SEQ_NUMBER": "EMPJOBHIST.SEQ_NUMBER",
        "POSITION_CODE": "POSITION.CODE",
        "POSITION_EFFECTIVE_START_DATE": "POSITION.EFFECTIVE_START_DATE",
        "POSITION_BUSINESS_UNIT": "POSITION.BUSINESS_UNIT",
        "POSITION_EXTERNAL_NAME": "POSITION.EXTERNAL_NAME",
        "USER_ID": "USERACCOUNT.USER_ID",
        "USERNAME": "USERACCOUNT.USERNAME",
        "DEFAULT_LOCALE": "USERACCOUNT.DEFAULT_LOCALE",
        "RELATIONSHIP_TYPE": "EMPJOBRELATIONSHIPS.RELATIONSHIP_TYPE",
        "RELATED_USER_ID": "EMPJOBRELATIONSHIPS.RELATED_USER_ID",
    }
    for col, target in expected.items():
        assert COLUMN_MAP.get(col) == target, col
        table, field = target.split(".")
        assert D.field(table, field) is not None, target  # column_map target actually resolves
