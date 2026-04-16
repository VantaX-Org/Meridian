import logging
from pathlib import Path

import yaml

logger = logging.getLogger("meridian.column_mapper")

RULES_DIR = Path(__file__).parent.parent.parent / "checks" / "rules"
CATEGORIES = ["ecc", "successfactors", "warehouse"]


def load_column_map(module_name: str) -> dict[str, str]:
    """Load column name aliases for a module from column_map.yaml."""
    for category in CATEGORIES:
        path = RULES_DIR / category / "column_map.yaml"
        if path.exists():
            with open(path, "r") as f:
                maps = yaml.safe_load(f) or {}
            if module_name in maps:
                return maps[module_name]
            # Category-level fallback: SF modules share the 'successfactors' key
            if category in maps:
                module_path = RULES_DIR / category / f"{module_name}.yaml"
                if module_path.exists():
                    return maps[category]
    return {}


def apply_column_mapping(df, module_name: str):
    """Rename DataFrame columns using the module's column_map.yaml aliases."""
    col_map = load_column_map(module_name)
    if col_map:
        rename_map = {alias: canonical for alias, canonical in col_map.items() if alias in df.columns}
        if rename_map:
            df = df.rename(columns=rename_map)
            logger.info(f"Mapped {len(rename_map)} columns for module '{module_name}'")
    return df


def get_required_fields(module_name: str) -> set[str]:
    """Extract all unique field names from the module's YAML rules."""
    for category in CATEGORIES:
        path = RULES_DIR / category / f"{module_name}.yaml"
        if path.exists():
            with open(path, "r") as f:
                config = yaml.safe_load(f) or {}
            fields = set()
            for rule in config.get("rules", []):
                field = rule.get("field", "")
                if field:
                    fields.add(field)
            return fields
    return set()


def get_standard_fields(module_name: str) -> set[str]:
    """Return all known standard SAP fields for a module.

    This combines:
    - Fields referenced in validation rules (from the module YAML)
    - Fields defined in column_map.yaml aliases (both source and target)

    Custom/customer fields are identified as anything NOT in this set.
    Common indicators of custom fields:
    - Z or ZZ prefix (SAP customer namespace)
    - Fields not belonging to any standard SAP table
    """
    fields: set[str] = set()

    # 1. Fields from validation rules
    for category in CATEGORIES:
        path = RULES_DIR / category / f"{module_name}.yaml"
        if path.exists():
            with open(path, "r") as f:
                config = yaml.safe_load(f) or {}
            for rule in config.get("rules", []):
                field = rule.get("field", "")
                if field:
                    fields.add(field)
                for related in rule.get("related_fields", []):
                    if related:
                        fields.add(related)

    # 2. Fields from column maps (both aliases and canonical target names)
    for category in CATEGORIES:
        path = RULES_DIR / category / "column_map.yaml"
        if path.exists():
            with open(path, "r") as f:
                maps = yaml.safe_load(f) or {}
            if module_name in maps:
                col_map = maps[module_name]
                fields.update(col_map.keys())
                fields.update(col_map.values())

    return fields
