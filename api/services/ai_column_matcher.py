"""AI-powered column matching service.

Deterministic matching runs first (exact TABLE.FIELD, alias, short-name).
LLM is only invoked for remaining unmatched columns.
"""

import json
import logging
from pathlib import Path

import yaml

from llm.provider import get_llm

logger = logging.getLogger("meridian.ai_column_matcher")

RULES_DIR = Path(__file__).parent.parent.parent / "checks" / "rules"
CATEGORIES = ["ecc", "successfactors", "warehouse"]

# Human-readable labels for modules
MODULE_LABELS: dict[str, str] = {
    "business_partner": "Business Partner",
    "material_master": "Material Master",
    "fi_gl": "GL Accounts",
    "accounts_payable": "Accounts Payable",
    "accounts_receivable": "Accounts Receivable",
    "asset_accounting": "Asset Accounting",
    "mm_purchasing": "MM Purchasing",
    "plant_maintenance": "Plant Maintenance",
    "production_planning": "Production Planning",
    "sd_customer_master": "SD Customer Master",
    "sd_sales_orders": "SD Sales Orders",
    "employee_central": "Employee Central",
    "compensation": "Compensation",
    "benefits": "Benefits",
    "payroll_integration": "Payroll Integration",
    "performance_goals": "Performance & Goals",
    "succession_planning": "Succession Planning",
    "recruiting_onboarding": "Recruiting & Onboarding",
    "learning_management": "Learning Management",
    "time_attendance": "Time & Attendance",
    "ewms_stock": "eWMS Stock",
    "ewms_transfer_orders": "eWMS Transfer Orders",
    "batch_management": "Batch Management",
    "mdg_master_data": "MDG Master Data",
    "grc_compliance": "GRC Compliance",
    "fleet_management": "Fleet Management",
    "transport_management": "Transport Management",
    "wm_interface": "WM Interface",
    "cross_system_integration": "Cross-System Integration",
}


def _load_module_fields(module_name: str) -> set[str]:
    """Load all TABLE.FIELD names from a module's YAML rules."""
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


def _load_all_module_fields() -> dict[str, set[str]]:
    """Load fields for every module. Returns {module_name: {TABLE.FIELD, ...}}."""
    all_fields: dict[str, set[str]] = {}
    for category in CATEGORIES:
        cat_dir = RULES_DIR / category
        if not cat_dir.exists():
            continue
        for yaml_file in cat_dir.glob("*.yaml"):
            if yaml_file.name == "column_map.yaml":
                continue
            module_name = yaml_file.stem
            with open(yaml_file, "r") as f:
                config = yaml.safe_load(f) or {}
            fields = set()
            for rule in config.get("rules", []):
                field = rule.get("field", "")
                if field:
                    fields.add(field)
            if fields:
                all_fields[module_name] = fields
    return all_fields


def _load_all_column_maps() -> dict[str, dict[str, str]]:
    """Load all column_map.yaml files. Returns {module_name: {alias: TABLE.FIELD}}."""
    all_maps: dict[str, dict[str, str]] = {}
    for category in CATEGORIES:
        path = RULES_DIR / category / "column_map.yaml"
        if not path.exists():
            continue
        with open(path, "r") as f:
            maps = yaml.safe_load(f) or {}
        for module_name, aliases in maps.items():
            if isinstance(aliases, dict):
                all_maps[module_name] = aliases
    return all_maps


def _build_short_name_index(fields: set[str]) -> dict[str, str]:
    """Build {FIELD_SHORT: TABLE.FIELD} index. Excludes ambiguous short names."""
    index: dict[str, list[str]] = {}
    for field in fields:
        if "." in field:
            short = field.split(".")[-1]
        else:
            short = field
        index.setdefault(short, []).append(field)
    # Only keep unambiguous mappings
    return {short: targets[0] for short, targets in index.items() if len(targets) == 1}


