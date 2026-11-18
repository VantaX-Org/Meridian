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
from concurrent.futures import ThreadPoolExecutor
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
        "FOPayGroup", "FOFrequency", "FOPayComponent", "FOPayComponentGroup",
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
        "PerNationalId", "PerPersonRelationship", "PerEmergencyContacts")),
    ("Employment", _EC, ("EmpEmployment", "EmpGlobalAssignment", "EmpWorkPermit")),
    ("Job history (two passes)", _EC, (
        "EmpJob", "EmpJobRelationships", "SecondaryAssignments", "EmpEmploymentTermination", "HireDateChange")),
    ("Compensation, pay and deductions", ("employee_central", "compensation", "benefits", "payroll_integration"), (
        "EmpCompensation", "EmpPayCompRecurring", "EmpPayCompNonRecurring", "PaymentInformationV3",
        "PaymentInformationDetailV3", "PaymentInformationDetailV3ZAF", "RecurringDeduction",
        "RecurringDeductionItem")),
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
        "JobReqScreeningQuestion", "JobReqFOLocation", "Candidate", "CandidateBackground_*",
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
UPSERT_WORKERS = 4  # batches upserted at once within one step; steps and waves stay in order
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


# D7: dictionary tables whose entity the source metadata does not have; PayScaleType/Area load instead
NOT_IN_SOURCE = {"FOPayScaleType", "FOPayScaleArea", "PerSocialAccount", "BenefitEnrollment"}


def _sf_steps(module: str, dictionary, frames, unplaced: list) -> list[dict]:
    out = []
    for t in OWNED_TABLES.get(module, []):
        tb = dictionary.table(t)
        if tb is None:
            unplaced.append({"module": module, "table": t, "reason": "not in the data dictionary"})
            continue
        ent, why = table_entity(tb)
        if ent in NOT_IN_SOURCE:
            ent, why = None, f"{ent} is not an entity set on the source tenant (D7)"
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
        if name not in loaded and (v["create_values"] or (source_wins(name) and v["conflicts"])):  # lists with a data step are narrowed by config_filter
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


# ── pilot sample and country scope ───────────────────────────────────────────

PILOT_PER_CELL = 10
PILOT_CLOSURE_CAP = 1000  # D8: full manager chain; the Komatsu pilot needs 283 (cap 200 cut it)
EXCLUDED_COUNTRIES = ("ZMB",)  # out of scope: no country rules in the target tenant
ACTIVE_STATUS = ("A", "U", "P", "S")  # EmpJob.emplStatus codes the EC rule pack treats as active
_MANAGER_REFS = ("EmpJob.managerId", "EmpJobRelationships.relUserId")
OUT_OF_SAMPLE = "manager outside pilot sample"
OUT_OF_SCOPE = "manager in an excluded country"


def band(grade) -> str:
    """Sample band of a payGrade: the leading letter A-F (AA -> A), G, H, APPR (every APPR_*), "No Grade",
    UNGRADED when blank; any other grade is its own band."""
    g = "" if grade is None or (isinstance(grade, float) and pd.isna(grade)) else str(grade).strip()
    if not g:
        return "UNGRADED"
    if g.lower() == "no grade":
        return "No Grade"
    if g.upper().startswith("APPR"):
        return "APPR"
    return g[0].upper() if g[0].upper() in "ABCDEFGH" else g


def _frame(frames, name: str) -> pd.DataFrame:
    from checks.frames import _decoded
    return _decoded(frames.frames[name])


def _prop_cols(frames, dictionary, name: str) -> dict[str, str]:
    """``Entity.prop`` -> column of frame ``name`` (dictionary fields, or the SFRAW_ columns)."""
    if name.startswith(RAW_PREFIX):
        ent, pre = name[len(RAW_PREFIX):], name + "."
        return {f"{ent}.{c[len(pre):]}": c for c in frames.frames[name].columns if c.startswith(pre)}
    tb = dictionary.table(name)
    if tb is None:
        return {}
    return {f"{ep[0]}.{ep[1]}": f"{name}.{f.name}" for f in tb.fields.values() if (ep := _entity_prop(f.source))}


