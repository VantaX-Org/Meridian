"""Move to new instance: plan, pre-flight, cleanse, load, reconcile and delta between two systems.

Every function here is pure. The connector, the status store and the check runner are passed in, so the
worker drives a real target and the tests drive a mocked one. Entity and property names come only from the
data dictionary (``Field.source`` is ``Entity.property``) or from the target's $metadata, never from code.

SuccessFactors waves are ``SF_MOVE_STAGES`` (index = wave): picklists and MDF config, Foundation in check-table
order, job architecture, Position, User, person, employment, job history (two passes), compensation and pay,
cust_ MDF, time config, time data, PMGM and development, recruiting, onboarding, workflow history, attachments.
Dictionary tables load through their mapped fields; every other set of a stage is a raw full-history copy
(``SFRAW_<set>``, every property the tenant returns). Effective-dated rows load oldest first per key.
SAP objects follow the DDIC load plan (``load_plan.build_plan``) as waves ``SAP_WAVE_BASE`` onwards.
"""
from __future__ import annotations

import hashlib
import json
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional, Protocol

import pandas as pd

from api.services.migration.load_plan import EC_LOAD_ORDER, OWNED_TABLES, build_plan

_EC = ("employee_central",)
# (label, modules whose move extracts the stage's raw sets, entity sets in load order). A trailing * is a family.
SF_MOVE_STAGES: tuple[tuple[str, tuple[str, ...], tuple[str, ...]], ...] = (
    ("Picklists and MDF config", _EC, ("PickListV2", "PickListValueV2")),
    ("Foundation", _EC, (
        "FOCompany", "FOBusinessUnit", "FODivision", "FODepartment", "FOLocationGroup", "FOGeozone", "FOLocation",
        "FOCorporateAddressDEFLT", "FOCostCenter", "FOJobFunction", "FOPayGrade", "FOJobCode", "FOPayRange",
        "FOPayGroup", "FOFrequency", "FOPayComponent", "FOPayComponentGroup", "FOPayScaleType", "FOPayScaleArea",
        "FOEventReason", "FOWfConfig", "FODynamicRole", "FoTranslation", "PayScaleType", "PayScaleArea",
        "PayScaleGroup", "PayScaleLevel", "PayScalePayComponent", "JobClassificationCountry", "JobClassificationZAF",
        "Bank")),
    ("Job architecture", _EC, (
        "FamilyEntity", "RoleEntity", "JobCodeMappingEntity", "CompetencyEntity", "RcmCompetency",
        "JobResponsibilityEntity", "RoleCompetencyMappingEntity", "JobDescTemplate", "JobProfile",
        "JobProfileLocalizedData", "JobDescSection", "JobResponsibilityContent")),
    ("Position", _EC, ("Position",)),
    ("User", _EC, ("User", "UserAccount")),
    ("Person", _EC, (
        "PerPerson", "PersonKey", "PerPersonal", "PerGlobalInfo*", "PerAddressDEFLT", "PerPhone", "PerEmail",
        "PerNationalId", "PerSocialAccount", "PerPersonRelationship", "PerEmergencyContacts")),
    ("Employment", _EC, ("EmpEmployment", "EmpGlobalAssignment", "EmpWorkPermit")),
    ("Job history (two passes)", _EC, (
        "EmpJob", "EmpJobRelationships", "SecondaryAssignments", "EmpEmploymentTermination", "HireDateChange")),
    ("Compensation, pay and deductions", ("employee_central", "compensation", "benefits", "payroll_integration"), (
        "EmpCompensation", "EmpPayCompRecurring", "EmpPayCompNonRecurring", "PaymentInformationV3",
        "PaymentInformationDetailV3", "PaymentInformationDetailV3ZAF", "RecurringDeduction",
        "RecurringDeductionItem", "BenefitEnrollment")),
    ("cust_ MDF", _EC, (
        "cust_birthday", "cust_customRetirement_Date", "cust_employeeRelationCase",
        "cust_employeeRelationsCollection", "cust_COVID_19_VACCINE_TRACKING", "cust_HEALTH_STATUS_TRACKING",
        "cust_JobClassificationBWA", "cust_JobClassificationNAM", "cust_JobClassificationMOZ", "cust_MedicalAid",
        "cust_uniform", "cust_Pension", "cust_Union")),
    ("Time config", ("time_attendance",), (
        "TimeType", "TimeAccountType", "TimeTypeProfile", "HolidayCalendar", "Holiday", "HolidayAssignment",
        "WorkSchedule", "WorkScheduleDayModelAssignment", "AvailableTimeType")),
    ("Time data", ("time_attendance",), (
        "TimeAccount", "TimeAccountDetail", "EmployeeTime", "EmployeeTimeCalendar", "EmployeeTimeSheetEntry")),
    ("PMGM and development", ("performance_goals", "succession_planning"), (
        "FormTemplate", "FormFolder", "FormHeader", "FormContent", "FormAuditTrail", "CompetencyContent", "Goal_1",
        "Goal_2", "Goal_9", "Goal_10", "Goal_11", "SimpleGoal", "TalentRatings", "CalibrationSession",
        "CalibrationSessionSubject", "TrendData_SysOverallPerformance", "TrendData_SysOverallObjective",
        "TrendData_SysOverallPotential", "DevGoal_*", "SimpleDevGoal", "Background_*", "TalentPool",
        "NominationTarget", "Successor")),
    ("Recruiting", ("recruiting_onboarding",), (
        "JobRequisition", "JobRequisitionLocale", "JobRequisitionPosting", "JobRequisitionOperator",
        "JobRequisitionScreeningQuestion", "JobRequisitionFOLocation", "Candidate", "CandidateBackground_*",
        "JobApplication", "JobApplicationQuestionResponse", "JobApplicationSnapshot_*", "JobApplicationComments",
        "JobApplicationInterview", "InterviewIndividualAssessment", "InterviewOverallAssessment",
        "JobApplicationAudit", "JobApplicationStatusAuditTrail", "JobReqFwdCandidates", "JobOffer",
        "JobOfferApprover", "OfferLetter")),
    ("Onboarding", ("recruiting_onboarding",), (
        "ONB2Process", "ONB2ProcessTask", "ONB2ProcessTrigger", "ONB2ProcessUserTask", "OnboardingInfo",
        "ONB2EquipmentActivity")),
    ("Workflow history", _EC, (
        "WfRequest", "WfRequestStep", "WfRequestComments", "WfRequestParticipator", "EMEvent", "EMEventAttribute",
        "EMMonitoredProcess", "TodoEntryV2")),
    ("Attachments", _EC, ("Attachment", "Photo")),
)
# Audit trails, snapshots, trend data, workflow and event history: the target API has no create for them, so they
# go out as a read-only history archive (method history_import, exported, never upserted).
SF_HISTORY_IMPORT = ("FormAuditTrail", "JobApplicationAudit", "JobApplicationStatusAuditTrail",
                     "JobApplicationSnapshot_*", "TrendData_*", "WfRequest*", "EMEvent*", "EMMonitoredProcess",
                     "TodoEntryV2")
