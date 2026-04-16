"""Z-Rule Builder: 12 pre-built rule templates for Z-object governance."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Optional

from api.models.z_object_intelligence import (
    ZBaseline,
    ZDetectedObject,
    ZObjectCategory,
    ZObjectProfile,
    ZRuleFinding,
)


@dataclass
class ZRuleTemplate:
    """A pre-built Z-rule template."""

    template_id: str
    name: str
    description: str
    default_severity: str
    applicable_to: str  # 'config_value', 'field', 'table', 'all'
    evaluate: Callable[..., list[ZRuleFinding]]


class ZRuleBuilder:
    """Evaluate Z-rule templates and custom rules against detected Z objects."""

    def __init__(self) -> None:
        self.templates: dict[str, ZRuleTemplate] = {}
        self._register_templates()

    # ------------------------------------------------------------------
    # Template registration
    # ------------------------------------------------------------------

    def _register_templates(self) -> None:
        """Register all 12 pre-built Z-rule templates."""

        self.templates["Z-RULE-001"] = ZRuleTemplate(
            template_id="Z-RULE-001",
            name="Z Doc Type Must Have Number Range",
            description=(
                "Z document type must have a corresponding number range interval "
                "detected from BELNR patterns"
            ),
            default_severity="high",
            applicable_to="config_value",
            evaluate=self._eval_001_number_range,
        )

        self.templates["Z-RULE-002"] = ZRuleTemplate(
            template_id="Z-RULE-002",
            name="Z Movement Type Must Have Account Determination",
            description=(
                "Z movement type must produce correct accounting entries "
                "(compare to mapped standard equivalent)"
            ),
            default_severity="high",
            applicable_to="config_value",
            evaluate=self._eval_002_account_determination,
        )

        self.templates["Z-RULE-003"] = ZRuleTemplate(
            template_id="Z-RULE-003",
            name="Z Order Type Must Have Settlement Rule",
            description=(
                "Z order types (PM/CO/PP) must have settlement parameters configured"
            ),
            default_severity="high",
            applicable_to="config_value",
            evaluate=self._eval_003_settlement_rule,
        )

        self.templates["Z-RULE-004"] = ZRuleTemplate(
            template_id="Z-RULE-004",
            name="Z Field Must Not Exceed Null Rate Threshold",
            description=(
                "Custom ZZ fields should maintain null rate below configurable "
                "threshold (default 20%)"
            ),
            default_severity="medium",
            applicable_to="field",
            evaluate=self._eval_004_null_threshold,
        )

        self.templates["Z-RULE-005"] = ZRuleTemplate(
            template_id="Z-RULE-005",
            name="Z Field Must Maintain Format Consistency",
            description="All values in a Z field must match the detected format pattern",
            default_severity="medium",
            applicable_to="field",
            evaluate=self._eval_005_format_consistency,
        )

        self.templates["Z-RULE-006"] = ZRuleTemplate(
            template_id="Z-RULE-006",
            name="Z Field FK Must Reference Valid Master Data",
            description=(
                "Z field identified as a foreign key must reference existing "
                "records in the inferred master data table"
            ),
            default_severity="high",
            applicable_to="field",
            evaluate=self._eval_006_fk_reference,
        )

        self.templates["Z-RULE-007"] = ZRuleTemplate(
            template_id="Z-RULE-007",
            name="Z Config Value Must Be Documented",
            description=(
                "Z config values should have a description and owner in the "
                "Z-Object Registry"
            ),
            default_severity="low",
            applicable_to="config_value",
            evaluate=self._eval_007_documented,
        )

        self.templates["Z-RULE-008"] = ZRuleTemplate(
            template_id="Z-RULE-008",
            name="Z Config Drift Alert",
            description=(
                "New Z config values appearing for the first time must trigger "
                "a governance notification"
            ),
            default_severity="medium",
            applicable_to="config_value",
            evaluate=self._eval_008_drift_alert,
        )

        self.templates["Z-RULE-009"] = ZRuleTemplate(
            template_id="Z-RULE-009",
            name="Z Table Completeness",
            description=(
                "Z table uploads must maintain field completeness above threshold "
                "per field"
            ),
            default_severity="medium",
            applicable_to="table",
            evaluate=self._eval_009_table_completeness,
        )

        self.templates["Z-RULE-010"] = ZRuleTemplate(
            template_id="Z-RULE-010",
            name="Z Value Lifecycle",
            description=(
                "Z config values with zero usage for > 6 months should be reviewed "
                "for deactivation"
            ),
            default_severity="low",
            applicable_to="config_value",
            evaluate=self._eval_010_lifecycle,
        )

        self.templates["Z-RULE-011"] = ZRuleTemplate(
            template_id="Z-RULE-011",
            name="Z Condition Type Must Be in Pricing Procedure",
            description=(
                "Z pricing conditions must be assigned to at least one active "
                "pricing procedure"
            ),
            default_severity="medium",
            applicable_to="config_value",
            evaluate=self._eval_011_pricing_procedure,
        )

        self.templates["Z-RULE-012"] = ZRuleTemplate(
            template_id="Z-RULE-012",
            name="Z Enhancement Outcome Deviation",
            description=(
                "If a Z config value produces significantly different outcomes "
                "than its standard equivalent, flag for investigation"
            ),
            default_severity="medium",
            applicable_to="config_value",
            evaluate=self._eval_012_enhancement_deviation,
        )

    # ------------------------------------------------------------------
    # Public evaluation API
    # ------------------------------------------------------------------

    def evaluate_all(
        self,
        detected_objects: list[ZDetectedObject],
        profiles: list[ZObjectProfile],
        baselines: dict[str, ZBaseline],
        records: list[dict],
        registry_status: dict[str, dict] | None = None,
    ) -> list[ZRuleFinding]:
        """Evaluate all applicable rule templates against detected Z objects."""
        findings: list[ZRuleFinding] = []
        profile_map = {p.object_name: p for p in profiles}

        for z_obj in detected_objects:
            profile = profile_map.get(z_obj.object_name)
            baseline = baselines.get(z_obj.object_name)
            reg = (registry_status or {}).get(z_obj.object_name, {})

            context: dict[str, Any] = {
                "records": records,
                "registry": reg,
                "all_profiles": profiles,
                "all_detected": detected_objects,
            }

            for template in self.templates.values():
                if self._template_applies(template, z_obj):
                    try:
                        template_findings = template.evaluate(
                            z_obj, profile, baseline, records, context
                        )
                        findings.extend(template_findings)
                    except Exception:
                        # Don't let one rule failure break the entire evaluation
                        pass

        return findings

    @staticmethod
    def _template_applies(
        template: ZRuleTemplate, z_obj: ZDetectedObject
    ) -> bool:
        """Check if a rule template is applicable to a Z object."""
        if template.applicable_to == "all":
            return True
        if (
            template.applicable_to == "config_value"
            and z_obj.category == ZObjectCategory.CONFIG_VALUE
        ):
            return True
        if (
            template.applicable_to == "field"
            and z_obj.category == ZObjectCategory.FIELD
        ):
            return True
        if (
            template.applicable_to == "table"
            and z_obj.category == ZObjectCategory.TABLE
        ):
            return True
        return False

    # ------------------------------------------------------------------
    # Rule evaluation methods
    # ------------------------------------------------------------------

    @staticmethod
    def _find_field(record: dict, field_name: str) -> Any:
        """Case-insensitive field lookup."""
        return (
            record.get(field_name)
            or record.get(field_name.lower())
            or record.get(field_name.upper())
        )

    def _eval_001_number_range(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """Z doc type must have a corresponding number range from BELNR patterns."""
        if z_obj.source_field != "BLART":
            return []
        matching = [
            r
            for r in records
            if self._find_field(r, "BLART") == z_obj.object_name
            and self._find_field(r, "BELNR")
        ]
        if not matching:
            return [
                ZRuleFinding(
                    z_object_name=z_obj.object_name,
                    rule_id="Z-RULE-001",
                    rule_name="Z Doc Type Must Have Number Range",
                    severity="high",
                    title=f"Z doc type {z_obj.object_name} has no document numbers",
                    description=(
                        f"Custom document type {z_obj.object_name} was detected but "
                        f"no BELNR values are associated \u2014 number range may not "
                        f"be configured."
                    ),
                    remediation=(
                        f"Configure a number range interval for document type "
                        f"{z_obj.object_name} in transaction FBN1/SNRO."
                    ),
                )
            ]
        return []

    def _eval_002_account_determination(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """Z movement type must produce correct accounting entries."""
        # TODO: Requires MSEG + BSEG cross-reference data to validate that
        # Z movement types produce GL postings. Needs additional SAP data
        # beyond a single CSV upload.
        if z_obj.source_field != "BWART":
            return []
        matching = [
            r
            for r in records
            if self._find_field(r, "BWART") == z_obj.object_name
            and self._find_field(r, "HKONT")
        ]
        if not matching:
            return [
                ZRuleFinding(
                    z_object_name=z_obj.object_name,
                    rule_id="Z-RULE-002",
                    rule_name="Z Movement Type Must Have Account Determination",
                    severity="high",
                    title=(
                        f"Z movement type {z_obj.object_name} has no GL account "
                        f"postings"
                    ),
                    description=(
                        f"Custom movement type {z_obj.object_name} was detected but "
                        f"no HKONT (GL account) values are associated \u2014 account "
                        f"determination may not be configured."
                    ),
                    remediation=(
                        f"Check account determination for movement type "
                        f"{z_obj.object_name} via OMWN / automatic account assignment."
                    ),
                )
            ]
        return []

    def _eval_003_settlement_rule(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """Z order types must have settlement parameters configured."""
        # TODO: Requires AUFK + COBRB settlement rule data. Only flags when
        # AUART is the source field and no settlement indicators are present.
        if z_obj.source_field != "AUART":
            return []
        # Without settlement data we can only flag as informational
        return []

    def _eval_004_null_threshold(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """Z field null rate must be below 20% threshold."""
        if not profile:
            return []
        threshold = 20.0
        if profile.null_rate > threshold:
            return [
                ZRuleFinding(
                    z_object_name=z_obj.object_name,
                    rule_id="Z-RULE-004",
                    rule_name="Z Field Null Rate Threshold",
                    severity="medium" if profile.null_rate < 50 else "high",
                    title=(
                        f"Z field {z_obj.object_name} has {profile.null_rate:.1f}% "
                        f"null rate (threshold: {threshold}%)"
                    ),
                    description=(
                        f"Custom field {z_obj.object_name} has {profile.null_rate:.1f}% "
                        f"null values. This exceeds the {threshold}% governance "
                        f"threshold, indicating the field may be abandoned or optional "
                        f"data entry has degraded."
                    ),
                    remediation=(
                        f"Review whether {z_obj.object_name} is still required. "
                        f"If required, enforce data entry via field status or "
                        f"validation rule."
                    ),
                )
            ]
        return []

    def _eval_005_format_consistency(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """Z field values must match detected format pattern."""
        if not profile or not profile.format_pattern or profile.cardinality >= 100:
            return []
        violations = 0
        field = z_obj.object_name
        for r in records:
            val = self._find_field(r, field)
            if val is not None and val != "":
                try:
                    if not re.match(profile.format_pattern, str(val)):
                        violations += 1
                except re.error:
                    break
        if violations > 0:
            return [
                ZRuleFinding(
                    z_object_name=z_obj.object_name,
                    rule_id="Z-RULE-005",
                    rule_name="Z Field Format Consistency",
                    severity="medium",
                    title=(
                        f"Z field {z_obj.object_name}: {violations} values violate "
                        f"format pattern '{profile.format_pattern}'"
                    ),
                    description=(
                        f"{violations} records have values that don't match the "
                        f"expected format pattern."
                    ),
                    remediation=(
                        f"Add input validation to enforce format "
                        f"'{profile.format_pattern}' on field {z_obj.object_name}."
                    ),
                    affected_records=[str(violations)],
                )
            ]
        return []

    def _eval_006_fk_reference(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """Z field with high relationship score must reference valid master data."""
        if (
            not profile
            or profile.relationship_score < 80
            or not profile.related_standard_field
        ):
            return []
        z_vals: set[str] = set()
        std_vals: set[str] = set()
        field = z_obj.object_name
        std_field = profile.related_standard_field
        for r in records:
            zv = self._find_field(r, field)
            sv = self._find_field(r, std_field)
            if zv:
                z_vals.add(str(zv))
            if sv:
                std_vals.add(str(sv))
        orphans = z_vals - std_vals
        if orphans:
            examples = ", ".join(list(orphans)[:5])
            return [
                ZRuleFinding(
                    z_object_name=z_obj.object_name,
                    rule_id="Z-RULE-006",
                    rule_name="Z Field FK Reference",
                    severity="high",
                    title=(
                        f"Z field {z_obj.object_name}: {len(orphans)} orphan "
                        f"references to {std_field}"
                    ),
                    description=(
                        f"{len(orphans)} values in {z_obj.object_name} do not exist "
                        f"in {std_field}. Examples: {examples}"
                    ),
                    remediation=(
                        f"Correct orphan references or update master data in "
                        f"{std_field}."
                    ),
                    affected_records=list(orphans)[:20],
                )
            ]
        return []

    def _eval_007_documented(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """Z config values should have description and owner in registry."""
        reg = ctx.get("registry", {})
        if not reg.get("description") or not reg.get("owner"):
            return [
                ZRuleFinding(
                    z_object_name=z_obj.object_name,
                    rule_id="Z-RULE-007",
                    rule_name="Z Config Documentation",
                    severity="low",
                    title=f"Z object {z_obj.object_name} is undocumented",
                    description=(
                        f"Custom object {z_obj.object_name} has no description or "
                        f"owner assigned in the Z-Object Registry. Undocumented Z "
                        f"objects increase governance risk."
                    ),
                    remediation=(
                        f"Assign a description and owner to {z_obj.object_name} "
                        f"in the Z-Object Registry."
                    ),
                )
            ]
        return []

    def _eval_008_drift_alert(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """New Z config values appearing for the first time trigger drift alert."""
        # If no baseline exists, this is the first time we've seen this value
        if baseline is None:
            return [
                ZRuleFinding(
                    z_object_name=z_obj.object_name,
                    rule_id="Z-RULE-008",
                    rule_name="Z Config Drift Alert",
                    severity="medium",
                    title=(
                        f"New Z config value {z_obj.object_name} detected for "
                        f"first time"
                    ),
                    description=(
                        f"Custom config value {z_obj.object_name} in "
                        f"{z_obj.source_field} ({z_obj.module}) was detected for "
                        f"the first time. This may indicate config drift or an "
                        f"unapproved customisation."
                    ),
                    remediation=(
                        f"Review whether {z_obj.object_name} was approved through "
                        f"the change management process. Register it in the "
                        f"Z-Object Registry."
                    ),
                )
            ]
        return []

    def _eval_009_table_completeness(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """Z table uploads must maintain field completeness above threshold."""
        if not profile or not records:
            return []
        threshold = 70.0  # percent completeness required per field
        findings: list[ZRuleFinding] = []
        # Check each column in the uploaded records
        columns = set()
        for r in records:
            columns.update(r.keys())
        for col in columns:
            total = len(records)
            non_null = sum(
                1 for r in records if r.get(col) is not None and r.get(col) != ""
            )
            completeness = (non_null / total * 100) if total > 0 else 0
            if completeness < threshold:
                findings.append(
                    ZRuleFinding(
                        z_object_name=z_obj.object_name,
                        rule_id="Z-RULE-009",
                        rule_name="Z Table Completeness",
                        severity="medium",
                        title=(
                            f"Z table {z_obj.object_name}: field '{col}' is "
                            f"{completeness:.0f}% complete (threshold: {threshold}%)"
                        ),
                        description=(
                            f"Field '{col}' in custom table {z_obj.object_name} "
                            f"has {completeness:.0f}% completeness, below the "
                            f"{threshold}% threshold."
                        ),
                        remediation=(
                            f"Review data entry processes for field '{col}' in "
                            f"table {z_obj.object_name}."
                        ),
                    )
                )
        return findings

    def _eval_010_lifecycle(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """Z config values with zero usage should be reviewed."""
        if z_obj.transaction_count == 0:
            return [
                ZRuleFinding(
                    z_object_name=z_obj.object_name,
                    rule_id="Z-RULE-010",
                    rule_name="Z Value Lifecycle",
                    severity="low",
                    title=(
                        f"Z object {z_obj.object_name} has zero transactions "
                        f"this period"
                    ),
                    description=(
                        f"Custom object {z_obj.object_name} had no transactions "
                        f"in the current analysis period. If this persists for 6+ "
                        f"months, consider deactivation."
                    ),
                    remediation=(
                        f"Review whether {z_obj.object_name} is still needed. "
                        f"Mark as deprecated in the Z-Object Registry if no longer "
                        f"required."
                    ),
                )
            ]
        return []

    def _eval_011_pricing_procedure(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """Z pricing conditions must be assigned to a pricing procedure."""
        # TODO: Requires T685A/T683S pricing procedure data. Only applicable
        # when source_field is KSCHL. Needs additional SAP configuration data
        # beyond a single CSV upload.
        if z_obj.source_field != "KSCHL":
            return []
        return []

    def _eval_012_enhancement_deviation(
        self,
        z_obj: ZDetectedObject,
        profile: ZObjectProfile | None,
        baseline: ZBaseline | None,
        records: list[dict],
        ctx: dict,
    ) -> list[ZRuleFinding]:
        """Flag Z config values with significantly different outcomes vs standard."""
        # TODO: Requires paired analysis comparing Z value outcomes against
        # the standard equivalent's outcomes (e.g. Z61 vs 261 for BWART).
        # Needs more contextual data to determine deviation significance.
        if not profile or not profile.standard_equivalent:
            return []
        return []