def person_column(name: str, frames, dictionary) -> Optional[str]:
    """The person column of a person-keyed frame, else None. A dictionary table is person-keyed when a key
    field is a person column or comes from userId/personIdExternal; a raw set when its $metadata key
    (``__raw_key__``) holds one of those, or, with no key written, when it carries one of them."""
    df = frames.frames[name]
    if name.startswith(RAW_PREFIX):
        pc = _prop_cols(frames, dictionary, name)
        ent = name[len(RAW_PREFIX):]
        if "__raw_key__" in df.columns:
            first = next((str(k) for k in _frame(frames, name)["__raw_key__"] if k), "")
            parts = {p.split("=", 1)[0] for p in first.split("|") if "=" in p}
        else:  # no key written: conservative, any person property makes it person data
            parts = set(_RAW_PERSON_PROPS)
        return next((pc[f"{ent}.{p}"] for p in _RAW_PERSON_PROPS if p in parts and f"{ent}.{p}" in pc), None)
    tb = dictionary.table(name)
    if tb is None:
        return None
    for f in tb.fields.values():
        ep = _entity_prop(f.source)
        if f.key and (f.name in _PERSON_COLS or (ep and ep[1] in _RAW_PERSON_PROPS)):
            return f"{name}.{f.name}"
    return None


def _strs(s: pd.Series) -> pd.Series:
    return s.astype("string").str.strip()


def _people(frames, dictionary) -> dict[str, dict]:
    """userId -> {country, grade, status} from the EmpJob history: country and status of the latest record
    (latest non-blank), grade the latest non-blank payGrade."""
    names = sorted((n for n in frames.frames
                    if {"EmpJob.userId", "EmpJob.payGrade"} <= set(_prop_cols(frames, dictionary, n))),
                   key=lambda n: n.startswith(RAW_PREFIX))
    if not names:
        return {}
    pc = _prop_cols(frames, dictionary, names[0])
    props = ("userId", "payGrade", "countryOfCompany", "emplStatus", "managerId", "startDate", "seqNumber")
    df = _frame(frames, names[0])
    d = pd.DataFrame({p: df[pc[f"EmpJob.{p}"]] for p in props if pc.get(f"EmpJob.{p}") in df.columns})
    order = [c for c in ("startDate", "seqNumber") if c in d]
    if "startDate" in d:
        d["startDate"] = pd.to_datetime(d["startDate"], errors="coerce", utc=True)
    if "seqNumber" in d:
        d["seqNumber"] = pd.to_numeric(d["seqNumber"], errors="coerce")
    d = d.sort_values(order, kind="stable", na_position="first") if order else d
    out = {}
    for uid, g in d.groupby(_strs(d["userId"]), sort=True):
        def last(p):
            s = _strs(g[p]) if p in g else pd.Series([], dtype="string")
            s = s[s.notna() & (s != "")]
            return s.iloc[-1] if len(s) else None
        out[str(uid)] = {"country": last("countryOfCompany"), "grade": last("payGrade"), "status": last("emplStatus"),
                         "manager": last("managerId")}
    return out


def _pairs(frames, dictionary, a: str, b: tuple[str, ...]) -> list[tuple[str, str]]:
    """(value of prop ``a``, value of a prop in ``b``) per row, over every frame with both from one entity."""
    out = []
    for n in frames.frames:
        pc = _prop_cols(frames, dictionary, n)
        for key, col in pc.items():
            ent, prop = key.split(".", 1)
            src = pc.get(f"{ent}.{a}") if key in b or prop in b else None
            if src is None or src == col:
                continue
            df = _frame(frames, n)
            if src in df.columns and col in df.columns:
                x, y = _strs(df[src]), _strs(df[col])
                out += [(u, v) for u, v in zip(x, y) if pd.notna(u) and pd.notna(v) and u and v]
    return out


def _values(frames, dictionary, props: tuple[str, ...]) -> set[str]:
    """Every non-blank value of the props in ``props`` (``Entity.prop``) over all frames."""
    out: set[str] = set()
    for n in frames.frames:
        pc = _prop_cols(frames, dictionary, n)
        cols = [pc[p] for p in props if p in pc]
        if cols:
            df = _frame(frames, n)
            for c in cols:
                if c in df.columns:
                    v = _strs(df[c])
                    out |= set(v[v.notna() & (v != "")])
    return out