SF_FILE_LOAD = ("FormHeader", "FormContent")  # forms are created by the form engine, not by OData upsert
# Sets the BizX OData API does not serve on this tenant: stated in every plan, never assumed empty.
SF_NOT_REACHABLE: dict[str, str] = {
    "ExternalLearner*": "Learning (LMS) data is on the LMS odatav4 API, not BizX OData; not extracted",
    "Achievement": "COE0025 Unsupported feature on this tenant",
    "Activity": "COE0025 Unsupported feature on this tenant",
    "ContinuousFeedback*": "COE0025 Unsupported feature on this tenant",
    "CPM*": "COE0025 Unsupported feature on this tenant (Continuous Performance Management)",
    "Background_VarPayEmpHistData": "COE0020 permission error for the API user",
}
WAVE_LABELS = {i: label for i, (label, _, _) in enumerate(SF_MOVE_STAGES)}
SAP_WAVE_BASE = len(SF_MOVE_STAGES)
_OTHER_WAVE = 12  # an SF entity no stage names loads with PMGM and development
_PERSON_COLS = ("USERID", "PERSON_ID", "USER_ID", "PERSON_ID_EXTERNAL")
_EFFECTIVE_KEYS = ("START_DATE", "EFFECTIVE_DATE", "EFFECTIVESTARTDATE")
_EFFECTIVE_PROPS = ("effectiveStartDate", "startDate")  # sap.successfactors.HISTORY_DATES
_HISTORY_PARTS = {*_EFFECTIVE_KEYS, "EFFECTIVE_START_DATE", "SEQ_NUMBER", *_EFFECTIVE_PROPS, "seqNumber"}
RAW_PREFIX = "SFRAW_"
_RAW_PERSON_PROPS = ("userId", "personIdExternal")  # person keys of the BizX entities (sap/successfactors.py)
# Edm.Binary properties (base64) of the file sets, per SAP's SF OData reference: never held in a frame. The
# extract writes each value to object storage page by page and keeps "<prop>@ref" (the object name); the load
# reads it back one batch at a time, just before that batch is sent.
SF_BLOB_PROPS = {"Attachment": "fileContent", "Photo": "photo"}
BLOB_REF = "@ref"
_CHANGE_DOCS = ("CDHDR", "CDPOS")
_PICKLIST = "PickListValueV2"
_CLOUD_KEYS = {_PICKLIST: ["PickListV2_id", "externalCode"]}  # mirrors sap/config_loader._CLOUD_KEYS
BATCH_PERSONS = 200
ERROR_THRESHOLD = 0.05
SAMPLE_CAP = 100
MAX_PASSES = 3
REFUSED = "credentials refused"
UNREACHABLE = "target not reachable or credentials refused"


# ── dictionary helpers ───────────────────────────────────────────────────────


def _entity_prop(source: str | None) -> tuple[str, str] | None:
    """``Entity.property`` from a dictionary ``Field.source``; None when it is not one."""
    head = (source or "").split(" ")[0]
    if "." not in head:
        return None
    ent, prop = head.split(".", 1)
    return (ent, prop) if ent and prop else None


def _is_sf(table) -> bool:
    return table is not None and str(getattr(table, "provenance", "")).startswith("canonical:successfactors")


def table_entity(table) -> tuple[Optional[str], str]:
    """The SF entity a dictionary table loads into, else (None, reason).

    The entity is the one most key fields come from; a tie goes to the entity with the most fields."""
    keys = Counter(ep[0] for f in table.fields.values() if f.key and (ep := _entity_prop(f.source)))
    every = Counter(ep[0] for f in table.fields.values() if (ep := _entity_prop(f.source)))
    if not every:
        return None, "the dictionary names no SuccessFactors entity for this table"
    pool = keys or every
    top = max(pool.values())
    ent = max((e for e, n in pool.items() if n == top), key=lambda e: (every[e], e))
    if "*" in ent:
        return None, f"the dictionary names a wildcard entity ({ent}); the country entity must be chosen per target"
    if not ent[0].isupper():
        return None, f"{ent} is not an OData entity name (it is an API path); no upsert target"
    return ent, ""


def entity_fields(table, entity: str) -> dict[str, Any]:
    """property -> dictionary Field for the fields of ``table`` that belong to ``entity``."""
    return {ep[1]: f for f in table.fields.values() if (ep := _entity_prop(f.source)) and ep[0] == entity}


# ── plan ─────────────────────────────────────────────────────────────────────


def _rows(frames, table: str) -> tuple[int, int]:
    df = frames.frames.get(table) if frames is not None else None
    if df is None or len(df) == 0:
        return 0, 0
    person = next((f"{table}.{c}" for c in _PERSON_COLS if f"{table}.{c}" in df.columns), None)
    n = len(df)
    return n, (n - df[person].nunique()) if person else 0


