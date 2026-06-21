"""Deterministic source→destination gap analyzer.

Pure Python. For one module: read the DESTINATION SAP system's own config +
field rules (via :class:`SPROReader`) and decide, per source record, whether
each cleaned source field is loadable into the destination. No LLM, no raw SAP
values in any finding's ``reason``.
"""

from __future__ import annotations

import hashlib
from typing import Any, Optional

from api.services.migration.models import (
    DomainProvenance,
    GapFinding,
    GapSeverity,
    GapType,
    ModuleGapScore,
    TransferGapResult,
    VerdictStatus,
)
from api.services.migration.source_target_map import SourceTargetMap, TargetFieldRef
from sap.custom_namespace import is_custom_field
from sap.data_dictionary import get_field_metadata, get_valid_values
from sap.field_status_inference import account_group_field_for
from sap.spro_tables import SPRO_REGISTRY

# Numeric/date SAP data types that a free-text string can clearly clash with.
_NUMERIC_TYPES = {"NUMC", "DEC", "CURR", "QUAN", "INT", "INT1", "INT2", "INT4", "FLTP"}
_DATE_TYPES = {"DATS"}


def _is_blank(value: Any) -> bool:
    """SAP-blank-aware. Mirrors ``field_status_inference._filled_mask`` exactly.

    None / NaN / empty / whitespace-only are blank. Numeric ``0`` and ``"0"``
    and ``"00000000"`` are NOT blank — we never guess field-specific sentinels.
    """
    # ponytail: replicates _filled_mask per-value to avoid a pd.Series per cell.
    if value is None:
        return True
    if isinstance(value, float) and value != value:  # NaN
        return True
    return str(value).strip() == ""


def _looks_numeric(value: Any) -> bool:
    try:
        float(str(value).strip())
        return True
    except (ValueError, TypeError):
        return False


def _looks_date(value: Any) -> bool:
    s = str(value).strip()
    # SAP DATS is YYYYMMDD; accept 8 digits or ISO-ish with separators.
    digits = s.replace("-", "").replace("/", "").replace(".", "")
    return digits.isdigit() and len(digits) == 8


