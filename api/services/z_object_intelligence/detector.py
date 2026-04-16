"""Z-Detector engine.

Scans uploaded SAP data records for Z/Y namespace objects:
- Z/Y config values in known SAP config fields (BLART, BWART, BSART, etc.)
- ZZ*/ZZ_* append structure fields (custom column names)
- Z table uploads (majority non-standard columns)
- Custom number ranges (90-99 prefix in BELNR)
- Custom org values (Z/Y prefix in BUKRS, WERKS, VKORG, etc.)
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Optional

from api.models.z_object_intelligence import (
    ZDetectedObject,
    ZDetectionResult,
    ZObjectCategory,
)


class ZDetector:
    """Detect all Z/Y namespace objects in SAP transactional data."""

    # SAP config fields where Z/Y values indicate custom configuration.
    # Maps field_name -> default module.
    CONFIG_FIELDS: dict[str, str] = {
        "BLART": "FI",      # Document Type
        "BSCHL": "FI",      # Posting Key (>70 or Z*)
        "BWART": "MM",      # Movement Type
        "BSART": "MM",      # PO Document Type
        "MTART": "MM",      # Material Type
        "AUART": "SD",      # Sales/PM/PP/CO Order Type (context-dependent)
        "FKART": "SD",      # Billing Type
        "LFART": "SD",      # Delivery Type
        "PSTYV": "SD",      # Item Category
        "KSCHL": "SD",      # Condition Type
        "QMART": "PM",      # Notification Type
        "ART": "QM",        # Inspection Type
        "MESTYP": "INT",    # IDoc Message Type
    }

    # Org unit fields where Z/Y prefix indicates custom org values.
    ORG_FIELDS: dict[str, str] = {
        "BUKRS": "FI",      # Company Code
        "WERKS": "MM",      # Plant
        "VKORG": "SD",      # Sales Organization
        "EKORG": "MM",      # Purchasing Organization
        "VSTEL": "SD",      # Shipping Point
    }

    # Known standard SAP field names — used to distinguish custom columns.
    KNOWN_SAP_FIELDS: frozenset[str] = frozenset({
        # FI
        "BUKRS", "BLART", "BSCHL", "HKONT", "KOSTL", "PRCTR", "MWSKZ", "ZLSCH",
        "WAERS", "VBUND", "AUFNR", "HBKID", "BELNR", "MONAT", "GJAHR", "XBLNR",
        "BUDAT", "BLDAT", "CPUDT", "USNAM", "BSTAT", "AWTYP", "AUGBL", "AUGDT",
        "SAKNR", "KUNNR", "LIFNR", "KOART", "SHKZG", "DMBTR", "WRBTR", "ZUONR",
        "SGTXT", "KOKRS",
        # MM
        "WERKS", "LGORT", "EKORG", "BSART", "MTART", "DISMM", "DISLS", "BESCHP",
        "BKLAS", "BWART", "EKGRP", "VPRSV", "FRGKE", "MEINS", "MATNR", "MAKTX",
        "MATKL", "EBELN", "EBELP", "BANFN", "RSNUM", "LFDAT", "EINDT",
        # SD
        "VKORG", "VTWEG", "SPART", "AUART", "PSTYV", "KSCHL", "VSTEL", "LFART",
        "FKART", "ROUTE", "INCO1", "KTOKD", "PARVW", "KKBER", "VBELN", "POSNR",
        "NETWR", "KWMENG",
        # PM
        "SWERK", "EQTYP", "INGRP", "QMART", "PRIOK", "FLTYP", "STRAT", "EQUNR",
        "TPLNR", "QMNUM", "AUTYP",
        # PP
        "PLNTY", "STLAN", "VERWE", "DISPO", "GAMNG", "PLNUM", "AFKO",
        # Integration
        "IDOCTP", "MESTYP", "SNDPRN", "RCVPRN", "DIRECT", "STATUS",
        # HR
        "PERNR", "PERSG", "PERSK", "ABKRS", "ORGEH", "PLANS", "MASSN", "SUBTY",
        "AWART", "TRFAR",
        # General / audit
        "ERDAT", "ERNAM", "AEDAT", "AENAM", "LOEKZ", "STATU", "STAT",
        "MANDT", "SPRAS", "LAND1", "REGIO", "ORT01", "PSTLZ", "STRAS",
        "TELF1", "ADRNR", "ANRED", "NAME1", "NAME2", "NAME3", "NAME4",
        "KTOKK", "LOEVM", "SPERR", "SPERM", "BEGRU",
    })

    # -----------------------------------------------------------------------
    # Public API
    # -----------------------------------------------------------------------

    def detect(self, records: list[dict]) -> ZDetectionResult:
        """Scan all records for Z/Y namespace objects."""
        if not records:
            return ZDetectionResult(
                detected_objects=[],
                z_config_values=[],
                z_fields=[],
                z_tables=[],
                custom_number_ranges=[],
                total_z_objects=0,
            )

        all_detected: list[ZDetectedObject] = []

        # 1. Z/Y config values in known config fields
        all_detected.extend(self._detect_z_config_values(records))

        # 2. Z/Y field names (column headers)
        all_detected.extend(self._detect_z_fields(records))

        # 3. Entire upload is a Z table
        all_detected.extend(self._detect_z_table(records))

        # 4. Custom number ranges
        all_detected.extend(self._detect_custom_number_ranges(records))

        # 5. Custom org values
        all_detected.extend(self._detect_custom_org_values(records))

        # Deduplicate by (category, module, object_name, source_field)
        seen: set[tuple[str, str, str, str]] = set()
        deduped: list[ZDetectedObject] = []
        for obj in all_detected:
            key = (obj.category.value, obj.module, obj.object_name, obj.source_field)
            if key not in seen:
                seen.add(key)
                deduped.append(obj)
        all_detected = deduped

        # Build subsets
        z_config = [d for d in all_detected if d.category == ZObjectCategory.CONFIG_VALUE]
        z_fields = [d for d in all_detected if d.category == ZObjectCategory.FIELD]
        z_tables = [d for d in all_detected if d.category == ZObjectCategory.TABLE]
        z_numranges = [d for d in all_detected if d.detection_reason.startswith("Custom number range")]

        modules = sorted({d.module for d in all_detected})

        return ZDetectionResult(
            detected_objects=all_detected,
            z_config_values=z_config,
            z_fields=z_fields,
            z_tables=z_tables,
            custom_number_ranges=z_numranges,
            total_z_objects=len(all_detected),
            modules_affected=modules,
        )

    # -----------------------------------------------------------------------
    # Detection methods
    # -----------------------------------------------------------------------

    def _detect_z_config_values(self, records: list[dict]) -> list[ZDetectedObject]:
        """Detect Z/Y config values in known SAP config fields."""
        detected: list[ZDetectedObject] = []

        for config_field, default_module in self.CONFIG_FIELDS.items():
            # Case-insensitive field lookup
            actual_key = self._find_field_key(records[0], config_field)
            if actual_key is None:
                continue

            # Count distinct values
            value_counts: Counter[str] = Counter()
            for rec in records:
                val = rec.get(actual_key)
                if val is not None and str(val).strip():
                    value_counts[str(val).strip()] += 1

            for value, count in value_counts.items():
                upper_val = value.upper()
                reason: Optional[str] = None

                # Z/Y prefix
                if upper_val.startswith("Z") or upper_val.startswith("Y"):
                    reason = f"Z/Y-prefix config value in {config_field}"

                # BSCHL: posting keys > 70 are custom
                elif config_field == "BSCHL":
                    try:
                        if int(value) > 70:
                            reason = f"Custom posting key (>{70}) in {config_field}"
                    except (ValueError, TypeError):
                        pass

                # BWART: 900-999 range is custom
                elif config_field == "BWART":
                    try:
                        if 900 <= int(value) <= 999:
                            reason = f"Custom movement type (900-999 range) in {config_field}"
                    except (ValueError, TypeError):
                        pass

                # Namespace objects (e.g. /BEV1/61)
                if reason is None and upper_val.startswith("/"):
                    reason = f"Namespace object in {config_field}"

                if reason is None:
                    continue

                # Infer module for AUART based on context
                module = default_module
                if config_field == "AUART":
                    module = self._infer_auart_module(records)

                detected.append(ZDetectedObject(
                    category=ZObjectCategory.CONFIG_VALUE,
                    module=module,
                    object_name=value,
                    source_field=config_field,
                    transaction_count=count,
                    detection_reason=reason,
                ))

        return detected

    def _detect_z_fields(self, records: list[dict]) -> list[ZDetectedObject]:
        """Detect Z/Y custom field names in column headers."""
        if not records:
            return []

        detected: list[ZDetectedObject] = []
        columns = list(records[0].keys())

        for col in columns:
            upper_col = col.upper()
            reason: Optional[str] = None

            # ZZ prefix — append structure field
            if upper_col.startswith("ZZ"):
                reason = "ZZ-prefix append structure field"
            # Z[A-Z]_ pattern — alternate Z naming
            elif re.match(r"^Z[A-Z]_", upper_col):
                reason = "Z-prefix custom field (Z[A-Z]_ pattern)"
            # /Z namespace field
            elif upper_col.startswith("/Z"):
                reason = "Partner namespace field (/Z prefix)"

            if reason is None:
                continue

            # Count non-null values
            non_null = sum(1 for rec in records if rec.get(col) is not None and str(rec.get(col)).strip())

            detected.append(ZDetectedObject(
                category=ZObjectCategory.FIELD,
                module="CROSS",
                object_name=col,
                source_field=col,
                transaction_count=non_null,
                detection_reason=reason,
            ))

        # Also detect potential custom fields: not in KNOWN_SAP_FIELDS, not Z-pattern,
        # but with cardinality > 10 and consistent format
        for col in columns:
            upper_col = col.upper()
            if upper_col in self.KNOWN_SAP_FIELDS:
                continue
            if upper_col.startswith("ZZ") or re.match(r"^Z[A-Z]_", upper_col) or upper_col.startswith("/Z"):
                continue  # already detected above

            values = [str(rec.get(col, "")).strip() for rec in records if rec.get(col) is not None and str(rec.get(col)).strip()]
            if len(set(values)) > 10:
                detected.append(ZDetectedObject(
                    category=ZObjectCategory.FIELD,
                    module="CROSS",
                    object_name=col,
                    source_field=col,
                    transaction_count=len(values),
                    detection_reason="Potential custom field — not in SAP standard field set",
                ))

        return detected

    def _detect_z_table(self, records: list[dict]) -> list[ZDetectedObject]:
        """Detect if the entire upload is a Z table (majority non-standard columns)."""
        if not records:
            return []

        columns = list(records[0].keys())
        if not columns:
            return []

        non_standard = sum(
            1 for col in columns
            if col.upper() not in self.KNOWN_SAP_FIELDS
            and not col.upper().startswith("ZZ")
            and not re.match(r"^Z[A-Z]_", col.upper())
        )

        ratio = non_standard / len(columns)
        if ratio > 0.70:
            return [ZDetectedObject(
                category=ZObjectCategory.TABLE,
                module="CROSS",
                object_name="unknown_z_table",
                source_field="*",
                transaction_count=len(records),
                detection_reason=f"Z table upload — {non_standard}/{len(columns)} columns ({ratio:.0%}) are non-standard",
            )]

        return []

    def _detect_custom_number_ranges(self, records: list[dict]) -> list[ZDetectedObject]:
        """Detect custom number ranges (90-99 prefix in BELNR)."""
        belnr_key = self._find_field_key(records[0], "BELNR") if records else None
        if belnr_key is None:
            return []

        detected: list[ZDetectedObject] = []
        prefix_counts: Counter[str] = Counter()

        for rec in records:
            val = rec.get(belnr_key)
            if val is not None and str(val).strip():
                s = str(val).strip()
                if len(s) >= 2:
                    prefix = s[:2]
                    try:
                        if 90 <= int(prefix) <= 99:
                            prefix_counts[prefix] += 1
                    except (ValueError, TypeError):
                        pass

        for prefix, count in prefix_counts.items():
            detected.append(ZDetectedObject(
                category=ZObjectCategory.CONFIG_VALUE,
                module="FI",
                object_name=f"NR_{prefix}xx",
                source_field="BELNR",
                transaction_count=count,
                detection_reason=f"Custom number range interval ({prefix}xx)",
            ))

        return detected

    def _detect_custom_org_values(self, records: list[dict]) -> list[ZDetectedObject]:
        """Detect custom org values (Z/Y prefix in BUKRS, WERKS, VKORG, etc.)."""
        if not records:
            return []

        detected: list[ZDetectedObject] = []

        for org_field, module in self.ORG_FIELDS.items():
            actual_key = self._find_field_key(records[0], org_field)
            if actual_key is None:
                continue

            value_counts: Counter[str] = Counter()
            for rec in records:
                val = rec.get(actual_key)
                if val is not None and str(val).strip():
                    value_counts[str(val).strip()] += 1

            for value, count in value_counts.items():
                upper_val = value.upper()
                if upper_val.startswith("Z") or upper_val.startswith("Y"):
                    detected.append(ZDetectedObject(
                        category=ZObjectCategory.CONFIG_VALUE,
                        module=module,
                        object_name=value,
                        source_field=org_field,
                        transaction_count=count,
                        detection_reason=f"Custom org value (Z/Y prefix) in {org_field}",
                    ))

        return detected

    # -----------------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------------

    @staticmethod
    def _find_field_key(record: dict, field_name: str) -> Optional[str]:
        """Case-insensitive field lookup in a record dict."""
        upper = field_name.upper()
        for key in record:
            if key.upper() == upper:
                return key
        return None

    @staticmethod
    def _infer_auart_module(records: list[dict]) -> str:
        """Infer module for AUART based on context fields in the data."""
        sample = records[:100]
        for rec in sample:
            # Check AUTYP field
            for key in rec:
                if key.upper() == "AUTYP":
                    val = str(rec[key]).strip()
                    if val == "30":
                        return "PM"
                    if val == "10":
                        return "PP"

            # Check for PP indicator (GAMNG)
            for key in rec:
                if key.upper() == "GAMNG":
                    return "PP"

            # Check for SD indicator (VKORG)
            for key in rec:
                if key.upper() == "VKORG":
                    return "SD"

        return "CO"  # default: internal orders