def _match(name: str, patterns: Iterable[str]) -> bool:
    """``name`` is one of ``patterns``; a pattern ending in ``*`` matches by prefix."""
    return any(name == p or (p.endswith("*") and name.startswith(p[:-1])) for p in patterns)


def stage_of(entity: str) -> int:
    """The SF_MOVE_STAGES wave an entity loads in; an entity no stage names loads with PMGM."""
    return next((i for i, (_, _, sets) in enumerate(SF_MOVE_STAGES) if _match(entity, sets)), _OTHER_WAVE)


def method_of(entity: str) -> str:
    """history_import (read-only archive: audit trails, workflow, event history), file_load (forms) or upsert."""
    if _match(entity, SF_HISTORY_IMPORT):
        return "history_import"
    return "file_load" if _match(entity, SF_FILE_LOAD) else "upsert"


def not_reachable(entity: str) -> Optional[str]:
    return next((why for p, why in SF_NOT_REACHABLE.items() if _match(entity, (p,))), None)


def _effective(table, entity: str) -> Optional[str]:
    """The dictionary field that dates one record of ``table`` (start or effective date), else None."""
    key = next((k for k in table.keys if k in _EFFECTIVE_KEYS), None)
    if key:
        return key
    return next((f.name for p, f in entity_fields(table, entity).items() if p in _EFFECTIVE_PROPS), None)


def _order(steps: list[dict]) -> list[dict]:
    """Topological order on check_table within one wave (Kahn), EC_LOAD_ORDER breaking ties. A cycle is cut
    at the first table by EC_LOAD_ORDER: its references to tables not yet loaded go to a second pass."""
    rank = {t: i for i, t in enumerate(EC_LOAD_ORDER)}
    tie = {id(s): (rank.get(s["table"], len(rank)), s["table"]) for s in steps}
    ents = {s["entity"] for s in steps}
    need = {id(s): {r for r in s.pop("_refs").values() if r in ents and r != s["entity"]} for s in steps}
    done: set[str] = set()
    left, out = list(steps), []
    while left:
        ready = [s for s in left if need[id(s)] <= done] or [min(left, key=lambda s: tie[id(s)])]
        nxt = min(ready, key=lambda s: tie[id(s)])
        nxt["_late"] += sorted(p for p, r in nxt["_ref_props"].items() if r in ents and r not in done | {nxt["entity"]})
        out.append(nxt)
        left.remove(nxt)
        done.add(nxt["entity"])
    return out


def _sf_steps(module: str, dictionary, frames, unplaced: list) -> list[dict]:
    out = []
    for t in OWNED_TABLES.get(module, []):
        tb = dictionary.table(t)
        if tb is None:
            unplaced.append({"module": module, "table": t, "reason": "not in the data dictionary"})
            continue
        ent, why = table_entity(tb)
        if ent is None:
            unplaced.append({"module": module, "table": t, "reason": why})
            continue
        for other in sorted({ep[0] for f in tb.fields.values() if (ep := _entity_prop(f.source))} - {ent}):
            unplaced.append({"module": module, "table": t, "entity": other,
                             "reason": f"fields of {other} sit on {t}; they load with no step of their own"})
        props = entity_fields(tb, ent)
        refs = {p: f.check_table for p, f in props.items() if f.check_table and not f.key}
        eff = _effective(tb, ent)
        rows, hist = _rows(frames, t)
        out.append({"module": module, "table": t, "entity": ent, "wave": stage_of(ent), "method": method_of(ent),
                    "rows": rows, "history_rows": hist, "purge_type": "full" if eff else None, "effective": eff,
                    "pass": 1, "fields": None, "_refs": refs, "_ref_props": refs,
                    # a reference to itself (parent division, manager) can only point at a record already loaded
                    "_late": sorted(p for p, r in refs.items() if r == ent)
                    + [p for p, f in props.items() if f.name == "MANAGER_ID"]})
    return out


def _second_passes(steps: list[dict], dictionary) -> list[dict]:
    """Pass-2 steps (keys plus the late references) for every step that held references back in pass 1."""
    late = []
    for s in steps:
        fields = s.pop("_late", [])
        s.pop("_ref_props", None)
        if not fields or s["method"] != "upsert":
            continue
        props = entity_fields(dictionary.table(s["table"]), s["entity"])
        s["exclude"] = fields
        late.append({**s, "pass": 2, "purge_type": None, "exclude": [],
                     "fields": list(dict.fromkeys([
                         *(props[p].name for p in _key_props(dictionary.table(s["table"]), s["entity"])),
                         *(props[p].name for p in fields), *([s["effective"]] if s.get("effective") else [])]))})
    return late


def _key_props(table, entity: str) -> list[str]:
    return [p for p, f in entity_fields(table, entity).items() if f.key]


def _raw_steps(modules: list[str], covered: set[str], frames, unplaced: list) -> list[dict]:
    """A step for every SF_MOVE_STAGES set of ``modules`` that no dictionary table loads: the whole entity
    set as extracted (SFRAW_<set>, every property, every effective-dated record). A family (``X*``) expands
    to the sets the extract found; the not-reachable sets are listed in the plan, never loaded."""
    have = sorted(k[len(RAW_PREFIX):] for k in (frames.frames if frames is not None else {})
                  if k.startswith(RAW_PREFIX))
    out = []
    for wave, (_, mods, sets) in enumerate(SF_MOVE_STAGES):
        mod = next((m for m in modules if m in mods), None)
        if mod is None:
            continue
        for pattern in sets:
            names = [n for n in have if _match(n, (pattern,))] if pattern.endswith("*") else [pattern]
            if not names:
                unplaced.append({"module": mod, "entity": pattern,
                                 "reason": "the entity family expands from the move extract; none extracted yet"})
            for ent in names:
                if ent in covered or not_reachable(ent):
                    continue
                df = frames.frames.get(RAW_PREFIX + ent) if frames is not None else None
                out.append({"module": mod, "table": RAW_PREFIX + ent, "entity": ent, "wave": wave,
                            "method": method_of(ent), "rows": 0 if df is None else len(df), "history_rows": 0,
                            "purge_type": None, "effective": None, "pass": 1, "fields": None, "raw": True})
                covered = covered | {ent}
    return out


