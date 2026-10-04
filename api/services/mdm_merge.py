"""Consolidate master records into clusters (match & merge), and take them apart again.

A cluster is a head record (``merged_into IS NULL``) plus members
(``merged_into = head.id``, status ``superseded``). Every record keeps its own
pre-merge values in ``own_fields`` so survivorship can be recomputed for both
sides of an unmerge. Survivorship per attribute (winner, rule, losing values with
reasons) comes from ``merge_explain.survive_cluster``; without a survivorship rule
it is source priority = join order, which is what ``fuse`` does.

Every operation writes one immutable ``mdm_merge_events`` row with before/after
snapshots, plus the legacy ``master_record_history`` rows. Unmerge records
do_not_match pairs so a cleaning rerun does not re-merge the split.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.merge_explain import pair_key, survive_cluster


class PairConstraintError(Exception):
    """A steward do_not_match pair spans the two clusters being merged."""


class MergeStateError(Exception):
    """The requested unmerge / undo / revert does not fit the current cluster state."""


def fuse(survivor: dict, merged: dict, contributions: dict, merged_key: str,
         overrides: Optional[dict] = None) -> tuple[dict, dict, list[str]]:
    fields, contrib, filled = dict(survivor), dict(contributions), []
    now = datetime.now(timezone.utc).isoformat()
    for f, v in merged.items():
        if fields.get(f) in (None, "") and v not in (None, ""):
            fields[f] = v
            contrib[f] = {"value": v, "source_system": f"merge:{merged_key}", "extracted_at": now, "confidence": None}
            filled.append(f)
    for f, v in (overrides or {}).items():
        fields[f] = v
        contrib[f] = {"value": v, "source_system": "steward_override", "extracted_at": now, "confidence": 1.0}
    return fields, contrib, filled


_COLS = ("id, domain, sap_object_key, golden_fields, source_contributions, own_fields, steward_overrides, "
         "merged_into, status, created_at")
_HIST = text("""
    INSERT INTO master_record_history (id, tenant_id, master_record_id, changed_by, change_type,
                                       previous_fields, new_fields)
    VALUES (gen_random_uuid(), :tid, :mid, CAST(:uid AS uuid), :ct, CAST(:prev AS jsonb), CAST(:new AS jsonb))
