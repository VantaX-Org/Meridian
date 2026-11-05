"""Data-subject access and erasure (debt item D-27).

A subject is a SAP record key, either the full key Meridian prints (``PERNR=00000001|SUBTY=0001``) or one key
value (``00000001``). Personal field values are NOT searched: Meridian masks or drops sensitive values before
they reach the findings tables (api/utils/pii_fields.py), and searching extracts by value would read every row.
Searching by a bare value matches ``FIELD=value`` parts of record keys in the three findings tables only; the full
key reaches every table below.

* ``search``  counts what is held, per table, and per extract file.
* ``export``  returns the same rows as a zip, with a manifest.
* ``erase``   deletes or scrubs them. ``dry_run=True`` changes nothing. Executing needs the id of a dry run for the
  same subject, made in the last 24 hours, that still resolves to the same set of keys, plus a reason.

Every statement carries ``tenant_id`` and runs under row level security. The ledger row (``subject_requests``)
and the audit_log row hold an HMAC of the subject and the request id, never the key. The routes sit under a
path the audit middleware skips, because it would copy the request body, key included.

What erasure cannot do: it does not delete from SAP. A completed erasure writes the record keys to the suppression
list (api/services/suppression.py), so extraction and analysis drop them until an admin lifts the suppression, but
SAP still holds the record and a path that bypasses the shared read and write points would show it again; it cannot reach backups; it does not rewrite raw
uploads, archives or report files; llm_audit_log is append-only by trigger and holds no record keys. A golden record
under another key may still carry values merged from the subject. Comments, attachments and workflow events on change
requests are not scrubbed, and a ``create`` request with no object key cannot be matched at all.

An open change request on the subject refuses execution, as does any run or job that could write the rows back. The
append-only triggers on master_record_history and mdm_merge_events step aside only inside the erasure transaction
(``app.subject_erasure``, migration 134): a soft guard against mistakes, not a security boundary.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import logging
import time
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from api.config import settings
from api.services import jobs, storage
from api.services.purge import Actor, write_audit_row

logger = logging.getLogger("meridian.subject_requests")

MAX_KEYS = 200
DRY_RUN_TTL = timedelta(hours=24)
MIN_REASON = 10
CONFIRM_WORD = "ERASE"
EXPORT_ROWS_PER_TABLE = 5000
EXPORT_ROWS_PER_FILE = 200
MAX_OBJECT_BYTES = 512 * 1024 * 1024
MAX_SCAN_BYTES = 8 * 1024 * 1024 * 1024
STATEMENT_TIMEOUT = "60s"
STAGING_PREFIX = "staging/{tenant}/"

# Tables searched when the subject is a bare value (the three that hold one row per finding or record).
VALUE_RESOLVE_TABLES = ("record_issues", "work_records", "finding_records")

# Anything in these states can still write the subject's rows back, or read an extract while it is rewritten.
BUSY_RUN_STATUSES = ("pending", "queued", "running", "agents_running", "ai_enriching")
BUSY_JOB_KINDS = ("extraction", "analysis", "upload", "config_sync")
BUSY_WINDOW_SECONDS = 24 * 3600  # older than this is a crashed run, which must not block erasure for ever
# Change requests that may still post to SAP. Erasure refuses until they are finished or cancelled.
OPEN_CHANGE_STATUSES = ("draft", "submitted", "in_approval", "approved", "creating", "failed")


@dataclass(frozen=True)
class Target:
    """One table that can hold a record key.

    ``cols``    scalar text columns that hold a key (a row matches when any equals a subject key).
    ``arrays``  text[] columns that hold keys (a row matches when any element equals a subject key).
    ``action``  ``delete`` removes the row; ``scrub`` keeps the row for its audit trail and clears the key and
                the values (``set``); ``set`` uses the token ``:erased`` for the placeholder key.
    ``also``    one more predicate, for rows tied to a subject through something other than a key column.
    ``export``  the select list of the access package, when a row also holds other subjects' data (default ``*``).
    """
    table: str
    cols: tuple[str, ...] = ()
    arrays: tuple[str, ...] = ()
    action: str = "delete"
    set: str = ""
    full_key_only: bool = False
    also: str = ""
    export: str = ""


# The golden records of the subject. Order below matters: their dependants go first, while this still finds them.
_GOLDEN = "(SELECT id FROM master_records WHERE tenant_id = :t AND sap_object_key = ANY(CAST(:keys AS text[])))"
_MASS = "kind = 'mass_change'"
# A reconciliation keeps one document per run, {table: [row, ...]}, so it holds many subjects. A row names its record
# twice: key on the target side, source_record on the source side. source_record can be NULL, hence IS TRUE below.
_RECON_ROWS = "FROM jsonb_array_elements(e.value) r"
_RECON_HIT = ("(r->>'key' = ANY(CAST(:keys AS text[])) OR r->>'source_record' = ANY(CAST(:keys AS text[]))) IS TRUE")

TARGETS: tuple[Target, ...] = (
    Target("finding_records", ("record_key",)),
    Target("record_issues", ("record_key",)),  # record_issue_events cascade
    Target("work_records", ("record_key",)),
    Target("record_hashes", ("record_key",)),
    Target("remediation_items", ("record_key",)),  # remediation_events cascade
    Target("rule_suppressions", ("record_key",)),
    Target("data_anomalies", ("record_key",)),
    Target("config_matches", ("record_key",)),
    Target("migration_gap_findings", ("record_key",)),
    Target("record_fixes", ("record_id",)),
    Target("data_duplicates", ("record_a", "record_b")),
    Target("dedup_candidates", ("record_key_a", "record_key_b", "survivor_key")),
    Target("match_scores", ("candidate_a_key", "candidate_b_key")),
    Target("record_relationships", ("from_key", "to_key")),
    Target("master_record_history", also=f"master_record_id IN {_GOLDEN}"),
    Target("golden_writeback_requests", also=f"master_record_id IN {_GOLDEN}"),
    Target("mdm_merge_events", arrays=("member_keys",), also=f"golden_record_id IN {_GOLDEN}", action="scrub",
           set="member_keys = ARRAY(SELECT x FROM unnest(member_keys) x WHERE x <> ALL(CAST(:keys AS text[]))), "
               "before = NULL, after = NULL"),
    Target("mdm_pair_constraints", ("key_lo", "key_hi")),
    Target("master_records", ("sap_object_key",)),
    Target("survivorship_decisions", ("sap_object_key",)),
    Target("cleaning_queue", ("record_key", "survivor_key"), action="scrub",
           set="record_key = :erased, survivor_key = NULL, record_data_before = NULL, record_data_after = NULL, "
               "merge_preview = NULL, golden_field_value = NULL"),
    Target("cleaning_audit", ("record_key",), action="scrub",
           set="record_key = :erased, data_before = NULL, data_after = NULL"),
    # Must run before change_requests, which loses the object_key this matches on. record_key is set on mass
    # changes only; a single-record change is tied to the subject through its request.
    Target("change_request_field_changes", ("record_key",), action="scrub",
           also="request_id IN (SELECT id FROM change_requests WHERE tenant_id = :t AND kind <> 'mass_change' "
                "AND object_key = ANY(CAST(:keys AS text[])))",
           set="record_key = CASE WHEN record_key IS NULL THEN NULL ELSE CAST(:erased AS text) END, "
               "old_value = NULL, new_value = NULL"),
    # A mass change is about many records: it keeps its payload and loses only the subject's key.
    Target("change_requests", ("object_key",), also="jsonb_exists_any(record_keys, CAST(:keys AS text[]))",
           action="scrub",
           set="object_key = CASE WHEN object_key = ANY(CAST(:keys AS text[])) THEN CAST(:erased AS text) "
               "ELSE object_key END, record_keys = record_keys - CAST(:keys AS text[]), "
               f"payload = CASE WHEN {_MASS} THEN payload ELSE CAST('{{}}' AS jsonb) END, "
               f"title = CASE WHEN {_MASS} THEN title ELSE NULL END, "
               f"sap_key = CASE WHEN {_MASS} THEN sap_key ELSE NULL END, "
               "precheck = NULL, sap_result = NULL, export = NULL"),
    Target("migration_export_files", arrays=("record_keys",), action="scrub",
           set="record_keys = ARRAY(SELECT x FROM unnest(record_keys) x WHERE x <> ALL(CAST(:keys AS text[])))"),
    # Only the subject's rows go: the run's other records and its counts stay.
    Target("migration_reconciliations", action="scrub",
           also=f"EXISTS (SELECT 1 FROM jsonb_each(records) e WHERE EXISTS (SELECT 1 {_RECON_ROWS} WHERE {_RECON_HIT}))",
           set=f"records = (SELECT COALESCE(jsonb_object_agg(e.key, (SELECT COALESCE(jsonb_agg(r), CAST('[]' AS jsonb)) "
               f"{_RECON_ROWS} WHERE NOT {_RECON_HIT})), CAST('{{}}' AS jsonb)) FROM jsonb_each(records) e)",
           export=f"id, run_id, status, created_at, completed_at, (SELECT jsonb_object_agg(e.key, (SELECT "
                  f"COALESCE(jsonb_agg(r), CAST('[]' AS jsonb)) {_RECON_ROWS} WHERE {_RECON_HIT})) "
                  "FROM jsonb_each(records) e) AS records"),
    Target("audit_log", action="scrub", full_key_only=True, set="before_json = NULL, after_json = NULL"),
)


class SubjectError(Exception):
    """A refusal the route turns into a 4xx. ``code`` is stable for the UI."""

    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


# ── subject and hashes ───────────────────────────────────────────────────────

def clean_subject(subject: str) -> str:
    s = (subject or "").strip()
    if not s or len(s) > 300:
        raise SubjectError("bad_subject", "Enter a record key (up to 300 characters).")
    return s


def _secret(session: Any, tenant_id: str) -> bytes:
    row = session.execute(text("SELECT jwt_secret FROM tenants WHERE id = :t"), {"t": str(tenant_id)}).fetchone()
    if not row or not row[0]:
        raise SubjectError("no_tenant_secret", "The tenant has no secret to key the request hashes with.", 503)
    return str(row[0]).encode()


def _hmac(session: Any, tenant_id: str, label: str, value: str) -> str:
    return hmac.new(_secret(session, tenant_id), f"{label}:{tenant_id}:{value}".encode(), hashlib.sha256).hexdigest()


def key_parts(key: str) -> dict[str, str]:
    """``A=1|B=2`` as ``{"A": "1", "B": "2"}``. A part without ``=`` is ignored."""
    out: dict[str, str] = {}
    for part in key.split("|"):
        if "=" in part:
            f, v = part.split("=", 1)
            out[f.strip()] = v
    return out


# ── database side ────────────────────────────────────────────────────────────

def _timeout(session: Any) -> None:
    session.execute(text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'"))


def _where(t: Target) -> str:
    """The match predicate. ``:keys`` is a text[]; the tenant is always ``:t``."""
    if t.table == "audit_log":
        return ("tenant_id = :t AND EXISTS (SELECT 1 FROM unnest(CAST(:keys AS text[])) k WHERE "
                "entity_id = k OR strpos(before_json::text, k) > 0 OR strpos(after_json::text, k) > 0)")
    parts = [f"{c} = ANY(CAST(:keys AS text[]))" for c in t.cols]
    parts += [f"{c} && CAST(:keys AS text[])" for c in t.arrays]
    if t.also:
        parts.append(t.also)
    return "tenant_id = :t AND (" + " OR ".join(parts) + ")"


def resolve_keys(session: Any, tenant_id: str, subject: str) -> list[str]:
    """The record keys the subject stands for. A full key stands for itself, found or not (so a second run can
    finish an erasure whose database half is already done). A bare value is looked up as a ``FIELD=value`` part."""
    if "=" in subject:
        return [subject]
    _timeout(session)
    found: set[str] = set()
    for table in VALUE_RESOLVE_TABLES:
        rows = session.execute(text(
            f"SELECT DISTINCT record_key FROM {table} t WHERE tenant_id = :t AND record_key IS NOT NULL AND EXISTS ("
            "SELECT 1 FROM unnest(string_to_array(t.record_key, '|')) p WHERE split_part(p, '=', 2) = :v) "
            f"LIMIT {MAX_KEYS + 1}"), {"t": str(tenant_id), "v": subject}).fetchall()
        found.update(r[0] for r in rows)
        if len(found) > MAX_KEYS:
            raise SubjectError("too_many_keys", f"That value is in more than {MAX_KEYS} record keys. Use the full "
                                                "record key.")
    return sorted(found)


def count_rows(session: Any, tenant_id: str, keys: list[str], include_full_key_only: bool) -> dict[str, int]:
    """Rows per table that would be touched. Tables with no rows are omitted."""
    if not keys:
        return {}
    _timeout(session)
    out: dict[str, int] = {}
    for t in TARGETS:
        if t.full_key_only and not include_full_key_only:
            continue
        n = int(session.execute(text(f"SELECT count(*) FROM {t.table} WHERE {_where(t)}"),
                                {"t": str(tenant_id), "keys": keys}).scalar() or 0)
        if n:
            out[t.table] = n
    return out


def _delete_or_scrub(session: Any, tenant_id: str, keys: list[str], request_id: str,
                     include_full_key_only: bool) -> dict[str, int]:
    _timeout(session)
    session.execute(text("SET LOCAL app.subject_erasure = 'on'"))
    out: dict[str, int] = {}
    erased = f"erased:{request_id[:8]}"
    for t in TARGETS:
        if t.full_key_only and not include_full_key_only:
            continue
        p: dict[str, Any] = {"t": str(tenant_id), "keys": keys}
        if t.table == "master_records":
            # merged_into has no cascade: free survivors that point at a record about to go
            session.execute(text(
                "UPDATE master_records SET merged_into = NULL WHERE tenant_id = :t AND merged_into IN ("
                "SELECT id FROM master_records WHERE tenant_id = :t AND sap_object_key = ANY(CAST(:keys AS text[])))"),
                p)
        if t.action == "delete":
            sql = f"DELETE FROM {t.table} WHERE {_where(t)}"
        else:
            sql = f"UPDATE {t.table} SET {t.set} WHERE {_where(t)}"
            if ":erased" in t.set:
                p["erased"] = erased
        n = session.execute(text(sql), p).rowcount or 0
        if n:
            out[t.table] = int(n)
    return out


# ── extracts in object storage ───────────────────────────────────────────────

def _by_field(names: list[str]) -> dict[str, str]:
    """Field name to column name, for columns named ``TABLE.FIELD`` or ``FIELD``."""
    out: dict[str, str] = {}
    for name in names:
        out.setdefault(name.split(".")[-1], name)
    return out


def _mask(table: Any, keys: list[str]) -> Optional[Any]:
    """Boolean mask of rows that equal any key on every key field, or None if no key fits this file.
    A file fits a key only when it has a column for every field of the key."""
    import pyarrow as pa
    import pyarrow.compute as pc

    by_field = _by_field(table.column_names)
    mask = None
    for key in keys:
        parts = key_parts(key)
        if not any(v.strip() for v in parts.values()) or any(f not in by_field for f in parts):
            continue
        m = None
        for f, v in parts.items():
            raw = table.column(by_field[f])
            if pa.types.is_floating(raw.type):  # arrow casts 1234.0 to "1234", the record key says "1234.0"
                raw = pa.array([None if x is None else str(x) for x in raw.to_pylist()], pa.string())
            col = pc.fill_null(pc.utf8_trim_whitespace(pc.cast(raw, pa.string())), "")  # a null is blank in a key
            eq = pc.equal(col, pa.scalar(v.strip()))
            m = eq if m is None else pc.and_(m, eq)
        mask = m if mask is None else pc.or_(mask, m)
    return mask


def _blank_scan() -> dict[str, Any]:
    return {"files": {}, "rows": 0, "scanned_bytes": 0, "skipped": [], "errors": [], "complete": True}


# ponytail: runs inside the request and holds one file in memory, bounded by MAX_OBJECT_BYTES and MAX_SCAN_BYTES;
# move it to a Celery task if extract files outgrow a request.
def scan_extracts(tenant_id: str, keys: list[str], *, rewrite: bool, collect: bool = False) -> dict[str, Any]:
    """Look in every ``staging/<tenant>/`` parquet file for rows of the subject; with ``rewrite`` remove them.
    Returns ``{files: {name: rows}, rows, scanned_bytes, skipped: [..], errors: [..], complete}`` and, with
    ``collect``, ``samples: {name: [row, ..]}``. ``complete`` is False when a file was too large to read or the
    scan hit its byte budget: the erasure is then reported incomplete, never silently done."""
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    out = _blank_scan()
    if collect:
        out["samples"] = {}
    usable = [k for k in keys if key_parts(k)]
    if not usable:
        return out  # keyless ("row:N") records cannot be located in a file
    bucket = settings.minio_bucket_uploads
    try:
        objects = [(n, s) for n, s in storage.list_prefix(bucket, STAGING_PREFIX.format(tenant=tenant_id))
                   if n.endswith(".parquet")]
    except Exception as e:  # storage down: say so rather than report "nothing found"
        out["errors"].append(f"list: {type(e).__name__}")
        out["complete"] = False
        return out
    for name, size in objects:
        if size > MAX_OBJECT_BYTES or out["scanned_bytes"] + size > MAX_SCAN_BYTES:
            out["skipped"].append(name)
            out["complete"] = False
            continue
        try:
            pf = pq.ParquetFile(io.BytesIO(storage.download_file(bucket, name)))
            out["scanned_bytes"] += size
            # read the key columns alone; the whole file only when it holds the subject
            by_field = _by_field(pf.schema_arrow.names)
            needed = {by_field[f] for k in usable for f in key_parts(k)
                      if all(p in by_field for p in key_parts(k))}
            if not needed:
                continue
            mask = _mask(pf.read(columns=sorted(needed)), usable)
            if mask is None:
                continue
            hit = pc.sum(mask).as_py() or 0
            if not hit:
                continue
            out["files"][name] = hit
            out["rows"] += hit
            if not (collect or rewrite):
                continue
            table = pf.read()
            if collect:
                out["samples"][name] = table.filter(mask).slice(0, EXPORT_ROWS_PER_FILE).to_pylist()
            if rewrite:
                kept = table.filter(pc.invert(mask))
                buf = io.BytesIO()
                pq.write_table(kept, buf)
                storage.upload_file(bucket, name, buf.getvalue(), "application/octet-stream")
        except Exception as e:
            logger.warning("subject extract scan failed on %s: %s", name, type(e).__name__)
            out["errors"].append(f"{name}: {type(e).__name__}")
            out["complete"] = False
    return out


# ── the four operations ──────────────────────────────────────────────────────

def _ledger(session: Any, tenant_id: str, *, kind: str, dry_run: bool, subject_hmac: str, key_set_hmac: str,
            keys: int, rows: dict, storage_doc: dict, actor: Actor, reason: Optional[str] = None,
            dry_run_id: Optional[str] = None, status: str = "done", request_id: Optional[str] = None) -> str:
    rid = request_id or str(uuid.uuid4())
    session.execute(text(
        "INSERT INTO subject_requests (id, tenant_id, kind, dry_run, subject_hmac, key_set_hmac, key_count, "
        "rows_by_table, storage, dry_run_id, reason, status, actor_user_id, actor_email) VALUES (:id, :t, :k, :d, "
        ":s, :ks, :n, CAST(:r AS jsonb), CAST(:st AS jsonb), :dr, :why, :status, :u, :e)"),
        {"id": rid, "t": str(tenant_id), "k": kind, "d": dry_run, "s": subject_hmac, "ks": key_set_hmac, "n": keys,
         "r": json.dumps(rows), "st": json.dumps(storage_doc), "dr": dry_run_id, "why": reason, "status": status,
         "u": actor.user_id, "e": actor.email})
    return rid


def _audit(session: Any, tenant_id: str, actor: Actor, action: str, request_id: str, subject_hmac: str,
           rows: dict, extra: Optional[dict] = None) -> None:
    write_audit_row(session, tenant_id, actor, action, "subject_request", request_id,
                    {"request_id": request_id, "subject_hmac": subject_hmac[:16], "rows_by_table": rows,
                     **(extra or {})})


def _storage_doc(scan: dict) -> dict:
    return {"files": scan["files"], "rows": scan["rows"], "scanned_bytes": scan["scanned_bytes"],
            "skipped": scan["skipped"], "errors": scan["errors"], "complete": scan["complete"]}


def _resolve(session: Any, tenant_id: str, subject: str) -> tuple[list[str], str, str]:
    subject = clean_subject(subject)
    keys = resolve_keys(session, tenant_id, subject)
    shmac = _hmac(session, tenant_id, "subject", subject)
    kmac = _hmac(session, tenant_id, "keyset", "\n".join(sorted(keys)))
    return keys, shmac, kmac


def search(session: Any, tenant_id: str, subject: str, actor: Actor) -> dict[str, Any]:
    keys, shmac, kmac = _resolve(session, tenant_id, subject)
    full = "=" in subject
    rows = count_rows(session, tenant_id, keys, include_full_key_only=full)
    scan = scan_extracts(tenant_id, keys, rewrite=False)
    rid = _ledger(session, tenant_id, kind="access", dry_run=True, subject_hmac=shmac, key_set_hmac=kmac,
                  keys=len(keys), rows=rows, storage_doc=_storage_doc(scan), actor=actor)
    _audit(session, tenant_id, actor, "subject_search", rid, shmac, rows)
    session.commit()
    return {"request_id": rid, "full_key": full, "keys": keys, "rows_by_table": rows, "extracts": _storage_doc(scan),
            "total_rows": sum(rows.values()) + scan["rows"]}


def export(session: Any, tenant_id: str, subject: str, actor: Actor) -> tuple[bytes, str]:
    """The zip of what is held, and the request id."""
    keys, shmac, kmac = _resolve(session, tenant_id, subject)
    full = "=" in subject
    rows = count_rows(session, tenant_id, keys, include_full_key_only=full)
    buf = io.BytesIO()
    truncated: list[str] = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for t in TARGETS:
            if t.table not in rows:
                continue
            data = session.execute(text(
                f"SELECT to_jsonb(x) FROM (SELECT {t.export or '*'} FROM {t.table} WHERE {_where(t)} LIMIT {EXPORT_ROWS_PER_TABLE}) x"),
                {"t": str(tenant_id), "keys": keys}).fetchall()
            if rows[t.table] > EXPORT_ROWS_PER_TABLE:
                truncated.append(t.table)
            z.writestr(f"{t.table}.json", json.dumps([r[0] for r in data], indent=2, default=str))
        scan = scan_extracts(tenant_id, keys, rewrite=False, collect=True)
        if scan["files"]:
            z.writestr("extracts.json", json.dumps(
                {"rows_by_file": scan["files"], "sample_rows": scan.get("samples", {})}, indent=2, default=str))
        rid = str(uuid.uuid4())
        z.writestr("manifest.json", json.dumps({
            "request_id": rid, "generated_at": datetime.now(timezone.utc).isoformat(),
            "record_keys": keys, "rows_by_table": rows, "extract_rows": scan["rows"],
            "truncated_tables": truncated, "extract_scan_complete": scan["complete"],
            "truncated_files": [n for n, hits in scan["files"].items() if hits > EXPORT_ROWS_PER_FILE],
            "note": "Meridian holds copies of extracted SAP data. SAP itself, backups and raw uploaded files are "
                    "not part of this package.",
        }, indent=2))
    _ledger(session, tenant_id, kind="access", dry_run=False, subject_hmac=shmac, key_set_hmac=kmac,
            keys=len(keys), rows=rows, storage_doc=_storage_doc(scan), actor=actor, request_id=rid)
    _audit(session, tenant_id, actor, "subject_export", rid, shmac, rows)
    session.commit()
    return buf.getvalue(), rid


def _require_quiet(session: Any, tenant_id: str) -> None:
    """Refuse while a run or job could write the subject's rows back or read an extract mid-rewrite. A registry
    that cannot be read refuses too: "cannot tell" is not "nothing is running"."""
    if session.execute(text(
            "SELECT 1 FROM analysis_versions WHERE tenant_id = :t AND status = ANY(:s) "
            "AND run_at > now() - interval '24 hours' LIMIT 1"),
            {"t": str(tenant_id), "s": list(BUSY_RUN_STATUSES)}).fetchone():
        raise SubjectError("run_in_progress", "An extraction or analysis is running. Wait for it to finish.", 409)
    if session.execute(text(
            "SELECT 1 FROM migration_reconciliations WHERE tenant_id = :t AND status IN ('queued', 'running') "
            "AND created_at > now() - interval '24 hours' LIMIT 1"), {"t": str(tenant_id)}).fetchone():
        raise SubjectError("run_in_progress", "A post-load reconciliation is running. Wait for it to finish.", 409)
    try:
        active = jobs.list_jobs(str(tenant_id), active_only=True, strict=True)
    except Exception as e:
        raise SubjectError("jobs_unreadable", "Could not check for running jobs. Try again shortly.", 503) from e
    cutoff = time.time() - BUSY_WINDOW_SECONDS
    if any(j.get("kind") in BUSY_JOB_KINDS and float(j.get("updated_at") or 0) > cutoff for j in active):
        raise SubjectError("run_in_progress", "An extraction or analysis is running. Wait for it to finish.", 409)


def _require_no_open_change(session: Any, tenant_id: str, keys: list[str]) -> None:
    """A change request still in flight would post the subject's values to SAP after they were cleared here."""
    if keys and session.execute(text(
            "SELECT 1 FROM change_requests WHERE tenant_id = :t AND status = ANY(:s) AND (object_key = ANY(CAST(:keys "
            "AS text[])) OR jsonb_exists_any(record_keys, CAST(:keys AS text[]))) LIMIT 1"),
            {"t": str(tenant_id), "s": list(OPEN_CHANGE_STATUSES), "keys": keys}).fetchone():
        raise SubjectError("change_request_open", "A change request on this record is still open. Finish or cancel "
                                                  "it, then run the erasure again.", 409)