def build_move_plan(modules: Iterable[str], dictionary, frames=None, columns_of=None,
                    config_lists: Optional[dict] = None, mode: str = "cleansed") -> dict:
    """Waves of steps for ``modules``. ``config_lists`` is the result of ``config_diff`` (picklists and FO/MDF
    lists), which adds one config step to wave 0 and narrows FO steps to the values the target lacks."""
    modules = list(dict.fromkeys(modules))
    unplaced: list[dict] = []
    steps: list[dict] = []
    sap_modules = []
    sf: list[dict] = []
    sf_modules = []
    for m in modules:
        first = dictionary.table(OWNED_TABLES[m][0]) if OWNED_TABLES.get(m) else None
        if _is_sf(first):
            sf_modules.append(m)
            sf.extend(_sf_steps(m, dictionary, frames, unplaced))
        else:
            sap_modules.append(m)
    by_wave: dict[int, list[dict]] = {}
    for s in sf:
        by_wave.setdefault(s["wave"], []).append(s)
    for w in sorted(by_wave):
        ordered = _order(by_wave[w])
        steps += ordered + _second_passes(ordered, dictionary)  # pass 2 runs once the whole wave is in
    steps += _raw_steps(sf_modules, {s["entity"] for s in sf}, frames, unplaced)
    if sap_modules:
        from checks.runner import get_required_columns
        lp = build_plan(sap_modules, dictionary, columns_of or get_required_columns)
        unplaced += [{"module": m, "reason": "no load object for this module in the data dictionary"}
                     for m in lp.unknown]
        for o in lp.objects:
            for t in o.tables:
                rows, hist = _rows(frames, t)
                steps.append({"module": o.module, "table": t, "entity": t, "wave": SAP_WAVE_BASE + o.step,
                              "method": "archive_only" if t in _CHANGE_DOCS else
                              ("bapi" if o.module == "material_master" else "file_load"),
                              "rows": rows, "history_rows": hist, "purge_type": None, "pass": 1, "fields": None})
    loaded = {s["entity"] for s in steps}
    for name, v in sorted((config_lists or {}).items()):
        if name not in loaded and v["create_values"]:  # lists with a data step are narrowed by config_filter
            steps.insert(0, {"module": "config", "table": None, "entity": name, "wave": 0, "method": "config_create",
                             "rows": len(v["create_values"]), "history_rows": 0, "purge_type": None, "pass": 1,
                             "fields": None})
    waves: dict[int, list[dict]] = {}
    for s in steps:
        waves.setdefault(s["wave"], []).append(s)
    out: list[dict] = []
    prev: list[str] = []
    for w in sorted(waves):
        for s in waves[w]:
            s["depends_on"] = prev
        prev = sorted({s["entity"] for s in waves[w]})
        out.append({"wave": w, "label": WAVE_LABELS.get(w, f"SAP load step {w - SAP_WAVE_BASE}"), "steps": waves[w]})
    return {"modules": modules, "mode": mode, "waves": out, "unplaced": unplaced,
            "not_reachable": [{"entity": p, "reason": why} for p, why in SF_NOT_REACHABLE.items()]
            if sf_modules else [],
            "config": {k: {n: v[n] for n in ("present", "create", "conflict")} for k, v in (config_lists or {}).items()}}


def public_plan(plan: dict) -> dict:
    """The plan as the API returns it (internal step fields dropped)."""
    keep = ("module", "entity", "method", "rows", "history_rows", "purge_type", "depends_on", "raw")
    return {**plan, "waves": [{"wave": w["wave"], "label": w["label"],
                               "steps": [{k: s.get(k) for k in keep} for s in w["steps"]]} for w in plan["waves"]]}


# ── records ──────────────────────────────────────────────────────────────────


def _odata_date(v):
    try:
        ts = pd.to_datetime(str(v), utc=True)
    except (ValueError, TypeError):
        return v
    return v if pd.isna(ts) else f"/Date({int(ts.timestamp() * 1000)})/"


def step_records(step: dict, frames, dictionary, id_map: Optional[dict] = None) -> list[tuple[str, dict]]:
    """(record key, SF payload) for each row of the step's table. Blank values are left out, dates become
    OData dates, and ``id_map`` (old id -> new id, identity when absent) rewrites keys, person ids and
    references to User or PerPerson."""
    if step["method"] != "upsert":
        return []
    tb = dictionary.table(step["table"])
    df = frames.plain(step["table"]) if frames is not None else None
    if df is None:
        return []
    props = entity_fields(tb, step["entity"])
    if step.get("fields"):
        props = {p: f for p, f in props.items() if f.name in step["fields"]}
    props = {p: f for p, f in props.items() if p not in (step.get("exclude") or []) and f.name in df.columns}
    mapped = {f.name for f in props.values()
              if id_map and (f.key or f.name in _PERSON_COLS or f.check_table in ("User", "PerPerson"))}
    eff = step.get("effective")
    if eff and eff in df.columns:  # oldest record first: SF builds each later slice on the one before
        df = df.iloc[pd.to_datetime(df[eff], errors="coerce", utc=True).argsort(kind="stable")]
    tag = eff if eff and eff in df.columns and eff not in tb.keys else None
    out = []
    for row in df.to_dict("records"):
        rec = {}
        for p, f in props.items():
            v = row.get(f.name)
            if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == "":
                continue
            v = (id_map or {}).get(str(v), v) if f.name in mapped else v
            rec[p] = _odata_date(v) if str(f.type).upper() in ("DATE", "DATETIME", "DATS") else v
        out.append((f"{row['__key__']}|{tag}={row.get(tag)}" if tag else row["__key__"], rec))
    return out