""")


def _own(r: Any) -> dict:
    return dict(r.own_fields if r.own_fields is not None else (r.golden_fields or {}))


async def _by_key(db: AsyncSession, tid: str, domain: str, key: str) -> Any:
    return (await db.execute(text(f"SELECT {_COLS} FROM master_records WHERE tenant_id = :tid AND domain = :d "
                                  "AND sap_object_key = :k FOR UPDATE"),
                             {"tid": tid, "d": domain, "k": key})).first()


async def _by_id(db: AsyncSession, tid: str, rid: Any) -> Any:
    return (await db.execute(text(f"SELECT {_COLS} FROM master_records WHERE tenant_id = :tid AND id = :id "
                                  "FOR UPDATE"), {"tid": tid, "id": str(rid)})).first()


async def _head(db: AsyncSession, tid: str, r: Any) -> Any:
    return await _by_id(db, tid, r.merged_into) if r is not None and r.merged_into else r


async def resolve_head(db: AsyncSession, tid: str, record_id: str) -> Any:
    """Head row of the cluster a record (head or member) belongs to; None when unknown."""
    return await _head(db, tid, await _by_id(db, tid, record_id))


async def _members(db: AsyncSession, tid: str, head_id: Any) -> list[Any]:
    # ponytail: join order approximated by member created_at; store a join sequence if stewards need exact order.
    return list((await db.execute(text(f"SELECT {_COLS} FROM master_records WHERE tenant_id = :tid "
                                       "AND merged_into = :h ORDER BY created_at, sap_object_key FOR UPDATE"),
                                  {"tid": tid, "h": str(head_id)})).fetchall())


def _snapshot(head: Any, golden: dict, overrides: dict, member_keys: list[str]) -> dict:
    return {"golden_record_id": str(head.id), "key": head.sap_object_key, "golden_fields": golden,
            "steward_overrides": overrides, "members": member_keys}


async def _rules(db: AsyncSession, tid: str, domain: str) -> dict:
    from api.services.golden_record_engine import _load_survivorship_rules
    return await _load_survivorship_rules(db, tid, domain)


async def _recompute(db: AsyncSession, tid: str, head: Any, members: list[Any], overrides: dict) -> dict:
    """Recompute and store golden values + explanation for ``head`` over ``members``."""
    rows = [head, *members]
    res = survive_cluster(
        [{"key": r.sap_object_key, "fields": _own(r), "extracted_at": r.created_at} for r in rows],
        await _rules(db, tid, head.domain), overrides)
    golden = {f: "" for r in rows for f in _own(r)}
    golden.update(res["fields"])
    now = datetime.now(timezone.utc).isoformat()
    old = head.source_contributions or {}
    contrib: dict = {}
    for f, ex in res["explanation"].items():
        if ex["rule"] == "steward_override":
            contrib[f] = {"value": golden[f], "source_system": "steward_override", "extracted_at": now,
                          "confidence": 1.0}
        elif ex["winner_key"] == head.sap_object_key:
            if f in old:
                contrib[f] = old[f]
        else:
            contrib[f] = {"value": golden[f], "source_system": f"merge:{ex['winner_key']}", "extracted_at": now,
                          "confidence": None}
    await db.execute(text("""
        UPDATE master_records SET golden_fields = CAST(:f AS jsonb), source_contributions = CAST(:c AS jsonb),
               steward_overrides = CAST(:o AS jsonb), survivorship_explanation = CAST(:e AS jsonb),
               own_fields = CAST(:own AS jsonb), updated_at = now()
         WHERE tenant_id = :tid AND id = :id
    """), {"tid": tid, "id": str(head.id), "f": json.dumps(golden, default=str), "c": json.dumps(contrib, default=str),
           "o": json.dumps(overrides, default=str), "e": json.dumps(res["explanation"], default=str),
           "own": json.dumps(_own(head), default=str)})
    return golden


async def _event(db: AsyncSession, tid: str, domain: str, event_type: str, golden_id: Optional[Any],
                 keys: list[str], user_id: Optional[str], reason: Optional[str], before: Any, after: Any,
                 reverses: Optional[str] = None) -> str:
    return str((await db.execute(text("""
        INSERT INTO mdm_merge_events (tenant_id, domain, event_type, golden_record_id, member_keys, actor, reason,
                                      before, after, reverses_event_id)
        VALUES (:tid, :d, :et, :g, :k, CAST(:u AS uuid), :r, CAST(:b AS jsonb), CAST(:a AS jsonb), :rev)
        RETURNING id
    """), {"tid": tid, "d": domain, "et": event_type, "g": str(golden_id) if golden_id else None, "k": keys,
           "u": user_id, "r": reason, "b": json.dumps(before, default=str), "a": json.dumps(after, default=str),
           "rev": reverses})).scalar())


async def _upsert_constraint(db: AsyncSession, tid: str, domain: str, a: str, b: str, kind: str,
                             reason: Optional[str], user_id: Optional[str], event_id: str) -> str:
    lo, hi = pair_key(a, b)
    return str((await db.execute(text("""
        INSERT INTO mdm_pair_constraints (tenant_id, domain, key_lo, key_hi, kind, reason, created_by, event_id)
        VALUES (:tid, :d, :lo, :hi, :kind, :r, CAST(:u AS uuid), :ev)
        ON CONFLICT (tenant_id, domain, key_lo, key_hi) DO UPDATE
           SET kind = EXCLUDED.kind, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by,
               event_id = EXCLUDED.event_id, created_at = now()
        RETURNING id
    """), {"tid": tid, "d": domain, "lo": lo, "hi": hi, "kind": kind, "r": reason, "u": user_id,
           "ev": event_id})).scalar())


async def merge_master_records(db: AsyncSession, tenant_id: str, domain: str, survivor_key: str, merged_key: str,
                               user_id: Optional[str], overrides: Optional[dict] = None, *,
                               reason: Optional[str] = None, event_type: str = "merge",
                               reverses: Optional[str] = None) -> Optional[dict]:
    """Merge the cluster of ``merged_key`` into the cluster of ``survivor_key``.

    Returns None when either key has no master record in ``domain``, a key is a legacy
    superseded record outside any cluster, or both keys are already in one cluster.
    Raises PairConstraintError when a do_not_match pair spans the two clusters.
    """
    s_row, m_row = (await _by_key(db, tenant_id, domain, survivor_key),
                    await _by_key(db, tenant_id, domain, merged_key))
    if s_row is None or m_row is None:
        return None
    s, m = await _head(db, tenant_id, s_row), await _head(db, tenant_id, m_row)
    if s is None or m is None or s.id == m.id or "superseded" in (s.status, m.status):
        return None
    s_members, m_members = await _members(db, tenant_id, s.id), await _members(db, tenant_id, m.id)
    s_keys = [s.sap_object_key, *(r.sap_object_key for r in s_members)]
    m_keys = [m.sap_object_key, *(r.sap_object_key for r in m_members)]
    blocked = (await db.execute(text("""
        SELECT key_lo, key_hi FROM mdm_pair_constraints
         WHERE tenant_id = :tid AND domain = :d AND kind = 'do_not_match'
           AND key_lo = ANY(:k) AND key_hi = ANY(:k)
    """), {"tid": tenant_id, "d": domain, "k": s_keys + m_keys})).fetchall()
    spans = [(r[0], r[1]) for r in blocked if (r[0] in s_keys) != (r[1] in s_keys)]
    if spans:
        raise PairConstraintError(f"do_not_match pair {spans[0][0]} / {spans[0][1]} spans the two clusters")

    _, _, filled = fuse(s.golden_fields or {}, m.golden_fields or {}, {}, merged_key, overrides)
    s_ov, m_ov = dict(s.steward_overrides or {}), dict(m.steward_overrides or {})
    new_ov = {**m_ov, **s_ov, **(overrides or {})}
    before = {"survivor": _snapshot(s, s.golden_fields or {}, s_ov, s_keys[1:]),
              "merged": _snapshot(m, m.golden_fields or {}, m_ov, m_keys[1:]),
              "steward_overrides": s_ov}

    await db.execute(text("""
        UPDATE master_records SET own_fields = COALESCE(own_fields, golden_fields), merged_into = :s,
               status = 'superseded', updated_at = now()
         WHERE tenant_id = :tid AND (id = :m OR merged_into = :m)
    """), {"tid": tenant_id, "s": str(s.id), "m": str(m.id)})
    golden = await _recompute(db, tenant_id, s, await _members(db, tenant_id, s.id), new_ov)

    await db.execute(_HIST, {"tid": tenant_id, "mid": s.id, "uid": user_id, "ct": "merged",
                             "prev": json.dumps(s.golden_fields or {}), "new": json.dumps(golden, default=str)})
    await db.execute(_HIST, {"tid": tenant_id, "mid": m.id, "uid": user_id, "ct": "superseded",
                             "prev": json.dumps(m.golden_fields or {}),
                             "new": json.dumps({"merged_into": s.sap_object_key})})
    after = {**_snapshot(s, golden, new_ov, s_keys[1:] + m_keys), "added_keys": m_keys}
    event_id = await _event(db, tenant_id, domain, event_type, s.id, m_keys, user_id, reason, before, after,
                            reverses)
    return {"survivor_id": str(s.id), "superseded_id": str(m.id), "filled_fields": filled, "event_id": event_id,
            "golden_fields": golden}


async def unmerge(db: AsyncSession, tenant_id: str, golden_id: str, split_keys: list[str],
                  user_id: Optional[str], reason: Optional[str], *, event_type: str = "unmerge",
                  add_do_not_match: bool = True, reverses: Optional[str] = None,
                  restore_overrides: Optional[dict] = None) -> dict:
    """Split ``split_keys`` out of the cluster; each becomes a standalone record with its own values.

    Survivorship is recomputed for the remaining cluster. With ``add_do_not_match`` every
    split key gets a do_not_match pair with every remaining key so reruns do not re-merge.
    """
    head = await resolve_head(db, tenant_id, golden_id)
    if head is None:
        raise MergeStateError("golden record not found")
    members = await _members(db, tenant_id, head.id)
    by_key = {r.sap_object_key: r for r in members}
    split = sorted(set(split_keys))
    if not split:
        raise MergeStateError("no records to split")
    if head.sap_object_key in split:
        raise MergeStateError("the surviving record cannot be split out; split the other members instead")
    missing = [k for k in split if k not in by_key]
    if missing:
        raise MergeStateError(f"not members of this cluster: {', '.join(missing)}")
    ov = dict(head.steward_overrides or {})
    before = _snapshot(head, head.golden_fields or {}, ov, sorted(by_key))

    for k in split:
        r = by_key[k]
        await db.execute(text("""
            UPDATE master_records SET merged_into = NULL, status = 'candidate', golden_fields = CAST(:f AS jsonb),
                   survivorship_explanation = NULL, steward_overrides = '{}'::jsonb, updated_at = now()
             WHERE tenant_id = :tid AND id = :id
        """), {"tid": tenant_id, "id": str(r.id), "f": json.dumps(_own(r), default=str)})
        await db.execute(_HIST, {"tid": tenant_id, "mid": r.id, "uid": user_id, "ct": "unmerged",
                                 "prev": json.dumps({"merged_into": head.sap_object_key}),
                                 "new": json.dumps(_own(r), default=str)})
    remaining = [r for r in members if r.sap_object_key not in split]
    new_ov = dict(restore_overrides) if restore_overrides is not None else ov
    golden = await _recompute(db, tenant_id, head, remaining, new_ov)
    await db.execute(_HIST, {"tid": tenant_id, "mid": head.id, "uid": user_id, "ct": "unmerged",
                             "prev": json.dumps(head.golden_fields or {}, default=str),
                             "new": json.dumps(golden, default=str)})
    after = {**_snapshot(head, golden, new_ov, [r.sap_object_key for r in remaining]),
             "split": {k: _own(by_key[k]) for k in split}}
    event_id = await _event(db, tenant_id, head.domain, event_type, head.id, split, user_id, reason, before, after,
                            reverses)
    pairs = 0
    if add_do_not_match:
        for k in split:
            for other in [head.sap_object_key, *(r.sap_object_key for r in remaining)]:
                await _upsert_constraint(db, tenant_id, head.domain, k, other, "do_not_match",
                                         reason or "unmerged by steward", user_id, event_id)
                pairs += 1
    return {"golden_record_id": str(head.id), "event_id": event_id, "split_keys": split,
            "remaining_keys": [r.sap_object_key for r in remaining], "do_not_match_pairs": pairs,
            "golden_fields": golden}


async def _reversed(db: AsyncSession, tid: str, event_id: Any) -> bool:
    return bool((await db.execute(text("SELECT 1 FROM mdm_merge_events WHERE tenant_id = :tid "
                                       "AND reverses_event_id = :e LIMIT 1"),
                                  {"tid": tid, "e": str(event_id)})).first())


async def undo_last_merge(db: AsyncSession, tenant_id: str, golden_id: str, user_id: Optional[str],
                          reason: Optional[str]) -> dict:
    """Reverse the latest merge into this golden record (no do_not_match pairs are added)."""
    head = await resolve_head(db, tenant_id, golden_id)
    if head is None:
        raise MergeStateError("golden record not found")
    rows = (await db.execute(text("""
        SELECT id, before, after FROM mdm_merge_events
         WHERE tenant_id = :tid AND golden_record_id = :g AND event_type IN ('merge', 'remerge')
         ORDER BY created_at DESC
    """), {"tid": tenant_id, "g": str(head.id)})).fetchall()
    for ev in rows:
        if not await _reversed(db, tenant_id, ev.id):
            return await unmerge(db, tenant_id, str(head.id), (ev.after or {}).get("added_keys") or [], user_id,
                                 reason or "undo last merge", event_type="undo", add_do_not_match=False,
                                 reverses=str(ev.id),
                                 restore_overrides=(ev.before or {}).get("steward_overrides"))
    raise MergeStateError("no merge to undo")


async def revert_event(db: AsyncSession, tenant_id: str, event_id: str, user_id: Optional[str],
                       reason: Optional[str]) -> dict:
    """Re-merge the records an unmerge / undo split out, dropping the do_not_match pairs it added."""
    ev = (await db.execute(text("SELECT id, domain, event_type, golden_record_id, member_keys, before "
                                "FROM mdm_merge_events WHERE tenant_id = :tid AND id = :id"),
                           {"tid": tenant_id, "id": event_id})).first()
    if ev is None:
        raise MergeStateError("event not found")
    if ev.event_type not in ("unmerge", "undo"):
        raise MergeStateError("only unmerge and undo events can be reverted")
    if await _reversed(db, tenant_id, ev.id):
        raise MergeStateError("event already reverted")
    head = await resolve_head(db, tenant_id, str(ev.golden_record_id))
    if head is None:
        raise MergeStateError("golden record not found")
    dropped = (await db.execute(text("DELETE FROM mdm_pair_constraints WHERE tenant_id = :tid AND event_id = :e"),
                                {"tid": tenant_id, "e": str(ev.id)})).rowcount
    ov = (ev.before or {}).get("steward_overrides") or {}
    events, golden = [], None
    for k in ev.member_keys:
        res = await merge_master_records(db, tenant_id, ev.domain, head.sap_object_key, k, user_id, ov,
                                         reason=reason or "re-merge", event_type="remerge", reverses=str(ev.id))
        if res is None:
            raise MergeStateError(f"record {k} can no longer be re-merged")
        events.append(res["event_id"])
        golden = res["golden_fields"]
    return {"golden_record_id": str(head.id), "event_ids": events, "remerged_keys": list(ev.member_keys),
            "constraints_removed": dropped, "golden_fields": golden}


async def set_overrides(db: AsyncSession, tenant_id: str, golden_id: str, overrides: dict,
                        user_id: Optional[str], reason: Optional[str]) -> dict:
    """Steward override per attribute (``None`` clears one); survivorship is recomputed."""
    head = await resolve_head(db, tenant_id, golden_id)
    if head is None:
        raise MergeStateError("golden record not found")
    members = await _members(db, tenant_id, head.id)
    old = dict(head.steward_overrides or {})
    new = {**old, **overrides}
    new = {f: v for f, v in new.items() if v is not None}
    golden = await _recompute(db, tenant_id, head, members, new)
    keys = [r.sap_object_key for r in members]
    event_id = await _event(db, tenant_id, head.domain, "override", head.id, sorted(overrides), user_id, reason,
                            _snapshot(head, head.golden_fields or {}, old, keys),
                            _snapshot(head, golden, new, keys))
    await db.execute(_HIST, {"tid": tenant_id, "mid": head.id, "uid": user_id, "ct": "steward_override",
                             "prev": json.dumps(head.golden_fields or {}, default=str),
                             "new": json.dumps(golden, default=str)})
    return {"golden_record_id": str(head.id), "event_id": event_id, "golden_fields": golden,
            "steward_overrides": new}


async def record_pair_decision(db: AsyncSession, tenant_id: str, match_score_id: str, decision: str,
                               reason: Optional[str], user_id: Optional[str]) -> Optional[dict]:
    """Steward accept (always_match) or reject (do_not_match) of a scored pair. None when unknown.

    ponytail: rejecting a pair that is already merged does not split it; the steward unmerges explicitly.
    """
    ms = (await db.execute(text("SELECT id, domain, candidate_a_key, candidate_b_key, steward_decision, "
                                "steward_reason FROM match_scores WHERE tenant_id = :tid AND id = :id"),
                           {"tid": tenant_id, "id": match_score_id})).first()
    if ms is None:
        return None
    kind = "always_match" if decision == "accept" else "do_not_match"
    event_id = await _event(db, tenant_id, ms.domain, f"pair_{decision}", None,
                            [ms.candidate_a_key, ms.candidate_b_key], user_id, reason,
                            {"steward_decision": ms.steward_decision, "steward_reason": ms.steward_reason},
                            {"steward_decision": decision, "steward_reason": reason, "constraint": kind})
    cid = await _upsert_constraint(db, tenant_id, ms.domain, ms.candidate_a_key, ms.candidate_b_key, kind,
                                   reason, user_id, event_id)
    await db.execute(text("""
        UPDATE match_scores SET steward_decision = :dec, steward_reason = :r, reviewed_by = CAST(:u AS uuid),
               reviewed_at = now()
         WHERE tenant_id = :tid AND id = :id
    """), {"tid": tenant_id, "id": match_score_id, "dec": decision, "r": reason, "u": user_id})
    return {"match_score_id": str(ms.id), "constraint_id": cid, "kind": kind, "event_id": event_id}


async def clear_constraint(db: AsyncSession, tenant_id: str, constraint_id: str, user_id: Optional[str],
                           reason: Optional[str]) -> Optional[dict]:
    c = (await db.execute(text("SELECT id, domain, key_lo, key_hi, kind, reason FROM mdm_pair_constraints "
                               "WHERE tenant_id = :tid AND id = :id"),
                          {"tid": tenant_id, "id": constraint_id})).first()
    if c is None:
        return None
    await db.execute(text("DELETE FROM mdm_pair_constraints WHERE tenant_id = :tid AND id = :id"),
                     {"tid": tenant_id, "id": constraint_id})
    event_id = await _event(db, tenant_id, c.domain, "pair_clear", None, [c.key_lo, c.key_hi], user_id, reason,
                            {"kind": c.kind, "reason": c.reason}, None)
    return {"constraint_id": str(c.id), "event_id": event_id}