def erase(session: Any, tenant_id: str, subject: str, actor: Actor, *, dry_run: bool, confirm: Optional[str] = None,
          reason: Optional[str] = None, dry_run_id: Optional[str] = None) -> dict[str, Any]:
    keys, shmac, kmac = _resolve(session, tenant_id, subject)
    full = "=" in subject
    if dry_run:
        rows = count_rows(session, tenant_id, keys, include_full_key_only=full)
        scan = scan_extracts(tenant_id, keys, rewrite=False)
        rid = _ledger(session, tenant_id, kind="erasure", dry_run=True, subject_hmac=shmac, key_set_hmac=kmac,
                      keys=len(keys), rows=rows, storage_doc=_storage_doc(scan), actor=actor)
        _audit(session, tenant_id, actor, "subject_erase_dry_run", rid, shmac, rows)
        session.commit()
        return {"request_id": rid, "dry_run": True, "keys": keys, "rows_by_table": rows,
                "extracts": _storage_doc(scan), "total_rows": sum(rows.values()) + scan["rows"]}

    # ── execute: every refusal below happens before anything is changed ──
    if confirm != CONFIRM_WORD:
        raise SubjectError("confirm_required", f"Type {CONFIRM_WORD} to confirm.", 400)
    reason = (reason or "").strip()
    if len(reason) < MIN_REASON:
        raise SubjectError("reason_required", f"Give a reason of at least {MIN_REASON} characters.", 400)
    if not dry_run_id:
        raise SubjectError("dry_run_required", "Run the dry run first and pass its request id.", 400)
    try:
        dry_run_id = str(uuid.UUID(dry_run_id))
    except ValueError as e:
        raise SubjectError("dry_run_unknown", "That dry run does not exist for this subject.", 409) from e
    prior = session.execute(text(
        "SELECT key_set_hmac, subject_hmac, created_at FROM subject_requests WHERE tenant_id = :t AND id = :id "
        "AND kind = 'erasure' AND dry_run = true"), {"t": str(tenant_id), "id": dry_run_id}).fetchone()
    if not prior or prior[1] != shmac:
        raise SubjectError("dry_run_unknown", "That dry run does not exist for this subject.", 409)
    created = prior[2] if prior[2].tzinfo else prior[2].replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - created > DRY_RUN_TTL:
        raise SubjectError("dry_run_stale", "The dry run is older than 24 hours. Run it again.", 409)
    if prior[0] != kmac:
        raise SubjectError("keys_changed", "The records found now differ from the dry run. Run it again.", 409)
    if session.execute(text(
            "SELECT 1 FROM subject_requests WHERE tenant_id = :t AND dry_run_id = :id AND dry_run = false"),
            {"t": str(tenant_id), "id": dry_run_id}).fetchone():
        raise SubjectError("already_executed", "That dry run was already executed. Run a new one.", 409)
    _require_quiet(session, tenant_id)
    _require_no_open_change(session, tenant_id, keys)

    rid = str(uuid.uuid4())
    done = _delete_or_scrub(session, tenant_id, keys, rid, include_full_key_only=full)
    try:
        _ledger(session, tenant_id, kind="erasure", dry_run=False, subject_hmac=shmac, key_set_hmac=kmac,
                keys=len(keys), rows=done, storage_doc={}, actor=actor, reason=reason, dry_run_id=dry_run_id,
                status="incomplete", request_id=rid)
    except IntegrityError as e:  # two requests raced past the check above; the rollback undoes the loser's deletes
        session.rollback()
        if "ux_subject_requests_executed" in str(e.orig):
            raise SubjectError("already_executed", "That dry run was already executed. Run a new one.", 409) from e
        raise
    suppressed = _suppress(session, tenant_id, keys, rid, actor)
    _audit(session, tenant_id, actor, "subject_erase", rid, shmac, done,
           {"dry_run_id": dry_run_id, "suppressed_keys": suppressed})
    session.commit()  # database half is final; extracts follow and may fail without undoing it

    # a run may have started during the database half; a rewrite now could lose its writes or race its reads
    try:
        _require_quiet(session, tenant_id)
        scan = scan_extracts(tenant_id, keys, rewrite=True)
    except SubjectError as e:
        scan = {**_blank_scan(), "errors": [e.code], "complete": False}
    doc = _storage_doc(scan)
    session.execute(text("UPDATE subject_requests SET storage = CAST(:s AS jsonb), status = :st "
                         "WHERE tenant_id = :t AND id = :id"),
                    {"s": json.dumps(doc), "st": "done" if scan["complete"] else "incomplete",
                     "t": str(tenant_id), "id": rid})
    session.commit()
    return {"request_id": rid, "dry_run": False, "keys": keys, "rows_by_table": done, "extracts": doc,
            "total_rows": sum(done.values()) + scan["rows"], "complete": scan["complete"]}