def raw_records(step: dict, frames, id_map: Optional[dict] = None) -> list[tuple[str, dict]]:
    """(record key, payload) for a raw SFRAW_ step: every property the extract read, blanks left out, oldest
    effective-dated record first. The key is the $metadata key the extract wrote to ``__raw_key__``."""
    df = frames.frames.get(step["table"]) if frames is not None else None
    if df is None or len(df) == 0:
        return []
    pre = step["table"] + "."
    df = df.rename(columns=lambda c: c[len(pre):] if c.startswith(pre) else c)
    eff = next((c for c in _EFFECTIVE_PROPS if c in df.columns), None)
    if eff:
        df = df.iloc[pd.to_datetime(df[eff], errors="coerce", utc=True).argsort(kind="stable")]
    out = []
    for i, row in enumerate(df.to_dict("records")):
        key = str(row.pop("__raw_key__", "") or f"row:{i}")
        rec = {p: (id_map or {}).get(str(v), v) if p in _RAW_PERSON_PROPS else v for p, v in row.items()
               if not (v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == "")}
        out.append((key, rec))
    return out


def spool_blobs(prefix: str, prop: str, put: Callable[[str, bytes], None]) -> Callable[[list[dict]], None]:
    """An ``on_page`` hook for SuccessFactorsConnector.read_entity_set: each record's ``prop`` goes to
    ``put(name, bytes)`` under ``prefix`` + its sha256 (the same file is stored once) and the record keeps
    ``prop@ref`` = that name instead. A blank value stays blank."""
    def hook(page: list[dict]) -> None:
        for rec in page:
            v = rec.pop(prop, None)
            if v:
                data = v.encode() if isinstance(v, str) else bytes(v)
                name = prefix + hashlib.sha256(data).hexdigest()
                put(name, data)
                rec[prop + BLOB_REF] = name
    return hook


def with_blobs(records: list[dict], fetch: Callable[[str], bytes]) -> list[dict]:
    """``records`` with every ``prop@ref`` read back into ``prop`` (base64 text, as the source returned it)."""
    return [{(p[:-len(BLOB_REF)] if p.endswith(BLOB_REF) else p): (fetch(v).decode() if p.endswith(BLOB_REF) else v)
             for p, v in r.items()} for r in records]


def _fetch_blob(name: str) -> bytes:
    from api.config import settings
    from api.services.storage import download_file
    return download_file(settings.minio_bucket_uploads, name)


def person_batches(step: dict, records: list[tuple[str, dict]], size: int = BATCH_PERSONS) -> list[list]:
    """Batches of whole persons (every effective-dated row of one person in one call), at most ``size`` persons
    per batch; records with no person go ``size`` to a batch."""
    def person(key: str) -> str:
        parts = dict(p.split("=", 1) for p in key.split("|") if "=" in p)
        who = next((parts[c] for c in (*_PERSON_COLS, *_RAW_PERSON_PROPS) if c in parts), None)
        # no person: one key's effective-dated records still travel together
        return who or "|".join(f"{k}={v}" for k, v in parts.items() if k not in _HISTORY_PARTS) or key
    groups: dict[str, list] = {}
    for kr in records:
        groups.setdefault(person(kr[0]), []).append(kr)
    batches, cur = [], []
    for g in groups.values():
        cur.append(g)
        if len(cur) >= size:
            batches.append([r for p in cur for r in p])
            cur = []
    if cur:
        batches.append([r for p in cur for r in p])
    return batches


# ── config lists ─────────────────────────────────────────────────────────────


def _list_keys(name: str, dictionary=None) -> list[str]:
    if name in _CLOUD_KEYS:
        return _CLOUD_KEYS[name]
    if dictionary is not None:
        tb = dictionary.table(name.upper())
        if tb is not None:
            ks = [ep[1] for f in tb.fields.values() if f.key and (ep := _entity_prop(f.source))]
            if ks:
                return ks
    return ["externalCode"]


def config_diff(source_lists: dict[str, list[dict]], target_lists: dict[str, list[dict]],
                dictionary=None) -> dict[str, dict]:
    """Per list: values already in the target (present), values to create (create) and values whose label or
    status differ in the target (conflict, skipped). Only values the target lacks are planned; nothing in the
    target is overwritten."""
    out = {}
    for name, rows in source_lists.items():
        keys = _list_keys(name, dictionary)
        tgt = {tuple(str(r.get(k)) for k in keys): r for r in target_lists.get(name) or []}
        present, create, conflict = [], [], []
        for r in rows:
            k = tuple(str(r.get(c)) for c in keys)
            t = tgt.get(k)
            if t is None:
                create.append(r)
                continue
            diff = {c: (r.get(c), t.get(c)) for c in set(r) & set(t) - set(keys) - {"__metadata"}
                    if str(r.get(c) or "") != str(t.get(c) or "")}
            (conflict.append({"key": dict(zip(keys, k)), "differs": diff}) if diff else present.append(r))
        out[name] = {"present": len(present), "create": len(create), "conflict": len(conflict),
                     "create_values": create, "conflicts": conflict, "keys": keys,
                     "target_keys": sorted(list(k) for k in tgt),
                     "target_codes": sorted([list(k) for k in tgt] + [[str(r.get(c)) for c in keys] for r in create])}
    return out


def config_filter(step: dict, records: list[tuple[str, dict]], config: dict) -> list[tuple[str, dict]]:
    """The step's records minus the values the target already holds (present or conflicting); nothing in the
    target is overwritten. Steps whose entity the diff does not know pass through unchanged."""
    c = config.get(step["entity"])
    if not c:
        return records
    have = {tuple(k) for k in c["target_keys"]}
    return [(k, r) for k, r in records if tuple(str(r.get(x)) for x in c["keys"]) not in have]


def config_records(name: str, config: dict) -> list[tuple[str, dict]]:
    """(key, payload) for the values of one list the target lacks."""
    c = config[name]
    return [("|".join(f"{k}={r.get(k)}" for k in c["keys"]), {p: v for p, v in r.items() if p != "__metadata"})
            for r in c["create_values"]]


