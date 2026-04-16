"""Add rules table for check engine rules (replaces YAML-only storage).

Rules are seeded from YAML files during upgrade and kept in sync with
Meridian HQ via the licence manifest. Customer-side view is read-only.

Revision ID: 023
Revises: 022_stewardship_queue_unique
Create Date: 2026-03-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "023"
down_revision: Union[str, None] = "022_stewardship_queue_unique"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rules",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
        ),
        sa.Column("name", sa.VARCHAR(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("module", sa.VARCHAR(100), nullable=False),
        # ecc | successfactors | warehouse
        sa.Column("category", sa.VARCHAR(50), nullable=False),
        # critical | high | medium | low | info
        sa.Column("severity", sa.VARCHAR(20), nullable=False, server_default="medium"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        # Raw rule conditions as JSONB — mirrors YAML rule body
        sa.Column(
            "conditions", postgresql.JSONB(), nullable=False, server_default="[]"
        ),
        # Optional numeric thresholds (e.g. completeness_threshold: 0.95)
        sa.Column(
            "thresholds", postgresql.JSONB(), nullable=True, server_default="{}"
        ),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.Text()),
            nullable=True,
            server_default="{}",
        ),
        # Original YAML filename for traceability (e.g. ecc/business_partner.yaml)
        sa.Column("source_yaml", sa.VARCHAR(255), nullable=True),
        # yaml = imported from local YAML | hq = pushed from Meridian HQ
        sa.Column("source", sa.VARCHAR(20), nullable=False, server_default="yaml"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index("idx_rules_category", "rules", ["category"])
    op.create_index("idx_rules_module", "rules", ["module"])
    op.create_index("idx_rules_tenant", "rules", ["tenant_id"])
    op.create_index("idx_rules_enabled", "rules", ["tenant_id", "enabled"])

    # Idempotent YAML import — unique per (tenant_id, name, module)
    op.create_unique_constraint(
        "uq_rules_name_module_tenant", "rules", ["tenant_id", "name", "module"]
    )

    # Row Level Security
    op.execute("ALTER TABLE rules ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON rules "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )

    # ── Seed rules from YAML for the dev tenant ──────────────────────────────
    # Reads all YAML rule files and inserts into the rules table.
    # Only runs for the dev tenant (00000000-0000-0000-0000-000000000001).
    # In production, rules are pushed via the licence manifest from Meridian HQ.
    _seed_yaml_rules(op)


def _seed_yaml_rules(op) -> None:
    """Import all YAML rule files into the rules table for the dev tenant."""
    import os
    import yaml  # PyYAML is already in requirements (used by check runner)

    dev_tenant = "00000000-0000-0000-0000-000000000001"
    conn = op.get_bind()

    # Skip seeding if dev tenant doesn't exist (CI, fresh installs, etc.)
    result = conn.execute(
        sa.text("SELECT 1 FROM tenants WHERE id = :tid"), {"tid": dev_tenant}
    )
    if not result.fetchone():
        print("[migration 023] Dev tenant not found — skipping YAML rule seed")
        return

    # Locate the checks/rules directory relative to this migration file
    base = os.path.dirname(__file__)
    rules_root = os.path.normpath(os.path.join(base, "..", "..", "..", "checks", "rules"))

    category_dirs = {
        "ecc": "ecc",
        "successfactors": "successfactors",
        "warehouse": "warehouse",
    }

    inserted = 0
    skipped = 0

    for category, subdir in category_dirs.items():
        cat_dir = os.path.join(rules_root, subdir)
        if not os.path.isdir(cat_dir):
            continue
        for fname in sorted(os.listdir(cat_dir)):
            if not fname.endswith(".yaml") or fname == "column_map.yaml":
                continue
            fpath = os.path.join(cat_dir, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    doc = yaml.safe_load(f)
            except Exception:
                continue

            if not isinstance(doc, dict) or "rules" not in doc:
                continue

            module = doc.get("module", fname.replace(".yaml", ""))
            source_yaml = f"{subdir}/{fname}"

            for rule in doc.get("rules", []):
                if not isinstance(rule, dict):
                    continue
                rule_id = rule.get("id", "")
                name = f"{rule_id}: {rule.get('message', rule_id)}"[:255]
                description = rule.get("why_it_matters") or rule.get("message") or ""
                severity = rule.get("severity", "medium")
                dimension = rule.get("dimension", "")
                check_class = rule.get("check_class", "")
                conditions = [
                    {
                        "field": rule.get("field"),
                        "check_class": check_class,
                        "dimension": dimension,
                        "pattern": rule.get("pattern"),
                        "domain_values": rule.get("domain_values"),
                    }
                ]

                try:
                    conn.execute(
                        sa.text("""
                            INSERT INTO rules
                                (tenant_id, name, description, module, category,
                                 severity, enabled, conditions, source_yaml, source)
                            VALUES
                                (:tid, :name, :desc, :module, :category,
                                 :severity, true, :conditions::jsonb, :source_yaml, 'yaml')
                            ON CONFLICT (tenant_id, name, module) DO NOTHING
                        """),
                        {
                            "tid": dev_tenant,
                            "name": name,
                            "desc": description[:1000] if description else "",
                            "module": module,
                            "category": category,
                            "severity": severity,
                            "conditions": __import__("json").dumps(conditions),
                            "source_yaml": source_yaml,
                        },
                    )
                    inserted += 1
                except Exception:
                    skipped += 1

    print(f"[migration 023] Rules seeded: {inserted} inserted, {skipped} skipped")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON rules")
    op.execute("ALTER TABLE rules DISABLE ROW LEVEL SECURITY")
    op.drop_table("rules")
