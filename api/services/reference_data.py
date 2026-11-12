"""Reference data management: managed code lists and source to target value mappings.

A code list is not a new store. It is one SAP check table (or the SuccessFactors picklist entity) that Meridian
already extracts into ``config_items``. A completed ``config_loads`` row is a version of the list. The lists below
name only tables and fields that are already in sap/data_dictionary.py (``config_table``) and
sap/config_loader.py; a list with no extraction for a system is empty, never invented.

Mappings live in ``transfer_value_mappings`` (the migration value map). Here a mapping is proposed by one user and
decided by another (``route``), and a mapping is only offered when its target code is in the target list.

AI angle: ``suggest`` may propose a target code for one source code. The prompt holds code values and descriptions
from the code lists only (configuration, never record data). ``verify`` proves the answer; an unproved suggestion
is dropped before anything is shown.
"""
from __future__ import annotations

import re

import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import config_pairing as cp
from api.services.prompt_shapes import in_unit_range
from api.utils.llm_logger import log_llm_call

logger = logging.getLogger("meridian.reference_data")

CODE_CAP = 2000
PROMPT_TARGET_CAP = 400
VERSION_CAP = 20


@dataclass(frozen=True)
class CodeList:
    id: str
    table: str                 # config_items.object
    keys: tuple[str, ...]      # key fields, in key order
    module: str                # the licensed object the list belongs to
    target_fields: tuple[str, ...]  # TABLE.FIELD that the list checks (data_dictionary config_table)
    desc: Optional[str] = None  # description field when it is not one of config_pairing.DESC_FIELDS
    text_table: Optional[str] = None  # language-dependent text table (config_items.object), keyed by lang_field + keys
    text_field: Optional[str] = None  # its description field
    lang_field: str = "SPRAS"
    order_field: Optional[str] = None  # text-table key field whose lowest value wins within a language (T052U.ZTAGG)


LISTS: tuple[CodeList, ...] = (
    CodeList("country", "T005", ("LAND1",), "sd_customer_master", ("KNA1.LAND1",),
             text_table="T005T", text_field="LANDX"),
    CodeList("payment_terms", "T052", ("ZTERM",), "sd_customer_master", ("KNB1.ZTERM",),
             text_table="T052U", text_field="TEXT1", order_field="ZTAGG"),
    CodeList("unit_of_measure", "T006", ("MSEHI",), "material_master", ("MARA.MEINS", "MARA.GEWEI"),
             text_table="T006A", text_field="MSEHL"),
    CodeList("material_group", "T023", ("MATKL",), "material_master", ("MARA.MATKL",),
             text_table="T023T", text_field="WGBEZ"),
    # SuccessFactors: the picklist entity the config loader reads (no label is extracted, so no description)
    CodeList("picklist", "PickListValueV2", ("PickListV2_id", "externalCode"), "employee_central",
             ("PickListValueV2.externalCode",)),
)
MODULES = tuple(dict.fromkeys(x.module for x in LISTS))


def by_id(list_id: str) -> Optional[CodeList]:
    return next((x for x in LISTS if x.id == list_id), None)


ENGLISH = ("E", "EN")  # SPRAS as RFC_READ_TABLE returns it (internal E) or as ISO, the fallback language


SPRAS = {"en": "E", "de": "D", "ja": "J"}  # UI locales (frontend i18n) to SAP logon language


def spras(locale: Optional[str]) -> Optional[str]:
    """SAP SPRAS for a user locale such as ``de`` or ``de-DE``; None when not one of the supported UI locales."""
    return SPRAS.get(re.split(r"[-_]", locale or "")[0].lower())


def _texts(lst: CodeList, items: list[Any], lang: Optional[str]) -> dict[str, str]:
    """Code -> text from the list's text table: the wanted language, else English, else any language."""
    rank = {l.upper(): n for n, l in enumerate([lang, *ENGLISH] if lang else ENGLISH)}
    best: dict[str, tuple[int, int, str]] = {}
    for i in items:
        if i.object != lst.text_table:
            continue
        k = cp.parse_key(i.key)
        code = "/".join(k.get(f, "").strip() for f in lst.keys)
        t = (i.values or {}).get(lst.text_field)
        if not code.strip("/") or not isinstance(t, str) or not t.strip():
            continue
        r = rank.get(k.get(lst.lang_field, "").strip().upper(), len(rank))
        o = k.get(lst.order_field, "").strip() if lst.order_field else ""
        cand = (r, int(o) if o.isdigit() else 10**9, t.strip())
        if code not in best or cand[:2] < best[code][:2]:
            best[code] = cand
    return {c: v[2] for c, v in best.items()}


