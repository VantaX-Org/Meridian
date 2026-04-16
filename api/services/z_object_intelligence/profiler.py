"""Z-Profiler engine.

Statistically profiles every detected Z object:
- Data type inference (numeric, text, date, boolean, code, reference)
- Cardinality, null rate, value distribution, length statistics
- Format pattern detection via regex inference
- Relationship inference via set intersection with standard SAP fields
- Standard equivalent mapping (ZKR->KR, Z61->261, ZOR->OR, etc.)
- User count and temporal analysis
"""

from __future__ import annotations

import hashlib
import re
import statistics
from collections import Counter
from typing import Optional

from api.models.z_object_intelligence import (
    ZDataType,
    ZDetectedObject,
    ZObjectCategory,
    ZObjectProfile,
    TrendDirection,
)

# Date patterns commonly found in SAP data
_DATE_PATTERNS = [
    re.compile(r"^\d{4}-\d{2}-\d{2}$"),       # YYYY-MM-DD
    re.compile(r"^\d{8}$"),                      # YYYYMMDD
    re.compile(r"^\d{2}\.\d{2}\.\d{4}$"),       # DD.MM.YYYY
]

_BOOLEAN_VALUES = frozenset({"X", "", "Y", "N", "TRUE", "FALSE", "0", "1"})


