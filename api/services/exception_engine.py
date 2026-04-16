"""Exception engine — SAP transaction monitors, custom rule evaluator, billing calculator."""

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

# ── 14 pre-built SAP transaction monitors ────────────────────────────────────

SAP_MONITORS: list[dict] = [
    {
        "name": "failed_posting",
        "category": "financial",
        "sap_area": "FI",
        "description": "Failed accounting document posting — BKPF status indicates incomplete or reversed entry",
        "detection_fields": ["BKPF.BSTAT"],
        "severity": "critical",
    },
    {
        "name": "blocked_invoice",
        "category": "financial",
        "sap_area": "FI-AP",
        "description": "Blocked vendor invoice — payment hold or purchasing block active",
        "detection_fields": ["RBKP.RBSTAT", "EKKO.SPERM"],
        "severity": "high",
    },
    {
        "name": "payment_rejection",
        "category": "financial",
        "sap_area": "FI-BL",
        "description": "Payment run rejection — payment method or bank details invalid",
        "detection_fields": ["PAYR.RZAWE", "REGUP.VBLNR"],
        "severity": "critical",
    },
    {
        "name": "intercompany_imbalance",
        "category": "financial",
        "sap_area": "FI-GL",
        "description": "Intercompany posting imbalance — company code amounts do not net to zero",
        "detection_fields": ["BSEG.BUKRS", "BSEG.DMBTR"],
        "severity": "critical",
    },
    {
        "name": "stuck_idoc",
        "category": "integration",
        "sap_area": "BC-MID",
        "description": "IDoc stuck in error status — middleware processing halted",
        "detection_fields": ["EDIDC.STATUS"],
        "severity": "high",
    },
    {
        "name": "api_failure",
        "category": "integration",
        "sap_area": "BC-API",
        "description": "API/ICM connection failure — external system integration broken",
        "detection_fields": ["SMICM.STATUS"],
        "severity": "high",
    },
    {
        "name": "cert_expiry",
        "category": "compliance",
        "sap_area": "BC-SEC",
        "description": "SSL/TLS certificate approaching expiry — secure connections at risk",
        "detection_fields": ["STXH.TDOBJECT", "STXH.TDID"],
        "severity": "medium",
    },
    {
        "name": "delivery_block",
        "category": "logistics",
        "sap_area": "SD",
        "description": "Sales order delivery block active — shipment cannot proceed",
        "detection_fields": ["VBAK.LIFSK", "VBAP.LFGSA"],
        "severity": "medium",
    },
    {
        "name": "mrp_exception",
        "category": "planning",
        "sap_area": "PP-MRP",
        "description": "MRP exception message — planning run flagged supply/demand imbalance",
        "detection_fields": ["MDPS.KZAZU"],
        "severity": "medium",
    },
    {
        "name": "gr_ir_mismatch",
        "category": "financial",
        "sap_area": "MM-IV",
        "description": "Goods Receipt / Invoice Receipt quantity mismatch — clearing blocked",
        "detection_fields": ["EKBE.VGABE", "RSEG.MENGE"],
        "severity": "high",
    },
    {
        "name": "maintenance_overdue",
        "category": "assets",
        "sap_area": "PM",
        "description": "Preventive maintenance order overdue — equipment risk increasing",
        "detection_fields": ["AUFK.IDAT2", "EQUI.GEWRK"],
        "severity": "medium",
    },
    {
        "name": "payroll_error",
        "category": "hr",
        "sap_area": "HR-PY",
        "description": "Payroll calculation error — wage type processing failed",
        "detection_fields": ["PC261.LGART", "T512T.LGTXT"],
        "severity": "critical",
    },
    {
        "name": "quality_hold",
        "category": "quality",
        "sap_area": "QM",
        "description": "Quality inspection lot on hold — material usage blocked pending QA",
        "detection_fields": ["QALS.QPLOS", "QAVE.PLNMG"],
        "severity": "high",
    },
    {
        "name": "workflow_stuck",
        "category": "process",
        "sap_area": "BC-WF",
        "description": "SAP workflow item stuck — approval or processing step not progressing",
        "detection_fields": ["SWWWIHEAD.WI_STAT"],
        "severity": "medium",
    },
]

# SLA durations by severity
_SLA_HOURS = {"critical": 8, "high": 24, "medium": 72, "low": 168}