NO_MANAGER = "NO_MANAGER"  # SF's own value for "no manager": not a person, never followed
_USER_IDS = ("User.userId", "EmpEmployment.userId", "EmpJob.userId")


def move_scope(frames, dictionary, sample: Optional[dict] = None,
               exclude_countries: Iterable[str] = EXCLUDED_COUNTRIES) -> dict:
    """Which users a move loads. Users whose latest country is excluded never load. Without ``sample`` every
    other user loads (full move); with one, ``per_cell`` users per (country, band, status) cell by userId,
    plus every person they reference in any history row (managerId, relUserId of any relationship type),
    transitively, at most ``closure_cap`` added. The report lists what the cap cut, references to excluded
    users and references to IDs found in no frame (never guessed)."""
    people = _people(frames, dictionary)
    excl = {str(c) for c in exclude_countries or ()}
    excluded = Counter(p["country"] for p in people.values() if p["country"] in excl)
    out_users = {u for u, p in people.items() if p["country"] in excl}
    known = set(people) | _values(frames, dictionary, _USER_IDS)
    scope = {"pilot": bool(sample), "excluded_countries": sorted(excl), "excluded": dict(excluded),
             "excluded_lines": [f"{c} excluded (out of scope): {n} users" for c, n in sorted(excluded.items())],
             "known": sorted(known), "keep": None, "drop": sorted(out_users)}
    if not sample:
        return scope
    per_cell = int(sample.get("per_cell", PILOT_PER_CELL))
    cap = int(sample.get("closure_cap", PILOT_CLOSURE_CAP))
    active = {str(a) for a in sample.get("active_status", ACTIVE_STATUS)}
    cells: dict[str, list[str]] = {}
    for u, p in sorted(people.items()):
        if u in out_users:
            continue
        status = "active" if p["status"] in active else "terminated/other"
        cells.setdefault(f"{p['country'] or '(none)'}|{band(p['grade'])}|{status}", []).append(u)
    picked = sorted(u for us in cells.values() for u in us[:per_cell])
    refs: dict[str, set] = {}
    for u, m in _pairs(frames, dictionary, "userId", _MANAGER_REFS):
        if m != NO_MANAGER:
            refs.setdefault(u, set()).add(m)
    seen, frontier, added = set(picked), picked, list[str]()
    while frontier and len(added) < cap:
        nxt = sorted({m for u in frontier for m in refs.get(u, ()) if m in known and m not in seen
                      and m not in out_users})[:cap - len(added)]
        added += nxt
        seen |= set(nxt)
        frontier = nxt
    cut, to_excluded, not_found = set(), set(), set()
    for u in seen:
        for m in refs.get(u, ()):
            if m not in known:
                not_found.add(m)
            elif m in out_users:
                to_excluded.add(m)
            elif m not in seen:
                cut.add(m)
    country = {u: (people.get(u) or {}).get("country") or "(none)" for u in seen}
    scope.update(per_cell=per_cell, closure_cap=cap, active_status=sorted(active),
                 cells={c: min(len(us), per_cell) for c, us in sorted(cells.items())},
                 sampled=len(picked), closure_added=added, keep=sorted(seen),
                 by_country=dict(sorted(Counter(country.values()).items())),
                 closure_by_country=dict(sorted(Counter(country[u] for u in added).items())),
                 cut_by_cap=sorted(cut), refs_to_excluded=sorted(to_excluded), refs_not_found=sorted(not_found))
    return scope


