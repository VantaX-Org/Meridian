"""Cost of poor data quality: what a rule's failing records put at risk.

The default model is ``checks/cost_model.yaml``; a tenant's model
(``tenants.cost_model``) overlays it section by section. See the YAML for the
spec forms and precedence.
"""
from functools import lru_cache
from pathlib import Path
from typing import Optional

import pandas as pd
import yaml

from checks.base import sap_number

_SECTIONS = ("severity", "modules", "rules", "features")
# Same ratio as analytics_engine.SEVERITY_WEIGHTS (40/30/20/10).
SEVERITY_FACTOR = {"critical": 4, "high": 3, "medium": 2, "low": 1}


@lru_cache(maxsize=1)
def defaults() -> dict:
    with open(Path(__file__).with_name("cost_model.yaml")) as f:
        return yaml.safe_load(f)


def effective(tenant_model: Optional[dict] = None) -> dict:
    """Defaults with the tenant's model laid over them, key by key per section."""
    base, own = defaults(), tenant_model or {}
    model = {"currency": own.get("currency") or base.get("currency", "ZAR")}
    for s in _SECTIONS:
        model[s] = {**(base.get(s) or {}), **(own.get(s) or {})}
    return model


def validate_spec(spec: object) -> Optional[str]:
    """None when ``spec`` is a usable cost spec, else the reason it is not."""
    if not isinstance(spec, dict):
        return "a cost spec is an object"
    forms = [k for k in ("per_record", "field") if spec.get(k) is not None]
    if len(forms) != 1:
        return "a cost spec has exactly one of per_record or field"
    if set(spec) - {"per_record", "field", "factor"}:
        return f"unknown keys: {sorted(set(spec) - {'per_record', 'field', 'factor'})}"
    if "per_record" in forms and not (isinstance(spec["per_record"], (int, float)) and spec["per_record"] >= 0):
        return "per_record is a number >= 0"
    if "field" in forms and not (isinstance(spec["field"], str) and "." in spec["field"]):
        return "field is TABLE.FIELD"
    factor = spec.get("factor", 1)
    if not (isinstance(factor, (int, float)) and factor >= 0):
        return "factor is a number >= 0"
    return None


def resolve(rule: dict, tenant_model: Optional[dict] = None) -> dict:
    """The spec that prices ``rule``, with the severity spec kept as ``fallback``
    for a field spec whose field is missing from the failing records."""
    model = effective(tenant_model)
    sev = model["severity"].get(rule.get("severity", "medium")) or {"per_record": 0}
    spec = (model["rules"].get(rule.get("id", ""))
            or rule.get("cost")
            or model["modules"].get(rule.get("module", ""))
            or sev)
    return {**spec, "fallback": sev, "currency": model["currency"]}


def _money(x: float) -> str:
    return f"{x:,.2f}"


def price(spec: Optional[dict], affected: int, failing: Optional[pd.DataFrame] = None) -> tuple[Optional[float], Optional[str]]:
    """(amount at risk, formula) for ``affected`` failing records."""
    if not spec:
        return None, None
    if affected <= 0:
        return 0.0, "no failing records"
    cur, factor = spec.get("currency", ""), float(spec.get("factor", 1))
    scale = f" × {factor:g}" if factor != 1 else ""
    field = spec.get("field")
    if field:
        if failing is not None and field in failing.columns:
            total = float(sap_number(failing[field]).fillna(0).sum())
            return (round(total * factor, 2),
                    f"sum({field}) of {affected} failing records = {_money(total)} {cur}{scale}")
        fb = spec.get("fallback") or {"per_record": 0}
        amount, formula = price({**fb, "currency": cur}, affected)
        return amount, f"{formula} ({field} not in the failing records)"
    per = float(spec.get("per_record", 0))
    return round(affected * per * factor, 2), f"{affected} records × {_money(per)} {cur}{scale}"


def blocked_features(check_id: str) -> list[str]:
    """SAP features this check fully blocks, from the config impact rules."""
    from agents.config_impact import _load_impact_rules
    return sorted({r["target_feature"] for r in _load_impact_rules().get(check_id, [])
                   if r.get("impact_type") == "full_block"})


def impact(cost: Optional[float], blocked: int, severity: str) -> Optional[float]:
    """Ranking score: $ at risk × (1 + features blocked) × severity factor."""
    if cost is None:
        return None
    return round(cost * (1 + blocked) * SEVERITY_FACTOR.get(severity, 2), 2)
