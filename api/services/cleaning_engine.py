"""Cleaning Engine — detects cleaning candidates across 5 categories.

Uses jellyfish for fuzzy string matching, thefuzz for token overlap.
Pure detection — no database writes, returns candidate dicts for bulk insert.
"""

import logging
from datetime import datetime, timezone

import jellyfish
import pandas as pd
from thefuzz import fuzz

from api.services.standardisers import (
    country_code,
    legal_suffix,
    material_description,
    sa_phone_number,
    sap_uom,
    title_case,
    validate_sa_bank_branch,
    validate_sa_id,
)

logger = logging.getLogger("meridian.cleaning")

# Column name patterns — includes SAP technical field names so detection works
# with both mapped (friendly) names and raw SAP TABLE.FIELD names.
_NAME_COLS = [
    "name", "partner_name", "vendor_name", "customer_name", "bp_name",
    "name_org1", "name1", "name2", "mcod1", "firstname", "lastname",
    "first_name", "last_name", "vorna", "nachn", "sname",
]
_PHONE_COLS = [
    "phone", "telephone", "tel", "phone_number", "tel_number",
    "telf1", "telf2", "mobile", "cell",
]
_COUNTRY_COLS = ["country", "country_code", "land1", "land", "nation"]
_UOM_COLS = ["uom", "base_unit", "base_uom", "meins", "gewei", "unit_of_measure", "unit"]
_EMAIL_COLS = ["email", "smtp_addr", "email_address", "e_mail", "contact_email"]
_ID_COLS = ["id_number", "sa_id", "national_id"]
_VAT_COLS = ["vat_number", "vat_no", "stceg"]
_BRANCH_COLS = ["branch_code", "bank_branch", "bankl"]
_DESC_COLS = [
    "description", "material_description", "maktx", "txt50", "eqktx",
    "text", "desc", "goal_description",
]
_PAYMENT_COLS = ["payment_terms", "zterm"]
_CURRENCY_COLS = ["currency", "waers", "curr", "currency_code"]
_TAX_COLS = ["tax_number", "stcd1", "vat_number", "stceg", "tax_id"]
_BANK_ACCT_COLS = ["bank_account", "bankn", "banka", "bankl", "bank_key"]
_MATERIAL_GROUP_COLS = ["material_group", "matkl"]
_BASE_UNIT_COLS = ["base_unit", "meins", "base_uom"]
_ACTIVITY_COLS = [
    "last_activity", "modified_date", "last_changed", "aedat", "laeda",
    "created_at", "erdat", "start_date", "hire_date", "effective_date",
]
_STATUS_COLS = [
    "status", "block_status", "sperr", "mstae", "employment_type",
    "approval_status", "is_active", "active",
]
_TERMINATION_COLS = ["termination_date", "term_date"]
_STOCK_COLS = ["stock_quantity", "labst", "stock", "bestq"]
_PRICE_COLS = ["price", "stprs", "verpr", "salary", "net_pay", "amount", "cost"]
_AMOUNT_COLS = [
    "price", "stprs", "salary", "net_pay", "amount", "cost",
    "weight", "ntgew", "quantity", "menge", "kwmeng", "bestq",
]
_PK_COLS = [
    "partner", "lifnr", "kunnr", "matnr", "equnr", "userid",
    "pernr", "employee_id", "candidate_id", "anln1", "saknr",
    "ebeln", "vbeln", "tanum", "charg", "lgpla",
]


def _find_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    """Find first matching column name (case-insensitive).

    Also strips SAP table prefixes: 'BUT000.NAME_ORG1' matches 'name_org1'.
    """
    cols_lower = {c.lower(): c for c in df.columns}
    # Build stripped map: "BUT000.NAME_ORG1" → "name_org1" → original column name
    cols_stripped: dict[str, str] = {}
    for c in df.columns:
        if "." in c:
            stripped = c.split(".", 1)[1].lower()
            cols_stripped[stripped] = c

    for candidate in candidates:
        cl = candidate.lower()
        if cl in cols_lower:
            return cols_lower[cl]
        if cl in cols_stripped:
            return cols_stripped[cl]
    return None