def apply_scope(frames, dictionary, scope: dict) -> tuple[Any, dict]:
    """Frames holding only the scope's users in person-keyed tables (every history row of each), every other
    table in full. A manager reference to a known user outside the scope is blanked and listed for review;
    no row of a table that is not person-keyed is dropped. Returns (frames, report)."""
    import copy

    from checks.base import record_keys

    keep, drop = scope.get("keep"), set(scope.get("drop") or ())
    report = {k: v for k, v in scope.items() if k not in ("known", "keep", "drop")}
    report.update(users=len(keep) if keep is not None else len(scope.get("known") or ()) - len(drop),
                  blanked=0, needs_review=[])
    if keep is None and not drop:
        return frames, report
    persons = dict(_pairs(frames, dictionary, "userId", ("personIdExternal",)))
    keep_ids = None if keep is None else set(keep) | {persons[u] for u in keep if u in persons}
    drop_ids = drop | {persons[u] for u in drop if u in persons}
    outside = (set(scope["known"]) - set(keep)) if keep is not None else drop
    reason = OUT_OF_SAMPLE if keep is not None else OUT_OF_SCOPE
    out = copy.copy(frames)
    out.frames = dict(frames.frames)
    out.reset_caches()
    out.flat = frames.flat
    for name in frames.frames:
        pcol = person_column(name, frames, dictionary)
        mcols = [c for k, c in _prop_cols(frames, dictionary, name).items() if k in _MANAGER_REFS]
        if pcol is None and not mcols:
            continue
        df = _frame(frames, name)
        if pcol in df.columns:
            v = _strs(df[pcol])
            mask = v.isin(keep_ids).fillna(False) if keep_ids is not None else ~v.isin(drop_ids).fillna(False)
            df = df[mask.astype(bool)]
        bad = {c: _strs(df[c]).isin(outside).fillna(False).astype(bool) for c in mcols if c in df.columns}
        if not any(b.any() for b in bad.values()) and len(df) == len(frames.frames[name]):
            continue
        df = df.copy()
        if any(b.any() for b in bad.values()):
            keys = (df["__raw_key__"].astype("string") if "__raw_key__" in df.columns else
                    record_keys(df, [f"{name}.{k}" for k in dictionary.keys(name) if f"{name}.{k}" in df.columns]))
            for c, b in bad.items():
                report["needs_review"] += [{"table": name, "record_key": k, "field": c.split(".", 1)[1],
                                            "value": val, "reason": reason, "decision": "scope"}
                                           for k, val in zip(keys[b], df.loc[b, c])]
                df.loc[b, c] = None
        out.frames[name] = df.reset_index(drop=True)
    report["blanked"] = len(report["needs_review"])
    return out, report


# ── move defaults (DECISIONS.md D1-D5, 2026-11-17) ──────────────────────────
# Nothing here invents a value: a row is changed only where the decision says how, every other problem is
# listed for review with its decision, and no row is dropped unless the decision says to leave it out.

TERMINATED_STATUS = ("T",)  # latest EmpJob.emplStatus of a terminated user (DECISIONS.md "Active and terminated")
INACTIVE_USER = "f"  # User.status of an inactive login
D1_NO_EMPLOYMENT = "user account without employment: left out until HR or IT names it"
D1_CREATED = "terminated person without a user account: loaded inactive, username = user ID"
D1_NO_ACCOUNT = "person without a user account who is not terminated: needs a real user account"
D2_CONFLICT = "duplicate address (same person, type and start date, any case): latest row kept"
D3_TERMINATED = "active user's current manager is terminated"
D3_NO_MANAGER = "active user has NO_MANAGER"
D3_NOT_FOUND = "manager ID not found in the source"
D3_REL_TERMINATED = "current relationship of an active user points at a terminated user"
D5_MISSING = "pay scale code not in the source pay scale objects"
_PAYSCALE = {"payScaleType": "PayScaleType", "payScaleArea": "PayScaleArea", "payScaleGroup": "PayScaleGroup",
             "payScaleLevel": "PayScaleLevel"}


def _with(frames, dictionary, *props: str) -> list[tuple[str, dict]]:
    """(frame, its Entity.prop columns) for every non-empty frame holding all of ``props``."""
    out = []
    for n in frames.frames:
        pc = _prop_cols(frames, dictionary, n)
        if all(p in pc and pc[p] in frames.frames[n].columns for p in props) and len(frames.frames[n]):
            out.append((n, pc))
    return out


def _review(decision: str, table: str, key, field: str, value, reason: str, **extra) -> dict:
    return {"decision": decision, "table": table, "record_key": None if key is None else str(key),
            "field": field, "value": None if value is None or pd.isna(value) else str(value), "reason": reason,
            **extra}


def _row_keys(df: pd.DataFrame, name: str, dictionary) -> pd.Series:
    from checks.base import record_keys
    if "__raw_key__" in df.columns:
        return df["__raw_key__"].astype("string")
    return record_keys(df, [f"{name}.{k}" for k in dictionary.keys(name) if f"{name}.{k}" in df.columns])


