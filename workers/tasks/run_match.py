"""Match pipeline: block, compare and score near-duplicate master records.

Fanned out from run_checks next to run_dedup, once per analysed module. Each module has a
match profile (PROFILES): the record id, the candidate passes that find pairs worth scoring
and the default comparator rules. Passes are unioned, so a pair found by any pass is scored:

- ``key``        exact match on a normalised key (manufacturer part number, tax number,
                 national id, date of birth + surname ...). One group-by: O(n).
- ``neighbour``  sorted neighbourhood on a normalised name or description: each record is
                 compared with the next WINDOW records in sort order, once on the value and
                 once with its tokens reversed. O(n log n), needs no blocking field.
- ``blocked``    the similarity check's name comparison inside one blocking key.

A key value shared by more than MAX_BLOCK records is not a duplicate signal (a placeholder
tax number, a shared switchboard phone): those groups are skipped and counted per pass. Each
pair is scored by match_engine.score_candidate_pair, which upserts match_scores and queues
the review band; populate_queue then turns queued pairs into steward merge decisions. Pairs
a steward marked do_not_match are never scored.

Cross-system: run_cross_system_match stacks the latest complete run of every connected system of the
tenant that holds the module and keeps only the pairs whose two records come from different systems
(same-system pairs stay with run_match). Each such pair's explanation carries ``sources``: the key,
system and description of both sides, which the review queue and the Across systems view read.
"""

import logging
from collections.abc import Hashable
from typing import Any, Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from checks.types.similarity_check import blocks, near_pairs
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.run_match")

CANDIDATE_THRESHOLD = 0.8  # looser than the similarity rules' 0.9: the match engine sets the band
MAX_BLOCK = 300
WINDOW = 8
# ponytail: each pair is scored with its own queries; past this many candidates a run stops
# and reports the rest as not scored. Batch score_candidate_pair (rules loaded once) to lift it.
MAX_CANDIDATES = 200_000
# Normalised key values that mean "not known", never "the same record".
_JUNK = {"", "0", "NA", "NONE", "NULL", "UNKNOWN", "TBA", "TBD", "XXX", "NOTAPPLICABLE", "NIL"}

