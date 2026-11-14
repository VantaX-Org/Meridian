"""audit_log hash chain (migration 175): checkpoint-aware purge and verification.

The chain itself is built in the database: a BEFORE INSERT trigger gives every row of a tenant the next chain_seq,
the previous row's hash as prev_hash and row_hash = audit_row_hash(row). UPDATE, TRUNCATE and DELETE are refused,
except a DELETE in a transaction that set app.audit_purge = 'on', which only ``purge_prefix`` does, and a subject
erasure's UPDATE that nulls before_json and after_json and nothing else (app.subject_erasure = 'on').

``purge_prefix`` deletes the oldest rows as one contiguous run and appends an ``audit.checkpoint`` row naming the
last deleted seq and hash, so the rows that remain still verify from that checkpoint. ``verify`` recomputes every
remaining row's hash in the database and ``check_chain`` walks the links.

ponytail: the chain proves that rows were not edited, removed or reordered by the app or by anyone without the
database owner role. An owner can rewrite the chain and its head together; anchor the head hash off the box
(signed export, WORM bucket) when that matters.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import text

GENESIS = "0" * 64
MAX_ERRORS = 20


def purge_prefix(session: Any, tenant_id: str, cutoff: Optional[datetime] = None, actor: Any = None) -> int:
    """Delete the tenant's audit rows older than ``cutoff`` (all of them when None) and append a checkpoint row.

    Only a contiguous oldest prefix goes: a row older than the cutoff that follows a newer one (clock skew) stays,
    so the remaining chain never has a hole. Returns how many rows were deleted. Caller commits. The app role can
    only read the head, so no row lock here: the checkpoint insert takes it, and a second concurrent purge of the
    same prefix deletes nothing and adds a harmless extra checkpoint."""
    from api.services.purge import write_audit_row

    t = str(tenant_id)
    head = session.execute(text("SELECT last_seq FROM audit_chain_head WHERE tenant_id = :t"), {"t": t}).fetchone()
    if head is None or not head[0]:
        return 0
    through = int(head[0])
    if cutoff is not None:
        kept = session.execute(text("SELECT min(chain_seq) FROM audit_log WHERE tenant_id = :t AND created_at >= :c"),
                               {"t": t, "c": cutoff}).scalar()
        if kept is not None:
            through = int(kept) - 1
    if through < 1:
        return 0
    through_hash = session.execute(text("SELECT row_hash FROM audit_log WHERE tenant_id = :t AND chain_seq = :s"),
                                   {"t": t, "s": through}).scalar()
    if through_hash is None:  # already purged up to here
        return 0
    session.execute(text("SET LOCAL app.audit_purge = 'on'"))
    deleted = session.execute(text("DELETE FROM audit_log WHERE tenant_id = :t AND chain_seq <= :s"),
                              {"t": t, "s": through}).rowcount or 0
    session.execute(text("SET LOCAL app.audit_purge = 'off'"))
    write_audit_row(session, t, actor, "audit.checkpoint", "audit_log", str(through),
                    {"through_seq": through, "through_hash": through_hash, "deleted": deleted,
                     "cutoff": cutoff.isoformat() if cutoff else None})
    return deleted


def check_chain(rows: list[dict], head: Optional[dict], checkpoints: list[dict]) -> dict[str, Any]:
    """Walk one tenant's chain. ``rows``: chain_seq, prev_hash, row_hash, hash_ok (the database recomputed the hash
    and it matched), ordered by chain_seq. ``head``: last_seq, last_hash. ``checkpoints``: through_seq, through_hash
    of each audit.checkpoint row. The first remaining row starts at genesis or at a checkpoint."""
    errors: list[str] = []

    def err(msg: str) -> None:
        if len(errors) < MAX_ERRORS:
            errors.append(msg)

    marks = {(int(c["through_seq"]), c["through_hash"]) for c in checkpoints if c.get("through_seq") is not None}
    prev: Optional[dict] = None
    for r in rows:
        seq = r["chain_seq"]
        if seq is None:
            err("a row has no chain_seq")
            continue
        if not r["hash_ok"]:
            err(f"row {seq}: its contents no longer match its hash")
        if prev is None:
            if not (seq == 1 and r["prev_hash"] == GENESIS) and (seq - 1, r["prev_hash"]) not in marks:
                err(f"row {seq}: the chain starts here without a checkpoint for the rows before it")
        else:
            if seq != prev["chain_seq"] + 1:
                err(f"rows {prev['chain_seq'] + 1} to {seq - 1} are missing")
            if r["prev_hash"] != prev["row_hash"]:
                err(f"row {seq}: it does not link to row {prev['chain_seq']}")
        prev = r
    if head is not None:
        if prev is None:
            if head["last_seq"] and (int(head["last_seq"]), head["last_hash"]) not in marks:
                err(f"the chain head is at row {head['last_seq']} but no rows remain")
        elif prev["chain_seq"] != head["last_seq"] or prev["row_hash"] != head["last_hash"]:
            err(f"the last row is {prev['chain_seq']} but the chain head is at row {head['last_seq']}")
    return {"ok": not errors, "rows_checked": len(rows), "first_seq": rows[0]["chain_seq"] if rows else None,
            "last_seq": prev["chain_seq"] if prev else None, "errors": errors}


def verify(session: Any, tenant_id: str) -> dict[str, Any]:
    """Recompute every hash of the tenant's remaining audit rows and check the links, the head and the checkpoints.
    The session must already carry the tenant's RLS context."""
    t = {"t": str(tenant_id)}
    # A subject erasure nulls both payloads and keeps payload_hash, so such a row still verifies; it is counted.
    rows = [dict(r._mapping) for r in session.execute(text(
        "SELECT a.chain_seq, a.prev_hash, a.row_hash, "
        "audit_row_hash(a) = a.row_hash AND (a.payload_hash = audit_payload_hash(a.before_json, a.after_json) "
        "OR (a.before_json IS NULL AND a.after_json IS NULL)) AS hash_ok, "
        "a.before_json IS NULL AND a.after_json IS NULL "
        "AND a.payload_hash <> audit_payload_hash(NULL, NULL) AS erased "
        "FROM audit_log a WHERE a.tenant_id = :t ORDER BY a.chain_seq"), t)]
    h = session.execute(text("SELECT last_seq, last_hash FROM audit_chain_head WHERE tenant_id = :t"), t).fetchone()
    cps = [{"through_seq": r[0], "through_hash": r[1]} for r in session.execute(text(
        "SELECT (after_json->>'through_seq')::bigint, after_json->>'through_hash' FROM audit_log "
        "WHERE tenant_id = :t AND action = 'audit.checkpoint'"), t)]
    out = check_chain(rows, {"last_seq": h[0], "last_hash": h[1]} if h else None, cps)
    out["payloads_erased"] = sum(1 for r in rows if r["erased"])
    return out