def _replace(frames, changed: dict[str, pd.DataFrame]):
    import copy
    if not changed:
        return frames
    out = copy.copy(frames)
    out.frames = {**frames.frames, **changed}
    out.reset_caches()
    out.flat = frames.flat
    return out


def _d1(frames, dictionary, people: dict, review: list, changed: dict) -> dict:
    emp = set()
    for n, pc in _with(frames, dictionary, "EmpEmployment.userId"):
        v = _strs(_frame(frames, n)[pc["EmpEmployment.userId"]])
        emp |= set(v[v.notna() & (v != "")])
    rep: dict[str, Any] = {"usernames_defaulted": 0, "left_out": [], "created_inactive": [], "no_account": []}
    users = _with(frames, dictionary, "User.userId")
    if not users or not emp:  # nothing to compare against: change nothing
        rep["skipped"] = "no user or employment rows in the extract"
        return rep
    have = set()
    for n, pc in users:
        df = _frame(frames, n).copy()
        uid = _strs(df[pc["User.userId"]])
        have |= set(uid[uid.notna()])
        name_col = pc.get("User.username")
        if name_col in df.columns:
            blank = (_strs(df[name_col]).fillna("") == "") & uid.notna()
            df.loc[blank, name_col] = uid[blank]
            rep["usernames_defaulted"] += int(blank.sum())
        out = ~uid.isin(emp).fillna(True).astype(bool)
        for k, u in zip(_row_keys(df, n, dictionary)[out], uid[out]):
            review.append(_review("D1", n, k, "userId", u, D1_NO_EMPLOYMENT))
            rep["left_out"].append(str(u))
        changed[n] = df[~out].reset_index(drop=True)
    for u in sorted(emp - have):
        status = (people.get(u) or {}).get("status")
        if status in TERMINATED_STATUS:
            rep["created_inactive"].append(u)
        else:
            rep["no_account"].append(u)
            review.append(_review("D1", "User", u, "userId", u, D1_NO_ACCOUNT, status=status))
    for n, pc in users:  # one inactive login per terminated person, only into frames that carry the columns
        cols = {pc.get("User.userId"): None, pc.get("User.username"): None, pc.get("User.status"): INACTIVE_USER}
        if rep["created_inactive"] and None not in cols and all(c in changed[n].columns for c in cols):
            new = pd.DataFrame([{c: (u if v is None else v) for c, v in cols.items()} for u in rep["created_inactive"]])
            if "__raw_key__" in changed[n].columns:
                new["__raw_key__"] = [f"userId={u}" for u in rep["created_inactive"]]
            changed[n] = pd.concat([changed[n], new], ignore_index=True)
    rep["left_out"] = sorted(set(rep["left_out"]))
    return rep


def _d2(frames, dictionary, review: list, changed: dict) -> dict:
    rep: dict[str, Any] = {"identical_dropped": 0, "conflicts": 0, "rows_dropped": 0}
    props = ("PerAddressDEFLT.personIdExternal", "PerAddressDEFLT.addressType", "PerAddressDEFLT.startDate")
    for n, pc in _with(frames, dictionary, *props):
        df = changed.get(n, _frame(frames, n))
        data = [c for c in df.columns if not c.startswith("__")]
        before = len(df)
        df = df.loc[~df[data].astype("string").fillna("\0").duplicated()].reset_index(drop=True)
        rep["identical_dropped"] += before - len(df)
        grp = [_strs(df[pc[props[0]]]), _strs(df[pc[props[1]]]).str.lower(), _strs(df[pc[props[2]]])]
        lm = pc.get("PerAddressDEFLT.lastModifiedDateTime")
        order = pd.to_datetime(df[lm], errors="coerce", utc=True) if lm in df.columns else pd.Series(range(len(df)))
        df = df.assign(__order__=order.values, __pos__=range(len(df)))
        losers = []
        keys = _row_keys(df, n, dictionary)
        for _, g in df.groupby(grp, sort=False, dropna=False):
            if len(g) < 2:
                continue
            g = g.sort_values(["__order__", "__pos__"], na_position="first", kind="stable")
            win = g.iloc[-1]
            rep["conflicts"] += 1
            for i, row in g.iloc[:-1].iterrows():
                diff = {c.split(".", 1)[1]: (None if pd.isna(row[c]) else str(row[c]),
                                             None if pd.isna(win[c]) else str(win[c]))
                        for c in data if str(row[c]) != str(win[c])}
                review.append(_review("D2", n, keys[i], "addressType", row[pc[props[1]]], D2_CONFLICT,
                                      kept=str(keys[win.name]), differs=diff))
                losers.append(i)
        rep["rows_dropped"] += len(losers)
        changed[n] = df.drop(index=losers).drop(columns=["__order__", "__pos__"]).reset_index(drop=True)
    return rep