def codes_of(lst: CodeList, items: list[Any], lang: Optional[str] = None) -> list[dict[str, Optional[str]]]:
    """Distinct ``{code, text}`` of a list, sorted by code. The code is the key field value(s); the text is the
    list's text table in ``lang`` (else English), else its description field, else the first config_pairing
    description field present, else None."""
    out: dict[str, Optional[str]] = {}
    texts = _texts(lst, items, lang) if lst.text_table else {}
    for i in items:
        if i.object != lst.table:
            continue
        k = cp.parse_key(i.key)
        code = "/".join(k.get(f, "").strip() for f in lst.keys)
        if not code.strip("/"):
            continue
        v = i.values or {}
        d = v.get(lst.desc) if lst.desc else None
        out[code] = (d.strip() if isinstance(d, str) and d.strip() else cp._desc(v))
    return [{"code": c, "text": texts.get(c) or out[c]} for c in sorted(out)][:CODE_CAP]


def versions(s: Session, sid: str, lst: CodeList) -> list[dict[str, Any]]:
    """Completed loads of the system, newest first, with how many codes the list held in each."""
    rows = s.execute(text(
        "SELECT l.id::text, l.origin, l.finished_at, "
        "(SELECT count(*) FROM config_items i WHERE i.load_id = l.id AND i.object = :o "
        f" AND i.{cp._TENANT}) "
        f"FROM config_loads l WHERE l.system_id = CAST(:sid AS uuid) AND l.status = 'completed' AND l.{cp._TENANT} "
        "ORDER BY l.finished_at DESC NULLS LAST, l.created_at DESC LIMIT :n"),
        {"sid": sid, "o": lst.table, "n": VERSION_CAP}).fetchall()
    return [{"load_id": r[0], "origin": r[1], "finished_at": r[2].isoformat() if r[2] else None, "codes": int(r[3])}
            for r in rows]


def _with_text_items(lst: CodeList, load: Any) -> list[Any]:
    return [*load(lst.table), *(load(lst.text_table) if lst.text_table else [])]


def source_codes(s: Session, sid: str, lst: CodeList, load_id: Optional[str] = None,
                 lang: Optional[str] = None) -> tuple[list[dict], Optional[str]]:
    """The source system's codes in a version (latest completed load unless ``load_id``), and the version used."""
    lid = load_id
    if lid is None:
        latest = cp.latest_completed_load(s, sid)
        lid = latest[0] if latest else None
    return (codes_of(lst, _with_text_items(lst, lambda o: cp.load_items(s, lid, o)), lang) if lid else []), lid


def target_codes(s: Session, sid: str, lst: CodeList, lang: Optional[str] = None) -> tuple[list[dict], str]:
    """The target's codes: its latest load, else the type's SAP baseline (config_pairing.resolve_target)."""
    t = cp.resolve_target(s, sid)
    return codes_of(lst, _with_text_items(lst, lambda o: cp.target_items(s, t, o)), lang), t.label


def coverage(source: list[dict], mappings: list[dict], target: list[dict]) -> dict[str, int]:
    """Where each source code stands: same code in the target, mapped (approved), waiting for approval, rejected, or
    open (nothing yet). A same-code match needs no mapping."""
    tgt = {c["code"] for c in target}
    by = {m["source_value"]: m["status"] for m in mappings}
    n = {"same": 0, "approved": 0, "proposed": 0, "rejected": 0, "open": 0}
    for c in source:
        st = by.get(c["code"])
        if st == "confirmed":
            n["approved"] += 1
        elif st in ("proposed", "rejected"):
            n[st] += 1
        elif c["code"] in tgt:
            n["same"] += 1
        else:
            n["open"] += 1
    return n


# -- Aletheia suggestion -------------------------------------------------------------------------------------------

def facts(source: dict, targets: list[dict]) -> dict[str, Any]:
    """The only thing the model sees: one source code with its description and the target list's codes with
    descriptions. Check-table configuration, never a master record value."""
    return {"source": {"code": source["code"], "text": source.get("text")},
            "targets": [{"code": c["code"], "text": c.get("text")} for c in targets[:PROMPT_TARGET_CAP]]}


def _build_prompt(list_id: str, f: dict[str, Any]) -> str:
    lines = "\n".join(f"  - {t['code']}: {t['text'] or '(no description)'}" for t in f["targets"])
    s = f["source"]
    return f"""You are an SAP data migration expert mapping one code of the list '{list_id}' from an ECC source to an S/4HANA target.

Source code: {s['code']} ({s['text'] or 'no description'})

Target codes you may choose from:
{lines}

Pick the target code with the same meaning. If none has the same meaning, answer null.

Respond in JSON format only:
{{"target_code": "<code from the list, or null>", "confidence": <0.0-1.0>}}"""