# Every field below is in sap/dictionaries (ECC MARA, MAKT, KNA1, KNBK, ADR6, BUT000, ADRC)
# or the SuccessFactors canonical PERINFO table. Rules: (field, comparator, weight, threshold).
PROFILES: dict[str, dict[str, Any]] = {
    "business_partner": {
        "id": "BUT000.PARTNER",
        "passes": [
            {"name": "name_in_postcode", "kind": "blocked", "field": "BUT000.NAME_ORG1",
             "block_by": ["ADRC.COUNTRY", "ADRC.POST_CODE1"]},
        ],
        "rules": [("BUT000.NAME_ORG1", "name_legal", 60, 0.85),
                  ("ADRC.STREET", "address_tokens", 25, 0.7),
                  ("ADRC.CITY1", "exact", 15, 1.0)],
    },
    "material_master": {
        "id": "MARA.MATNR",
        "passes": [
            {"name": "manufacturer_part", "kind": "key", "fields": [("MARA.MFRPN", "part_number")]},
            {"name": "old_material_number", "kind": "key", "fields": [("MARA.BISMT", "part_number")]},
            {"name": "description_and_unit", "kind": "key",
             "fields": [("MAKT.MAKTX", "desc_tokens"), ("MARA.MEINS", "code_exact")]},
            {"name": "description_neighbours", "kind": "neighbour", "field": "MAKT.MAKTX",
             "comparator": "desc_tokens"},
            {"name": "name_in_group", "kind": "blocked", "field": "MAKT.MAKTX",
             "block_by": ["MARA.MATKL", "MARA.MTART"]},
        ],
        "rules": [("MAKT.MAKTX", "desc_tokens", 35, 0.85),
                  ("MARA.MFRPN", "part_number", 20, 1.0),
                  ("MARA.MFRNR", "code_exact", 10, 1.0),
                  ("MARA.BISMT", "part_number", 10, 1.0),
                  ("MARA.MEINS", "code_exact", 10, 1.0),
                  ("MARA.MATKL", "code_exact", 10, 1.0),
                  ("MARA.MTART", "code_exact", 5, 1.0)],
    },
    "sd_customer_master": {
        "id": "KNA1.KUNNR",
        "passes": [
            {"name": "tax_number_1", "kind": "key", "fields": [("KNA1.STCD1", "tax_exact")]},
            {"name": "tax_number_2", "kind": "key", "fields": [("KNA1.STCD2", "tax_exact")]},
            {"name": "vat_registration", "kind": "key", "fields": [("KNA1.STCEG", "tax_exact")]},
            {"name": "phone", "kind": "key", "fields": [("KNA1.TELF1", "phone_e164")]},
            {"name": "email", "kind": "key", "fields": [("ADR6.SMTP_ADDR", "email")]},
            {"name": "bank_account", "kind": "key",
             "fields": [("KNBK.BANKL", "code_exact"), ("KNBK.BANKN", "bank_exact")]},
            {"name": "legal_name_and_country", "kind": "key",
             "fields": [("KNA1.NAME1", "name_legal"), ("KNA1.LAND1", "code_exact")]},
            {"name": "name_neighbours", "kind": "neighbour", "field": "KNA1.NAME1", "comparator": "name_legal"},
        ],
        "rules": [("KNA1.NAME1", "name_legal", 30, 0.85),
                  ("KNA1.STCEG", "tax_exact", 15, 1.0),
                  ("KNA1.STCD1", "tax_exact", 10, 1.0),
                  ("KNA1.STCD2", "tax_exact", 5, 1.0),
                  ("KNA1.STRAS", "address_tokens", 10, 0.7),
                  ("KNA1.PSTLZ", "code_exact", 5, 1.0),
                  ("KNA1.ORT01", "name_legal", 5, 0.85),
                  ("KNA1.LAND1", "code_exact", 5, 1.0),
                  ("KNA1.TELF1", "phone_e164", 5, 0.9),
                  ("ADR6.SMTP_ADDR", "email", 5, 1.0),
                  ("KNBK.BANKN", "bank_exact", 5, 1.0)],
    },
    "employee_central": {
        # Duplicate people, not employments: the PerPerson grain (one person, many employments).
        "id": "PERINFO.PERSON_ID",
        "anchor": "PERINFO",
        "passes": [
            {"name": "national_id", "kind": "key", "fields": [("PERINFO.NATIONAL_ID", "national_id")]},
            {"name": "birth_date_and_last_name", "kind": "key",
             "fields": [("PERINFO.DATE_OF_BIRTH", "date_exact"), ("PERINFO.LASTNAME", "person_name")]},
            {"name": "birth_date_and_first_name", "kind": "key",
             "fields": [("PERINFO.DATE_OF_BIRTH", "date_exact"), ("PERINFO.FIRSTNAME", "person_name")]},
            {"name": "name_neighbours", "kind": "neighbour", "field": "PERINFO.LASTNAME",
             "comparator": "person_name", "also": "PERINFO.FIRSTNAME"},
        ],
        "rules": [("PERINFO.NATIONAL_ID", "national_id", 35, 1.0),
                  ("PERINFO.DATE_OF_BIRTH", "date_exact", 20, 1.0),
                  ("PERINFO.LASTNAME", "person_name", 15, 0.85),
                  ("PERINFO.FIRSTNAME", "person_name", 15, 0.85),
                  ("PERINFO.GENDER", "code_exact", 5, 1.0),
                  ("PERINFO.NATIONALITY", "code_exact", 5, 1.0),
                  ("PERINFO.NATIONAL_ID_COUNTRY", "code_exact", 5, 1.0)],
    },
}

