"""Config intelligence: source/target pairing, deterministic config comparison and realignment.

Matching is deterministic (no LLM). Every proposal goes to the steward queue and is used only once confirmed.
Read only towards SAP: this module reads stored config_items and writes Meridian tables only.
"""

from __future__ import annotations

import difflib
import logging
import uuid
from collections import Counter
from dataclasses import asdict, dataclass
from typing import Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from sap.config_snapshot import NOT_AVAILABLE, ConfigItem, ConfigSnapshot

logger = logging.getLogger(__name__)

DESC_FIELDS = ("TXT30", "TEXT1", "TXTMD", "BUTXT", "NAME1", "MTBEZ", "TEXT", "LTEXT", "MSEHT", "MSEHL",
               "LGOBE", "DESCRIPTION")
BASELINE_DETAIL = "SAP standard baseline; no configuration API"
BASELINE_LABEL = "baseline target"
BASELINE_TYPE = "s4hana_cloud"
DESC_MATCH_MAX = 2000
DESC_CUTOFF = 0.85
STALE_MINUTES = 30
ITEM_CAP = 20000
STATUSES = ("exists", "key_match", "desc_match", "missing")


def normalise(v: str) -> str:
    """Strip, upper-case and drop leading zeros ('0001' -> '1', '000' -> '0')."""
    s = v.strip().upper()
    return s.lstrip("0") or ("0" if s else "")


def parse_key(key: str) -> dict[str, str]:
    # ponytail: splits on ',' and '='; a key value containing a comma parses wrongly. Store keys as JSON if one does.
    return dict(p.partition("=")[::2] for p in key.split(",") if p)


def normalise_key(key: str) -> str:
    return ",".join(f"{f}={normalise(v)}" for f, v in parse_key(key).items())


def _desc(values: dict[str, object]) -> Optional[str]:
    for f in DESC_FIELDS:
        v = values.get(f)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _diff_field(a: str, b: str) -> Optional[tuple[str, str, str]]:
    """(field, a value, b value) when the two keys differ in exactly one field."""
    pa, pb = parse_key(a), parse_key(b)
    if pa.keys() != pb.keys():
        return None
    diffs = [f for f in pa if pa[f] != pb[f]]
    return (diffs[0], pa[diffs[0]], pb[diffs[0]]) if len(diffs) == 1 else None


@dataclass
class MatchRow:
    object: str
    source_key: str
    status: str  # exists | key_match | desc_match | missing
    target_key: Optional[str] = None
    score: Optional[float] = None
    field: Optional[str] = None
    source_value: Optional[str] = None
    target_value: Optional[str] = None
    description: Optional[str] = None

    @property
    def proposable(self) -> bool:
        return self.status in ("key_match", "desc_match") and self.field is not None

    def as_dict(self) -> dict[str, object]:
        return {**asdict(self), "proposable": self.proposable}


def compare_object(obj: str, source: list[ConfigItem], target: list[ConfigItem]) -> list[MatchRow]:
    """Classify each source key: exists, key_match (normalised key), desc_match (difflib), missing."""
    exact = {t.key for t in target}
    by_norm = {normalise_key(t.key): t.key for t in target}
    by_desc: dict[str, str] = {}
    # ponytail: description matching is O(n·m); skipped above DESC_MATCH_MAX target items. Index by token if needed.
    if len(target) <= DESC_MATCH_MAX:
        for t in target:
            d = _desc(t.values)
            if d:
                by_desc.setdefault(d.upper(), t.key)
    rows: list[MatchRow] = []
    for it in source:
        desc = _desc(it.values)
        if it.key in exact:
            rows.append(MatchRow(obj, it.key, "exists", it.key, 1.0, description=desc))
            continue
        tk, status, score = by_norm.get(normalise_key(it.key)), "key_match", 1.0
        if tk is None and by_desc and desc:
            hit = difflib.get_close_matches(desc.upper(), list(by_desc), n=1, cutoff=DESC_CUTOFF)
            if hit:
                tk, status = by_desc[hit[0]], "desc_match"
                score = round(difflib.SequenceMatcher(None, desc.upper(), hit[0]).ratio(), 3)
        if tk is None:
            rows.append(MatchRow(obj, it.key, "missing", description=desc))
            continue
        field, sv, tv = _diff_field(it.key, tk) or (None, None, None)
        rows.append(MatchRow(obj, it.key, status, tk, score, field, sv, tv, desc))
    return rows


def baseline_snapshot(system_type: str) -> ConfigSnapshot:
    """The SAP standard baseline of ``system_type`` as a best-practice snapshot."""
    from api.services.connectivity_manager import baseline_key
    from sap.baseline_config import BASELINE_CONFIG
    from sap.ddic import dictionary_for_system

    snap = ConfigSnapshot(system_type, origin="best_practice")
    ddic = dictionary_for_system(system_type)
    for tables in BASELINE_CONFIG.get(baseline_key(system_type), {}).values():
        for table, rows in tables.items():
            if table in snap.objects:
                continue
            snap.add_frame(table, pd.DataFrame(rows), ddic.keys(table))
    for st in snap.objects.values():
        st.detail = BASELINE_DETAIL
    return snap


