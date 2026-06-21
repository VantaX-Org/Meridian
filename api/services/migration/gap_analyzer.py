"""Deterministic source→destination transfer gap analyzer.

Pure Python. Consumes already-extracted/cleaned source records and a *live*
destination SPRO reader, and reports why each record/field cannot load into the
destination. No LLM, no guessing: every required-field and domain decision is
grounded in the destination's own dictionary / live customizing, with provenance
stamped on each finding (see CLAUDE.md).

Structural gaps (field mapping) are computed once per module — they apply to
every record — while value gaps (mandatory-blank, domain, type) are per record.
"""

from __future__ import annotations

import hashlib
import math

from sap.custom_namespace import is_custom_field
from sap.data_dictionary import get_field_metadata, get_key_fields, get_valid_values
from sap.field_status_inference import account_group_field_for
from sap.spro_tables import SPRO_REGISTRY
from api.services.spro_reader import SPROReader
from agents.readiness import compute_readiness_status

from .models import (
    DomainProvenance,
    GapFinding,
    GapSeverity,
    GapType,
    ModuleGapScore,
    SEVERITY_WEIGHT,
    TransferGapResult,
)
from .source_target_map import SourceTargetMap

_NUMERIC_TYPES = {
    "NUMC", "DEC", "CURR", "QUAN", "INT1", "INT2", "INT4",
    "FLTP", "DF16_DEC", "DF34_DEC",
}


def _is_blank(value) -> bool:
    """SAP-blank-aware: None/NaN/empty/whitespace are blank; ``0``/``00000000`` are not."""
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return str(value).strip() == ""


def _record_key(record: dict, dest_key_field: str | None, key_source_field: str | None) -> str:
    """Stable per-record identifier — the source value of the dest key, else a hash."""
    if key_source_field:
        val = record.get(key_source_field)
        if not _is_blank(val):
            return str(val).strip()
    items = sorted((str(k), str(v)) for k, v in record.items())
    return "rec:" + hashlib.sha1(repr(items).encode("utf-8")).hexdigest()[:12]


