"""Mine learned house rules for one module of an analysed version and store them as
pending proposals (learned_rule_proposals). Idempotent: one row per fingerprint;
re-mining refreshes pending rows and never touches approved or rejected ones.
Reads the stored extract only — never SAP."""
from __future__ import annotations

import json
import logging
from typing import Iterator

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from checks.house_rules import Proposal, mine_frame
from sap.ddic import Dictionary
from workers.celery_app import celery_app
from workers.dataset import bundle_object, iter_parquet_chunks
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.mining.house_rules")
PARENT_CODES = 10


def _keys(dictionary: Dictionary, table: str) -> list[str]:
    return [f"{table}.{k}" for k in dictionary.keys(table) if k != "MANDT"]


def _qualified(df: pd.DataFrame, table: str) -> pd.DataFrame:
    return df.rename(columns=lambda c: c if "." in c else f"{table}.{c}")


def _parent_lookup(path: str, parent: str, on: tuple[tuple[str, str], ...],
                   dictionary: Dictionary) -> pd.DataFrame:
    """Parent join keys + up to PARENT_CODES code columns (category dtype), one row per parent key."""
    from checks.house_rules import candidates

    keys = {p for _, p in on}
    head = next(iter_parquet_chunks(bundle_object(path, parent)), None)
    if head is None:
        return pd.DataFrame()
    codes = [c for c in candidates(_qualified(head, parent), dictionary)[0]
             if c.split(".", 1)[1] not in keys][:PARENT_CODES]
    want = keys | {c.split(".", 1)[1] for c in codes}
    # ponytail: holds parent keys + <=10 category columns in memory; partition by key hash if parents pass ~20M rows
    parts = [_qualified(c, parent) for c in iter_parquet_chunks(bundle_object(path, parent), keep=lambda c: c in want)]
    df = pd.concat(parts, ignore_index=True).drop_duplicates([f"{parent}.{k}" for k in sorted(keys)])
    return df.astype({c: "category" for c in codes})


def frames_for(path: str, tables: list[str], dictionary: Dictionary
               ) -> Iterator[tuple[str, Iterator[pd.DataFrame], list[str]]]:
    """(frame name, chunk iterator, key columns). A flat upload is one frame holding every module
    table; a bundle is one frame per table, its chunks left-joined to the parent's code columns."""
    from checks.frames import _graph

    if not path.endswith("/"):
        wanted = set(tables)
        yield ("flat", iter_parquet_chunks(path, keep=lambda c: c.split(".", 1)[0] in wanted),
               [k for t in tables for k in _keys(dictionary, t)])
        return
    edges, _ = _graph()
    for table in tables:
        edge = next((e for e in edges if e.child == table and e.parent in tables), None)
        lookup = _parent_lookup(path, edge.parent, edge.on, dictionary) if edge else None

        def chunks(table: str = table, edge=edge, lookup: "pd.DataFrame | None" = lookup) -> Iterator[pd.DataFrame]:
            for c in iter_parquet_chunks(bundle_object(path, table)):
                c = _qualified(c, table)
                if lookup is not None and not lookup.empty:
                    c = c.merge(lookup, how="left", left_on=[f"{table}.{cf}" for cf, _ in edge.on],
                                right_on=[f"{edge.parent}.{pf}" for _, pf in edge.on])
                    c = c.drop(columns=[f"{edge.parent}.{pf}" for _, pf in edge.on])
                yield c

        yield table, chunks(), _keys(dictionary, table)


def upsert_rows(props: list[Proposal], module: str, version_id: str, tenant_id: str) -> list[dict]:
    return [{"tenant_id": tenant_id, "version_id": version_id, "module": module, "kind": p.kind,
             "table_name": p.table, "determinant": p.determinant, "field": p.field, "fingerprint": p.fingerprint,
             "body": json.dumps(p.body, sort_keys=True), "confidence": p.confidence,
             "support_rows": p.support_rows, "violations": p.violations,
             "sample_keys": json.dumps(list(p.sample_keys))} for p in props]


_UPSERT = text("""
    INSERT INTO learned_rule_proposals (tenant_id, version_id, module, kind, table_name, determinant, field,
                                        fingerprint, body, confidence, support_rows, violations, sample_keys)
    VALUES (:tenant_id, :version_id, :module, :kind, :table_name, :determinant, :field, :fingerprint,
            CAST(:body AS jsonb), :confidence, :support_rows, :violations, CAST(:sample_keys AS jsonb))
    ON CONFLICT ON CONSTRAINT uq_learned_rule_proposals_fp DO UPDATE
       SET version_id = EXCLUDED.version_id, body = EXCLUDED.body, confidence = EXCLUDED.confidence,
           support_rows = EXCLUDED.support_rows, violations = EXCLUDED.violations,
           sample_keys = EXCLUDED.sample_keys, updated_at = now()
     WHERE learned_rule_proposals.status = 'pending'
    RETURNING (xmax = 0) AS inserted
""")


@celery_app.task(bind=True, name="workers.tasks.mining.house_rules.run_house_rules",
                 soft_time_limit=3300, time_limit=3600)
def run_house_rules(self, version_id: str, tenant_id: str, module: str, parquet_path: str) -> dict:
    """Mine module-level house rules for one analysed version and upsert pending proposals."""
    from api.services.source_design import dictionary_for
    from checks.frames import tables_of
    from checks.runner import get_required_columns
    from workers.tasks.rule_proposal_task import _notify_reviewers

    engine = get_sync_engine()
    with Session(engine) as s:
        s.execute(text("SET app.tenant_id = :tid"), {"tid": tenant_id})
        meta = s.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v"),
                         {"v": version_id}).scalar() or {}
        dictionary = dictionary_for(s, meta.get("system_id"))
    try:
        tables = sorted(tables_of(get_required_columns(module)))
    except FileNotFoundError:
        return {"module": module, "proposals": 0, "reason": "no_rules"}
    props: list[Proposal] = []
    for name, chunks, keys in frames_for(parquet_path, tables, dictionary):
        found = mine_frame(chunks, dictionary, keys)
        logger.info("house rules %s/%s: %d proposals", module, name, len(found))
        props += found
    new = 0
    with Session(engine) as s:
        s.execute(text("SET app.tenant_id = :tid"), {"tid": tenant_id})
        new = sum(1 for row in upsert_rows(props, module, version_id, tenant_id)
                  if s.execute(_UPSERT, row).scalar())
        if new:
            _notify_reviewers(s, tenant_id, module, new, roles=("admin", "manager", "approver"),
                              title=f"{new} new learned house rules",
                              body=f"Module: {module}. Your data follows these rules for at least 95% of records. "
                                   "Approve or reject them under Rules › Learned.",
                              link="/rules/learned")
        s.commit()
    return {"module": module, "proposals": len(props), "new": new}