class ZProfiler:
    """Statistically profile detected Z objects."""

    # Known SAP fields for relationship inference (mirrors ZDetector set)
    KNOWN_SAP_FIELDS: frozenset[str] = frozenset({
        "BUKRS", "BLART", "BSCHL", "HKONT", "KOSTL", "PRCTR", "MWSKZ", "ZLSCH",
        "WAERS", "VBUND", "AUFNR", "HBKID", "BELNR", "MONAT", "GJAHR", "XBLNR",
        "BUDAT", "BLDAT", "CPUDT", "USNAM", "BSTAT", "AWTYP", "AUGBL", "AUGDT",
        "SAKNR", "KUNNR", "LIFNR", "KOART", "SHKZG", "DMBTR", "WRBTR", "ZUONR",
        "SGTXT", "KOKRS", "WERKS", "LGORT", "EKORG", "BSART", "MTART", "DISMM",
        "DISLS", "BESCHP", "BKLAS", "BWART", "EKGRP", "VPRSV", "FRGKE", "MEINS",
        "MATNR", "MAKTX", "MATKL", "EBELN", "EBELP", "BANFN", "RSNUM", "LFDAT",
        "EINDT", "VKORG", "VTWEG", "SPART", "AUART", "PSTYV", "KSCHL", "VSTEL",
        "LFART", "FKART", "ROUTE", "INCO1", "KTOKD", "PARVW", "KKBER", "VBELN",
        "POSNR", "NETWR", "KWMENG", "SWERK", "EQTYP", "INGRP", "QMART", "PRIOK",
        "FLTYP", "STRAT", "EQUNR", "TPLNR", "QMNUM", "AUTYP", "PLNTY", "STLAN",
        "VERWE", "DISPO", "GAMNG", "PLNUM", "AFKO", "IDOCTP", "MESTYP", "SNDPRN",
        "RCVPRN", "DIRECT", "STATUS", "PERNR", "PERSG", "PERSK", "ABKRS", "ORGEH",
        "PLANS", "MASSN", "SUBTY", "AWART", "TRFAR", "ERDAT", "ERNAM", "AEDAT",
        "AENAM", "LOEKZ", "STATU", "STAT",
    })

    # -----------------------------------------------------------------------
    # Public API
    # -----------------------------------------------------------------------

    def profile_all(
        self,
        detected_objects: list[ZDetectedObject],
        records: list[dict],
    ) -> list[ZObjectProfile]:
        """Profile every detected Z object against the source data."""
        profiles: list[ZObjectProfile] = []
        for z_obj in detected_objects:
            profile = self._profile_object(z_obj, records)
            if profile is not None:
                profiles.append(profile)
        return profiles

    # -----------------------------------------------------------------------
    # Dispatch
    # -----------------------------------------------------------------------

    def _profile_object(
        self,
        z_obj: ZDetectedObject,
        records: list[dict],
    ) -> ZObjectProfile | None:
        """Profile a single Z object."""
        if z_obj.category == ZObjectCategory.CONFIG_VALUE:
            return self._profile_config_value(z_obj, records)
        elif z_obj.category == ZObjectCategory.FIELD:
            return self._profile_field(z_obj, records)
        elif z_obj.category == ZObjectCategory.TABLE:
            return self._profile_table(z_obj, records)
        return None

    # -----------------------------------------------------------------------
    # Config value profiling
    # -----------------------------------------------------------------------

    def _profile_config_value(
        self,
        z_obj: ZDetectedObject,
        records: list[dict],
    ) -> ZObjectProfile:
        """Profile a Z/Y config value (e.g. BLART=ZKR)."""
        source_key = self._find_field_key(records[0], z_obj.source_field)
        matching = [
            rec for rec in records
            if source_key and str(rec.get(source_key, "")).strip() == z_obj.object_name
        ]

        tx_count = len(matching)
        user_count = self._count_users(matching)
        first_seen, last_seen = self._extract_date_range(matching)
        std_equiv = self._infer_standard_equivalent(z_obj.object_name, z_obj.source_field)

        val_len = len(z_obj.object_name)
        return ZObjectProfile(
            object_name=z_obj.object_name,
            data_type=ZDataType.CODE,
            cardinality=1,
            null_rate=0.0,
            value_distribution={z_obj.object_name: tx_count},
            length_stats={"min": val_len, "max": val_len, "avg": val_len, "stddev": 0.0},
            format_pattern=re.escape(z_obj.object_name),
            relationship_score=0.0,
            related_standard_field=None,
            standard_equivalent=std_equiv,
            transaction_count=tx_count,
            user_count=user_count,
            first_seen=first_seen,
            last_seen=last_seen,
            trend_direction=None,
        )

    # -----------------------------------------------------------------------
    # Field profiling
    # -----------------------------------------------------------------------

    def _profile_field(
        self,
        z_obj: ZDetectedObject,
        records: list[dict],
    ) -> ZObjectProfile:
        """Profile a Z/Y custom field (column)."""
        col_key = self._find_field_key(records[0], z_obj.object_name) if records else None

        # Extract all values
        raw_values: list[Optional[str]] = []
        for rec in records:
            val = rec.get(col_key) if col_key else None
            raw_values.append(str(val).strip() if val is not None else None)

        non_null = [v for v in raw_values if v is not None and v != ""]
        total = len(raw_values)
        null_count = total - len(non_null)
        null_rate = (null_count / total * 100) if total > 0 else 0.0

        # Cardinality
        distinct = set(non_null)
        cardinality = len(distinct)

        # Value distribution — top 20
        counter = Counter(non_null)
        value_distribution = dict(counter.most_common(20))

        # Length stats
        lengths = [len(v) for v in non_null]
        length_stats = self._compute_length_stats(lengths)

        # Data type inference
        data_type = self._infer_data_type(non_null, cardinality)

        # Format pattern
        format_pattern = self._infer_format_pattern(non_null)

        # Relationship inference
        relationship_score, related_field = self._infer_relationship(
            z_obj.object_name, distinct, records
        )

        # User count
        user_count = self._count_users(records)

        # Date range
        first_seen, last_seen = self._extract_date_range(records)

        return ZObjectProfile(
            object_name=z_obj.object_name,
            data_type=data_type,
            cardinality=cardinality,
            null_rate=round(null_rate, 2),
            value_distribution=value_distribution,
            length_stats=length_stats,
            format_pattern=format_pattern,
            relationship_score=round(relationship_score, 2),
            related_standard_field=related_field,
            standard_equivalent=None,
            transaction_count=len(non_null),
            user_count=user_count,
            first_seen=first_seen,
            last_seen=last_seen,
            trend_direction=None,
        )

    # -----------------------------------------------------------------------
    # Table profiling
    # -----------------------------------------------------------------------

    def _profile_table(
        self,
        z_obj: ZDetectedObject,
        records: list[dict],
    ) -> ZObjectProfile:
        """Profile an entire Z table upload."""
        columns = list(records[0].keys()) if records else []
        col_null_rates: dict[str, float] = {}
        for col in columns:
            non_null = sum(1 for rec in records if rec.get(col) is not None and str(rec.get(col)).strip())
            col_null_rates[col] = round((1 - non_null / len(records)) * 100, 2) if records else 0.0

        return ZObjectProfile(
            object_name=z_obj.object_name,
            data_type=ZDataType.TEXT,
            cardinality=len(records),
            null_rate=0.0,
            value_distribution=col_null_rates,  # column -> null rate
            length_stats={"columns": len(columns), "rows": len(records)},
            format_pattern=None,
            relationship_score=0.0,
            related_standard_field=None,
            standard_equivalent=None,
            transaction_count=len(records),
            user_count=self._count_users(records),
            first_seen=None,
            last_seen=None,
            trend_direction=None,
        )

    # -----------------------------------------------------------------------
    # Data type inference
    # -----------------------------------------------------------------------

    @staticmethod
    def _infer_data_type(values: list[str], cardinality: int) -> ZDataType:
        """Infer the data type from a set of non-null string values."""
        if not values:
            return ZDataType.TEXT

        sample = values[:200]

        # Boolean check
        if all(v.upper() in _BOOLEAN_VALUES for v in sample):
            return ZDataType.BOOLEAN

        # Numeric check
        if all(_is_numeric(v) for v in sample):
            return ZDataType.NUMERIC

        # Date check
        if all(_is_date(v) for v in sample):
            return ZDataType.DATE

        # Code check: low cardinality + short values
        avg_len = sum(len(v) for v in sample) / len(sample) if sample else 0
        if cardinality < 20 and avg_len < 10:
            return ZDataType.CODE

        return ZDataType.TEXT

    # -----------------------------------------------------------------------
    # Format pattern inference
    # -----------------------------------------------------------------------

    @staticmethod
    def _infer_format_pattern(values: list[str]) -> str | None:
        """Infer a regex format pattern from sample values."""
        if not values:
            return None
        sample = [v for v in values[:50] if v]
        if not sample:
            return None

        # Check common patterns
        if all(re.match(r"^\d+$", v) for v in sample):
            return r"^\d+$"
        if all(re.match(r"^[A-Z]+$", v) for v in sample):
            return r"^[A-Z]+$"
        if all(re.match(r"^[A-Z]{2,4}-\d{3,6}$", v) for v in sample):
            return r"^[A-Z]{2,4}-\d{3,6}$"
        if all(re.match(r"^\d{4}-\d{2}-\d{2}", v) for v in sample):
            return r"^\d{4}-\d{2}-\d{2}$"
        if all(re.match(r"^\d{8}$", v) for v in sample):
            return r"^\d{8}$"

        # Fixed-length pattern: classify each char position
        lengths = {len(v) for v in sample}
        if len(lengths) == 1:
            fixed_len = lengths.pop()
            pattern_chars: list[str] = []
            for i in range(fixed_len):
                chars = {v[i] for v in sample if i < len(v)}
                if all(c.isdigit() for c in chars):
                    pattern_chars.append(r"\d")
                elif all(c.isalpha() for c in chars):
                    pattern_chars.append("[A-Za-z]")
                else:
                    pattern_chars.append(".")
            return "^" + "".join(pattern_chars) + "$"

        return None

    # -----------------------------------------------------------------------
    # Relationship inference
    # -----------------------------------------------------------------------

    def _infer_relationship(
        self,
        z_field_name: str,
        z_values: set[str],
        records: list[dict],
    ) -> tuple[float, Optional[str]]:
        """Infer if a Z field is related to a standard SAP field."""
        if not z_values or not records:
            return 0.0, None

        best_score = 0.0
        best_field: Optional[str] = None

        # Check naming: if Z field name contains a known SAP field name
        upper_z = z_field_name.upper()
        naming_boost_field: Optional[str] = None
        for sap_field in self.KNOWN_SAP_FIELDS:
            if sap_field in upper_z and sap_field != upper_z:
                naming_boost_field = sap_field
                break

        # Value intersection with SAP fields present in the data
        columns = list(records[0].keys()) if records else []
        for col in columns:
            upper_col = col.upper()
            if upper_col not in self.KNOWN_SAP_FIELDS:
                continue

            sap_values: set[str] = set()
            for rec in records:
                val = rec.get(col)
                if val is not None and str(val).strip():
                    sap_values.add(str(val).strip())

            if not sap_values:
                continue

            intersection = len(z_values & sap_values)
            if intersection > 0:
                score = intersection / len(z_values) * 100
                if score > best_score:
                    best_score = score
                    best_field = upper_col

        # Apply naming boost
        if naming_boost_field and best_score < 50:
            best_score = max(best_score, 50.0)
            if best_field is None:
                best_field = naming_boost_field

        return min(best_score, 100.0), best_field

    # -----------------------------------------------------------------------
    # Utility methods
    # -----------------------------------------------------------------------

    @staticmethod
    def _find_field_key(record: dict, field_name: str) -> Optional[str]:
        """Case-insensitive field lookup."""
        upper = field_name.upper()
        for key in record:
            if key.upper() == upper:
                return key
        return None

    @staticmethod
    def _count_users(records: list[dict]) -> int:
        """Count distinct users from USNAM or ERNAM fields."""
        users: set[str] = set()
        for rec in records:
            for key in ("USNAM", "usnam", "Usnam", "ERNAM", "ernam", "Ernam"):
                val = rec.get(key)
                if val is not None and str(val).strip():
                    users.add(str(val).strip())
                    break
        return len(users)

    @staticmethod
    def _extract_date_range(records: list[dict]) -> tuple[Optional[str], Optional[str]]:
        """Extract first_seen / last_seen from date fields."""
        date_fields = ("BUDAT", "ERDAT", "CPUDT", "budat", "erdat", "cpudt")
        dates: list[str] = []
        for rec in records:
            for df in date_fields:
                val = rec.get(df)
                if val is not None and str(val).strip():
                    dates.append(str(val).strip())
                    break
        if not dates:
            return None, None
        dates.sort()
        return dates[0], dates[-1]

    @staticmethod
    def _compute_length_stats(lengths: list[int]) -> dict[str, float]:
        """Compute min, max, avg, stddev of a list of lengths."""
        if not lengths:
            return {"min": 0, "max": 0, "avg": 0, "stddev": 0}
        return {
            "min": min(lengths),
            "max": max(lengths),
            "avg": round(sum(lengths) / len(lengths), 2),
            "stddev": round(statistics.pstdev(lengths), 2) if len(lengths) > 1 else 0.0,
        }

    @staticmethod
    def _infer_standard_equivalent(value: str, source_field: str) -> Optional[str]:
        """Infer the standard SAP equivalent by stripping Z/Y prefix."""
        upper = value.upper()

        # Movement types: Z61 -> 261, Z01 -> 201
        if source_field == "BWART" and re.match(r"^Z\d{2}$", upper):
            return "2" + upper[1:]

        # Generic: strip leading Z or Y
        if upper.startswith("Z") or upper.startswith("Y"):
            candidate = upper[1:]
            if candidate:
                return candidate

        return None

    @staticmethod
    def compute_distribution_hash(distribution: dict[str, int]) -> str:
        """Hash the value distribution for change detection."""
        sorted_items = sorted(distribution.items())
        raw = "|".join(f"{k}:{v}" for k, v in sorted_items)
        return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------

def _is_numeric(value: str) -> bool:
    """Check if a string value is numeric (int or float)."""
    try:
        float(value.replace(",", ""))
        return True
    except (ValueError, TypeError):
        return False


def _is_date(value: str) -> bool:
    """Check if a string matches common SAP date patterns."""
    return any(pat.match(value) for pat in _DATE_PATTERNS)