def history(session: Any, tenant_id: str, limit: int = 100) -> list[dict[str, Any]]:
    rows = session.execute(text(
        "SELECT id, kind, dry_run, key_count, rows_by_table, storage, reason, status, actor_email, created_at "
        "FROM subject_requests WHERE tenant_id = :t ORDER BY created_at DESC LIMIT :n"),
        {"t": str(tenant_id), "n": limit}).fetchall()
    return [{"request_id": str(r[0]), "kind": r[1], "dry_run": r[2], "key_count": r[3], "rows_by_table": r[4] or {},
             "extract_rows": (r[5] or {}).get("rows", 0), "reason": r[6], "status": r[7], "actor": r[8],
             "created_at": r[9]} for r in rows]


# ── suppression list (api/services/suppression.py) ───────────────────────────

def _suppress(session: Any, tenant_id: str, keys: list[str], request_id: str, actor: Actor) -> int:
    """One suppression row per erased key that has fields; a key already suppressed is left as it is."""
    from api.services import suppression
    n = 0
    for key in keys:
        parts = key_parts(key)
        if not parts:
            continue  # a keyless "row:N" record cannot be matched in an extract
        fields, norm = suppression.normalise(parts)
        n += session.execute(text(
            "INSERT INTO subject_suppressions (tenant_id, key_hmac, key_fields, request_id, created_by) "
            "VALUES (:t, :h, :f, :r, :by) ON CONFLICT (tenant_id, key_hmac) WHERE lifted_at IS NULL DO NOTHING"),
            {"t": str(tenant_id), "h": _hmac(session, tenant_id, "suppress", norm), "f": fields, "r": request_id,
             "by": actor.email}).rowcount
    suppression.invalidate(str(tenant_id))
    return n


