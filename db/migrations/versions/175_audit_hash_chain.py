"""audit_log hash chain: chain_seq, prev_hash, row_hash per tenant, append-only guard, checkpoint-aware purge

Revision ID: 175
Revises: 166
Create Date: 2026-11-13

Every audit_log row of a tenant is linked to the one before it. A BEFORE INSERT trigger takes the tenant's
audit_chain_head row FOR UPDATE (so concurrent writers queue), numbers the row (chain_seq), copies the head hash
into prev_hash and stores row_hash = sha256 over prev_hash and every column (audit_row_hash). Every writer gets
this for free, whichever helper or raw INSERT it uses. An edited, removed or reordered row breaks the chain;
api/services/audit_chain.verify finds the first break.

The row hash covers before_json and after_json through payload_hash, their own sha256, so a subject erasure
(api/services/subject_requests, which sets app.subject_erasure = 'on') can still null both payloads: the guard
lets exactly that UPDATE through and nothing else, and the chain still verifies. verify counts such rows.

Any other UPDATE and every TRUNCATE are refused. DELETE is refused unless the transaction set app.audit_purge = 'on', which only
api/services/audit_chain.purge_prefix does: it deletes a contiguous oldest prefix and appends an audit.checkpoint
row naming the last deleted seq and hash, so the rows that remain still verify after retention.

Existing rows are backfilled in (created_at, id) order per tenant.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "175"
down_revision: Union[str, None] = "166"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

GENESIS = "0" * 64


def upgrade() -> None:
    op.execute("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS chain_seq bigint")
    op.execute("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash text")
    op.execute("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS row_hash text")
    op.execute("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS payload_hash text")
    op.execute("""
        CREATE TABLE IF NOT EXISTS audit_chain_head (
            tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
            last_seq bigint NOT NULL,
            last_hash text NOT NULL
        )""")
    op.execute("ALTER TABLE audit_chain_head ENABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS audit_chain_head_rls ON audit_chain_head")
    op.execute("CREATE POLICY audit_chain_head_rls ON audit_chain_head "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")

    # The chain trigger runs as the table owner (SECURITY DEFINER), so the app role only needs to read the head:
    # it can neither move the head nor skip the trigger.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meridian_app') THEN
                REVOKE ALL ON audit_chain_head FROM meridian_app;
                GRANT SELECT ON audit_chain_head TO meridian_app;
            END IF;
        END $$""")

    op.execute(r"""
        CREATE OR REPLACE FUNCTION audit_payload_hash(b jsonb, a jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
            SELECT encode(sha256(convert_to(concat_ws(E'\x1f', coalesce(b::text, '\N'), coalesce(a::text, '\N')),
                                            'UTF8')), 'hex')
        $$""")
    # NULL and '' must hash differently, so NULL becomes a marker no column holds.
    op.execute(r"""
        CREATE OR REPLACE FUNCTION audit_row_hash(r audit_log) RETURNS text LANGUAGE sql IMMUTABLE AS $$
            SELECT encode(sha256(convert_to(concat_ws(E'\x1f',
                coalesce(r.prev_hash, '\N'), r.chain_seq::text, r.id::text, r.tenant_id::text,
                coalesce(r.actor_user_id::text, '\N'), coalesce(r.actor_email, '\N'), r.action,
                coalesce(r.entity_type, '\N'), coalesce(r.entity_id, '\N'), r.method, r.path, r.status_code::text,
                coalesce(r.ip, '\N'), coalesce(r.user_agent, '\N'),
                r.payload_hash,
                (extract(epoch FROM r.created_at) * 1000000)::bigint::text), 'UTF8')), 'hex')
        $$""")

    # Backfill before the guards exist: one tenant at a time, oldest first.
    op.execute(f"""
        DO $$
        DECLARE r record; t uuid; seq bigint := 0; h text := '{GENESIS}';
        BEGIN
            FOR r IN SELECT id, tenant_id FROM audit_log ORDER BY tenant_id, created_at, id LOOP
                IF t IS DISTINCT FROM r.tenant_id THEN
                    IF t IS NOT NULL THEN
                        INSERT INTO audit_chain_head VALUES (t, seq, h) ON CONFLICT (tenant_id) DO NOTHING;
                    END IF;
                    t := r.tenant_id; seq := 0; h := '{GENESIS}';
                END IF;
                seq := seq + 1;
                UPDATE audit_log SET chain_seq = seq, prev_hash = h,
                       payload_hash = audit_payload_hash(before_json, after_json) WHERE id = r.id;
                UPDATE audit_log a SET row_hash = audit_row_hash(a) WHERE id = r.id RETURNING row_hash INTO h;
            END LOOP;
            IF t IS NOT NULL THEN
                INSERT INTO audit_chain_head VALUES (t, seq, h) ON CONFLICT (tenant_id) DO NOTHING;
            END IF;
        END $$""")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_log_chain ON audit_log (tenant_id, chain_seq)")

    op.execute(f"""
        CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger LANGUAGE plpgsql
        SECURITY DEFINER SET search_path = public AS $$
        DECLARE h audit_chain_head%ROWTYPE;
        BEGIN
            INSERT INTO audit_chain_head VALUES (NEW.tenant_id, 0, '{GENESIS}') ON CONFLICT (tenant_id) DO NOTHING;
            SELECT * INTO h FROM audit_chain_head WHERE tenant_id = NEW.tenant_id FOR UPDATE;
            NEW.chain_seq := h.last_seq + 1;
            NEW.prev_hash := h.last_hash;
            NEW.payload_hash := audit_payload_hash(NEW.before_json, NEW.after_json);
            NEW.row_hash := audit_row_hash(NEW);
            UPDATE audit_chain_head SET last_seq = NEW.chain_seq, last_hash = NEW.row_hash
             WHERE tenant_id = NEW.tenant_id;
            RETURN NEW;
        END $$""")
    op.execute("DROP TRIGGER IF EXISTS audit_log_chain ON audit_log")
    op.execute("CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log "
               "FOR EACH ROW EXECUTE FUNCTION audit_log_chain()")

    op.execute("""
        CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' AND current_setting('app.audit_purge', true) = 'on' THEN
                RETURN OLD;
            END IF;
            IF TG_OP = 'UPDATE' AND current_setting('app.subject_erasure', true) = 'on'
               AND NEW.before_json IS NULL AND NEW.after_json IS NULL
               AND to_jsonb(NEW) - 'before_json' - 'after_json' = to_jsonb(OLD) - 'before_json' - 'after_json' THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP;
        END $$""")
    op.execute("DROP TRIGGER IF EXISTS audit_log_guard ON audit_log")
    op.execute("CREATE TRIGGER audit_log_guard BEFORE UPDATE OR DELETE ON audit_log "
               "FOR EACH ROW EXECUTE FUNCTION audit_log_guard()")
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log")
    op.execute("CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log "
               "FOR EACH STATEMENT EXECUTE FUNCTION audit_log_guard()")


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log")
    op.execute("DROP TRIGGER IF EXISTS audit_log_guard ON audit_log")
    op.execute("DROP TRIGGER IF EXISTS audit_log_chain ON audit_log")
    op.execute("DROP FUNCTION IF EXISTS audit_log_guard()")
    op.execute("DROP FUNCTION IF EXISTS audit_log_chain()")
    op.execute("DROP FUNCTION IF EXISTS audit_row_hash(audit_log)")
    op.execute("DROP FUNCTION IF EXISTS audit_payload_hash(jsonb, jsonb)")
    op.execute("DROP INDEX IF EXISTS ux_audit_log_chain")
    op.execute("DROP TABLE IF EXISTS audit_chain_head")
    op.execute("ALTER TABLE audit_log DROP COLUMN IF EXISTS payload_hash")
    op.execute("ALTER TABLE audit_log DROP COLUMN IF EXISTS row_hash")
    op.execute("ALTER TABLE audit_log DROP COLUMN IF EXISTS prev_hash")
    op.execute("ALTER TABLE audit_log DROP COLUMN IF EXISTS chain_seq")