def _d3(frames, dictionary, people: dict, known: set, review: list) -> dict:
    rep: dict[str, Any] = {"current_terminated_manager": 0, "current_no_manager": 0, "current_relationship_terminated": 0,
           "manager_ids_not_found": {}}
    terminated = {u for u, p in people.items() if p["status"] in TERMINATED_STATUS}
    is_active = lambda u: u in people and people[u]["status"] not in TERMINATED_STATUS  # noqa: E731
    for n, pc in _with(frames, dictionary, "EmpJob.userId", "EmpJob.managerId"):
        df = _frame(frames, n)
        m = _strs(df[pc["EmpJob.managerId"]])
        miss = m[m.notna() & (m != "") & (m != NO_MANAGER) & ~m.isin(known)]
        for mid, cnt in miss.value_counts().items():
            rep["manager_ids_not_found"][str(mid)] = rep["manager_ids_not_found"].get(str(mid), 0) + int(cnt)
    for u, p in sorted(people.items()):
        mgr = p.get("manager")
        if not is_active(u) or not mgr:
            continue
        why = (D3_NO_MANAGER if mgr == NO_MANAGER else D3_NOT_FOUND if mgr not in known
               else D3_TERMINATED if mgr in terminated else None)
        if why:
            k = {D3_NO_MANAGER: "current_no_manager", D3_TERMINATED: "current_terminated_manager"}.get(
                why, "current_manager_not_found")
            rep[k] = rep.get(k, 0) + 1
            review.append(_review("D3", "EmpJob", u, "managerId", mgr, why, country=p["country"]))
    now = pd.Timestamp.now(tz="UTC")
    for n, pc in _with(frames, dictionary, "EmpJobRelationships.userId", "EmpJobRelationships.relUserId"):
        df = _frame(frames, n)
        end = pc.get("EmpJobRelationships.endDate")
        cur = (pd.to_datetime(df[end], errors="coerce", utc=True).fillna(now) >= now) if end in df.columns \
            else pd.Series(True, index=df.index)
        u, r = _strs(df[pc["EmpJobRelationships.userId"]]), _strs(df[pc["EmpJobRelationships.relUserId"]])
        hit = cur & u.map(is_active).astype(bool) & r.isin(terminated).fillna(False).astype(bool)
        for k, x, y in zip(_row_keys(df, n, dictionary)[hit], u[hit], r[hit]):
            review.append(_review("D3", n, k, "relUserId", y, D3_REL_TERMINATED, user=x))
        rep["current_relationship_terminated"] += int(hit.sum())
    return rep


def _source_codes(frames, entity: str) -> Optional[set]:
    """Every key value of the source ``entity`` rows (from the $metadata key in ``__raw_key__``), else None."""
    name = RAW_PREFIX + entity
    if name not in frames.frames or "__raw_key__" not in frames.frames[name].columns:
        return None
    out = set()
    for k in _frame(frames, name)["__raw_key__"].dropna().astype(str):
        out |= {p.split("=", 1)[1] for p in k.split("|") if "=" in p}
    return out


def _d5(frames, dictionary, review: list) -> dict:
    """Every pay scale code the employment rows use, checked against the source pay scale objects that load
    in the Foundation stage first. Placeholder codes ("No Level") are kept, like any other code."""
    rep: dict[str, Any] = {"checked": {}, "not_validated": []}
    for prop, entity in _PAYSCALE.items():
        used: Counter = Counter()
        for ent in ("EmpJob", "EmpEmployment"):
            for n, pc in _with(frames, dictionary, f"{ent}.{prop}"):
                v = _strs(_frame(frames, n)[pc[f"{ent}.{prop}"]])
                used.update(v[v.notna() & (v != "")])
        if not used:
            continue
        codes = _source_codes(frames, entity)
        if codes is None:
            rep["not_validated"].append(f"{entity}: object not found in the extract")
            continue
        missing = {c: n for c, n in used.items() if c not in codes}  # ponytail: any key part matches; exact composite key when T2 keys are known
        rep["checked"][entity] = {"codes": len(used), "missing": len(missing)}
        review += [_review("D5", entity, c, prop, c, D5_MISSING, rows=n) for c, n in sorted(missing.items())]
    return rep