def detect_module_and_match(
    headers: list[str],
    sample_rows: list[list[str]],
    filename: str,
    module_hint: str | None = None,
) -> dict:
    """Detect the SAP module and map columns to TABLE.FIELD format.

    Returns a dict matching the MatchResponse schema.
    """
    all_fields = _load_all_module_fields()
    all_maps = _load_all_column_maps()

    # ── Step 1: Deterministic module detection ──
    # Score each module by how many headers match its fields/aliases
    module_scores: dict[str, int] = {}
    for mod, fields in all_fields.items():
        score = 0
        aliases = all_maps.get(mod, {})
        short_index = _build_short_name_index(fields)

        for header in headers:
            h = header.strip()
            if h in fields:
                score += 3  # exact TABLE.FIELD match — strong signal
            elif h in aliases:
                score += 2  # known alias
            elif h in short_index:
                score += 1  # short name match
        module_scores[mod] = score

    # Use hint if provided and valid, otherwise pick best scoring module
    if module_hint and module_hint in all_fields:
        detected_module = module_hint
    else:
        detected_module = max(module_scores, key=lambda m: module_scores[m])

    best_score = module_scores.get(detected_module, 0)
    max_possible = len(headers) * 3
    module_confidence = min(best_score / max(max_possible, 1), 1.0)

    # ── Step 2: Deterministic column matching for detected module ──
    target_fields = all_fields.get(detected_module, set())
    aliases = all_maps.get(detected_module, {})
    short_index = _build_short_name_index(target_fields)

    mappings: list[dict] = []
    unmatched_headers: list[str] = []

    for header in headers:
        h = header.strip()

        # Exact TABLE.FIELD match
        if h in target_fields:
            mappings.append({
                "source_column": header,
                "target_field": h,
                "confidence": 1.0,
                "is_required": h in target_fields,
                "match_type": "exact",
            })
            continue

        # Alias match from column_map.yaml
        if h in aliases:
            mappings.append({
                "source_column": header,
                "target_field": aliases[h],
                "confidence": 0.95,
                "is_required": aliases[h] in target_fields,
                "match_type": "alias",
            })
            continue

        # Short name match (FIELD part of TABLE.FIELD)
        if h in short_index:
            mappings.append({
                "source_column": header,
                "target_field": short_index[h],
                "confidence": 0.85,
                "is_required": short_index[h] in target_fields,
                "match_type": "short_name",
            })
            continue

        # Case-insensitive alias match
        alias_lower = {k.lower(): v for k, v in aliases.items()}
        if h.lower() in alias_lower:
            mappings.append({
                "source_column": header,
                "target_field": alias_lower[h.lower()],
                "confidence": 0.90,
                "is_required": alias_lower[h.lower()] in target_fields,
                "match_type": "alias",
            })
            continue

        # Case-insensitive short name match
        short_lower = {k.lower(): v for k, v in short_index.items()}
        if h.lower() in short_lower:
            mappings.append({
                "source_column": header,
                "target_field": short_lower[h.lower()],
                "confidence": 0.80,
                "is_required": short_lower[h.lower()] in target_fields,
                "match_type": "short_name",
            })
            continue

        unmatched_headers.append(header)

    # ── Step 3: LLM matching for remaining unmatched columns ──
    if unmatched_headers and target_fields:
        llm_results = _llm_match_columns(
            unmatched_headers, sample_rows, headers, target_fields, detected_module
        )
        already_mapped_targets = {m["target_field"] for m in mappings if m["target_field"]}
        for result in llm_results:
            target = result.get("target")
            # Don't map to a field already claimed by a deterministic match
            if target and target in already_mapped_targets:
                target = None
            mappings.append({
                "source_column": result["source"],
                "target_field": target,
                "confidence": result.get("confidence", 0.0),
                "is_required": (target in target_fields) if target else False,
                "match_type": "ai" if target else "unmatched",
            })
            if target:
                already_mapped_targets.add(target)
    else:
        # Mark remaining as unmatched without calling LLM
        for header in unmatched_headers:
            mappings.append({
                "source_column": header,
                "target_field": None,
                "confidence": 0.0,
                "is_required": False,
                "match_type": "unmatched",
            })

    # ── Step 4: Identify unmapped required fields ──
    mapped_targets = {m["target_field"] for m in mappings if m["target_field"]}
    unmapped_required = sorted(f for f in target_fields if f not in mapped_targets)

    # ── Step 5: Build available modules list ──
    available_modules = [
        {"value": mod, "label": MODULE_LABELS.get(mod, mod.replace("_", " ").title())}
        for mod in sorted(all_fields.keys())
    ]

    return {
        "detected_module": detected_module,
        "module_confidence": round(module_confidence, 2),
        "module_label": MODULE_LABELS.get(detected_module, detected_module),
        "mappings": mappings,
        "unmapped_required": unmapped_required,
        "available_modules": available_modules,
    }