def reference_issues(step: dict, records: list[tuple[str, dict]], dictionary, config: dict) -> list[dict]:
    """Blocking errors for references that resolve to neither a target value nor a planned one. A reference is
    a field with a check table on ``externalCode`` or a picklist; lists the diff does not know are skipped."""
    tb = dictionary.table(step["table"]) if step.get("table") else None
    if tb is None:
        return []
    out = []
    for p, f in entity_fields(tb, step["entity"]).items():
        if f.picklist and _PICKLIST in config:
            known = {c[1] for c in config[_PICKLIST]["target_codes"] if c[0] == str(f.picklist)}
            if not any(c[0] == str(f.picklist) for c in config[_PICKLIST]["target_codes"]):
                continue
        elif f.check_table and (f.check_field or "").lower() == "externalcode" and f.check_table in config:
            known = {c[0] for c in config[f.check_table]["target_codes"]}
        else:
            continue
        bad = [k for k, r in records if p in r and str(r[p]) not in known]
        if bad:
            out.append({"entity": step["entity"], "field": p, "records": bad[:SAMPLE_CAP], "severity": "error",
                        "reason": f"{len(bad)} value(s) of {p} exist neither in the target nor in the planned "
                                  f"{f.picklist or f.check_table} values"})
    return out


# ── metadata pre-flight ──────────────────────────────────────────────────────


def _attr(el, suffix: str) -> Optional[str]:
    return next((v for k, v in el.attrib.items() if k.split("}")[-1] == suffix), None)


def parse_metadata(xml: str) -> dict[str, dict]:
    """entity -> {properties: {name: {required}}, upsertable, creatable, updatable} from a $metadata document."""
    root = ET.fromstring(xml)
    types: dict[str, dict] = {}
    sets: dict[str, dict] = {}
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag == "EntityType":
            props = {}
            for p in el:
                if p.tag.split("}")[-1] == "Property":
                    req = (_attr(p, "required") or "").lower() == "true" or (_attr(p, "Nullable") or "") == "false"
                    props[p.get("Name", "")] = {"required": req}
            types[el.get("Name", "")] = {"properties": props,
                                     **{a: (_attr(el, a) or "true").lower() != "false"
                                        for a in ("upsertable", "creatable", "updatable")}}
        elif tag == "EntitySet":
            sets[el.get("Name", "")] = {a: (_attr(el, a) or "true").lower() != "false"
                                    for a in ("upsertable", "creatable", "updatable")}
    for name, flags in sets.items():
        if name in types:
            types[name].update({a: types[name][a] and flags[a] for a in flags})
    return types


def metadata_issues(step: dict, records: list[tuple[str, dict]], meta: dict) -> list[dict]:
    """Errors for a missing entity, a missing field or an empty required field; a warning (and the step goes
    archive_only) when the target does not accept upserts on the entity."""
    ent = step["entity"]
    if step["method"] not in ("upsert", "config_create"):
        return []
    m = meta.get(ent)
    if m is None:
        return [{"entity": ent, "field": None, "records": [], "severity": "error",
                 "reason": f"{ent} is not in the target's $metadata"}]
    out = []
    if not (m["upsertable"] and (m["creatable"] or m["updatable"])):
        step["method"] = "archive_only"
        out.append({"entity": ent, "field": None, "records": [], "severity": "warning",
                    "reason": f"the target does not accept upserts on {ent}; its rows go to the archive file"})
        return out
    sent = {p.removesuffix(BLOB_REF) for _, r in records for p in r}
    for p in sorted(sent - set(m["properties"]) - {"__metadata"}):
        out.append({"entity": ent, "field": p, "records": [], "severity": "error",
                    "reason": f"{ent}.{p} is not in the target's $metadata"})
    for p, d in m["properties"].items():
        if not d["required"]:
            continue
        missing = [k for k, r in records if p not in r]
        if missing and step.get("pass", 1) == 1:
            out.append({"entity": ent, "field": p, "records": missing[:SAMPLE_CAP], "severity": "error",
                        "reason": f"{len(missing)} record(s) have no value for the required field {p}"})
    return out


def key_conflicts(step: dict, records: list[tuple[str, dict]], target_rows: list[dict], key_props: list[str]) -> list[dict]:
    """Warn when a source key already exists in the target with different data."""
    if not key_props:
        return []
    tgt = {tuple(str(r.get(k)) for k in key_props): r for r in target_rows}
    bad = []
    for key, r in records:
        t = tgt.get(tuple(str(r.get(k)) for k in key_props))
        if t is not None and any(str(t.get(p)) != str(v) for p, v in r.items() if p in t):
            bad.append(key)
    return [{"entity": step["entity"], "field": None, "records": bad[:SAMPLE_CAP], "severity": "warning",
             "reason": f"{len(bad)} record(s) already exist in the target with different data; the upsert replaces it"}] if bad else []


# ── safety ───────────────────────────────────────────────────────────────────


def _norm_url(u: Optional[str]) -> str:
    return (u or "").strip().lower().rstrip("/")


def same_system(a: dict, b: dict) -> bool:
    """True when ``a`` and ``b`` reach the same data. Cloud systems compare base URL and company id (one host
    may serve several companies); RFC systems compare host, client and system number."""
    if a.get("id") and str(a.get("id")) == str(b.get("id")):
        return True
    if a.get("base_url") or b.get("base_url"):
        return _norm_url(a.get("base_url")) == _norm_url(b.get("base_url")) and \
            str(a.get("company_id") or "").strip().lower() == str(b.get("company_id") or "").strip().lower()
    return all(str(a.get(k) or "").strip().lower() == str(b.get(k) or "").strip().lower()
               for k in ("host", "client", "sysnr"))


def check_safety(source: dict, target: dict, dry_run: bool) -> Optional[str]:
    """The refusal, or None. A live run needs a target flagged as a migration target; source and target must
    differ for every run."""
    if same_system(source, target):
        return "Source and target are the same system; a move needs two different systems."
    if not dry_run and not target.get("migration_target"):
        return "The target system is not flagged as a migration target; flag it before a live load."
    return None


