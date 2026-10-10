"""Source → target transfer readiness (deterministic, no LLM). See engine.py."""

# Module id -> the S/4 business object a migration lead recognises.
OBJECT_LABELS: dict[str, str] = {
    "material_master": "Material",
    "business_partner": "Business partner",
    "sd_customer_master": "BP customer",
    "accounts_receivable": "BP customer",
    "accounts_payable": "BP supplier",
    "fi_gl": "GL account",
    "asset_accounting": "Fixed asset",
}


def object_label(module: str) -> str:
    return OBJECT_LABELS.get(module) or module.replace("_", " ").title()
