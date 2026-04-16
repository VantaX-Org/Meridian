"""Alignment Validation Engine (Layer 3).

Cross-references discovered config with actual data usage to find
misalignment across 8 check categories.

Ported from the Nexus TypeScript AlignmentValidator class.
"""

from __future__ import annotations

import re
from collections import defaultdict

from api.models.config_intelligence import (
    AlignmentCategory,
    AlignmentFinding,
    ConfigElement,
    ConfigHealthScore,
    ConfigStatus,
    ProcessHealth,
    ProcessStatus,
    RootCauseAnalysis,
    RootCauseType,
    Severity,
)


class AlignmentValidator:
    """Validate alignment between config, processes, and transactional data."""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get(self, record: dict, field: str):
        """Case-insensitive field lookup."""
        return record.get(field) or record.get(field.lower()) or record.get(field.upper())

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def validate_alignment(
        self,
        config_elements: list[ConfigElement],
        processes: list[ProcessHealth],
        records: list[dict],
    ) -> list[AlignmentFinding]:
        """Run all alignment check categories and return findings."""
        findings: list[AlignmentFinding] = []
        findings.extend(self._check_ghost_config(config_elements))
        findings.extend(self._check_process_bottlenecks(processes))
        findings.extend(self._check_licence_waste(config_elements, processes))
        findings.extend(self._check_config_conflicts(config_elements, records))
        findings.extend(self._check_master_data_config_mismatch(config_elements, records))
        findings.extend(self._check_number_range_health(config_elements))
        findings.extend(self._check_org_structure_gaps(config_elements))
        findings.extend(self._check_integration_gaps(config_elements))
        findings.extend(self._check_z_object_alignment(config_elements, records))
        return findings

    # ------------------------------------------------------------------
    # CHS calculator
    # ------------------------------------------------------------------

    def calculate_chs(self, findings: list[AlignmentFinding]) -> list[ConfigHealthScore]:
        """Calculate Configuration Health Score per module."""
        by_module: dict[str, list[AlignmentFinding]] = defaultdict(list)
        for f in findings:
            by_module[f.module].append(f)

        scores = []
        for module, module_findings in by_module.items():
            critical = sum(1 for f in module_findings if f.severity == Severity.CRITICAL)
            high = sum(1 for f in module_findings if f.severity == Severity.HIGH)
            medium = sum(1 for f in module_findings if f.severity == Severity.MEDIUM)
            low = sum(1 for f in module_findings if f.severity == Severity.LOW)
            deductions = (critical * 3) + (high * 2) + (medium * 1) + (low * 0.5)
            chs = max(0, round(100 - deductions))
            scores.append(ConfigHealthScore(
                module=module,
                chs=chs,
                critical_count=critical,
                high_count=high,
                medium_count=medium,
                low_count=low,
            ))
        return scores

    # ------------------------------------------------------------------
    # Root cause analysis bridge
    # ------------------------------------------------------------------

    def analyze_root_cause(
        self,
        finding: dict,
        config_elements: list[ConfigElement],
        processes: list[ProcessHealth],
    ) -> RootCauseAnalysis:
        """Classify a DQ finding's root cause as data, config, or process."""
        finding_id = finding.get("check_id", finding.get("id", "unknown"))
        field = finding.get("field", "")
        record_data = finding.get("record_data", {})

        # Get field value (case-insensitive)
        field_value = None
        if record_data and field:
            field_value = self._get(record_data, field)

        # Check if value exists in config
        config_match = False
        if field_value is not None:
            str_val = str(field_value)
            for elem in config_elements:
                if elem.element_value == str_val:
                    config_match = True
                    break

        # Check if any process has missing steps related to the field's table
        process_incomplete = False
        for proc in processes:
            if proc.status == ProcessStatus.PARTIAL:
                process_incomplete = True
                break

        # Classify root cause
        if not config_match and process_incomplete:
            return RootCauseAnalysis(
                finding_id=finding_id,
                root_cause_type=RootCauseType.BAD_DATA_AND_CONFIG,
                data_issue="Value not found in configuration inventory",
                config_issue="Configuration issue, review SPRO settings",
                process_issue="Related business process is incomplete",
                recommendation="Review both configuration and process completeness",
            )
        elif not config_match:
            return RootCauseAnalysis(
                finding_id=finding_id,
                root_cause_type=RootCauseType.BAD_CONFIG,
                config_issue="Configuration issue, review SPRO settings",
                recommendation="Review SPRO configuration for this element",
            )
        elif process_incomplete:
            return RootCauseAnalysis(
                finding_id=finding_id,
                root_cause_type=RootCauseType.PROCESS_GAP,
                process_issue="Related business process has missing steps",
                recommendation="Review process completeness and address gaps",
            )
        else:
            return RootCauseAnalysis(
                finding_id=finding_id,
                root_cause_type=RootCauseType.BAD_DATA,
                data_issue="Data issue, apply cleaning rule",
                recommendation="Apply data cleaning rule to correct the value",
            )

    # ------------------------------------------------------------------
    # Check categories
    # ------------------------------------------------------------------

    def _check_ghost_config(self, elements: list[ConfigElement]) -> list[AlignmentFinding]:
        """Ghost Config: elements with zero transactions or dormant status."""
        findings: list[AlignmentFinding] = []

        # Filter ghost/dormant elements
        ghosts = [e for e in elements if e.transaction_count == 0 or e.status == ConfigStatus.DORMANT]
        if not ghosts:
            return findings

        # Group by module-element_type
        groups: dict[str, list[ConfigElement]] = defaultdict(list)
        for e in ghosts:
            key = f"{e.module}-{e.element_type}"
            groups[key].append(e)

        for key, group in groups.items():
            module, element_type = key.split("-", 1)
            count = len(group)
            severity = Severity.MEDIUM if count > 10 else Severity.LOW
            findings.append(AlignmentFinding(
                check_id=f"GHOST-{key}",
                module=module,
                category=AlignmentCategory.GHOST,
                severity=severity,
                title=f"{count} unused {element_type} configurations",
                description=f"{count} {element_type} configurations in module {module} have zero transactions",
                affected_elements=[e.element_value for e in group],
                remediation=f"Review and deactivate unused {element_type} configurations",
                estimated_impact_zar=count * 500,
            ))
        return findings

    def _check_process_bottlenecks(self, processes: list[ProcessHealth]) -> list[AlignmentFinding]:
        """Process Bottlenecks: bottleneck steps and incomplete processes."""
        findings: list[AlignmentFinding] = []

        for proc in processes:
            if proc.status == ProcessStatus.INACTIVE:
                continue

            # Bottleneck detection
            if proc.bottleneck_step:
                if proc.exception_rate > 30:
                    severity = Severity.CRITICAL
                elif proc.exception_rate > 15:
                    severity = Severity.HIGH
                else:
                    severity = Severity.MEDIUM

                exception_count = 0
                for s in proc.steps:
                    if s.step_name == proc.bottleneck_step:
                        exception_count = s.exception_count
                        break

                findings.append(AlignmentFinding(
                    check_id=f"BOTTLENECK-{proc.process_id}",
                    module=proc.process_id,
                    category=AlignmentCategory.BOTTLENECK,
                    severity=severity,
                    title=f"Bottleneck at {proc.bottleneck_step} in {proc.process_name}",
                    description=(
                        f"{proc.process_name} process has a bottleneck at "
                        f"{proc.bottleneck_step} with {proc.exception_rate:.1f}% exception rate"
                    ),
                    affected_elements=[proc.bottleneck_step],
                    remediation=f"Investigate and resolve bottleneck at {proc.bottleneck_step}",
                    estimated_impact_zar=exception_count * 2500,
                ))

            # Incomplete process (shadow process)
            if 0 < proc.completeness_score < 100:
                missing_steps = [s.step_name for s in proc.steps if not s.detected]
                missing_count = len(missing_steps)
                severity = Severity.HIGH if missing_count > 2 else Severity.MEDIUM

                findings.append(AlignmentFinding(
                    check_id=f"SHADOW-{proc.process_id}",
                    module=proc.process_id,
                    category=AlignmentCategory.SHADOW,
                    severity=severity,
                    title=f"{proc.process_name} process incomplete ({missing_count} steps missing)",
                    description=(
                        f"{proc.process_name} is missing steps: "
                        + ", ".join(missing_steps)
                    ),
                    affected_elements=missing_steps,
                    remediation=f"Review and implement missing process steps",
                    estimated_impact_zar=missing_count * 5000,
                ))

        return findings

    def _check_licence_waste(
        self,
        elements: list[ConfigElement],
        processes: list[ProcessHealth],
    ) -> list[AlignmentFinding]:
        """Licence Waste: modules with minimal usage or inactive processes with some volume."""
        findings: list[AlignmentFinding] = []

        # Group elements by module and sum transaction counts
        module_volumes: dict[str, int] = defaultdict(int)
        for e in elements:
            module_volumes[e.module] += e.transaction_count

        for module, total in module_volumes.items():
            if 0 < total < 10:
                findings.append(AlignmentFinding(
                    check_id=f"LICENCE_WASTE-{module}",
                    module=module,
                    category=AlignmentCategory.LICENCE_WASTE,
                    severity=Severity.MEDIUM,
                    title=f"Module {module} has minimal usage ({total} transactions)",
                    description=f"Module {module} has only {total} transactions — potential licence waste",
                    remediation=f"Review whether module {module} licence is still needed",
                    estimated_impact_zar=50000,
                ))

        # Inactive processes with some step volume
        for proc in processes:
            if proc.status == ProcessStatus.INACTIVE:
                step_volume = sum(s.volume for s in proc.steps if s.volume > 0)
                if step_volume > 0:
                    findings.append(AlignmentFinding(
                        check_id=f"LICENCE_WASTE-PROC-{proc.process_id}",
                        module=proc.process_id,
                        category=AlignmentCategory.LICENCE_WASTE,
                        severity=Severity.LOW,
                        title=f"Inactive process {proc.process_name} has residual volume",
                        description=(
                            f"{proc.process_name} is inactive but {step_volume} records "
                            f"match individual steps"
                        ),
                        remediation=f"Investigate residual data in {proc.process_name}",
                        estimated_impact_zar=25000,
                    ))

        return findings

    def _check_config_conflicts(
        self,
        elements: list[ConfigElement],
        records: list[dict],
    ) -> list[AlignmentFinding]:
        """Config Conflicts: materials with different MRP types across plants, vendors without bank details."""
        findings: list[AlignmentFinding] = []

        # Materials with different MRP types (DISMM) across plants (WERKS)
        mrp_by_material: dict[str, set[str]] = defaultdict(set)
        for r in records:
            matnr = self._get(r, "MATNR")
            dismm = self._get(r, "DISMM")
            werks = self._get(r, "WERKS")
            if matnr and dismm and werks:
                mrp_by_material[str(matnr)].add(f"{werks}:{dismm}")

        conflicting_materials = {
            mat: combos for mat, combos in mrp_by_material.items()
            if len({c.split(":")[1] for c in combos}) > 1
        }
        if conflicting_materials:
            count = len(conflicting_materials)
            findings.append(AlignmentFinding(
                check_id="CONFLICT-MRP-CROSS-PLANT",
                module="MM",
                category=AlignmentCategory.CONFLICT,
                severity=Severity.HIGH,
                title=f"{count} materials with conflicting MRP types across plants",
                description=(
                    f"{count} materials have different MRP type (DISMM) settings "
                    f"across different plants"
                ),
                affected_elements=list(conflicting_materials.keys()),
                remediation="Harmonise MRP type settings across plants for each material",
                estimated_impact_zar=count * 2000,
            ))

        # Vendors with payment method but no bank details
        vendors_no_bank = []
        for r in records:
            zlsch = self._get(r, "ZLSCH")
            bankn = self._get(r, "BANKN")
            lifnr = self._get(r, "LIFNR")
            if zlsch and not bankn and lifnr:
                vendors_no_bank.append(str(lifnr))

        vendors_no_bank = list(set(vendors_no_bank))
        if vendors_no_bank:
            count = len(vendors_no_bank)
            findings.append(AlignmentFinding(
                check_id="CONFLICT-VENDOR-BANK",
                module="FI",
                category=AlignmentCategory.CONFLICT,
                severity=Severity.CRITICAL,
                title=f"{count} vendors with payment method but no bank details",
                description=(
                    f"{count} vendors have a payment method (ZLSCH) configured "
                    f"but are missing bank details (BANKN)"
                ),
                affected_elements=vendors_no_bank,
                remediation="Add bank details for vendors with payment methods configured",
                estimated_impact_zar=count * 8000,
            ))

        return findings

    def _check_master_data_config_mismatch(
        self,
        elements: list[ConfigElement],
        records: list[dict],
    ) -> list[AlignmentFinding]:
        """Master Data vs Config Mismatch: customers without sales area."""
        findings: list[AlignmentFinding] = []

        customers_no_sales_area = []
        for r in records:
            kunnr = self._get(r, "KUNNR")
            vkorg = self._get(r, "VKORG")
            ktokd = self._get(r, "KTOKD")
            if kunnr and not vkorg and ktokd:
                customers_no_sales_area.append(str(kunnr))

        customers_no_sales_area = list(set(customers_no_sales_area))
        if len(customers_no_sales_area) > 5:
            count = len(customers_no_sales_area)
            findings.append(AlignmentFinding(
                check_id="MISMATCH-CUSTOMER-SALES-AREA",
                module="SD",
                category=AlignmentCategory.MISMATCH,
                severity=Severity.HIGH,
                title=f"{count} customers without sales area assignment",
                description=(
                    f"{count} customers have account group (KTOKD) but no "
                    f"sales organisation (VKORG) assignment"
                ),
                affected_elements=customers_no_sales_area,
                remediation="Assign sales area data to customer master records",
                estimated_impact_zar=count * 5000,
            ))

        return findings

    def _check_number_range_health(self, elements: list[ConfigElement]) -> list[AlignmentFinding]:
        """Number Range Exhaustion: ranges approaching capacity."""
        findings: list[AlignmentFinding] = []

        nr_elements = [e for e in elements if e.element_type == "number_range"]
        for e in nr_elements:
            match = re.search(r"(\d+)%\s*consumed", e.element_value)
            if not match:
                continue
            utilisation = int(match.group(1))
            if utilisation > 80:
                severity = Severity.CRITICAL if utilisation > 95 else Severity.HIGH
                findings.append(AlignmentFinding(
                    check_id=f"NUMBER_RANGE-{e.module}-{e.element_value[:20]}",
                    module=e.module,
                    category=AlignmentCategory.NUMBER_RANGE,
                    severity=severity,
                    title=f"Number range {utilisation}% consumed in {e.module}",
                    description=(
                        f"Number range '{e.element_value}' is {utilisation}% consumed — "
                        f"risk of system stop if exhausted"
                    ),
                    affected_elements=[e.element_value],
                    remediation="Extend or reset the number range before exhaustion",
                    estimated_impact_zar=100000,
                ))

        return findings

    def _check_org_structure_gaps(self, elements: list[ConfigElement]) -> list[AlignmentFinding]:
        """Org Structure Gaps: plants without purchasing orgs."""
        findings: list[AlignmentFinding] = []

        plants = [e for e in elements if e.element_type == "plant"]
        purchasing_orgs = [e for e in elements if e.element_type == "purchasing_org"]

        if plants and not purchasing_orgs:
            findings.append(AlignmentFinding(
                check_id="ORG_GAP-PLANT-PURCH",
                module="MM",
                category=AlignmentCategory.ORG_GAP,
                severity=Severity.CRITICAL,
                title="Plants exist but no purchasing organisations configured",
                description=(
                    f"{len(plants)} plants found but no purchasing organisations — "
                    f"procurement processes cannot function"
                ),
                affected_elements=[e.element_value for e in plants],
                remediation="Configure purchasing organisation and assign to plants",
                estimated_impact_zar=50000,
            ))

        return findings

    def _check_integration_gaps(self, elements: list[ConfigElement]) -> list[AlignmentFinding]:
        """Integration Gaps: one-way IDocs and IDoc error rates."""
        findings: list[AlignmentFinding] = []

        # One-way IDocs: outbound exists but no inbound
        idoc_directions = [e for e in elements if e.element_type == "direction"]
        outbound = any(e.element_value == "1" for e in idoc_directions)
        inbound = any(e.element_value == "2" for e in idoc_directions)

        if outbound and not inbound:
            findings.append(AlignmentFinding(
                check_id="INTEGRATION_GAP-ONEWAY-IDOC",
                module="INT",
                category=AlignmentCategory.INTEGRATION_GAP,
                severity=Severity.HIGH,
                title="One-way IDoc integration detected (outbound only)",
                description="IDocs are configured for outbound only — no inbound processing detected",
                remediation="Review whether inbound IDoc processing is required",
                estimated_impact_zar=30000,
            ))

        # IDoc error rate
        idoc_statuses = [e for e in elements if e.element_type == "idoc_status"]
        error_codes = {"51", "56", "61", "63"}
        success_codes = {"53", "03", "12", "16"}

        error_count = sum(e.transaction_count for e in idoc_statuses if e.element_value in error_codes)
        success_count = sum(e.transaction_count for e in idoc_statuses if e.element_value in success_codes)
        total = error_count + success_count

        if total > 0:
            error_rate = (error_count / total) * 100
            if error_rate > 5:
                severity = Severity.CRITICAL if error_rate > 15 else Severity.HIGH
                findings.append(AlignmentFinding(
                    check_id="INTEGRATION_GAP-IDOC-ERRORS",
                    module="INT",
                    category=AlignmentCategory.INTEGRATION_GAP,
                    severity=severity,
                    title=f"IDoc error rate {error_rate:.1f}% ({error_count} errors)",
                    description=(
                        f"{error_count} IDocs in error status out of {total} total "
                        f"({error_rate:.1f}% error rate)"
                    ),
                    affected_elements=[f"Status {s}" for s in error_codes if any(
                        e.element_value == s and e.transaction_count > 0 for e in idoc_statuses
                    )],
                    remediation="Investigate and reprocess failed IDocs",
                    estimated_impact_zar=error_count * 3000,
                ))

        return findings

    # ------------------------------------------------------------------
    # Z-Object Alignment
    # ------------------------------------------------------------------

    def _check_z_object_alignment(
        self,
        elements: list[ConfigElement],
        records: list[dict],
    ) -> list[AlignmentFinding]:
        """Z-Object alignment checks: ghost Z config, Z field completeness."""
        findings: list[AlignmentFinding] = []

        # Filter Z-prefixed config elements
        z_elements = [e for e in elements if e.element_type.startswith("z_")]
        if not z_elements:
            return findings

        # Ghost Z config: Z config values in inventory with 0 transactions
        ghost_z = [e for e in z_elements if e.transaction_count == 0]
        if ghost_z:
            by_module: dict[str, list[ConfigElement]] = defaultdict(list)
            for e in ghost_z:
                by_module[e.module].append(e)
            for module, group in by_module.items():
                findings.append(AlignmentFinding(
                    check_id=f"GHOST-Z-{module}",
                    module=module,
                    category=AlignmentCategory.GHOST,
                    severity=Severity.LOW,
                    title=f"{len(group)} ghost Z config values in {module}",
                    description=(
                        f"{len(group)} custom Z config values in module {module} "
                        f"have zero transactions — may be abandoned customisations"
                    ),
                    affected_elements=[e.element_value for e in group],
                    remediation="Review ghost Z config values and deactivate if no longer needed",
                    estimated_impact_zar=len(group) * 300,
                ))

        # Z field completeness: ZZ fields with >50% null rate
        zz_fields = set()
        for r in records:
            for key in r.keys():
                upper_key = key.upper()
                if upper_key.startswith("ZZ") or (
                    len(upper_key) > 2
                    and upper_key[0] == "Z"
                    and upper_key[1].isalpha()
                    and upper_key[1].isupper()
                    and "_" in upper_key
                ):
                    zz_fields.add(key)
            break  # Only need field names from first record

        for field in zz_fields:
            total = len(records)
            if total == 0:
                continue
            null_count = sum(
                1 for r in records
                if r.get(field) is None or r.get(field) == ""
            )
            null_rate = (null_count / total) * 100
            if null_rate > 50:
                findings.append(AlignmentFinding(
                    check_id=f"Z-FIELD-COMPLETENESS-{field.upper()}",
                    module="CROSS",
                    category=AlignmentCategory.MISMATCH,
                    severity=Severity.MEDIUM,
                    title=f"Z field {field} has {null_rate:.0f}% null rate",
                    description=(
                        f"Custom field {field} has {null_rate:.0f}% null values "
                        f"({null_count} of {total} records) — indicates degraded "
                        f"data entry or abandoned customisation"
                    ),
                    affected_elements=[field],
                    remediation=f"Review field {field}: enforce data entry or deprecate",
                    estimated_impact_zar=null_count * 100,
                ))

        return findings
