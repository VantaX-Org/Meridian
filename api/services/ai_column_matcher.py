"""AI-powered column matching service.

Deterministic matching runs first (exact TABLE.FIELD, alias, short-name).
LLM is only invoked for remaining unmatched columns.
"""

import json
import logging
import re
from pathlib import Path

import yaml

from api.services.prompt_shapes import in_unit_range
from llm.provider import get_llm

logger = logging.getLogger("meridian.ai_column_matcher")

RULES_DIR = Path(__file__).parent.parent.parent / "checks" / "rules"
CATEGORIES = ["ecc", "successfactors", "warehouse", "concur", "ariba"]

# Human-readable labels for modules
MODULE_LABELS: dict[str, str] = {
    "business_partner": "Business Partner",
    "material_master": "Material Master",
    "fi_gl": "GL Accounts",
    "accounts_payable": "Accounts Payable",
    "accounts_receivable": "Accounts Receivable",
    "asset_accounting": "Asset Accounting",
    "hcm": "HCM Personnel Administration",
    "controlling": "Controlling",
    "mm_purchasing": "MM Purchasing",
    "plant_maintenance": "Plant Maintenance",
    "production_planning": "Production Planning",
    "quality_management": "Quality Management",
    "project_system": "Project System",
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
    "s4hc_master_data": "S/4HANA BP, CVI & Product",
    "concur_expense": "Concur Expense Reports",
    "concur_users": "Concur Users",
    "ariba_supplier": "Ariba Suppliers",
    "ariba_contracts": "Ariba Contracts",
    "ariba_procurement": "Ariba POs & Invoices",
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


_NUMERIC_DATE_MASK = re.compile(r"^[9\-./:,~+]*9[9\-./:,~+]*$")


def probably_headerless(headers: list[str], sample_rows: list[list[str]]) -> bool:
    """True when most header cells look like data (Aletheia shapes only): a number or date, or a cell with a digit
    whose mask is one of its own column's value masks. Needs 2+ non-blank cells and 60% or more data-like.
    ponytail: a headerless file of pure text columns is not caught; upgrade by comparing against known field names."""
    from api.services.prompt_shapes import masks_of, shape

    cells = [(i, shape(h)["mask"]) for i, h in enumerate(headers) if str(h).strip()]
    if len(cells) < 2:
        return False
    hits = 0
    for i, m in cells:
        masks = masks_of(r[i] for r in sample_rows if i < len(r))  # local test, never sent to the model
        if _NUMERIC_DATE_MASK.match(m) or ("9" in m and m in masks):
            hits += 1
    return hits / len(cells) >= 0.6


def detect_module_and_match(
    headers: list[str],
    sample_rows: list[list[str]],
    filename: str,
    module_hint: str | None = None,
    tenant_id: str | None = None,
    saved_mapping: dict[str, str] | None = None,
) -> dict:
    """Detect the SAP module and map columns to TABLE.FIELD format.

    ``saved_mapping`` is the tenant's saved {source header: SAP field}; the model prompt redacts by that field.
    ``tenant_id`` selects the tenant's "aggregates only" switch (no sample-derived shape reaches the model).
    Returns a dict matching the MatchResponse schema.
    """
    headerless = probably_headerless(headers, sample_rows)
    if headerless:
        # The first row is data: never send it as header names. Positional names, and the row joins the sample.
        sample_rows = [list(headers)] + list(sample_rows)
        headers = [f"column_{i + 1}" for i in range(len(headers))]
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
            unmatched_headers, sample_rows, headers, target_fields, detected_module,
            tenant_id=tenant_id, saved_mapping=saved_mapping,
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
        "headerless": headerless,
    }


# ── LLM matching ────────────────────────────────────────────────────────────

MATCH_SYSTEM_PROMPT = """You are an SAP data mapping expert. Given a set of CSV column headers \
with a shape profile of each column's data, map each column to the correct SAP TABLE.FIELD format.

Rules:
- Only map columns you are confident about (>0.7 confidence)
- Return null for target if you cannot confidently map a column
- Consider the column name AND the column's shape profile (you never see the data values)
- SAP field names follow TABLE.FIELD format (e.g., BUT000.PARTNER, MARA.MTART)
- Respond ONLY with a JSON array, no other text"""

MATCH_USER_TEMPLATE = """Detected SAP module: {module_name}

Expected fields for this module:
{expected_fields}

Unmatched columns from uploaded file:
{unmatched_columns}

Shape profile of each unmatched column (counts and masks only; mask: A upper, a lower, 9 digit, ~ space):
{sample_data}

Map each unmatched column to the best matching expected field.
Return a JSON array: [{{"source": "column_name", "target": "TABLE.FIELD", "confidence": 0.85}}]
Use null for target if no confident match exists."""