def auth_preflight(connector) -> Optional[str]:
    """One request to the target before any load. Returns the stop reason, or None when the target answered.
    Never retried: repeated attempts with wrong credentials lock the account."""
    try:
        ok = connector.ping()
    except Exception:  # noqa: BLE001 - any raise is a refusal, the message may carry the credential
        return REFUSED
    return None if ok else UNREACHABLE


# ── cleansing ────────────────────────────────────────────────────────────────


def _diff_cells(before, after, table: str, rule_of: dict, source_of: dict) -> list[dict]:
    a, b = before.plain(table), after.plain(table)
    if a is None or b is None:
        return []
    out = []
    for col in [c for c in a.columns if c != "__key__" and c in b.columns]:
        x, y = a[col].astype("string").fillna(""), b[col].astype("string").fillna("")
        for i in (x != y).to_numpy().nonzero()[0]:
            k, f = a["__key__"].iat[i], f"{table}.{col}"
            out.append({"record_key": k, "field": f, "old": x.iat[i], "new": y.iat[i],
                        "rule_id": rule_of.get((f, k)), "source": source_of.get((f, k), "rule")})
    return out


def cleanse(frames, rules: dict[str, dict], check_fn: Callable, steward_fixes: Iterable[dict] = (),
            workbook_fixes: Iterable[dict] = (), weights: Optional[dict] = None, max_passes: int = MAX_PASSES) -> dict:
    """Auto-cleansing for a cleansed move, reusing fix simulation.

    Each pass runs every enabled rule, takes the high-confidence rule proposals (remediation.auto_approvable),
    lets approved steward fixes and workbook values override them on the same cell (a human value beats a rule),
    patches a copy and logs every changed cell. Stops when a pass changes nothing, at most ``max_passes``.
    No value is invented and no row is dropped: a record still failing is loaded as it is and listed."""
    from api.services.fix_simulation import apply_fixes, dqs_delta, rule_record_fixes
    from api.services.remediation import auto_approvable, has_value

    human = {}
    for src, items in (("workbook", workbook_fixes), ("steward", steward_fixes)):  # steward wins over workbook
        for i in items:
            if i.get("field") and i.get("record_key") and has_value(i.get("proposed_value")):
                human[(i["field"], i["record_key"])] = {**i, "source": src}
    before_results = check_fn(frames)
    results, cur, log, passes = before_results, frames, [], 0
    for _ in range(max_passes):
        fixes: dict[tuple, dict] = {}
        rule_of: dict[tuple, Any] = {}
        source_of: dict[tuple, Any] = {}
        for r in results:
            rule = rules.get(r.check_id)
            if rule is None or r.passed or r.error:
                continue
            for fx in rule_record_fixes(rule, r, cur):
                if auto_approvable({**fx, "proposed_value": fx["new_value"]}):
                    fixes.setdefault((fx["field"], fx["record_key"]), fx)
                    rule_of.setdefault((fx["field"], fx["record_key"]), r.check_id)
        for k, h in human.items():
            fixes[k] = {"field": k[0], "record_key": k[1], "new_value": h["proposed_value"]}
            rule_of[k], source_of[k] = h.get("check_id"), h["source"]
        if not fixes:
            break
        patched, stats = apply_fixes(cur, record_fixes=list(fixes.values()))
        if not stats["cells_changed"]:
            break
        passes += 1
        for t in stats["tables"]:
            log += _diff_cells(cur, patched, t, rule_of, source_of)
        cur = patched
        human = {}  # applied once; later passes only see what the rules still propose
        results = check_fn(cur)
    unfixable = []
    for r in results:
        if r.passed or r.error:
            continue
        for k in r.failing_record_keys or []:
            unfixable.append({"rule": r.check_id, "field": r.field, "record_key": k,
                              "current_value": _cell(cur, r.field, k),
                              "reason": "no high-confidence rule fix or approved value; loaded as it is"})
    per_rule = Counter(c["rule_id"] or c["source"] for c in log)
    return {"frames": cur, "log": log, "unfixable": unfixable, "passes": passes,
            "summary": {"cells_fixed_per_rule": dict(per_rule),
                        "records_still_failing": len({u["record_key"] for u in unfixable}),
                        "dqs": dqs_delta(before_results, results, weights)},
            "before_results": before_results, "after_results": results}


def _cell(frames, field: Optional[str], key: str):
    if not field or "." not in field:
        return None
    t, c = field.split(".", 1)
    df = frames.plain(t)
    if df is None or c not in df.columns:
        return None
    hit = df.loc[df["__key__"] == key, c]
    return None if hit.empty else hit.iat[0]


# ── loader ───────────────────────────────────────────────────────────────────


class Store(Protocol):
    def record(self, entity: str, pass_no: int, batch: int, rows: list[dict]) -> None: ...
    def checkpoint(self, wave: int, entity: str, pass_no: int, batch: int) -> None: ...
    def done(self, entity: str, pass_no: int, batch: int) -> bool: ...
    def stopped(self) -> bool: ...


class MemoryStore:
    """In-process store (tests and dry runs without a database)."""

    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.checkpoints: set[tuple] = set()
        self.stop = False

    def record(self, entity, pass_no, batch, rows):
        self.rows += [{"entity": entity, "pass": pass_no, "batch": batch, **r} for r in rows]

    def checkpoint(self, wave, entity, pass_no, batch):
        self.checkpoints.add((entity, pass_no, batch))

    def done(self, entity, pass_no, batch):
        return (entity, pass_no, batch) in self.checkpoints

    def stopped(self):
        return self.stop


