"""Per-tenant catalogues kept in step with the release: the rule catalogue (from the
shipped YAML rules) and the standard upload fields.

Migrations 023/024 seeded both only for a tenant that already existed when they
ran — on a fresh install the tenant is created afterwards, so the Rules and Field
mappings pages stayed empty, and rules added by later releases never appeared.
Run at API start for every tenant: adds what is missing, never changes a row a
customer has edited (rule on/off, field mapping).
"""

from __future__ import annotations

import importlib.util
import json
import logging
from functools import lru_cache
from pathlib import Path

import yaml
from sqlalchemy import text

logger = logging.getLogger("meridian.tenant_seed")

_ROOT = Path(__file__).resolve().parents[2]
_CATEGORIES = ("ecc", "successfactors", "warehouse", "concur", "ariba")


@lru_cache(maxsize=1)
def rule_catalogue() -> tuple[dict, ...]:
    out = []
    for category in _CATEGORIES:
        for path in sorted((_ROOT / "checks" / "rules" / category).glob("*.yaml")):
            if path.name == "column_map.yaml":
                continue
            doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            module = doc.get("module") or path.stem
            for r in doc.get("rules") or []:
                if not isinstance(r, dict) or not r.get("id"):
                    continue
                out.append({
                    "rid": str(r["id"]), "module": module, "category": category,
                    "name": f"{r['id']}: {r.get('message', r['id'])}"[:255],
                    "description": str(r.get("why_it_matters") or r.get("message") or "")[:1000],
                    "severity": r.get("severity", "medium"),
                    "conditions": json.dumps([{"field": r.get("field"), "check_class": r.get("check_class"),
                                               "dimension": r.get("dimension"), "pattern": r.get("pattern"),
                                               "domain_values": r.get("domain_values")}]),
                    "source_yaml": f"{category}/{path.name}",
                })
    return tuple(out)


@lru_cache(maxsize=1)
def standard_fields() -> tuple[tuple[str, str, str, str], ...]:
    path = next((_ROOT / "db" / "migrations" / "versions").glob("024_*.py"))
    spec = importlib.util.spec_from_file_location("_m024_field_mappings", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return tuple(mod._STANDARD_FIELDS)


def seed_tenant(conn, tenant_id: str) -> dict[str, int]:
    """Add the release's missing rules and standard fields for one tenant (one transaction)."""
    conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tenant_id})
    have = {(rid, m) for rid, m in conn.execute(text(
        "SELECT split_part(name, ':', 1), module FROM rules WHERE tenant_id = :t"), {"t": tenant_id})}
    rules = [{**r, "tid": tenant_id} for r in rule_catalogue() if (r["rid"], r["module"]) not in have]
    if rules:
        conn.execute(text("""
            INSERT INTO rules (tenant_id, name, description, module, category, severity, enabled,
                               conditions, source_yaml, source)
            VALUES (:tid, :name, :description, :module, :category, :severity, true,
                    CAST(:conditions AS jsonb), :source_yaml, 'yaml')
            ON CONFLICT (tenant_id, name, module) DO NOTHING
        """), rules)
    fields = conn.execute(text("""
        INSERT INTO field_mappings (tenant_id, module, standard_field, standard_label,
                                    customer_field, customer_label, data_type, is_mapped)
        SELECT :tid, m, f, l, f, l, d, false
          FROM unnest(CAST(:m AS text[]), CAST(:f AS text[]), CAST(:l AS text[]), CAST(:d AS text[])) AS x(m, f, l, d)
        ON CONFLICT (tenant_id, module, standard_field) DO NOTHING
    """), {"tid": tenant_id, **{k: [row[i] for row in standard_fields()] for i, k in enumerate("mfld")}}).rowcount
    return {"rules": len(rules), "field_mappings": fields}


def seed_all(engine) -> dict[str, dict[str, int]]:
    with engine.connect() as c:
        tenants = [str(t) for (t,) in c.execute(text("SELECT id FROM tenants"))]
    out = {}
    for tid in tenants:
        with engine.begin() as conn:
            out[tid] = seed_tenant(conn, tid)
    return out