def suppressions(session: Any, tenant_id: str) -> dict[str, Any]:
    """The list, one item per erasure: field names, key count, rows dropped so far. No key and no hash."""
    rows = session.execute(text(
        "SELECT request_id, min(key_fields), count(*), sum(dropped_count), max(last_dropped_at), min(created_at), "
        "min(created_by), count(*) FILTER (WHERE lifted_at IS NULL), max(lifted_at), max(lifted_by), max(lift_reason) "
        "FROM subject_suppressions WHERE tenant_id = :t GROUP BY request_id ORDER BY min(created_at) DESC LIMIT 200"),
        {"t": str(tenant_id)}).fetchall()
    items = [{"request_id": str(r[0]) if r[0] else None, "key_fields": r[1].split("|"), "keys": r[2],
              "dropped": int(r[3] or 0), "last_dropped_at": r[4], "created_at": r[5], "created_by": r[6],
              "active_keys": r[7], "lifted_at": r[8] if not r[7] else None, "lifted_by": r[9] if not r[7] else None,
              "lift_reason": r[10] if not r[7] else None} for r in rows]
    return {"active_keys": sum(i["active_keys"] for i in items), "dropped_total": sum(i["dropped"] for i in items),
            "field_texts": _field_texts({f for i in items for f in i["key_fields"]}), "items": items}