def _record_key(row: pd.Series, df: pd.DataFrame) -> str:
    """Build a record key from the first plausible key column or index."""
    actual = _find_col(df, _PK_COLS)
    if actual and pd.notna(row.get(actual)):
        return str(row[actual])
    # Fallback: try first column if it looks like an ID
    if len(df.columns) > 0:
        first_val = row.get(df.columns[0])
        if pd.notna(first_val) and str(first_val).strip():
            return str(first_val).strip()
    return str(row.name)


class CleaningEngine:
    """Detect cleaning candidates across five categories."""

    def detect_candidates(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Run all five detection categories. Returns candidate dicts for cleaning_queue."""
        candidates: list[dict] = []

        try:
            candidates.extend(self.detect_duplicates(df, object_type, version_id, tenant_id))
        except Exception as e:
            logger.warning(f"detect_duplicates failed: {e}")

        try:
            candidates.extend(self.detect_standardisation_issues(df, object_type, version_id, tenant_id))
        except Exception as e:
            logger.warning(f"detect_standardisation_issues failed: {e}")

        try:
            candidates.extend(self.detect_enrichment_gaps(df, object_type, version_id, tenant_id))
        except Exception as e:
            logger.warning(f"detect_enrichment_gaps failed: {e}")

        try:
            candidates.extend(self.detect_validation_errors(df, object_type, version_id, tenant_id))
        except Exception as e:
            logger.warning(f"detect_validation_errors failed: {e}")

        try:
            candidates.extend(self.detect_lifecycle_issues(df, object_type, version_id, tenant_id))
        except Exception as e:
            logger.warning(f"detect_lifecycle_issues failed: {e}")

        return candidates

    def detect_duplicates(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Category 1: Exact primary-key duplicates + O(n^2) fuzzy dedup."""
        results: list[dict] = []

        # Phase 1: Exact duplicate detection on primary key (applies to all modules)
        pk_col = _find_col(df, _PK_COLS)
        if pk_col:
            dupes = df[df[pk_col].duplicated(keep=False) & df[pk_col].notna()]
            if not dupes.empty:
                for pk_val, group in dupes.groupby(pk_col):
                    if len(group) < 2:
                        continue
                    rows_list = list(group.iterrows())
                    for g in range(1, len(rows_list)):
                        idx_a, row_a = rows_list[0]
                        idx_b, row_b = rows_list[g]
                        key_a = str(pk_val)
                        key_b = f"{pk_val}_dup{g}"
                        merge_preview: dict[str, dict] = {}
                        for col in df.columns:
                            va = row_a.get(col)
                            vb = row_b.get(col)
                            sa = str(va) if pd.notna(va) else ""
                            sb = str(vb) if pd.notna(vb) else ""
                            survivor = sa if len(sa) >= len(sb) else sb
                            merge_preview[col] = {"a": sa, "b": sb, "survivor": survivor}
                        results.append({
                            "object_type": object_type,
                            "status": "detected",
                            "record_key": f"{key_a}|{key_b}",
                            "record_data_before": {"record_a": key_a, "record_b": key_b},
                            "record_data_after": None,
                            "confidence": 98,
                            "rule_id": None,
                            "version_id": version_id,
                            "tenant_id": tenant_id,
                            "priority": 80,
                            "merge_preview": merge_preview,
                            "match_method": "exact_pk",
                            "match_fields": {pk_col: {"a": str(pk_val), "b": str(pk_val), "method": "exact_pk"}},
                            "category": "dedup",
                        })

        # Phase 2: Fuzzy matching on name/email/tax/bank (O(n^2), capped at 500 rows)
        name_col = _find_col(df, _NAME_COLS)
        email_col = _find_col(df, _EMAIL_COLS)
        tax_col = _find_col(df, _TAX_COLS)
        bank_col = _find_col(df, _BANK_ACCT_COLS)

        if not name_col and not email_col and not tax_col and not bank_col:
            return results

        # Limit to first 500 rows to keep O(n^2) feasible
        subset = df.head(500)
        seen_pairs: set[tuple[int, int]] = set()

        for i in range(len(subset)):
            for j in range(i + 1, len(subset)):
                if (i, j) in seen_pairs:
                    continue

                row_a = subset.iloc[i]
                row_b = subset.iloc[j]
                score = 0
                method = ""
                match_fields: dict[str, dict] = {}

                # Exact match on tax_number, bank_account, or email
                for col, col_name in [(tax_col, "tax_number"), (bank_col, "bank_account"), (email_col, "email")]:
                    if col and pd.notna(row_a.get(col)) and pd.notna(row_b.get(col)):
                        val_a = str(row_a[col]).strip()
                        val_b = str(row_b[col]).strip()
                        if val_a and val_b and val_a.lower() == val_b.lower():
                            score = max(score, 95)
                            method = "exact"
                            match_fields[col_name] = {"a": val_a, "b": val_b, "method": "exact"}

                # Name-based matching
                if name_col and pd.notna(row_a.get(name_col)) and pd.notna(row_b.get(name_col)):
                    name_a = str(row_a[name_col]).strip()
                    name_b = str(row_b[name_col]).strip()

                    if name_a and name_b and len(name_a) > 5 and len(name_b) > 5:
                        # Levenshtein
                        lev_dist = jellyfish.levenshtein_distance(name_a.lower(), name_b.lower())
                        if lev_dist <= 3:
                            if score < 80:
                                score = 80
                                method = method or "fuzzy"
                            match_fields["name_levenshtein"] = {"a": name_a, "b": name_b, "distance": lev_dist}

                        # Soundex
                        if jellyfish.soundex(name_a) == jellyfish.soundex(name_b):
                            if score < 70:
                                score = 70
                                method = method or "phonetic"
                            match_fields["name_soundex"] = {"a": name_a, "b": name_b, "soundex": jellyfish.soundex(name_a)}

                        # Token overlap (Jaccard)
                        tokens_a = set(name_a.lower().split())
                        tokens_b = set(name_b.lower().split())
                        if tokens_a and tokens_b:
                            jaccard = len(tokens_a & tokens_b) / len(tokens_a | tokens_b) * 100
                            if jaccard > 80:
                                if score < 75:
                                    score = 75
                                    method = method or "token_overlap"
                                match_fields["name_token_overlap"] = {"a": name_a, "b": name_b, "jaccard": round(jaccard, 1)}

                if score < 60:
                    continue

                seen_pairs.add((i, j))
                key_a = _record_key(row_a, df)
                key_b = _record_key(row_b, df)

                # Build merge preview — prefer non-empty, longer value
                merge_preview: dict[str, dict] = {}
                for col in df.columns:
                    val_a = row_a.get(col)
                    val_b = row_b.get(col)
                    str_a = str(val_a) if pd.notna(val_a) else ""
                    str_b = str(val_b) if pd.notna(val_b) else ""
                    survivor = str_a if len(str_a) >= len(str_b) else str_b
                    merge_preview[col] = {"a": str_a, "b": str_b, "survivor": survivor}

                results.append({
                    "object_type": object_type,
                    "status": "detected",
                    "record_key": f"{key_a}|{key_b}",
                    "record_data_before": {"record_a": key_a, "record_b": key_b},
                    "record_data_after": None,
                    "confidence": score,
                    "rule_id": None,
                    "version_id": version_id,
                    "tenant_id": tenant_id,
                    "priority": 70 if score >= 85 else 50,
                    "merge_preview": merge_preview,
                    "match_method": method,
                    "match_fields": match_fields,
                    "category": "dedup",
                })

        return results

    def detect_standardisation_issues(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Category 2: Apply standardisers and flag differences."""
        results: list[dict] = []

        # Map columns to standardiser functions — base set applies to all modules
        mappings: list[tuple[list[str], callable, int]] = [
            (_PHONE_COLS, sa_phone_number, 90),
            (_COUNTRY_COLS, country_code, 90),
        ]

        # ECC master data — names, UOM, descriptions
        if object_type in ("customer", "vendor", "business_partner",
                           "accounts_payable", "accounts_receivable",
                           "sd_customer_master"):
            mappings.append((_NAME_COLS, lambda v: title_case(v), 75))
            mappings.append((_UOM_COLS, sap_uom, 85))

        if object_type in ("material", "production_planning", "mm_purchasing"):
            mappings.append((_DESC_COLS, material_description, 80))
            mappings.append((_UOM_COLS, sap_uom, 85))

        # ECC operations — UOM for quantities
        if object_type in ("plant_maintenance", "asset_accounting",
                           "sd_sales_orders"):
            mappings.append((_UOM_COLS, sap_uom, 85))

        # SuccessFactors — names and phones
        if object_type in ("employee_central", "recruiting_onboarding"):
            mappings.append((_NAME_COLS, lambda v: title_case(v), 75))

        # Warehouse — UOM standardisation
        if object_type in ("ewms_stock", "ewms_transfer_orders",
                           "batch_management", "transport_management",
                           "fleet_management"):
            mappings.append((_UOM_COLS, sap_uom, 85))

        for col_candidates, func, confidence in mappings:
            col = _find_col(df, col_candidates)
            if not col:
                continue

            for idx, row in df.iterrows():
                val = row.get(col)
                if pd.isna(val) or not str(val).strip():
                    continue

                original = str(val)
                standardised = func(original)

                if standardised != original:
                    key = _record_key(row, df)
                    results.append({
                        "object_type": object_type,
                        "status": "detected",
                        "record_key": key,
                        "record_data_before": {col: original},
                        "record_data_after": {col: standardised},
                        "confidence": confidence,
                        "rule_id": None,
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "priority": 40,
                        "merge_preview": None,
                        "category": "standardisation",
                    })

        return results

    def detect_enrichment_gaps(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Category 3: Flag missing fields that should be populated."""
        results: list[dict] = []

        # Define checks per object type: (column_candidates, confidence, default_value_or_None)
        checks: list[tuple[list[str], int, str | None]] = []

        if object_type in ("business_partner", "customer", "vendor"):
            checks = [
                (_PAYMENT_COLS, 80, None),
                (_CURRENCY_COLS, 90, "ZAR"),
                (_COUNTRY_COLS, 85, "ZA"),
            ]
        elif object_type == "material":
            checks = [
                (_BASE_UNIT_COLS, 95, None),
                (_MATERIAL_GROUP_COLS, 70, None),
            ]
        # ECC Finance
        elif object_type == "fi_gl":
            checks = [
                (_CURRENCY_COLS, 90, "ZAR"),
                (_DESC_COLS, 60, None),
            ]
        elif object_type in ("accounts_payable", "accounts_receivable"):
            checks = [
                (_PAYMENT_COLS, 80, None),
                (_CURRENCY_COLS, 90, "ZAR"),
                (_COUNTRY_COLS, 85, "ZA"),
                (_EMAIL_COLS, 70, None),
            ]
        # ECC Operations
        elif object_type in ("plant_maintenance", "asset_accounting"):
            checks = [(_DESC_COLS, 70, None)]
        elif object_type in ("production_planning", "mm_purchasing"):
            checks = [(_UOM_COLS, 85, None)]
        elif object_type == "sd_customer_master":
            checks = [
                (_PAYMENT_COLS, 80, None),
                (_COUNTRY_COLS, 85, "ZA"),
            ]
        elif object_type == "sd_sales_orders":
            checks = [(_UOM_COLS, 80, None)]
        # SuccessFactors
        elif object_type == "employee_central":
            checks = [
                (_EMAIL_COLS, 80, None),
                (_PHONE_COLS, 70, None),
                (_COUNTRY_COLS, 85, "ZA"),
            ]
        elif object_type in ("compensation", "payroll_integration"):
            checks = [(_CURRENCY_COLS, 95, "ZAR")]
        elif object_type == "benefits":
            checks = [(_ACTIVITY_COLS, 70, None)]
        elif object_type == "recruiting_onboarding":
            checks = [
                (_EMAIL_COLS, 85, None),
                (_PHONE_COLS, 70, None),
            ]
        elif object_type == "time_attendance":
            checks = [(_STATUS_COLS, 75, None)]
        # Warehouse
        elif object_type in ("ewms_stock", "ewms_transfer_orders"):
            checks = [(_UOM_COLS, 85, None)]
        elif object_type == "batch_management":
            checks = [(_ACTIVITY_COLS, 80, None)]
        elif object_type == "fleet_management":
            checks = [(_ACTIVITY_COLS, 75, None), (_DESC_COLS, 60, None)]
        elif object_type == "transport_management":
            checks = [(_COUNTRY_COLS, 85, None)]
        # Catch-all for remaining modules
        else:
            checks = [
                (_COUNTRY_COLS, 85, "ZA"),
                (_CURRENCY_COLS, 90, "ZAR"),
                (_DESC_COLS, 50, None),
            ]

        for col_candidates, confidence, default_value in checks:
            col = _find_col(df, col_candidates)
            if not col:
                continue

            for idx, row in df.iterrows():
                val = row.get(col)
                if pd.isna(val) or str(val).strip() == "":
                    key = _record_key(row, df)
                    after = {col: default_value} if default_value else {}
                    results.append({
                        "object_type": object_type,
                        "status": "detected",
                        "record_key": key,
                        "record_data_before": {col: None},
                        "record_data_after": after,
                        "confidence": confidence,
                        "rule_id": None,
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "priority": 30,
                        "merge_preview": None,
                        "category": "enrichment",
                    })

        return results

    def detect_validation_errors(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Category 4: SA-specific validation checks."""
        results: list[dict] = []

        # SA ID validation
        id_col = _find_col(df, _ID_COLS)
        if id_col:
            for idx, row in df.iterrows():
                val = row.get(id_col)
                if pd.isna(val) or not str(val).strip():
                    continue
                check = validate_sa_id(str(val).strip())
                if not check["valid"]:
                    key = _record_key(row, df)
                    results.append({
                        "object_type": object_type,
                        "status": "detected",
                        "record_key": key,
                        "record_data_before": {id_col: str(val), "error": check["error"]},
                        "record_data_after": {},
                        "confidence": 95,
                        "rule_id": None,
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "priority": 60,
                        "merge_preview": None,
                        "category": "validation",
                    })

        # SA VAT validation (10 digits starting with 4)
        vat_col = _find_col(df, _VAT_COLS)
        if vat_col:
            for idx, row in df.iterrows():
                val = row.get(vat_col)
                if pd.isna(val) or not str(val).strip():
                    continue
                vat_str = str(val).strip()
                import re
                if not re.match(r"^4\d{9}$", vat_str):
                    key = _record_key(row, df)
                    results.append({
                        "object_type": object_type,
                        "status": "detected",
                        "record_key": key,
                        "record_data_before": {vat_col: vat_str, "error": "must be 10 digits starting with 4"},
                        "record_data_after": {},
                        "confidence": 90,
                        "rule_id": None,
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "priority": 55,
                        "merge_preview": None,
                        "category": "validation",
                    })

        # Bank branch validation
        branch_col = _find_col(df, _BRANCH_COLS)
        if branch_col:
            for idx, row in df.iterrows():
                val = row.get(branch_col)
                if pd.isna(val) or not str(val).strip():
                    continue
                check = validate_sa_bank_branch(str(val).strip())
                if not check["valid"]:
                    key = _record_key(row, df)
                    results.append({
                        "object_type": object_type,
                        "status": "detected",
                        "record_key": key,
                        "record_data_before": {branch_col: str(val)},
                        "record_data_after": {},
                        "confidence": 85,
                        "rule_id": None,
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "priority": 45,
                        "merge_preview": None,
                        "category": "validation",
                    })

        # Numeric validation — zero/negative stock quantities, zero prices on active materials
        stock_col = _find_col(df, _STOCK_COLS)
        if stock_col:
            for idx, row in df.iterrows():
                val = row.get(stock_col)
                if pd.isna(val):
                    continue
                try:
                    num = float(val)
                    if num <= 0:
                        key = _record_key(row, df)
                        results.append({
                            "object_type": object_type,
                            "status": "detected",
                            "record_key": key,
                            "record_data_before": {stock_col: str(val), "issue": "zero or negative stock"},
                            "record_data_after": {},
                            "confidence": 80,
                            "rule_id": None,
                            "version_id": version_id,
                            "tenant_id": tenant_id,
                            "priority": 40,
                            "merge_preview": None,
                            "category": "validation",
                        })
                except (ValueError, TypeError):
                    pass

        # Currency code validation — applies to all modules with a currency field
        currency_col = _find_col(df, _CURRENCY_COLS)
        if currency_col:
            valid_currencies = {"ZAR", "USD", "EUR", "GBP", "AUD", "CAD", "CHF", "JPY", "CNY",
                                "BWP", "NAD", "ZMW", "KES", "NGN", "MZN", "INR", "BRL"}
            for idx, row in df.iterrows():
                val = row.get(currency_col)
                if pd.isna(val) or not str(val).strip():
                    continue
                currency_str = str(val).strip().upper()
                if currency_str not in valid_currencies:
                    key = _record_key(row, df)
                    results.append({
                        "object_type": object_type,
                        "status": "detected",
                        "record_key": key,
                        "record_data_before": {currency_col: currency_str, "error": "unknown currency code"},
                        "record_data_after": {},
                        "confidence": 85,
                        "rule_id": None,
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "priority": 50,
                        "merge_preview": None,
                        "category": "validation",
                    })

        # Negative amount validation — runs for any module with an amount column
        amount_col = _find_col(df, _AMOUNT_COLS)
        if amount_col:
            for idx, row in df.iterrows():
                val = row.get(amount_col)
                if pd.isna(val):
                    continue
                try:
                    num = float(val)
                    if num < 0:
                        key = _record_key(row, df)
                        results.append({
                            "object_type": object_type,
                            "status": "detected",
                            "record_key": key,
                            "record_data_before": {amount_col: str(val), "issue": "negative amount"},
                            "record_data_after": {},
                            "confidence": 80,
                            "rule_id": None,
                            "version_id": version_id,
                            "tenant_id": tenant_id,
                            "priority": 45,
                            "merge_preview": None,
                            "category": "validation",
                        })
                except (ValueError, TypeError):
                    pass

        price_col = _find_col(df, _PRICE_COLS)
        if price_col and object_type == "material":
            status_col = _find_col(df, _STATUS_COLS)
            for idx, row in df.iterrows():
                val = row.get(price_col)
                if pd.isna(val):
                    continue
                try:
                    num = float(val)
                    if num == 0:
                        # Check if material is active (no block status)
                        is_active = True
                        if status_col:
                            s = row.get(status_col)
                            if pd.notna(s) and str(s).strip().lower() in ("blocked", "x", "1"):
                                is_active = False
                        if is_active:
                            key = _record_key(row, df)
                            results.append({
                                "object_type": object_type,
                                "status": "detected",
                                "record_key": key,
                                "record_data_before": {price_col: str(val), "issue": "zero price on active material"},
                                "record_data_after": {},
                                "confidence": 80,
                                "rule_id": None,
                                "version_id": version_id,
                                "tenant_id": tenant_id,
                                "priority": 40,
                                "merge_preview": None,
                                "category": "validation",
                            })
                except (ValueError, TypeError):
                    pass

        return results

    def detect_lifecycle_issues(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Category 5: Activity-based lifecycle issues."""
        results: list[dict] = []
        now = datetime.now(timezone.utc)

        # Dormant records — last activity > 24 months ago
        activity_col = _find_col(df, _ACTIVITY_COLS)
        if activity_col:
            for idx, row in df.iterrows():
                val = row.get(activity_col)
                if pd.isna(val):
                    continue
                try:
                    dt = pd.to_datetime(val, utc=True)
                    months_ago = (now - dt).days / 30.44
                    if months_ago > 24:
                        key = _record_key(row, df)
                        results.append({
                            "object_type": object_type,
                            "status": "detected",
                            "record_key": key,
                            "record_data_before": {activity_col: str(val), "issue": "dormant", "months_inactive": round(months_ago)},
                            "record_data_after": {"suggested_action": "review for block"},
                            "confidence": 70,
                            "rule_id": None,
                            "version_id": version_id,
                            "tenant_id": tenant_id,
                            "priority": 20,
                            "merge_preview": None,
                            "category": "lifecycle",
                        })
                except Exception:
                    pass

        # Archival candidates — status=blocked > 12 months
        status_col = _find_col(df, _STATUS_COLS)
        if status_col and activity_col:
            for idx, row in df.iterrows():
                s = row.get(status_col)
                if pd.isna(s) or str(s).strip().lower() not in ("blocked", "x", "1"):
                    continue
                val = row.get(activity_col)
                if pd.isna(val):
                    continue
                try:
                    dt = pd.to_datetime(val, utc=True)
                    months_ago = (now - dt).days / 30.44
                    if months_ago > 12:
                        key = _record_key(row, df)
                        results.append({
                            "object_type": object_type,
                            "status": "detected",
                            "record_key": key,
                            "record_data_before": {status_col: str(s), activity_col: str(val), "issue": "archival candidate"},
                            "record_data_after": {"suggested_action": "archive"},
                            "confidence": 65,
                            "rule_id": None,
                            "version_id": version_id,
                            "tenant_id": tenant_id,
                            "priority": 15,
                            "merge_preview": None,
                            "category": "lifecycle",
                        })
                except Exception:
                    pass

        # Access risk — terminated employees with active status
        if object_type in ("employee", "employee_central"):
            term_col = _find_col(df, _TERMINATION_COLS)
            emp_status_col = _find_col(df, _STATUS_COLS)
            if term_col and emp_status_col:
                for idx, row in df.iterrows():
                    term_val = row.get(term_col)
                    status_val = row.get(emp_status_col)
                    if pd.isna(term_val) or pd.isna(status_val):
                        continue
                    try:
                        term_dt = pd.to_datetime(term_val, utc=True)
                        if term_dt < now and str(status_val).strip().upper() == "A":
                            key = _record_key(row, df)
                            results.append({
                                "object_type": object_type,
                                "status": "detected",
                                "record_key": key,
                                "record_data_before": {
                                    term_col: str(term_val),
                                    emp_status_col: str(status_val),
                                    "issue": "access risk — terminated but active",
                                },
                                "record_data_after": {emp_status_col: "I", "suggested_action": "deactivate"},
                                "confidence": 95,
                                "rule_id": None,
                                "version_id": version_id,
                                "tenant_id": tenant_id,
                                "priority": 90,
                                "merge_preview": None,
                                "category": "lifecycle",
                            })
                    except Exception:
                        pass

        return results
