"""Draft glossary terms from the rule library: one term per SAP field a rule checks.

Deterministic (no model): the business name, why it matters, SAP impact and approved values
come from the rules' own YAML. Runs after every analysis for the objects it covered, from the
glossary's "Draft terms from analysed objects" action, and from db/seeds/populate_glossary.py.
Idempotent: an existing term (tenant, table, field) is left as it is.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

import yaml
from sqlalchemy import text

RULES_DIR = Path(__file__).resolve().parents[2] / "checks" / "rules"


def parse_field(field: str, module: str) -> tuple[str, str, str]:
    """(technical_name, sap_table, sap_field) of `TABLE.FIELD`; a bare field takes the module as its table."""
    if "." in field:
        table, name = field.split(".", 1)
        return field, table, name
    return field, module, field


def business_name(rule: dict, technical_name: str) -> str:
    if rule.get("label"):
        return rule["label"]
    return (rule.get("message") or technical_name)[:120]


def mandatory_for_s4hana(rule: dict) -> bool:
    return rule.get("severity") in ("critical", "high") and rule.get("rule_authority") in ("sap_hard_constraint", "s4hana_migration")


def approved_values(rule: dict) -> Optional[str]:
    if rule.get("valid_values_with_labels"):
        return json.dumps(rule["valid_values_with_labels"])
    if rule.get("allowed_values") is not None:
        return json.dumps(rule["allowed_values"])
    return None


@lru_cache(maxsize=1)
def library() -> tuple[tuple[dict, ...], tuple[dict, ...]]:
    """(terms, rule links) for every module in the shipped rule library."""
    seen: set[tuple[str, str, str]] = set()
    terms: list[dict] = []
    links: list[dict] = []
    for path in sorted(RULES_DIR.glob("**/*.yaml")):
        if path.stem == "column_map":
            continue
        data = yaml.safe_load(path.read_text("utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("rules"), list):
            continue
        module = data.get("module", path.stem.removesuffix(".generated"))
        for rule in data["rules"]:
            field = rule.get("field")
            if not isinstance(field, str) or not field:
                continue
            technical, table, name = parse_field(field, module)
            if rule.get("id"):
                links.append({"domain": module, "sap_table": table, "sap_field": name, "rule_id": str(rule["id"])})
            if (module, table, name) in seen:
                continue
            seen.add((module, table, name))
            terms.append({
                "domain": module, "sap_table": table, "sap_field": name, "technical_name": technical,
                "business_name": business_name(rule, technical), "why_it_matters": rule.get("why_it_matters", ""),
                "sap_impact": rule.get("sap_impact", ""), "approved_values": approved_values(rule),
                "mandatory_for_s4hana": mandatory_for_s4hana(rule), "rule_authority": rule.get("rule_authority", ""),
            })
    return tuple(terms), tuple(links)


def populate(session, tenant_id: str, modules: Optional[Iterable[str]] = None, changed_by: str = "meridian") -> dict:
    """Insert the terms (and their rule links) of ``modules`` (every module when None) for the tenant.

    The caller has set app.tenant_id and commits. Returns {"created": n, "linked": n}."""
    wanted = set(modules) if modules is not None else None
    terms, links = library()
    terms = [t for t in terms if wanted is None or t["domain"] in wanted]
    links = [lk for lk in links if wanted is None or lk["domain"] in wanted]
    created = 0
    for row in terms:
        term_id = session.execute(text("""
            INSERT INTO glossary_terms
              (tenant_id, domain, sap_table, sap_field, technical_name, business_name, why_it_matters, sap_impact,
               approved_values, mandatory_for_s4hana, rule_authority, status, ai_drafted)
            VALUES (:tid, :domain, :sap_table, :sap_field, :technical_name, :business_name, :why_it_matters,
                    :sap_impact, CAST(:approved_values AS jsonb), :mandatory_for_s4hana, :rule_authority, 'active', false)
            ON CONFLICT (tenant_id, sap_table, sap_field) DO NOTHING
            RETURNING id"""), {"tid": tenant_id, **row}).scalar()
        if term_id:
            created += 1
            session.execute(text("""
                INSERT INTO glossary_change_log (tenant_id, term_id, changed_by, field_changed, new_value, change_reason)
                VALUES (:tid, :term, :by, 'created', :name, 'Drafted from the rule library')"""),
                {"tid": tenant_id, "term": str(term_id), "by": changed_by, "name": row["technical_name"]})
    linked = 0
    for link in links:
        if session.execute(text("""
            INSERT INTO glossary_term_rules (tenant_id, term_id, rule_id, domain)
            SELECT :tid, gt.id, :rule_id, :domain FROM glossary_terms gt
             WHERE gt.tenant_id = :tid AND gt.sap_table = :sap_table AND gt.sap_field = :sap_field
            ON CONFLICT (tenant_id, term_id, rule_id) DO NOTHING
            RETURNING id"""), {"tid": tenant_id, **link}).scalar():
            linked += 1
    return {"created": created, "linked": linked}