# Seeded only for a domain with no match_rules at all.
DEFAULT_RULES: dict[str, list[tuple[str, str, int, float]]] = {m: p["rules"] for m, p in PROFILES.items()}
# module: (id column, name column, block-by columns): the blocked name pass, which the Dedup page uses.
MATCH_KEYS: dict[str, tuple[str, str, list[str]]] = {
    m: (p["id"], ps["field"], ps["block_by"])
    for m, p in PROFILES.items() for ps in p["passes"] if ps["kind"] == "blocked"}

_SEED_RULES = text("""
    INSERT INTO match_rules (id, tenant_id, domain, field, match_type, weight, threshold, active)
    SELECT gen_random_uuid(), CAST(:tid AS uuid), :d, u.f, u.m, u.w, u.t, true
    FROM unnest(CAST(:f AS text[]), CAST(:m AS text[]), CAST(:w AS int[]), CAST(:t AS float8[])) AS u(f, m, w, t)
    WHERE NOT EXISTS (SELECT 1 FROM match_rules WHERE tenant_id = CAST(:tid AS uuid) AND domain = :d)
""")
_DO_NOT_MATCH = text("""
    SELECT key_lo, key_hi FROM mdm_pair_constraints
    WHERE tenant_id = CAST(:tid AS uuid) AND domain = :d AND kind = 'do_not_match'
""")


def candidate_pairs(df: pd.DataFrame,
                    module: str) -> tuple[list[tuple[Hashable, Hashable, float]], dict[str, int]]:
    """Index pairs whose names are near inside a block, plus what could not be compared."""
    _, name_col, block_by = MATCH_KEYS[module]
    kept, oversized = blocks(df, name_col, block_by, MAX_BLOCK)
    compared = sum(len(g) for g in kept)
    not_compared = sum(len(g) for g in oversized)
    return near_pairs(df, name_col, kept, CANDIDATE_THRESHOLD), {
        "compared": compared,
        "blocks_skipped_too_large": len(oversized),
        "records_not_compared": not_compared,
        "records_not_blocked": len(df) - compared - not_compared,
    }


def pass_columns(p: dict) -> list[str]:
    if p["kind"] == "key":
        return [c for c, _ in p["fields"]]
    if p["kind"] == "blocked":
        return [p["field"], *p["block_by"]]
    return [p["field"]] + ([p["also"]] if p.get("also") else [])


def _normalised(df: pd.DataFrame, col: str, comparator: str) -> pd.Series:
    from api.services.merge_explain import SAP_COMPARATORS

    norm = SAP_COMPARATORS[comparator][0]
    return df[col].map(lambda v: "" if v is None or (isinstance(v, float) and pd.isna(v)) else str(norm(str(v))))


def _pair(a: Hashable, b: Hashable) -> tuple[Hashable, Hashable]:
    return (a, b) if str(a) <= str(b) else (b, a)


def key_pass(df: pd.DataFrame, fields: list[tuple[str, str]]) -> tuple[list[tuple[Hashable, Hashable]], dict]:
    """Pairs whose normalised key is equal. A blank or placeholder part drops the record."""
    parts = [_normalised(df, c, comp) for c, comp in fields]
    ok = pd.Series(True, index=df.index)
    for s in parts:
        ok &= ~s.str.upper().str.replace(r"[^0-9A-Z]", "", regex=True).isin(_JUNK) & (s.str.len() >= 2)
    key = parts[0] if len(parts) == 1 else parts[0].str.cat(parts[1:], sep="|")
    key = key[ok]
    pairs: list[tuple[Hashable, Hashable]] = []
    oversized = 0
    for idx in key.groupby(key).groups.values():
        if len(idx) > MAX_BLOCK:
            oversized += 1
        elif len(idx) > 1:
            pairs.extend(_pair(idx[i], idx[j]) for i in range(len(idx)) for j in range(i + 1, len(idx)))
    return pairs, {"keyed": int(ok.sum()), "groups_skipped_too_large": oversized}