def with_baseline(snap: ConfigSnapshot, system_type: str) -> tuple[ConfigSnapshot, str]:
    """Swap a no-API snapshot (no items, every object NOT_AVAILABLE) for the type's baseline."""
    if snap.items or not snap.objects or any(st.state != NOT_AVAILABLE for st in snap.objects.values()):
        return snap, snap.origin
    base = baseline_snapshot(system_type)
    if not base.items:
        return snap, snap.origin
    base.system_id, base.role = snap.system_id, snap.role
    return base, "best_practice"


def pair_error(source_role: str, target_role: str, same: bool) -> Optional[str]:
    if same:
        return "A system cannot be its own target."
    if source_role == "target":
        return "A target system cannot have a target of its own."
    if target_role != "target":
        return "The assigned system must have the target role."
    return None


# Scope predicate for transfer_value_mappings: global rows (both ids NULL) OR exactly this source/target pair.
# Binds: :src (source system uuid text), :tgt (target system uuid text, may be NULL).
SCOPE_SQL = (
    "((source_system_id IS NULL AND target_system_id IS NULL) "
    "OR (source_system_id IS NOT DISTINCT FROM CAST(:src AS uuid) "
    "AND target_system_id IS NOT DISTINCT FROM CAST(:tgt AS uuid)))"
)


BASIS_SQL = (
    "SELECT bool_or(status = 'completed'), "
    f"bool_or(status IN ('queued', 'running') AND created_at > now() - interval '{STALE_MINUTES} minutes') "
    "FROM config_loads WHERE system_id = CAST(:sid AS uuid) "
    "AND tenant_id = CAST(current_setting('app.tenant_id') AS uuid)"  # the session's tenant, as RLS sees it
)


def config_basis(s: Session, sid: str) -> str:
    """'loaded' (a completed load), 'loading' (a load started in the last 30 minutes) or 'none'."""
    # ponytail: a running load older than STALE_MINUTES counts as stale; a heartbeat column would be exact.
    done, running = s.execute(text(BASIS_SQL), {"sid": sid}).one()
    return "loaded" if done else "loading" if running else "none"


def latest_completed_load(s: Session, sid: str) -> Optional[tuple[str, str, str]]:
    row = s.execute(text(
        "SELECT id::text, origin, system_type FROM config_loads "
        "WHERE system_id = CAST(:sid AS uuid) AND status = 'completed' "
        "ORDER BY finished_at DESC NULLS LAST, created_at DESC LIMIT 1"), {"sid": sid}).fetchone()
    return (row[0], row[1], row[2]) if row else None


def load_items(s: Session, load_id: str, obj: Optional[str] = None) -> list[ConfigItem]:
    # ponytail: capped at ITEM_CAP items per read; page by object if a load is larger.
    rows = s.execute(text(
        'SELECT object, key, "values" FROM config_items WHERE load_id = CAST(:lid AS uuid) '
        "AND (CAST(:obj AS text) IS NULL OR object = :obj) ORDER BY object, key LIMIT :cap"),
        {"lid": load_id, "obj": obj, "cap": ITEM_CAP}).fetchall()
    return [ConfigItem(r[0], r[1], r[2] or {}) for r in rows]


@dataclass
class Target:
    system_id: Optional[str]
    system_type: str
    load_id: Optional[str]
    baseline: bool
    label: str


def resolve_target(s: Session, source_id: str) -> Target:
    """The source's assigned target: its latest completed load, else its type's baseline, else the S/4 baseline."""
    row = s.execute(text(
        "SELECT t.id::text, t.name, t.system_type FROM sap_systems s "
        "LEFT JOIN sap_systems t ON t.id = s.target_system_id WHERE s.id = CAST(:sid AS uuid)"),
        {"sid": source_id}).fetchone()
    if row is None or row[0] is None:
        return Target(None, BASELINE_TYPE, None, True, BASELINE_LABEL)
    tid_, name, stype = row
    load = latest_completed_load(s, tid_)
    if load and load[1] != "best_practice":
        return Target(tid_, stype, load[0], False, name)
    return Target(tid_, stype, load[0] if load else None, True, f"{name} ({BASELINE_LABEL})")


def target_items(s: Session, t: Target, obj: Optional[str] = None) -> list[ConfigItem]:
    if t.load_id:
        return load_items(s, t.load_id, obj)
    return [i for i in baseline_snapshot(t.system_type).items if obj is None or i.object == obj]