class SAPTransactionMonitor:
    """Scan findings for SAP field names matching monitor detection_fields."""

    def evaluate_monitors(
        self, findings: list[dict], tenant_id: str
    ) -> list[dict]:
        now = datetime.now(timezone.utc)
        exceptions: list[dict] = []

        # Build a set of all field names referenced across findings
        finding_fields: set[str] = set()
        for f in findings:
            # Check check_id, details.field_checked, and details.message for field refs
            details = f.get("details") or {}
            field_checked = details.get("field_checked", "")
            if field_checked:
                finding_fields.add(field_checked.upper())
            message = details.get("message", "")
            # Extract TABLE.FIELD patterns from message
            for match in re.findall(r"[A-Z0-9_]+\.[A-Z0-9_]+", message.upper()):
                finding_fields.add(match)

        for monitor in SAP_MONITORS:
            # Check if any detection field appears in the findings field set
            matched_fields = [
                df for df in monitor["detection_fields"]
                if df.upper() in finding_fields
            ]
            if not matched_fields:
                continue

            sla_hours = _SLA_HOURS.get(monitor["severity"], 72)
            exceptions.append({
                "id": str(uuid.uuid4()),
                "tenant_id": tenant_id,
                "type": "sap_transaction",
                "category": monitor["category"],
                "severity": monitor["severity"],
                "status": "open",
                "title": f"SAP Monitor: {monitor['name'].replace('_', ' ').title()}",
                "description": monitor["description"],
                "source_system": f"SAP {monitor['sap_area']}",
                "source_reference": monitor["name"],
                "affected_records": {"matched_fields": matched_fields},
                "escalation_tier": 1,
                "sla_deadline": (now + timedelta(hours=sla_hours)).isoformat(),
                "created_at": now.isoformat(),
            })

        return exceptions


class CustomRuleEvaluator:
    """Evaluate custom exception_rules against records."""

    def evaluate_rules(
        self, records: list[dict], rules: list[dict], tenant_id: str
    ) -> list[dict]:
        now = datetime.now(timezone.utc)
        exceptions: list[dict] = []

        for rule in rules:
            if not rule.get("is_active", False):
                continue

            rule_type = rule.get("rule_type", "")
            condition = rule.get("condition", "")
            severity = rule.get("severity", "medium")
            sla_hours = _SLA_HOURS.get(severity, 72)

            matched_records: list[str] = []

            for record in records:
                try:
                    if rule_type == "field_condition" and self._check_field_condition(record, condition):
                        matched_records.append(str(record.get("id", record.get("record_key", "unknown"))))
                    elif rule_type == "threshold" and self._check_threshold(record, condition, records):
                        matched_records.append(str(record.get("id", record.get("record_key", "unknown"))))
                    elif rule_type == "temporal" and self._check_temporal(record, condition):
                        matched_records.append(str(record.get("id", record.get("record_key", "unknown"))))
                    elif rule_type == "relationship" and self._check_relationship(record, condition):
                        matched_records.append(str(record.get("id", record.get("record_key", "unknown"))))
                except Exception:
                    continue

            if matched_records:
                exceptions.append({
                    "id": str(uuid.uuid4()),
                    "tenant_id": tenant_id,
                    "type": "custom_business",
                    "category": rule.get("object_type", "general"),
                    "severity": severity,
                    "status": "open",
                    "title": f"Custom Rule: {rule.get('name', 'Unnamed')}",
                    "description": rule.get("description", condition),
                    "source_reference": str(rule.get("id", "")),
                    "affected_records": {
                        "rule_id": str(rule.get("id", "")),
                        "matched_count": len(matched_records),
                        "sample_keys": matched_records[:20],
                    },
                    "assigned_to": rule.get("auto_assign_to"),
                    "escalation_tier": 1,
                    "sla_deadline": (now + timedelta(hours=sla_hours)).isoformat(),
                    "billing_tier": 4,
                    "created_at": now.isoformat(),
                })

        return exceptions

    def _check_field_condition(self, record: dict, condition: str) -> bool:
        """Parse 'FIELD != VALUE', 'FIELD IS NULL', 'FIELD == VALUE' patterns."""
        condition = condition.strip()

        # FIELD IS NULL
        m = re.match(r"^(\S+)\s+IS\s+NULL$", condition, re.IGNORECASE)
        if m:
            field = m.group(1)
            val = record.get(field)
            return val is None or val == ""

        # FIELD IS NOT NULL
        m = re.match(r"^(\S+)\s+IS\s+NOT\s+NULL$", condition, re.IGNORECASE)
        if m:
            field = m.group(1)
            val = record.get(field)
            return val is not None and val != ""

        # FIELD != VALUE
        m = re.match(r"^(\S+)\s*!=\s*(.+)$", condition)
        if m:
            field, expected = m.group(1), m.group(2).strip().strip("'\"")
            return str(record.get(field, "")) != expected

        # FIELD == VALUE
        m = re.match(r"^(\S+)\s*==\s*(.+)$", condition)
        if m:
            field, expected = m.group(1), m.group(2).strip().strip("'\"")
            return str(record.get(field, "")) == expected

        return False

    def _check_threshold(self, record: dict, condition: str, all_records: list[dict]) -> bool:
        """Parse 'FIELD > VALUE' or 'FIELD > AVG(FIELD) * N' patterns."""
        # FIELD > AVG(FIELD) * N
        m = re.match(r"^(\S+)\s*>\s*AVG\((\S+)\)\s*\*\s*(\S+)$", condition, re.IGNORECASE)
        if m:
            field = m.group(1)
            avg_field = m.group(2)
            multiplier = float(m.group(3))
            vals = [float(r.get(avg_field, 0)) for r in all_records if r.get(avg_field) is not None]
            if not vals:
                return False
            avg = sum(vals) / len(vals)
            try:
                return float(record.get(field, 0)) > avg * multiplier
            except (ValueError, TypeError):
                return False

        # FIELD > VALUE or FIELD < VALUE
        m = re.match(r"^(\S+)\s*([><]=?)\s*(\S+)$", condition)
        if m:
            field, op, value = m.group(1), m.group(2), m.group(3)
            try:
                rec_val = float(record.get(field, 0))
                threshold = float(value)
                if op == ">":
                    return rec_val > threshold
                if op == ">=":
                    return rec_val >= threshold
                if op == "<":
                    return rec_val < threshold
                if op == "<=":
                    return rec_val <= threshold
            except (ValueError, TypeError):
                return False

        return False

    def _check_temporal(self, record: dict, condition: str) -> bool:
        """Parse 'DATE_FIELD < TODAY + N' or 'DATE_FIELD < TODAY - N' patterns."""
        m = re.match(r"^(\S+)\s*([><]=?)\s*TODAY\s*([+-])\s*(\d+)$", condition, re.IGNORECASE)
        if not m:
            return False

        field, op, sign, days_str = m.group(1), m.group(2), m.group(3), m.group(4)
        days = int(days_str)
        if sign == "-":
            days = -days

        target_date = datetime.now(timezone.utc) + timedelta(days=days)
        raw = record.get(field)
        if not raw:
            return False

        try:
            if isinstance(raw, str):
                rec_date = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            elif isinstance(raw, datetime):
                rec_date = raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
            else:
                return False
        except (ValueError, TypeError):
            return False

        if op == "<":
            return rec_date < target_date
        if op == "<=":
            return rec_date <= target_date
        if op == ">":
            return rec_date > target_date
        if op == ">=":
            return rec_date >= target_date
        return False

    def _check_relationship(self, record: dict, condition: str) -> bool:
        """Check for NOT EXISTS pattern — flag when referenced field is missing."""
        m = re.match(r"^NOT\s+EXISTS\s+(\S+)$", condition, re.IGNORECASE)
        if m:
            field = m.group(1)
            val = record.get(field)
            return val is None or val == ""
        return False