def _field_texts(fields: set[str]) -> dict[str, str]:
    """DDIC description of each key field, from the first table that defines it. Empty when none does."""
    try:
        from sap.ddic import get_dictionary
        tables = get_dictionary("ecc6").tables.values()
    except Exception:
        return {}
    out: dict[str, str] = {}
    for f in fields:
        out[f] = next((fd.description for t in tables if (fd := t.fields.get(f.upper())) and fd.description), "")
    return out


def lift(session: Any, tenant_id: str, request_id: str, actor: Actor, reason: str) -> dict[str, Any]:
    """Lift every active suppression written by one erasure. The next extraction brings the records back."""
    from api.services import suppression
    reason = (reason or "").strip()
    if len(reason) < MIN_REASON:
        raise SubjectError("reason_required", f"Give a reason of at least {MIN_REASON} characters.", 400)
    try:
        request_id = str(uuid.UUID(request_id))
    except ValueError as e:
        raise SubjectError("suppression_unknown", "No suppression for that erasure.", 404) from e
    n = session.execute(text(
        "UPDATE subject_suppressions SET lifted_at = now(), lifted_by = :by, lift_reason = :why "
        "WHERE tenant_id = :t AND request_id = :r AND lifted_at IS NULL"),
        {"by": actor.email, "why": reason, "t": str(tenant_id), "r": request_id}).rowcount
    if not n:
        raise SubjectError("suppression_unknown", "No active suppression for that erasure.", 404)
    _audit(session, tenant_id, actor, "subject_suppression_lift", request_id, "", {},
           {"keys_lifted": n, "reason": reason})
    session.commit()
    suppression.invalidate(str(tenant_id))
    return {"request_id": request_id, "lifted": n}