def _by_object(items: list[ConfigItem]) -> dict[str, list[ConfigItem]]:
    out: dict[str, list[ConfigItem]] = {}
    for i in items:
        out.setdefault(i.object, []).append(i)
    return out


def _compare_all(s: Session, source_id: str) -> tuple[Target, Optional[str], dict[str, list[MatchRow]]]:
    # ponytail: load_items caps at ITEM_CAP, so larger loads are truncated on both sides; compare per object if needed.
    t = resolve_target(s, source_id)
    src = latest_completed_load(s, source_id)
    if src is None:
        return t, None, {}
    source, target = _by_object(load_items(s, src[0])), _by_object(target_items(s, t))
    return t, src[0], {o: compare_object(o, source[o], target[o]) for o in sorted(set(source) & set(target))}


def compare(s: Session, source_id: str, obj: Optional[str] = None) -> dict[str, object]:
    t, load_id, by_obj = _compare_all(s, source_id)
    objects: list[dict[str, object]] = []
    for o, rows in by_obj.items():
        counts = Counter(r.status for r in rows)
        objects.append({"object": o, **{k: counts.get(k, 0) for k in STATUSES},
                        "proposable": sum(r.proposable for r in rows)})
    return {"source_load_id": load_id,
            "target": {"system_id": t.system_id, "label": t.label, "baseline": t.baseline},
            "objects": objects,
            "rows": [r.as_dict() for r in by_obj.get(obj or "", [])]}


_DRIFT_SQL = """
WITH prev AS (
    SELECT id FROM config_loads
    WHERE system_id = CAST(:sid AS uuid) AND status = 'completed' AND id <> CAST(:lid AS uuid)
    ORDER BY finished_at DESC NULLS LAST, created_at DESC LIMIT 1),
a AS (SELECT object, key, "values" FROM config_items WHERE load_id = (SELECT id FROM prev)),
b AS (SELECT object, key, "values" FROM config_items WHERE load_id = CAST(:lid AS uuid))
INSERT INTO config_drift_log (id, tenant_id, run_id, module, element_type, element_value, change_type,
                              previous_value, current_value)
SELECT gen_random_uuid(), CAST(:tid AS uuid), CAST(:lid AS uuid), 'config',
       LEFT(COALESCE(b.object, a.object), 80), LEFT(COALESCE(b.key, a.key), 500),
       CASE WHEN a.key IS NULL THEN 'added' WHEN b.key IS NULL THEN 'removed' ELSE 'changed' END,
       a."values"::text, b."values"::text
FROM a FULL OUTER JOIN b ON a.object = b.object AND a.key = b.key
WHERE EXISTS (SELECT 1 FROM prev) AND (a.key IS NULL OR b.key IS NULL OR a."values" <> b."values")
"""


def write_drift(s: Session, tid: str, sid: str, lid: str) -> int:
    """Diff load ``lid`` against the system's previous completed load into config_drift_log (run_id = lid)."""
    # ponytail: duplicate keys inside one load multiply drift rows; config_items has no unique key.
    s.execute(text("DELETE FROM config_drift_log WHERE run_id = CAST(:lid AS uuid) AND tenant_id = CAST(:tid AS uuid)"),
              {"lid": lid, "tid": tid})
    return s.execute(text(_DRIFT_SQL), {"tid": tid, "sid": sid, "lid": lid}).rowcount


def _queue_proposal(s: Session, tid: str, mapping_id: str, conf: float, rec: str) -> None:
    """One open steward item per mapping; the partial unique index makes a repeat a no-op."""
    s.execute(text("""
        INSERT INTO stewardship_queue (tenant_id, item_type, source_id, domain, priority, due_at, sla_hours,
                                       ai_recommendation, ai_confidence)
        VALUES (CAST(:tid AS uuid), 'config_value_match', CAST(:mid AS uuid), 'config', 3,
                now() + interval '72 hours', 72, :rec, :conf)
        ON CONFLICT (source_id, item_type) WHERE status != 'resolved' DO NOTHING
    """), {"tid": tid, "mid": mapping_id, "conf": conf, "rec": rec})


def propose(s: Session, tid: str, source_id: str) -> dict[str, object]:
    """Insert each proposable match as a 'proposed' pair-scoped value map plus one steward queue item."""
    t, _, by_obj = _compare_all(s, source_id)
    proposed = skipped = 0
    for o, rows in by_obj.items():
        for r in rows:
            if not r.proposable:
                continue
            new_id = s.execute(text("""
                INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, target_value,
                    note, source_system_id, target_system_id, status, updated_at)
                VALUES (gen_random_uuid(), CAST(:tid AS uuid), 'config', :tf, :sv, :tv, :note,
                        CAST(:src AS uuid), CAST(:tgt AS uuid), 'proposed', now())
                ON CONFLICT ON CONSTRAINT uq_transfer_value_mappings_scope DO NOTHING
                RETURNING id::text
            """), {"tid": tid, "tf": f"{o}.{r.field}", "sv": r.source_value, "tv": r.target_value,
                   "note": f"{r.status.replace('_', ' ')} {r.source_key} → {r.target_key}",
                   "src": source_id, "tgt": t.system_id}).scalar()
            if new_id is None:
                skipped += 1
                continue
            proposed += 1
            _queue_proposal(s, tid, new_id, r.score,
                            f"{o}.{r.field}: {r.source_value} → {r.target_value} ({r.status.replace('_', ' ')})")
    return {"proposed": proposed, "skipped": skipped, "target": t.label}