def facts(unmatched_headers: list[str], sample_rows: list[list[str]], all_headers: list[str],
          target_fields: set[str], module_name: str, tenant_id: str | None = None,
          saved_mapping: dict[str, str] | None = None) -> dict:
    """What the model may see: module, schema field names, the unmatched headers and a shape profile per column
    (counts, length range, top masks). Never a cell value, a preview or a hash of one.
    ponytail: a headerless file puts its first data row in the header position; callers must not pass that as a header."""
    from api.services.prompt_shapes import aggregates_only, column_profile

    agg = aggregates_only(tenant_id)
    saved = saved_mapping or {}
    profiles = {}
    for i, h in enumerate(all_headers):
        if h in unmatched_headers and h not in profiles:
            profiles[h] = column_profile((row[i] for row in sample_rows if i < len(row)), header=h,
                                         mapped_field=saved.get(h), aggregates=agg)
    return {"module": module_name, "expected": sorted(target_fields),
            "unmatched": list(unmatched_headers), "profiles": profiles, "aggregates_only": agg}


def _build_prompt(f: dict) -> str:
    lines = [
        f"{h}: rows={p['rows']} blank={p['blank']} distinct={p['distinct']} "
        f"length={p['min_length']}-{p['max_length']} "
        + (f"kind={p['kind']} (shape withheld)" if p.get("masked") else f"masks={p['masks']}")
        for h, p in f["profiles"].items()
    ]
    return MATCH_USER_TEMPLATE.format(
        module_name=f["module"],
        expected_fields="\n".join(f["expected"]),
        unmatched_columns=", ".join(f["unmatched"]),
        sample_data="\n".join(lines) if lines else "(no profile)",
    )


def verify(item: object, unmatched_headers: list[str], target_fields: set[str]) -> dict:
    """Prove one model mapping before it is used. Deterministic, grounded in what the caller offered.

    SOURCE_OFFERED       the source column is one we asked about
    TARGET_IN_SCHEMA     the target is null or a field of the detected module
    CONFIDENCE_IN_RANGE  confidence is a number from 0 to 1
    Any failed check drops the target. Free text is never kept."""
    d = item if isinstance(item, dict) else {}
    target, conf = d.get("target"), d.get("confidence")
    checks = [
        {"code": "SOURCE_OFFERED", "passed": d.get("source") in unmatched_headers},
        {"code": "TARGET_IN_SCHEMA", "passed": target is None or target in target_fields},
        {"code": "CONFIDENCE_IN_RANGE", "passed": in_unit_range(conf)},
    ]
    ok = all(c["passed"] for c in checks)
    return {"verified": ok, "checks": checks}


def _llm_match_columns(
    unmatched_headers: list[str],
    sample_rows: list[list[str]],
    all_headers: list[str],
    target_fields: set[str],
    module_name: str,
    tenant_id: str | None = None,
    saved_mapping: dict[str, str] | None = None,
) -> list[dict]:
    """Call the LLM to map unmatched columns. Returns list of {source, target, confidence}."""
    prompt = _build_prompt(facts(unmatched_headers, sample_rows, all_headers, target_fields, module_name,
                                 tenant_id, saved_mapping))

    try:
        from llm.provider import safe_invoke
        llm = get_llm()
        from langchain_core.messages import HumanMessage, SystemMessage

        response = safe_invoke(llm, [
            SystemMessage(content=MATCH_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ], timeout_seconds=30)
        if response is None:
            logger.warning(f"Column matcher LLM timeout for {module_name}")
            return _fallback_unmatched(unmatched_headers)  # Conservative fallback
        content = response.strip() if isinstance(response, str) else response.content.strip()

        # Log the LLM call for audit
        _log_llm_call(module_name, prompt, content)

        # Parse JSON from response — handle markdown code fences
        if content.startswith("```"):
            content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        results = json.loads(content)
        if not isinstance(results, list):
            logger.warning("LLM returned non-list response for column matching")
            return _fallback_unmatched(unmatched_headers)

        valid_results = []
        seen: set[str] = set()
        for item in results:
            proof = verify(item, unmatched_headers, target_fields)
            if not proof["checks"][0]["passed"] or item["source"] in seen:
                continue
            seen.add(item["source"])
            target, confidence = item.get("target"), item.get("confidence")
            if not proof["verified"] or confidence < 0.5:
                target, confidence = None, 0.0
            valid_results.append({"source": item["source"], "target": target, "confidence": round(confidence, 2)})

        # Add any headers the LLM missed
        for header in unmatched_headers:
            if header not in seen:
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