def load(plan_steps: list[dict], connector, store: Store, dry_run: bool = True, waves: Optional[set] = None,
         threshold: float = ERROR_THRESHOLD, only: Optional[set] = None,
         fetch: Callable[[str], bytes] = _fetch_blob) -> dict:
    """Send the steps' batches wave by wave. ``plan_steps`` carry ``batches`` (lists of (key, payload)).

    A dry run never touches the target and marks every record validated. A live run sends one ping first and
    stops the whole move on any auth failure, sending nothing. A wave whose error rate passes ``threshold``
    stops the run. Checkpointed batches are skipped (resume); ``only`` = {(entity, key)} resends just those
    records (retry failed). Steps that are not upserts are marked exported: their rows go out as files."""
    report: dict[str, Any] = {"status": "completed", "reason": None, "waves": []}
    if not dry_run:
        why = auth_preflight(connector)
        if why:
            return {**report, "status": "failed", "reason": why}
    by_wave: dict[int, list[dict]] = {}
    for s in plan_steps:
        if waves is None or s["wave"] in waves:
            by_wave.setdefault(s["wave"], []).append(s)
    for w in sorted(by_wave):
        wrep: dict[str, Any] = {"wave": w, "status": "completed", "steps": []}
        report["waves"].append(wrep)
        for s in by_wave[w]:
            srep: dict[str, Any] = {"entity": s["entity"], "pass": s.get("pass", 1), "sent": 0, "ok": 0, "failed": 0, "error_rate": 0.0}
            wrep["steps"].append(srep)
            for b, batch in enumerate(s.get("batches") or []):
                if store.stopped():
                    wrep["status"] = report["status"] = "stopped"
                    return report
                if only is not None:
                    batch = [kr for kr in batch if (s["entity"], kr[0]) in only]
                elif store.done(s["entity"], srep["pass"], b):
                    continue
                if not batch:
                    continue
                if dry_run or s["method"] not in ("upsert", "config_create"):
                    status = "validated" if dry_run else "exported"
                    rows = [{"key": k, "status": status, "http_code": None, "message": ""} for k, _ in batch]
                else:
                    res = connector.upsert(s["entity"], with_blobs([r for _, r in batch], fetch),
                                           purge_type=s.get("purge_type"))
                    rows = [{**x, "key": batch[i][0]} for i, x in enumerate(res)]
                for (_, payload), r in zip(batch, rows):
                    r["row_hash"] = row_hash(payload)
                store.record(s["entity"], srep["pass"], b, rows)
                store.checkpoint(w, s["entity"], srep["pass"], b)
                srep["sent"] += len(rows)
                srep["failed"] += sum(r["status"] == "failed" for r in rows)
                srep["ok"] = srep["sent"] - srep["failed"]
                srep["error_rate"] = round(srep["failed"] / srep["sent"], 4)
            sent = sum(x["sent"] for x in wrep["steps"])
            failed = sum(x["failed"] for x in wrep["steps"])
            if sent and failed / sent > threshold:
                wrep["status"] = report["status"] = "stopped_error_rate"
                report["reason"] = f"wave {w} error rate {failed / sent:.1%} passed {threshold:.0%}"
                return report
    return report


# ── reconciliation ───────────────────────────────────────────────────────────


def reconcile_entity(entity: str, source: list[dict], target: list[dict], key_props: list[str]) -> dict:
    """Counts, missing and extra keys and field differences between what was sent and what the target holds."""
    kf = lambda r: "|".join(f"{k}={r.get(k)}" for k in key_props)  # noqa: E731
    s, t = {kf(r): r for r in source}, {kf(r): r for r in target}
    missing, extra = sorted(set(s) - set(t)), sorted(set(t) - set(s))
    diffs: Counter = Counter()
    sample: list[dict] = []
    for k in set(s) & set(t):
        for p, v in s[k].items():
            if p in t[k] and str(t[k][p]) != str(v):
                diffs[p] += 1
                if len(sample) < SAMPLE_CAP:
                    sample.append({"key": k, "field": p, "source": v, "target": t[k][p]})
    return {"entity": entity, "source_rows": len(source), "target_rows": len(target),
            "missing_in_target": missing[:SAMPLE_CAP], "extra_in_target": extra[:SAMPLE_CAP],
            "field_diffs": dict(diffs), "sample": sample}


def dqs_block(source_results, projected_results, actual_results, weights=None, cells_changed: int = 0,
              failed_records: int = 0) -> dict:
    """Source, projected target and actual target DQS with the reasons they differ. Each input is a list of
    check results, an already computed score, or None."""
    from api.services.fix_simulation import dqs_summary

    def score(r):
        return r if r is None or isinstance(r, (int, float)) else dqs_summary(r, weights).get("composite")
    src, proj, act = score(source_results), score(projected_results), score(actual_results)
    reasons = []
    if cells_changed:
        reasons.append(f"cleansing changed {cells_changed} cell(s) between source and projected target")
    if failed_records:
        reasons.append(f"{failed_records} record(s) failed to load, so the actual target lacks them")
    if act is None:
        reasons.append("the target has not been extracted and checked since the load")
    elif proj is not None and act != proj:
        reasons.append("the target holds data the load did not send, or applied its own defaults")
    return {"source": src, "projected_target": proj, "actual_target": act, "reasons": reasons}


# ── delta ────────────────────────────────────────────────────────────────────


def row_hash(rec: dict) -> str:
    return hashlib.sha256(json.dumps(rec, sort_keys=True, default=str).encode()).hexdigest()


def delta_records(records: list[tuple[str, dict]], since: datetime, previous_hashes: Optional[dict] = None,
                  modified_props: Iterable[str] = ()) -> list[tuple[str, dict]]:
    """Records changed since ``since``: their last-modified property is on or after it, or their content hash
    differs from the one the earlier run stored."""
    since = since if since.tzinfo else since.replace(tzinfo=timezone.utc)
    mods = list(modified_props)
    out = []
    for k, r in records:
        if previous_hashes is not None and previous_hashes.get(k) != row_hash(r):
            out.append((k, r))
            continue
        for p in mods:
            v = r.get(p)
            ts = pd.to_datetime(int(str(v)[6:-2]), unit="ms", utc=True) if str(v).startswith("/Date(") \
                else pd.to_datetime(v, utc=True, errors="coerce")
            if ts is not None and not pd.isna(ts) and ts >= since:
                out.append((k, r))
                break
    return out