def apply_defaults(frames, dictionary, scope: dict) -> tuple[Any, list[dict], dict]:
    """The agreed move defaults on the (scoped) frames. Returns (frames, needs_review, summary per decision).
    D1 user accounts, D2 duplicate addresses, D3 manager flags (history loads as is), D5 pay scale check.
    D4 (locale kept) and D7 (stage list) need no row change; D6 has no attachment data in the extract."""
    people = _people(frames, dictionary)
    known = set(scope.get("known") or ()) | set(people) | _values(frames, dictionary, _USER_IDS)
    review: list[dict] = []
    changed: dict[str, pd.DataFrame] = {}
    summary = {"D1": _d1(frames, dictionary, people, review, changed),
               "D2": _d2(frames, dictionary, review, changed),
               "D3": _d3(frames, dictionary, people, known, review),
               "D5": _d5(frames, dictionary, review)}
    summary["needs_review"] = dict(Counter(r["decision"] for r in review))
    return _replace(frames, changed), review, summary


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
    """Per list: values already in the target, matched by external code (present, listed in mapped), values to
    create (create) and values whose label or status differ in the target (conflict). Conflicts are skipped,
    except in source-wins stages (D8: Foundation, Job architecture, Position), where the source replaces them.
    Nothing in the target is deleted."""
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
            if not diff:
                present.append(r)
            else:  # source-wins lists (D8) keep the source row so a config-only step can upsert it
                conflict.append({"key": dict(zip(keys, k)), "differs": diff, **({"row": r} if source_wins(name) else {})})
        out[name] = {"present": len(present), "create": len(create), "conflict": len(conflict),
                     "mapped": [{c: r.get(c) for c in keys} for r in present], "create_values": create,
                     "conflicts": conflict, "keys": keys,
                     "target_keys": sorted(list(k) for k in tgt),
                     "target_codes": sorted([list(k) for k in tgt] + [[str(r.get(c)) for c in keys] for r in create])}
    return out


SOURCE_WINS_STAGES = ("Foundation", "Job architecture", "Position")  # D8: base data comes from the source


def source_wins(entity: str) -> bool:
    """True when the source record replaces a differing target record with the same key (D8). Picklists
    and everything else keep create-only: a value the target already holds is never changed."""
    w = stage_of(entity)
    return w < len(SF_MOVE_STAGES) and SF_MOVE_STAGES[w][0] in SOURCE_WINS_STAGES


def config_filter(step: dict, records: list[tuple[str, dict]], config: dict) -> list[tuple[str, dict]]:
    """The step's records minus the values the target already holds. For source-wins stages (D8) only
    identical target values drop; a conflicting key passes through as an upsert and the source wins
    (listed by ``overwrites``). Elsewhere present and conflicting keys both drop. Steps whose entity the
    diff does not know pass through unchanged. Nothing in the target is deleted."""
    c = config.get(step["entity"])
    if not c:
        return records
    have = {tuple(k) for k in c["target_keys"]}
    if source_wins(step["entity"]):
        have -= {tuple(str(x["key"].get(k)) for k in c["keys"]) for x in c.get("conflicts") or ()}
    return [(k, r) for k, r in records if tuple(str(r.get(x)) for x in c["keys"]) not in have]


def overwrites(config: dict) -> list[dict]:
    """Every target record a source-wins stage replaces: entity, key and, per differing field, the target
    value before the change and the source value after it."""
    return [{"entity": name, "key": x["key"],
             "fields": {f: {"target_before": t, "source": s} for f, (s, t) in sorted(x["differs"].items())}}
            for name, c in sorted(config.items()) if source_wins(name) for x in c.get("conflicts") or ()]