def neighbour_pass(df: pd.DataFrame, col: str, comparator: str, also: Optional[str] = None,
                   window: int = WINDOW) -> tuple[list[tuple[Hashable, Hashable]], dict]:
    """Sorted neighbourhood: sort on the normalised value, then on it with tokens reversed, and
    compare each record with the next ``window``; keep pairs scoring >= CANDIDATE_THRESHOLD."""
    from api.services.merge_explain import SAP_COMPARATORS

    scorer = SAP_COMPARATORS[comparator][1]
    s = _normalised(df, col, comparator)
    if also:  # person names: last name sorts, first name tells two people of one surname apart
        s = s.str.cat(_normalised(df, also, comparator), sep=" ").str.strip()
    s = s[s.str.len() >= 3]
    vals = s.to_dict()
    seen: set[tuple[Hashable, Hashable]] = set()
    for order in (s.sort_values(), s.map(lambda v: " ".join(reversed(v.split()))).sort_values()):
        idx = list(order.index)
        for i, a in enumerate(idx):
            for b in idx[i + 1:i + 1 + window]:
                k = _pair(a, b)
                if k not in seen and scorer(vals[a], vals[b]) >= CANDIDATE_THRESHOLD:
                    seen.add(k)
    return list(seen), {"keyed": len(s)}


def profile_candidates(df: pd.DataFrame,
                       module: str) -> tuple[dict[tuple[Hashable, Hashable], list[str]], dict[str, dict]]:
    """Every pass of the module's profile, unioned: pair -> names of the passes that found it."""
    found: dict[tuple[Hashable, Hashable], list[str]] = {}
    report: dict[str, dict] = {}
    for p in PROFILES[module]["passes"]:
        missing = [c for c in pass_columns(p) if c not in df.columns]
        if missing:
            report[p["name"]] = {"status": "skipped", "missing": missing}
            continue
        if p["kind"] == "key":
            pairs, stats = key_pass(df, p["fields"])
        elif p["kind"] == "neighbour":
            pairs, stats = neighbour_pass(df, p["field"], p["comparator"], p.get("also"))
        else:
            near, stats = candidate_pairs(df, module)
            pairs = [_pair(a, b) for a, b, _ in near]
        for k in pairs:
            found.setdefault(k, []).append(p["name"])
        report[p["name"]] = {"status": "complete", "pairs": len(pairs), **stats}
    return found, report


def _record(row: pd.Series) -> dict:
    """Row as plain Python values for scoring (NaN to None, numpy scalars to Python)."""
    return {k: None if pd.isna(v) else (v.item() if hasattr(v, "item") else v) for k, v in row.items()}


def _text_cols(profile: dict) -> list[str]:
    """The description of a record: the name or text column of the profile's first name pass."""
    p = next((p for p in profile["passes"] if "field" in p), None)
    return [] if p is None else [p["field"]] + ([p["also"]] if p.get("also") else [])


def _source(df: pd.DataFrame, i: Hashable, key: str, system: dict, cols: list[str],
            record_key: Optional[str] = None) -> dict:
    words = [str(df.at[i, c]).strip() for c in cols if c in df.columns and not pd.isna(df.at[i, c])]
    # record_key: the golden record's system-qualified key, only when it differs from the SAP key
    return {"key": key, **system, "text": " ".join(w for w in words if w) or None,
            **({"record_key": record_key} if record_key and record_key != key else {})}