def verify(source: list[dict], target: list[dict], source_code: str, rec: Any) -> dict[str, Any]:
    """Prove a model suggestion before it can be shown. Deterministic.

    SOURCE_KNOWN       the source code is in the source list
    TARGET_EXISTS      the suggested target code is exactly one code of the target list
    CONFIDENCE_VALID   the stated confidence is a number from 0 to 1
    The model's free text is never kept: the sentence shown is written here from the lists."""
    rec = rec if isinstance(rec, dict) else {}
    want = rec.get("target_code")
    tgt = {c["code"]: c for c in target}
    checks = [
        {"code": "SOURCE_KNOWN", "passed": any(c["code"] == source_code for c in source)},
        {"code": "TARGET_EXISTS", "passed": isinstance(want, str) and want in tgt},
        {"code": "CONFIDENCE_VALID", "passed": in_unit_range(rec.get("confidence"))},
    ]
    ok = all(c["passed"] for c in checks)
    hit = tgt.get(want) if ok else None
    sentence = f"{want} is in the target list" + (f" as {hit['text']}." if hit and hit.get("text") else ".") if ok else ""
    return {"verified": ok, "checks": checks, "reasoning": sentence}


def suggest(tenant_id: str, list_id: str, source: list[dict], target: list[dict], source_code: str) -> Optional[dict]:
    """Ask the model for a target code, prove it, and return it only when proved. None: no LLM, a model failure, or a
    suggestion that did not pass (the caller then shows nothing)."""
    from llm.provider import get_llm, llm_is_noop, safe_invoke

    me = next((c for c in source if c["code"] == source_code), None)
    if me is None or not target or llm_is_noop():
        return None
    prompt = _build_prompt(list_id, facts(me, target))
    start = time.monotonic_ns() // 1_000_000
    try:
        llm = get_llm()
        resp = safe_invoke(llm, prompt, timeout_seconds=40, max_tokens=300)
        if resp is None:
            return None
        content = resp if isinstance(resp, str) else getattr(resp, "content", str(resp))
        log_llm_call(tenant_id=tenant_id, service_name="reference_data", prompt=prompt,
                     model_version=getattr(llm, "model", "unknown"), token_count=0,
                     latency_ms=int(time.monotonic_ns() // 1_000_000 - start), success=True)
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        cleaned = cleaned.rsplit("```", 1)[0].strip()
        rec = json.loads(cleaned)
    except Exception as e:  # a model or parse failure is "no suggestion", never an error to the steward
        logger.warning("reference data suggestion failed for %s: %s", list_id, e)
        return None
    proof = verify(source, target, source_code, rec)
    if not proof["verified"]:
        return None
    tgt = next(c for c in target if c["code"] == rec["target_code"])
    return {"source_code": source_code, "target_code": tgt["code"], "target_text": tgt.get("text"),
            "confidence": float(rec["confidence"]), "reasoning": proof["reasoning"], "checks": proof["checks"]}


# -- Usage: which codes the records actually hold --------------------------------------------------------------------

def usage(codes: list[dict], profiles: dict[str, Optional[dict]]) -> dict[str, Any]:
    """How the records use a code list, from the stored field profiles of its target fields (``TABLE.FIELD`` ->
    ``field_profiles.stats``, None when the field was not profiled).

    A profile lists at most its top values, so when a field holds more distinct values than it lists the figures
    are lower bounds: ``orphans_complete`` and ``unused_certain`` are False and ``covered_at_least`` is True. A
    composite code (``PickListV2_id/externalCode``) is matched on its last part, the value the record holds."""
    known = {str(c["code"]).rsplit("/", 1)[-1] for c in codes}
    fields, orphans, used = [], {}, set()
    filled_all = covered_all = 0
    complete = True
    for col, st in profiles.items():
        f: dict[str, Any] = {"field": col, "profiled": st is not None, "rows": 0, "filled": 0, "covered": 0,
                             "orphan_rows": 0, "masked": False, "mask_reason": None, "truncated": False,
                             "sampled": False}
        fields.append(f)
        if st is None:
            complete = False
            continue
        rows, blank = int(st.get("rows", 0)), int(st.get("blank", 0))
        f.update(rows=rows, filled=max(rows - blank, 0), sampled=bool(st.get("sampled")))
        tv = st.get("top_values")
        if st.get("masked") or tv is None:
            f.update(masked=True, mask_reason=st.get("mask_reason") or "privacy")
            complete = False
            continue
        f["truncated"] = int(st.get("distinct", 0)) > len(tv)
        complete = complete and not f["truncated"]
        for v in tv:
            val, n = str(v["value"]).strip(), int(v["count"])
            if not val:
                continue
            if val in known:
                used.add(val)
                f["covered"] += n
            else:
                f["orphan_rows"] += n
                o = orphans.setdefault(val, {"value": val, "count": 0, "fields": []})
                o["count"] += n
                o["fields"].append(col)
        filled_all += f["filled"]
        covered_all += f["covered"]
    return {
        "fields": fields,
        "orphans": sorted(orphans.values(), key=lambda o: (-o["count"], o["value"])),
        "orphans_complete": complete,
        "unused": sorted(known - used),
        "unused_certain": complete,
        "codes": len(known), "used": len(used),
        "filled": filled_all, "covered": covered_all,
        "covered_share": round(covered_all / filled_all, 4) if filled_all else None,
        "covered_at_least": not complete,
    }