def config_records(name: str, config: dict) -> list[tuple[str, dict]]:
    """(key, payload) for the values of one list the target lacks, plus, in a source-wins stage (D8), the
    source rows that replace differing target values."""
    c = config[name]
    rows = list(c["create_values"]) + [x["row"] for x in c.get("conflicts") or () if source_wins(name) and "row" in x]
    return [("|".join(f"{k}={r.get(k)}" for k in c["keys"]), {p: v for p, v in r.items() if p != "__metadata"})
            for r in rows]


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


def key_overwrites(step: dict, records: list[tuple[str, dict]], target_rows: list[dict],
                   key_props: list[str]) -> list[dict]:
    """Each source record whose key the target already holds with different data: entity, record key, target
    key and, per differing field, the target value before the upsert and the source value after it."""
    if not key_props:
        return []
    tgt = {tuple(str(r.get(k)) for k in key_props): r for r in target_rows}
    out = []
    for key, r in records:
        t = tgt.get(tuple(str(r.get(k)) for k in key_props))
        d = {} if t is None else {p: {"target_before": t.get(p), "source": v} for p, v in sorted(r.items())
                                  if p in t and p != "__metadata" and str(t.get(p)) != str(v)}
        if d:
            out.append({"entity": step["entity"], "record_key": key, "key": {k: r.get(k) for k in key_props},
                        "fields": d})
    return out


def key_conflicts(step: dict, records: list[tuple[str, dict]], target_rows: list[dict], key_props: list[str]) -> list[dict]:
    """Warn when a source key already exists in the target with different data."""
    bad = [x["record_key"] for x in key_overwrites(step, records, target_rows, key_props)]
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
    unfixable, cell = [], _cells(cur)
    for r in results:
        if r.passed or r.error:
            continue
        for k in r.failing_record_keys or []:
            unfixable.append({"rule": r.check_id, "field": r.field, "record_key": k,
                              "current_value": cell(r.field, k),
                              "reason": "no high-confidence rule fix or approved value; loaded as it is"})
    per_rule = Counter(c["rule_id"] or c["source"] for c in log)
    return {"frames": cur, "log": log, "unfixable": unfixable, "passes": passes,
            "summary": {"cells_fixed_per_rule": dict(per_rule),
                        "records_still_failing": len({u["record_key"] for u in unfixable}),
                        "dqs": dqs_delta(before_results, results, weights)},
            "before_results": before_results, "after_results": results}


def _cells(frames) -> Callable:
    """Cell lookup by (TABLE.FIELD, record key). Each table is unprefixed and each column mapped
    once; a per-call ``frames.plain`` copied the whole table for every failing record."""
    plains: dict[str, Any] = {}
    cols: dict[str, dict] = {}

    def cell(field: Optional[str], key: str):
        if not field or "." not in field:
            return None
        if field not in cols:
            t, c = field.split(".", 1)
            if t not in plains:
                df = frames.plain(t)
                plains[t] = None if df is None else df.drop_duplicates("__key__")
            df = plains[t]
            cols[field] = {} if df is None or c not in df.columns else dict(zip(df["__key__"], df[c]))
        return cols[field].get(key)
    return cell


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
         fetch: Callable[[str], bytes] = _fetch_blob, workers: int = UPSERT_WORKERS) -> dict:
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
            todo = []
            for b, batch in enumerate(s.get("batches") or []):
                if only is not None:
                    batch = [kr for kr in batch if (s["entity"], kr[0]) in only]
                elif store.done(s["entity"], srep["pass"], b):
                    continue
                if batch:
                    todo.append((b, batch))
            live = not dry_run and s["method"] in ("upsert", "config_create")

            def send(item, s=s, live=live):
                _, batch = item
                if not live:
                    status = "validated" if dry_run else "exported"
                    return [{"key": k, "status": status, "http_code": None, "message": ""} for k, _ in batch]
                res = connector.upsert(s["entity"], with_blobs([r for _, r in batch], fetch),
                                       purge_type=s.get("purge_type"))
                return [{**x, "key": batch[i][0]} for i, x in enumerate(res)]
            # ponytail: windows of `workers` batches in flight; the store is written only here, in batch order
            n = workers if live else 1
            with ThreadPoolExecutor(max_workers=n) as pool:
                for i in range(0, len(todo), n):
                    if store.stopped():
                        wrep["status"] = report["status"] = "stopped"
                        return report
                    chunk = todo[i:i + n]
                    for (b, batch), rows in zip(chunk, pool.map(send, chunk)):
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