class ExceptionBillingCalculator:
    """Calculate billing based on resolved exceptions by tier."""

    # Pricing per tier in ZAR
    TIER_PRICES = {1: 25.0, 2: 150.0, 3: 500.0, 4: 250.0}
    TIER1_INCLUDED = 100  # first 100 tier-1 included in base fee

    def calculate_billing(
        self, exceptions: list[dict], period: str, base_fee: float = 8000.0
    ) -> dict:
        tier_counts = {1: 0, 2: 0, 3: 0, 4: 0}

        for exc in exceptions:
            tier = exc.get("billing_tier")
            if tier and tier in tier_counts:
                tier_counts[tier] += 1

        # Tier 1: first 100 included in base
        tier1_billable = max(0, tier_counts[1] - self.TIER1_INCLUDED)
        tier1_amount = tier1_billable * self.TIER_PRICES[1]
        tier2_amount = tier_counts[2] * self.TIER_PRICES[2]
        tier3_amount = tier_counts[3] * self.TIER_PRICES[3]
        tier4_amount = tier_counts[4] * self.TIER_PRICES[4]

        total = base_fee + tier1_amount + tier2_amount + tier3_amount + tier4_amount

        return {
            "period": period,
            "tier1_count": tier_counts[1],
            "tier2_count": tier_counts[2],
            "tier3_count": tier_counts[3],
            "tier4_count": tier_counts[4],
            "tier1_amount": tier1_amount,
            "tier2_amount": tier2_amount,
            "tier3_amount": tier3_amount,
            "tier4_amount": tier4_amount,
            "base_fee": base_fee,
            "total_amount": total,
        }

    def calculate_escalation(self, exception: dict) -> int:
        """Return escalation tier: 1 if >8h remaining, 2 if 2-8h, 3 if <2h, 4 if past SLA."""
        sla_raw = exception.get("sla_deadline")
        if not sla_raw:
            return 1

        now = datetime.now(timezone.utc)

        if isinstance(sla_raw, str):
            try:
                sla = datetime.fromisoformat(sla_raw.replace("Z", "+00:00"))
            except ValueError:
                return 1
        elif isinstance(sla_raw, datetime):
            sla = sla if sla.tzinfo else sla.replace(tzinfo=timezone.utc)
        else:
            return 1

        remaining = sla - now
        hours_remaining = remaining.total_seconds() / 3600

        if hours_remaining <= 0:
            return 4
        if hours_remaining < 2:
            return 3
        if hours_remaining < 8:
            return 2
        return 1