def master_keys(df: pd.DataFrame, id_col: str, systems: pd.Series, tenant_id: str, module: str,
                session: Session) -> dict:
    """Golden key per row index. A SAP key found in more than one system maps to its system-qualified
    golden key where build_golden_records created one (golden_keys); every other row keeps its plain key."""
    from api.services.golden_keys import qualify

    sid = systems.map(lambda s: s["system_id"])
    keys = df[id_col].astype(str)
    out = dict(keys)
    multi = sid.groupby(keys).nunique()
    dup = keys[keys.map(multi) > 1]
    if dup.empty:
        return out
    qual = {i: qualify(k, sid[i]) for i, k in dup.items()}
    have = {r[0] for r in session.execute(text(
        "SELECT sap_object_key FROM master_records WHERE tenant_id = :tid AND domain = :d "
        "AND sap_object_key = ANY(:keys)"), {"tid": tenant_id, "d": module, "keys": sorted(set(qual.values()))})}
    out.update({i: q for i, q in qual.items() if q in have})
    return out


def match_frame(df: pd.DataFrame, module: str, tenant_id: str, session: Optional[Session],
                systems: Optional[pd.Series] = None) -> dict:
    """Score one module's candidate pairs into match_scores. ``session`` may be None only
    when the module is skipped (no DB work happens before the column checks). ``systems``
    (index-aligned, ``{"system_id", "system_name"}`` per row) keeps only pairs across systems."""
    from api.services.match_engine import score_candidate_pair
    from api.services.merge_explain import drop_blocked_pairs

    profile = PROFILES.get(module)
    if profile is None:
        return {"status": "skipped", "reason": f"no match profile for {module}"}
    id_col = profile["id"]
    usable = [p for p in profile["passes"] if all(c in df.columns for c in pass_columns(p))]
    if id_col not in df.columns or not usable:
        cols = dict.fromkeys([id_col, *(c for p in profile["passes"] for c in pass_columns(p))])
        return {"status": "skipped", "reason": f"missing columns: {', '.join(c for c in cols if c not in df.columns)}"}
    assert session is not None

    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    # ponytail: two first runs at once can both seed; duplicate rules only double-weight
    # equally. Add a unique (tenant_id, domain, field) key if that ever happens.
    f, m, w, t = (list(x) for x in zip(*DEFAULT_RULES[module]))
    session.execute(_SEED_RULES, {"tid": tenant_id, "d": module, "f": f, "m": m, "w": w, "t": t})
    blocked = {(r.key_lo, r.key_hi) for r in session.execute(_DO_NOT_MATCH, {"tid": tenant_id, "d": module})}
    session.commit()

    found, passes = profile_candidates(df, module)
    candidates = []
    mkeys = None if systems is None else master_keys(df, id_col, systems, tenant_id, module, session)
    for a, b in found:
        ida, idb = (str(df.at[a, id_col]), str(df.at[b, id_col])) if mkeys is None else (mkeys[a], mkeys[b])
        if systems is not None and systems.at[a]["system_id"] == systems.at[b]["system_id"]:
            continue  # a same-system pair belongs to that system's own run_match
        if ida != idb:  # identical keys are cleaning_engine's exact_pk duplicates
            candidates.append({"category": "dedup", "record_key": f"{ida}|{idb}", "a": a, "b": b})
    not_scored = max(len(candidates) - MAX_CANDIDATES, 0)
    capped = candidates[:MAX_CANDIDATES]
    to_score = drop_blocked_pairs(capped, blocked)

    queued = 0
    for c in to_score:
        ida, _, idb = c["record_key"].partition("|")
        sources = None if systems is None else [
            _source(df, c["a"], str(df.at[c["a"], id_col]), systems.at[c["a"]], _text_cols(profile), ida),
            _source(df, c["b"], str(df.at[c["b"], id_col]), systems.at[c["b"]], _text_cols(profile), idb)]
        res = score_candidate_pair(tenant_id, module, _record(df.loc[c["a"]]), _record(df.loc[c["b"]]),
                                   ida, idb, session, dry_run=False, sources=sources)
        queued += res["auto_action"] == "queued"
    legacy = next((passes[p["name"]] for p in profile["passes"] if p["kind"] == "blocked"), {})
    return {"status": "complete", **{k: v for k, v in legacy.items() if k not in ("status", "pairs")},
            "passes": passes, "candidates": len(candidates), "candidates_not_scored": not_scored,
            "blocked": len(capped) - len(to_score), "scored": len(to_score), "queued": queued}