# ── LLM matching ────────────────────────────────────────────────────────────

MATCH_SYSTEM_PROMPT = """You are an SAP data mapping expert. Given a set of CSV column headers \
with sample data, map each column to the correct SAP TABLE.FIELD format.

Rules:
- Only map columns you are confident about (>0.7 confidence)
- Return null for target if you cannot confidently map a column
- Consider both the column name AND the sample data values
- SAP field names follow TABLE.FIELD format (e.g., BUT000.PARTNER, MARA.MTART)
- Respond ONLY with a JSON array, no other text"""

MATCH_USER_TEMPLATE = """Detected SAP module: {module_name}

Expected fields for this module:
{expected_fields}

Unmatched columns from uploaded file:
{unmatched_columns}

Sample data (first 3 rows):
{sample_data}

Map each unmatched column to the best matching expected field.
Return a JSON array: [{{"source": "column_name", "target": "TABLE.FIELD", "confidence": 0.85}}]
Use null for target if no confident match exists."""


def _llm_match_columns(
    unmatched_headers: list[str],
    sample_rows: list[list[str]],
    all_headers: list[str],
    target_fields: set[str],
    module_name: str,
) -> list[dict]:
    """Call the LLM to map unmatched columns. Returns list of {source, target, confidence}."""
    # Build sample data for unmatched columns only
    unmatched_indices = [i for i, h in enumerate(all_headers) if h in unmatched_headers]
    sample_data_lines = []
    for row in sample_rows[:3]:
        sample_vals = []
        for idx in unmatched_indices:
            if idx < len(row):
                sample_vals.append(f"{all_headers[idx]}={row[idx]}")
        if sample_vals:
            sample_data_lines.append(", ".join(sample_vals))

    prompt = MATCH_USER_TEMPLATE.format(
        module_name=module_name,
        expected_fields="\n".join(sorted(target_fields)),
        unmatched_columns=", ".join(unmatched_headers),
        sample_data="\n".join(sample_data_lines) if sample_data_lines else "(no sample data)",
    )

    try:
        llm = get_llm()
        from langchain_core.messages import HumanMessage, SystemMessage

        response = llm.invoke([
            SystemMessage(content=MATCH_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])

        content = response.content.strip()

        # Log the LLM call for audit
        _log_llm_call(module_name, prompt, content)

        # Parse JSON from response — handle markdown code fences
        if content.startswith("```"):
            content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        results = json.loads(content)
        if not isinstance(results, list):
            logger.warning("LLM returned non-list response for column matching")
            return _fallback_unmatched(unmatched_headers)

        # Validate and sanitise results
        valid_results = []
        valid_targets = target_fields  # Only allow mapping to known fields
        for item in results:
            source = item.get("source", "")
            target = item.get("target")
            confidence = float(item.get("confidence", 0.0))

            if source not in unmatched_headers:
                continue
            if target and target not in valid_targets:
                target = None
                confidence = 0.0
            if confidence < 0.5:
                target = None

            valid_results.append({
                "source": source,
                "target": target,
                "confidence": round(confidence, 2),
            })

        # Add any headers the LLM missed
        returned_sources = {r["source"] for r in valid_results}
        for header in unmatched_headers:
            if header not in returned_sources:
                valid_results.append({"source": header, "target": None, "confidence": 0.0})

        return valid_results

    except Exception as e:
        logger.warning(f"LLM column matching failed: {type(e).__name__}: {e}")
        return _fallback_unmatched(unmatched_headers)


def _fallback_unmatched(headers: list[str]) -> list[dict]:
    """Return unmatched entries when LLM fails."""
    return [{"source": h, "target": None, "confidence": 0.0} for h in headers]


def _log_llm_call(module_name: str, prompt: str, response: str) -> None:
    """Log the LLM matching call for audit. Best-effort — does not block on failure."""
    try:
        import hashlib

        prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()[:16]
        logger.info(
            f"AI column match: module={module_name} prompt_hash={prompt_hash} "
            f"response_len={len(response)}"
        )
    except Exception:
        pass