class TransferGapAnalyzer:
    """Analyse source records against a live destination's config, per module."""

    def __init__(
        self,
        dest_system_type: str,
        dest_connection_params: Optional[dict[str, Any]] = None,
    ) -> None:
        # Lazy import keeps the engine importable without the heavier reader deps.
        from api.services.spro_reader import SPROReader

        self.dest_system_type = dest_system_type
        self._reader = SPROReader(dest_system_type, dest_connection_params)

    # ------------------------------------------------------------------

    def analyze(
        self,
        module: str,
        source_records: list[dict],
        field_map: SourceTargetMap,
    ) -> TransferGapResult:
        """Gap-analyse one module.

        Args:
            module: SPRO-registry module id (raises if unknown — no fabrication).
            source_records: list of ``{"record_key": str|None, "data": {field: value}}``.
            field_map: source→destination field map for this module.
        """
        if module not in SPRO_REGISTRY:
            raise ValueError(
                f"Module '{module}' is not in the SPRO registry — cannot analyse "
                f"a destination with no known config. Available: "
                f"{', '.join(sorted(SPRO_REGISTRY.keys()))}"
            )

        primary_table = field_map.primary_table(module)
        ag_field = account_group_field_for(primary_table) if primary_table else None
        governed = self._governed_fields(module)

        # Destination's allowed account-group domain (for the sweep).
        ag_qualified = f"{primary_table}.{ag_field}" if (primary_table and ag_field) else None
        ag_allowed: list[str] = (
            self._reader.get_valid_values(module, ag_qualified) if ag_qualified else []
        )

        findings: list[GapFinding] = []
        ready_by_record: dict[str, bool] = {}
        seen_account_groups: set[str] = set()
        n_fields_assessed = 0
        object_type: Optional[str] = None

        for rec in source_records:
            data = rec.get("data") or {}
            if object_type is None:
                object_type = rec.get("object_type")
            record_key = rec.get("record_key") or self._hash_key(data)

            account_group = self._resolve_account_group(
                module, data, field_map, primary_table, ag_field
            )
            if account_group is not None and not _is_blank(account_group):
                seen_account_groups.add(str(account_group))

            record_findings: list[GapFinding] = []
            for source_field, value in data.items():
                ref = field_map.resolve(module, source_field)
                finding = self._assess_field(
                    module=module,
                    object_type=object_type,
                    record_key=record_key,
                    source_field=source_field,
                    value=value,
                    ref=ref,
                    account_group=account_group,
                    ag_field=ag_field,
                    governed=governed,
                )
                if finding is not None:
                    record_findings.append(finding)
                if ref is not None and ref.is_mapped:
                    n_fields_assessed += 1

            findings.extend(record_findings)
            # A record is transfer-ready when none of its findings are blocking.
            ready_by_record[record_key] = not any(
                f.severity_is_blocking for f in record_findings
            )

        # Account-group sweep: any distinct source group absent from the
        # destination's allowed domain blocks every record in it.
        if ag_allowed:
            for grp in sorted(seen_account_groups):
                if grp not in ag_allowed:
                    findings.append(
                        GapFinding(
                            gap_type=GapType.VALUE_DOMAIN,
                            module=module,
                            record_key=f"account_group:{grp}",
                            source_field=ag_field or "account_group",
                            severity=GapSeverity.CRITICAL,
                            severity_is_blocking=True,
                            reason=(
                                f"Account group '{grp}' does not exist in the "
                                f"destination's allowed groups — every record in it "
                                f"will fail to load."
                            ),
                            object_type=object_type,
                            target_ref=ag_qualified,
                            dest_table=primary_table,
                            domain_provenance=DomainProvenance.LIVE_SPRO,
                            account_group=grp,
                            is_grounded=True,
                        )
                    )
                    # Mark every record in this group not transfer-ready.
                    for rec in source_records:
                        data = rec.get("data") or {}
                        rk = rec.get("record_key") or self._hash_key(data)
                        ag = self._resolve_account_group(
                            module, data, field_map, primary_table, ag_field
                        )
                        if ag is not None and str(ag) == grp:
                            ready_by_record[rk] = False

        score = self._score(module, findings, len(source_records), n_fields_assessed)
        return TransferGapResult(
            module=module,
            object_type=object_type,
            findings=findings,
            score=score,
            transfer_ready_by_record=ready_by_record,
        )

    # ------------------------------------------------------------------
    # Per-field assessment
    # ------------------------------------------------------------------

    def _assess_field(
        self,
        *,
        module: str,
        object_type: Optional[str],
        record_key: str,
        source_field: str,
        value: Any,
        ref: Optional[TargetFieldRef],
        account_group: Optional[str],
        ag_field: Optional[str],
        governed: set[str],
    ) -> Optional[GapFinding]:
        # 4a. Unmapped → field will not be carried into the load file.
        if ref is None or not ref.is_mapped:
            sev = GapSeverity.LOW if is_custom_field(source_field) else GapSeverity.MEDIUM
            return GapFinding(
                gap_type=GapType.FIELD_MAPPING,
                module=module,
                record_key=record_key,
                source_field=source_field,
                severity=sev,
                severity_is_blocking=False,
                reason=f"Source field '{source_field}' is not mapped to a destination field.",
                object_type=object_type,
            )

        dest_table = ref.dest_table.upper()
        dest_field = ref.dest_field.upper()
        qualified = f"{dest_table}.{dest_field}"
        meta = get_field_metadata(dest_table, dest_field)

        # 4b. Mapped to a field the destination does not have (and not custom) → load impossible.
        if meta is None and not is_custom_field(dest_field):
            return GapFinding(
                gap_type=GapType.FIELD_MAPPING,
                module=module,
                record_key=record_key,
                source_field=source_field,
                severity=GapSeverity.CRITICAL,
                severity_is_blocking=True,
                reason=f"Mapped destination field '{qualified}' does not exist in the target.",
                object_type=object_type,
                target_ref=qualified,
                dest_table=dest_table,
            )

        blank = _is_blank(value)

        # 5. target_mandatory — destination requires it, source blank.
        if blank:
            resolution = self._reader.resolve_field_status_smart(
                dest_table, dest_field, account_group=account_group, module=module
            )
            if resolution is not None and resolution.is_required:
                return GapFinding(
                    gap_type=GapType.TARGET_MANDATORY,
                    module=module,
                    record_key=record_key,
                    source_field=source_field,
                    severity=GapSeverity.CRITICAL,
                    severity_is_blocking=True,
                    reason=f"Destination requires '{qualified}' but the source value is blank.",
                    object_type=object_type,
                    target_ref=qualified,
                    dest_table=dest_table,
                    status_source=resolution.source.value,
                    account_group=account_group,
                    is_grounded=resolution.is_grounded,
                )
            return None  # blank + not required → nothing to flag

        # The account-group field is handled by the sweep — don't double-flag it.
        if ag_field and dest_field == ag_field.upper():
            return self._type_mismatch(
                module, object_type, record_key, source_field, value, meta, qualified, dest_table
            )

        # 6. value_domain (non-blank values only).
        domain_finding = self._value_domain(
            module=module,
            object_type=object_type,
            record_key=record_key,
            source_field=source_field,
            value=value,
            dest_table=dest_table,
            dest_field=dest_field,
            qualified=qualified,
            governed=governed,
        )
        if domain_finding is not None:
            return domain_finding

        # 7. type_mismatch — clear category clash only.
        return self._type_mismatch(
            module, object_type, record_key, source_field, value, meta, qualified, dest_table
        )

    def _value_domain(
        self,
        *,
        module: str,
        object_type: Optional[str],
        record_key: str,
        source_field: str,
        value: Any,
        dest_table: str,
        dest_field: str,
        qualified: str,
        governed: set[str],
    ) -> Optional[GapFinding]:
        sval = str(value).strip()

        if qualified in governed:
            allowed = self._reader.get_valid_values(module, qualified)
            if allowed:
                if sval not in allowed:
                    return GapFinding(
                        gap_type=GapType.VALUE_DOMAIN,
                        module=module,
                        record_key=record_key,
                        source_field=source_field,
                        severity=GapSeverity.HIGH,
                        severity_is_blocking=False,
                        reason=f"Value not in the destination's live allowed set for '{qualified}'.",
                        object_type=object_type,
                        target_ref=qualified,
                        dest_table=dest_table,
                        domain_provenance=DomainProvenance.LIVE_SPRO,
                        is_grounded=True,
                    )
                return None
            # Governed but no rows came back — cannot verify, don't fabricate a pass.
            return GapFinding(
                gap_type=GapType.VALUE_DOMAIN,
                module=module,
                record_key=record_key,
                source_field=source_field,
                severity=GapSeverity.LOW,
                severity_is_blocking=False,
                reason=f"Destination domain for '{qualified}' is governed but returned no values — not verified.",
                object_type=object_type,
                target_ref=qualified,
                dest_table=dest_table,
                domain_provenance=DomainProvenance.UNAVAILABLE,
                is_grounded=False,
            )

        # Not governed by SPRO → fall back to the data dictionary's enumeration.
        dict_allowed = get_valid_values(dest_table, dest_field)
        if dict_allowed is not None:
            if sval not in [str(v) for v in dict_allowed]:
                return GapFinding(
                    gap_type=GapType.VALUE_DOMAIN,
                    module=module,
                    record_key=record_key,
                    source_field=source_field,
                    severity=GapSeverity.MEDIUM,
                    severity_is_blocking=False,
                    reason=f"Value not in the data-dictionary allowed set for '{qualified}'.",
                    object_type=object_type,
                    target_ref=qualified,
                    dest_table=dest_table,
                    domain_provenance=DomainProvenance.DICTIONARY,
                    is_grounded=False,
                )
            return None

        # Free-form field (dict valid_values None) or custom field — no domain to check.
        return None

    def _type_mismatch(
        self,
        module: str,
        object_type: Optional[str],
        record_key: str,
        source_field: str,
        value: Any,
        meta: Optional[dict],
        qualified: str,
        dest_table: str,
    ) -> Optional[GapFinding]:
        if meta is None:
            return None
        dtype = str(meta.get("data_type", "")).upper()
        if dtype in _NUMERIC_TYPES and not _looks_numeric(value):
            kind = "numeric"
        elif dtype in _DATE_TYPES and not _looks_date(value):
            kind = "date"
        else:
            return None
        return GapFinding(
            gap_type=GapType.TYPE_MISMATCH,
            module=module,
            record_key=record_key,
            source_field=source_field,
            severity=GapSeverity.HIGH,
            severity_is_blocking=False,
            reason=f"Source value is not a valid {kind} for destination '{qualified}' ({dtype}).",
            object_type=object_type,
            target_ref=qualified,
            dest_table=dest_table,
            is_grounded=True,
        )

    # ------------------------------------------------------------------
    # Scoring (mirrors api/services/scoring.py caps + agents/readiness.py status)
    # ------------------------------------------------------------------

    def _score(
        self, module: str, findings: list[GapFinding], n_records: int, n_fields: int
    ) -> ModuleGapScore:
        from agents.readiness import compute_readiness_status

        counts = {s: 0 for s in GapSeverity}
        for f in findings:
            counts[f.severity] += 1
        critical = counts[GapSeverity.CRITICAL]
        high = counts[GapSeverity.HIGH]
        medium = counts[GapSeverity.MEDIUM]
        low = counts[GapSeverity.LOW]
        blocking = sum(1 for f in findings if f.severity_is_blocking)

        weighted_gap = 3 * critical + 2 * high + 1 * medium + 0.5 * low
        denom = max(n_records * max(n_fields, 1), 1)
        raw = max(0.0, 100.0 - 100.0 * weighted_gap / denom)

        capped = False
        cap_reason = None
        if critical >= 2 and raw > 70:
            raw, capped, cap_reason = 70.0, True, f"{critical} critical gaps — capped at 70"
        elif critical == 1 and raw > 85:
            raw, capped, cap_reason = 85.0, True, "1 critical gap — capped at 85"

        status = VerdictStatus(compute_readiness_status(raw, critical))
        return ModuleGapScore(
            module=module,
            score=round(raw, 2),
            status=status,
            n_records=n_records,
            n_fields_assessed=n_fields,
            blocking_count=blocking,
            critical_count=critical,
            high_count=high,
            medium_count=medium,
            low_count=low,
            capped=capped,
            cap_reason=cap_reason,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _governed_fields(module: str) -> set[str]:
        out: set[str] = set()
        for entry in SPRO_REGISTRY.get(module, []):
            for gf in entry.get("governs_fields", []):
                out.add(gf.upper())
        return out

    @staticmethod
    def _resolve_account_group(
        module: str,
        data: dict,
        field_map: SourceTargetMap,
        primary_table: Optional[str],
        ag_field: Optional[str],
    ) -> Optional[str]:
        if not primary_table or not ag_field:
            return None
        target = f"{primary_table}.{ag_field}".upper()
        for source_field, value in data.items():
            ref = field_map.resolve(module, source_field)
            if ref is not None and ref.is_mapped and ref.qualified and ref.qualified.upper() == target:
                return None if _is_blank(value) else str(value)
        return None

    @staticmethod
    def _hash_key(data: dict) -> str:
        payload = "|".join(f"{k}={data[k]}" for k in sorted(data))
        return "rec:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