@celery_app.task(bind=True, name="workers.tasks.run_match.run_match",
                 soft_time_limit=1800, time_limit=2100)
def run_match(self, version_id: str, tenant_id: str, module: str, parquet_path: str) -> dict:
    """Score one analysed module's near-duplicate pairs and refresh the steward queue."""
    from workers.dataset import load_module_frame
    from workers.tasks.populate_stewardship_queue import populate_queue

    if module not in PROFILES:
        return {"version_id": version_id, "module": module, "status": "skipped"}
    df = load_module_frame(parquet_path, module, anchor=PROFILES[module].get("anchor"))
    with Session(get_sync_engine()) as session:
        result = match_frame(df, module, tenant_id, session)
    logger.info("run_match version_id=%s module=%s result=%s", version_id, module,
                {k: v for k, v in result.items() if k != "passes"})
    if result.get("queued"):
        populate_queue.delay()
    run_cross_system_match.delay(tenant_id, module)
    return {"version_id": version_id, "module": module, **result}


# The latest complete run per connected system that analysed the module and kept its dataset.
_LATEST_PER_SYSTEM = text("""
    SELECT DISTINCT ON (s.id) s.id::text AS system_id, s.name AS system_name, v.id::text AS version_id,
           COALESCE(v.metadata->>'dataset_path', v.metadata->>'parquet_path') AS path
      FROM analysis_versions v
      JOIN sap_systems s ON s.tenant_id = v.tenant_id AND s.id::text = v.metadata->>'system_id'
     WHERE v.tenant_id = CAST(:tid AS uuid) AND v.status = 'complete'
       AND COALESCE(v.metadata->>'dataset_path', v.metadata->>'parquet_path') IS NOT NULL
       AND v.metadata->'modules' @> to_jsonb(CAST(:m AS text))
     ORDER BY s.id, v.created_at DESC
""")


def latest_runs(session: Session, tenant_id: str, module: str) -> list[Any]:
    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    return list(session.execute(_LATEST_PER_SYSTEM, {"tid": str(tenant_id), "m": module}))


def stack_systems(frames: list[tuple[dict, pd.DataFrame]]) -> tuple[pd.DataFrame, pd.Series]:
    """One frame of every system's records and the system of each row, on a fresh index."""
    df = pd.concat([f for _, f in frames], ignore_index=True)
    systems = pd.Series([s for s, f in frames for _ in range(len(f))], index=df.index, dtype=object)
    return df, systems


@celery_app.task(bind=True, name="workers.tasks.run_match.run_cross_system_match",
                 soft_time_limit=1800, time_limit=2100)
def run_cross_system_match(self, tenant_id: str, module: str) -> dict:
    """Score the module's duplicates across the tenant's connected systems (latest complete run each)."""
    from workers.dataset import load_module_frame
    from workers.tasks.populate_stewardship_queue import populate_queue

    if module not in PROFILES:
        return {"module": module, "status": "skipped"}
    with Session(get_sync_engine()) as session:
        runs = latest_runs(session, tenant_id, module)
        if len(runs) < 2:
            return {"module": module, "status": "skipped", "reason": "fewer than two systems"}
        # ponytail: every system's frame in memory at once; stream per block if a landscape outgrows a worker
        frames = [({"system_id": r.system_id, "system_name": r.system_name},
                   load_module_frame(r.path, module, anchor=PROFILES[module].get("anchor"))) for r in runs]
        df, systems = stack_systems(frames)
        result = match_frame(df, module, tenant_id, session, systems=systems)
    logger.info("run_cross_system_match tenant=%s module=%s systems=%d result=%s", tenant_id, module, len(runs),
                {k: v for k, v in result.items() if k != "passes"})
    if result.get("queued"):
        populate_queue.delay()
    return {"module": module, "systems": [r.system_name for r in runs], **result}