def finding_context(s: Session, rule_id: str, module: str, version_id: Optional[str],
                    fields: list[str]) -> dict[str, object]:
    """Source and target keys of the config object a rule depends on, and the source keys missing in the target."""
    from api.services.config_applicability import condition
    from api.services.source_design import dictionary_for

    sid = s.execute(text("SELECT metadata->>'system_id' FROM analysis_versions WHERE id = CAST(:v AS uuid)"),
                    {"v": version_id}).scalar() if version_id else None
    cond = condition(module, rule_id)
    obj: Optional[str] = (cond.get("requires") or {}).get("object") if cond else None
    if obj is None and sid:
        ddic = dictionary_for(s, sid)
        for f in fields:
            table, _, name = f.partition(".")
            fd = ddic.field(table, name) if name else None
            if fd is not None and fd.check_table:
                obj = fd.check_table
                break
    empty: dict[str, object] = {"object": obj, "system_id": sid, "target_label": BASELINE_LABEL, "baseline": True,
                                "source": [], "target": [], "missing": [], "missing_total": 0}
    if obj is None or sid is None:
        return empty
    t = resolve_target(s, sid)
    src = latest_completed_load(s, sid)
    source = load_items(s, src[0], obj) if src else []
    target = target_items(s, t, obj)
    missing = [r.source_key for r in compare_object(obj, source, target) if r.status == "missing"]
    return {"object": obj, "system_id": sid, "target_label": t.label, "baseline": t.baseline,
            "source": [i.key for i in source[:50]], "target": [i.key for i in target[:50]],
            "missing": missing[:50], "missing_total": len(missing)}


async def enqueue_config_load(db: AsyncSession, tid: str, sid: str, force: bool = False) -> Optional[dict[str, str]]:
    """Queue run_load_config for ``sid``. The caller has set app.tenant_id.

    Without ``force`` it runs only when the system has no completed or fresh load, and never raises
    (register and test connection must not fail on it). With ``force`` it always queues and raises on failure.
    """
    from api.services import jobs
    from workers.tasks.run_load_config import run_load_config

    load_id: Optional[str] = None
    queued = False
    try:
        st = (await db.execute(text("SELECT system_type FROM sap_systems "
                                    "WHERE id = CAST(:sid AS uuid) AND tenant_id = CAST(:tid AS uuid)"),
                               {"sid": sid, "tid": tid})).scalar()
        if st is None:
            return None
        if not force and await db.run_sync(lambda s: config_basis(s, sid)) != "none":
            return None
        load_id = str(uuid.uuid4())
        job_id = f"cfgload-{load_id}"
        # commit the running row first so the worker always finds it; the task upserts it
        await db.execute(text(
            "INSERT INTO config_loads (id, tenant_id, system_id, system_type, role, origin, status) "
            "SELECT CAST(:lid AS uuid), CAST(:tid AS uuid), id, system_type, role, 'connection', 'running' "
            "FROM sap_systems WHERE id = CAST(:sid AS uuid) ON CONFLICT (id) DO NOTHING"),
            {"lid": load_id, "tid": tid, "sid": sid})
        await db.commit()
        jobs.start_job(tid, job_id, "config_load", f"Configuration load: {st}", status="queued",
                       system_id=sid, load_id=load_id)
        run_load_config.apply_async(args=(tid, sid, load_id, job_id), task_id=load_id)
        queued = True
        return {"job_id": job_id, "load_id": load_id, "status": "queued", "system_type": st}
    except Exception as e:
        if load_id and not queued:
            try:  # the running row is committed; do not leave it blocking retries for 30 minutes
                await db.rollback()
                await db.execute(text("UPDATE config_loads SET status = 'failed', error = :e, finished_at = now() "
                                      "WHERE id = CAST(:lid AS uuid) AND tenant_id = CAST(:tid AS uuid)"),
                                 {"e": str(e)[:500], "lid": load_id, "tid": tid})
                await db.commit()
            except Exception:
                logger.exception("Could not mark config load %s failed", load_id)
        if force:
            raise
        logger.exception("Config load could not be queued for system %s", sid)
        return None