class TransferGapAnalyzer:
    """Gap-analyse one module's source records against a live destination."""

    def __init__(self, dest_system_type: str, dest_connection_params: dict | None):
        self.dest_system_type = dest_system_type
        self.reader = SPROReader(dest_system_type, dest_connection_params)

    # -- domain resolution -----------------------------------------------------

    def _domain(self, module: str, dest_table: str, dest_field: str):
        """Return (allowed_set | None, DomainProvenance | None) for a dest field."""
        qualified = f"{dest_table}.{dest_field}"
        governed = any(
            qualified in entry.get("governs_fields", [])
            for entry in SPRO_REGISTRY.get(module, [])
        )
        if governed:
            vals = self.reader.get_valid_values(module, qualified)
            if vals:
                return {str(v).strip() for v in vals}, DomainProvenance.LIVE_SPRO
            # governed but no rows read — cannot verify (never fabricate a pass)
            return None, DomainProvenance.UNAVAILABLE
        dv = get_valid_values(dest_table, dest_field)
        if dv:
            return {str(v).strip() for v in dv}, DomainProvenance.DICTIONARY
        if is_custom_field(dest_field):
            return None, DomainProvenance.CUSTOM
        return None, None  # genuinely free-form — no domain finding

    # -- main ------------------------------------------------------------------

    def analyze(
        self,
        module: str,
        source_records: list[dict],
        field_map: SourceTargetMap,
        object_type: str | None = None,
        record_keys: list[str] | None = None,
    ) -> TransferGapResult:
        if module not in SPRO_REGISTRY:
            raise ValueError(
                f"Module '{module}' is not in the SPRO registry — cannot gap-analyse "
                f"against the destination without confirmed config. Available: "
                f"{', '.join(sorted(SPRO_REGISTRY.keys()))}"
            )

        object_type = object_type or module
        # Warm/confirm the live destination config read (raises nothing; cached).
        self.reader.read_config(module)

        # Normalise record keys to upper-case once.
        records = [{str(k).upper(): v for k, v in r.items()} for r in source_records]

        primary_table = field_map.primary_table(module)
        dest_key_field = (get_key_fields(primary_table)[0] if primary_table
                          and get_key_fields(primary_table) else None)
        ag_field = account_group_field_for(primary_table) if primary_table else None

        # Reverse-map dest key / account-group fields back to their source field.
        key_source_field = self._source_for_dest(module, field_map, dest_key_field, records)
        ag_source_field = self._source_for_dest(module, field_map, ag_field, records)

        findings: list[GapFinding] = []
        critical_fields: set[tuple] = set()

        def emit(f: GapFinding):
            findings.append(f)
            if f.severity is GapSeverity.CRITICAL:
                critical_fields.add((f.gap_type, f.dest_field, f.record_key))

        # --- structural (schema-level, once) ---------------------------------
        source_fields = sorted({k for r in records for k in r.keys()})
        schema_blocking = False
        for sfield in source_fields:
            ref = field_map.resolve(module, sfield)
            if ref is None:
                # Unconfirmed field — steward hasn't decided. Custom Z/Y = low.
                sev = GapSeverity.LOW if is_custom_field(sfield) else GapSeverity.MEDIUM
                schema_blocking = schema_blocking or sev is not GapSeverity.LOW
                emit(GapFinding(
                    gap_type=GapType.FIELD_MAPPING, module=module, record_key="(all records)",
                    object_type=object_type, severity=sev, source_field=sfield,
                    reason=f"source field {sfield} is not mapped to a destination field",
                ))
                continue
            if not ref.is_mapped:
                continue  # explicit skip — steward left dest blank on purpose
            # Mapped — does the destination field exist?
            exists = get_field_metadata(ref.dest_table, ref.dest_field) is not None
            if not exists and not is_custom_field(ref.dest_field):
                schema_blocking = True
                emit(GapFinding(
                    gap_type=GapType.FIELD_MAPPING, module=module, record_key="(all records)",
                    object_type=object_type, severity=GapSeverity.CRITICAL, source_field=sfield,
                    dest_table=ref.dest_table, dest_field=ref.dest_field,
                    reason=f"destination field {ref.dest_table}.{ref.dest_field} does not exist — load impossible",
                ))

        # --- account-group sweep (schema-level, once per bad group) -----------
        bad_groups: set[str] = set()
        if ag_field and ag_source_field and primary_table:
            allowed, prov = self._domain(module, primary_table, ag_field)
            if allowed is not None:
                seen = {str(r.get(ag_source_field)).strip() for r in records
                        if not _is_blank(r.get(ag_source_field))}
                for ag in sorted(seen):
                    if ag not in allowed:
                        bad_groups.add(ag)
                        emit(GapFinding(
                            gap_type=GapType.VALUE_DOMAIN, module=module,
                            record_key=f"account_group={ag}", object_type=object_type,
                            severity=GapSeverity.CRITICAL, dest_table=primary_table,
                            dest_field=ag_field, domain_provenance=prov.value,
                            reason=f"account group '{ag}' is not valid in the destination",
                        ))

        # --- per-record value gaps -------------------------------------------
        ready_keys: list[str] = []
        for i, r in enumerate(records):
            rkey = (record_keys[i] if record_keys and i < len(record_keys)
                    else _record_key(r, dest_key_field, key_source_field))
            ag_val = (str(r.get(ag_source_field)).strip()
                      if ag_source_field and not _is_blank(r.get(ag_source_field)) else None)
            in_bad_group = ag_val in bad_groups
            record_gaps = 0

            for sfield, value in r.items():
                ref = field_map.resolve(module, sfield)
                if ref is None or not ref.is_mapped:
                    continue
                if get_field_metadata(ref.dest_table, ref.dest_field) is None and not is_custom_field(ref.dest_field):
                    continue  # structural gap already reported at schema level
                # skip the account-group field here — handled by the sweep
                if ag_field and ref.dest_field and ref.dest_field.upper() == ag_field.upper():
                    continue

                # target_mandatory
                res = self.reader.resolve_field_status_smart(
                    ref.dest_table, ref.dest_field, account_group=ag_val, module=module,
                )
                if res is not None and res.is_required and _is_blank(value):
                    record_gaps += 1
                    emit(GapFinding(
                        gap_type=GapType.TARGET_MANDATORY, module=module, record_key=rkey,
                        object_type=object_type, severity=GapSeverity.CRITICAL,
                        dest_table=ref.dest_table, dest_field=ref.dest_field,
                        status_source=res.source.value, is_grounded=res.is_grounded,
                        reason=f"{ref.dest_table}.{ref.dest_field} is required in the destination but the source value is blank",
                    ))
                    continue

                if _is_blank(value):
                    continue  # nothing more to check on a blank optional field

                # value_domain
                allowed, prov = self._domain(module, ref.dest_table, ref.dest_field)
                if allowed is not None and str(value).strip() not in allowed:
                    record_gaps += 1
                    sev = GapSeverity.HIGH if prov is DomainProvenance.LIVE_SPRO else GapSeverity.MEDIUM
                    emit(GapFinding(
                        gap_type=GapType.VALUE_DOMAIN, module=module, record_key=rkey,
                        object_type=object_type, severity=sev, dest_table=ref.dest_table,
                        dest_field=ref.dest_field, domain_provenance=prov.value,
                        reason=f"value '{str(value).strip()}' is not in the destination's allowed domain for {ref.dest_field}",
                    ))
                    continue
                if allowed is None and prov is DomainProvenance.UNAVAILABLE:
                    record_gaps += 1
                    emit(GapFinding(
                        gap_type=GapType.VALUE_DOMAIN, module=module, record_key=rkey,
                        object_type=object_type, severity=GapSeverity.LOW, dest_table=ref.dest_table,
                        dest_field=ref.dest_field, domain_provenance=prov.value, is_grounded=False,
                        reason=f"{ref.dest_field} is governed but the destination returned no values — not verified",
                    ))

                # type_mismatch (numeric only — no length/format guessing)
                meta = get_field_metadata(ref.dest_table, ref.dest_field) or {}
                if meta.get("data_type") in _NUMERIC_TYPES and any(c.isalpha() for c in str(value)):
                    record_gaps += 1
                    emit(GapFinding(
                        gap_type=GapType.TYPE_MISMATCH, module=module, record_key=rkey,
                        object_type=object_type, severity=GapSeverity.MEDIUM,
                        dest_table=ref.dest_table, dest_field=ref.dest_field,
                        reason=f"value '{str(value).strip()}' is not numeric but {ref.dest_field} is a numeric field",
                    ))

            if record_gaps == 0 and not in_bad_group and not schema_blocking:
                ready_keys.append(rkey)

        score = self._score(module, findings, len(records), field_map.mapped_field_count(module),
                            len(critical_fields))
        return TransferGapResult(
            module=module, object_type=object_type, findings=findings,
            module_score=score, ready_record_keys=ready_keys, total_records=len(records),
        )

    # -- helpers ---------------------------------------------------------------

    def _source_for_dest(self, module, field_map, dest_field, records) -> str | None:
        """Find the source field that maps to *dest_field* (upper-cased)."""
        if not dest_field:
            return None
        target = dest_field.upper()
        for r in records[:1] or [{}]:
            for sfield in r.keys():
                ref = field_map.resolve(module, sfield)
                if ref and ref.dest_field and ref.dest_field.upper() == target:
                    return sfield
        # records may be empty or first record missing the field — scan the map
        for sfield, ref in field_map._by_module.get(module, {}).items():
            if ref.dest_field and ref.dest_field.upper() == target:
                return sfield
        return None

    def _score(self, module, findings, n_records, n_fields, critical_count) -> ModuleGapScore:
        weighted = sum(SEVERITY_WEIGHT[f.severity] for f in findings)
        denom = max(n_records * max(n_fields, 1), 1)
        raw = max(0.0, 100.0 - 100.0 * weighted / denom)

        capped, cap_reason = False, None
        if critical_count >= 2 and raw > 70:
            raw, capped, cap_reason = 70.0, True, f"{critical_count} critical gaps — capped at 70"
        elif critical_count == 1 and raw > 85:
            raw, capped, cap_reason = 85.0, True, "1 critical gap — capped at 85"

        sev = {s: 0 for s in GapSeverity}
        for f in findings:
            sev[f.severity] += 1

        status = compute_readiness_status(raw, critical_count)
        return ModuleGapScore(
            module=module, score=round(raw, 2), status=status, n_records=n_records,
            n_fields_assessed=n_fields, blocking_count=len(findings), critical_count=critical_count,
            high_count=sev[GapSeverity.HIGH], medium_count=sev[GapSeverity.MEDIUM],
            low_count=sev[GapSeverity.LOW], capped=capped, cap_reason=cap_reason,
        )
