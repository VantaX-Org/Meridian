"""mdm source system: tag golden-record values with the SAP system they came from; dedup merge reasons

Revision ID: 091
Revises: 090
Create Date: 2026-10-26

"Trusted system wins" survivorship compares a rule's ordered systems with the system each value came
from, but master_records.source_contributions only carried a provenance label (``upload:<version>``,
``merge:<key>``). From now on each entry also carries ``source_system_id`` / ``source_system_name``
(sap_systems) when the run's system is known: an extraction, or an upload attached to a system
(analysis_versions.metadata.system_id). Merges keep the tags of the member a value came from.

  1. master_records.own_contributions (JSONB, NULL): a clustered record's own pre-merge contributions,
     kept beside own_fields so survivorship can rank a merged cluster's values by system and an
     unmerge restores them.
  2. dedup_candidates.merge_reason (TEXT, NULL): the steward's reason for a cleaning-engine merge.
  3. Backfill, per tenant (both tables are FORCE-RLS): an ``upload:<version prefix>`` entry whose
     prefix names exactly one analysis version with a known system gets that system's id and name;
     then a ``merge:<key>`` entry takes the tags of that member's own entry for the field. Entries
     already tagged are left alone, so re-running changes nothing.

No new tables (so no new RLS policy). Downgrade drops the two columns; the tags inside
source_contributions are additive keys and stay.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "091"
down_revision: str | None = "090"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# One tenant at a time: master_records, analysis_versions and sap_systems are FORCE-RLS.
BACKFILL_SQL = """
    DO $$
    DECLARE t uuid; map jsonb;
    BEGIN
        FOR t IN SELECT id FROM tenants LOOP
            PERFORM set_config('app.tenant_id', t::text, true);

            -- 1. upload:<version prefix> -> the run's system, when the prefix names one version only.
            --    The prefix -> system map is built once per tenant, from the DISTINCT prefixes in use,
            --    as one jsonb object; each entry then looks its prefix up in it. Matching every entry
            --    against analysis_versions with LIKE instead (a lateral per entry) took tens of minutes
            --    on large tables while this migration holds ACCESS EXCLUSIVE on master_records.
            WITH pfx AS (
                SELECT DISTINCT p, translate(p, '%_' || chr(92), '') = p AS plain
                  FROM (SELECT CASE WHEN jsonb_typeof(e.value) = 'object'
                                     AND NOT (e.value ? 'source_system_id')
                                     AND e.value->>'source_system' LIKE 'upload:%'
                                     AND length(e.value->>'source_system') >= 15
                                    THEN substr(e.value->>'source_system', 8) END AS p
                          FROM master_records m2
                          CROSS JOIN LATERAL jsonb_each(m2.source_contributions) e
                         WHERE m2.tenant_id = t) q
                 WHERE p IS NOT NULL
            ), ver AS (
                SELECT v.id::text AS vid, s.id::text AS sid, s.name AS sname
                  FROM analysis_versions v
                  LEFT JOIN sap_systems s ON s.tenant_id = v.tenant_id
                                         AND s.id::text = v.metadata->>'system_id'
                 WHERE v.tenant_id = t
            ), hit AS (
                -- a plain prefix: equality with the version ids cut to each prefix length in use
                SELECT pfx.p, c.sid, c.sname
                  FROM pfx
                  JOIN (SELECT left(ver.vid, l.len) AS vpfx, ver.sid, ver.sname
                          FROM ver CROSS JOIN (SELECT DISTINCT length(p) AS len FROM pfx WHERE plain) l) c
                    ON c.vpfx = pfx.p
                 WHERE pfx.plain
                UNION ALL
                -- a prefix holding a LIKE wildcard or the escape character keeps LIKE's meaning
                SELECT pfx.p, ver.sid, ver.sname
                  FROM pfx JOIN ver ON ver.vid LIKE pfx.p || '%'
                 WHERE NOT pfx.plain
            )
            SELECT jsonb_object_agg(p, jsonb_build_object('source_system_id', sid, 'source_system_name', sname))
              INTO map
              FROM (SELECT p, max(sid) AS sid, max(sname) AS sname FROM hit GROUP BY p HAVING count(*) = 1) u
             WHERE sid IS NOT NULL;

            IF map IS NOT NULL THEN
                UPDATE master_records m
                   SET source_contributions = (
                       SELECT jsonb_object_agg(e.key, CASE WHEN map ? k.p THEN e.value || (map -> k.p)
                                                           ELSE e.value END)
                         FROM jsonb_each(m.source_contributions) e
                         CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(e.value) = 'object'
                                                          AND NOT (e.value ? 'source_system_id')
                                                          AND e.value->>'source_system' LIKE 'upload:%'
                                                          AND length(e.value->>'source_system') >= 15
                                                         THEN substr(e.value->>'source_system', 8) END AS p) k)
                 WHERE m.tenant_id = t
                   AND EXISTS (SELECT 1 FROM jsonb_each(m.source_contributions) e
                                WHERE jsonb_typeof(e.value) = 'object'
                                  AND NOT (e.value ? 'source_system_id')
                                  AND e.value->>'source_system' LIKE 'upload:%'
                                  AND length(e.value->>'source_system') >= 15
                                  AND map ? substr(e.value->>'source_system', 8));
            END IF;

            -- 2. merge:<key> -> the tags of that member's own entry for the field.
            UPDATE master_records m SET source_contributions = x.c
              FROM (
                SELECT m2.id,
                       jsonb_object_agg(e.key, CASE WHEN src.sid IS NOT NULL
                           THEN e.value || jsonb_strip_nulls(jsonb_build_object('source_system_id', src.sid,
                                                                                'source_system_name', src.sname))
                           ELSE e.value END) AS c,
                       bool_or(src.sid IS NOT NULL) AS hit
                  FROM master_records m2
                  CROSS JOIN LATERAL jsonb_each(m2.source_contributions) e
                  LEFT JOIN LATERAL (
                      SELECT COALESCE(o.own_contributions, o.source_contributions)->e.key->>'source_system_id' AS sid,
                             COALESCE(o.own_contributions, o.source_contributions)->e.key->>'source_system_name' AS sname
                        FROM master_records o
                       WHERE jsonb_typeof(e.value) = 'object'
                         AND NOT (e.value ? 'source_system_id')
                         AND e.value->>'source_system' LIKE 'merge:%'
                         AND o.tenant_id = m2.tenant_id AND o.domain = m2.domain
                         AND o.sap_object_key = substr(e.value->>'source_system', 7)
                       LIMIT 1
                  ) src ON true
                 WHERE m2.tenant_id = t
                 GROUP BY m2.id
              ) x
             WHERE m.id = x.id AND x.hit;
        END LOOP;
    END $$
"""


def upgrade() -> None:
    op.add_column("master_records", sa.Column("own_contributions", JSONB, nullable=True))
    op.add_column("dedup_candidates", sa.Column("merge_reason", sa.Text, nullable=True))
    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    op.drop_column("dedup_candidates", "merge_reason")
    op.drop_column("master_records", "own_contributions")
