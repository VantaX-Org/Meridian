"""Move to new instance: plan, pre-flight, cleanse, load, reconcile and delta between two systems.

Every function here is pure. The connector, the status store and the check runner are passed in, so the
worker drives a real target and the tests drive a mocked one. Entity and property names come only from the
data dictionary (``Field.source`` is ``Entity.property``) or from the target's $metadata, never from code.

Waves for SuccessFactors follow the Employee Central import order:
  0 picklists, MDF config and Foundation; 1 Position; 2 User; 3 person; 4 employment;
  5 job history, relationships, compensation and pay; 6 other modules.
SAP objects follow the DDIC load plan (``load_plan.build_plan``) as waves 7 onwards.
"""
from __future__ import annotations

import hashlib
import json
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional, Protocol

import pandas as pd

from api.services.migration.load_plan import OWNED_TABLES, build_plan

WAVE_LABELS = {
    0: "Picklists, MDF config and Foundation",
    1: "Position",
    2: "User",
    3: "Person",
    4: "Employment",
    5: "Job history, relationships, compensation and pay",
    6: "Other modules",
}
SAP_WAVE_BASE = 7
_SF_WAVE = {
    "POSITION": 1, "USERACCOUNT": 2,
    **{t: 3 for t in ("PERINFO", "PER_GLOBAL_INFO", "PEREMAIL", "PERPHONE", "PERADDRESS", "PEREMERGENCY",
                      "PERSOCIALACCOUNT")},
    **{t: 4 for t in ("EMPEMPLOYMENT", "EMPGLOBALASSIGNMENT", "EMPWORKPERMIT")},
    **{t: 5 for t in ("EMPJOBHIST", "EMPJOBRELATIONSHIPS", "PAYMENTINFO", "COMPINFO", "PAYCOMPNONREC")},
}
_PERSON_COLS = ("USERID", "PERSON_ID", "USER_ID", "PERSON_ID_EXTERNAL")
_EFFECTIVE_KEYS = ("START_DATE", "EFFECTIVE_DATE", "EFFECTIVESTARTDATE")
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
        wave = 0 if t.startswith("FO") else _SF_WAVE.get(t, 6)
        effective = any(k in _EFFECTIVE_KEYS for k in tb.keys)
        rows, hist = _rows(frames, t)
        out.append({"module": module, "table": t, "entity": ent, "wave": wave, "method": "upsert",
                    "rows": rows, "history_rows": hist, "purge_type": "full" if effective else None,
                    "pass": 1, "fields": None})
        if t == "EMPJOBHIST":
            mgr = next((p for p, f in entity_fields(tb, ent).items() if f.name == "MANAGER_ID"), None)
            if mgr:
                out[-1]["exclude"] = [mgr]
                out.append({**out[-1], "pass": 2, "purge_type": None, "exclude": [],
                            "fields": [*(entity_fields(tb, ent)[p].name for p in _key_props(tb, ent)), "MANAGER_ID"]})
    return out


def _key_props(table, entity: str) -> list[str]:
    return [p for p, f in entity_fields(table, entity).items() if f.key]


def build_move_plan(modules: Iterable[str], dictionary, frames=None, columns_of=None,
                    config_lists: Optional[dict] = None, mode: str = "cleansed") -> dict:
    """Waves of steps for ``modules``. ``config_lists`` is the result of ``config_diff`` (picklists and FO/MDF
    lists), which adds one config step to wave 0 and narrows FO steps to the values the target lacks."""
    modules = list(dict.fromkeys(modules))
    unplaced: list[dict] = []
    steps: list[dict] = []
    sap_modules = []
    for m in modules:
        first = dictionary.table(OWNED_TABLES[m][0]) if OWNED_TABLES.get(m) else None
        (steps.extend(_sf_steps(m, dictionary, frames, unplaced)) if _is_sf(first) else sap_modules.append(m))
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
            "config": {k: {n: v[n] for n in ("present", "create", "conflict")} for k, v in (config_lists or {}).items()}}


def public_plan(plan: dict) -> dict:
    """The plan as the API returns it (internal step fields dropped)."""
    keep = ("module", "entity", "method", "rows", "history_rows", "purge_type", "depends_on")
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
    out = []
    for row in df.to_dict("records"):
        rec = {}
        for p, f in props.items():
            v = row.get(f.name)
            if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == "":
                continue
            v = (id_map or {}).get(str(v), v) if f.name in mapped else v
            rec[p] = _odata_date(v) if str(f.type).upper() in ("DATE", "DATETIME", "DATS") else v
        out.append((row["__key__"], rec))
    return out


def person_batches(step: dict, records: list[tuple[str, dict]], size: int = BATCH_PERSONS) -> list[list]:
    """Batches of whole persons (every effective-dated row of one person in one call), at most ``size`` persons
    per batch; records with no person go ``size`` to a batch."""
    def person(key: str) -> str:
        parts = dict(p.split("=", 1) for p in key.split("|") if "=" in p)
        return next((parts[c] for c in _PERSON_COLS if c in parts), key)
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
    sent = {p for _, r in records for p in r}
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
         threshold: float = ERROR_THRESHOLD, only: Optional[set] = None) -> dict:
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
                    res = connector.upsert(s["entity"], [r for _, r in batch], purge_type=s.get("purge_type"))
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
