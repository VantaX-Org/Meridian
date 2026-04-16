"""Process Detection Engine (Layer 2).

Detects which of 7 SAP business processes are actively running by matching
transactional data patterns against predefined process signatures.

Ported from the Nexus TypeScript ProcessDetector class.
"""

from __future__ import annotations

from api.models.config_intelligence import (
    ConfigElement,
    ProcessHealth,
    ProcessStatus,
    ProcessStep,
)


class ProcessDetector:
    """Detect active business processes from SAP transactional records."""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get(self, record: dict, field: str):
        """Case-insensitive field lookup."""
        return record.get(field) or record.get(field.lower()) or record.get(field.upper())

    def _detect_step(
        self,
        step_number: int,
        name: str,
        sap_table: str,
        records: list[dict],
        predicate,
    ) -> ProcessStep:
        """Apply a predicate to records and return a ProcessStep."""
        matching = [r for r in records if predicate(r)]
        return ProcessStep(
            step_number=step_number,
            step_name=name,
            sap_table=sap_table,
            detected=len(matching) > 0,
            volume=len(matching),
        )

    def _build_process_health(
        self,
        process_id: str,
        process_name: str,
        steps: list[ProcessStep],
    ) -> ProcessHealth:
        """Compute completeness, exception rate, and bottleneck from steps."""
        total = len(steps)
        detected_count = sum(1 for s in steps if s.detected)
        completeness = (detected_count / total) * 100 if total > 0 else 0

        if completeness == 100:
            status = ProcessStatus.ACTIVE
        elif completeness > 0:
            status = ProcessStatus.PARTIAL
        else:
            status = ProcessStatus.INACTIVE

        # Find bottleneck: largest volume drop >20% between consecutive detected steps
        bottleneck_step: str | None = None
        detected_steps = [s for s in steps if s.detected and s.volume > 0]

        for i in range(len(detected_steps) - 1):
            curr_vol = detected_steps[i].volume
            next_vol = detected_steps[i + 1].volume
            if curr_vol > 0:
                drop_pct = ((curr_vol - next_vol) / curr_vol) * 100
                if drop_pct > 20:
                    bottleneck_step = detected_steps[i + 1].step_name
                    detected_steps[i + 1].exception_count = curr_vol - next_vol
                    break

        # Exception rate: drop from first to last detected step
        exception_rate = 0.0
        if len(detected_steps) >= 2:
            first_vol = detected_steps[0].volume
            last_vol = detected_steps[-1].volume
            if first_vol > 0:
                exception_rate = ((first_vol - last_vol) / first_vol) * 100

        total_volume = sum(s.volume for s in steps)

        return ProcessHealth(
            process_id=process_id,
            process_name=process_name,
            status=status,
            completeness_score=round(completeness, 1),
            steps=steps,
            exception_rate=round(exception_rate, 1),
            bottleneck_step=bottleneck_step,
            total_volume=total_volume,
        )

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def detect_processes(
        self,
        records: list[dict],
        config_inventory: list[ConfigElement],
    ) -> list[ProcessHealth]:
        """Run all 7 process detectors and return health results."""
        return [
            self._detect_otc(records),
            self._detect_ptp(records),
            self._detect_rtr(records),
            self._detect_ptp_mfg(records),
            self._detect_mto(records),
            self._detect_htr(records),
            self._detect_stc(records),
        ]

    # ------------------------------------------------------------------
    # Per-process detectors
    # ------------------------------------------------------------------

    def _detect_otc(self, records: list[dict]) -> ProcessHealth:
        """Order-to-Cash (OTC) — 6 steps."""
        steps = [
            self._detect_step(1, "Sales Order", "VBAK", records,
                lambda r: self._get(r, "AUART") in ("OR", "SO", "ZOR", "TA")),
            self._detect_step(2, "Delivery", "LIKP", records,
                lambda r: bool(self._get(r, "LFART"))),
            self._detect_step(3, "Goods Issue (PGI)", "LIPS", records,
                lambda r: self._get(r, "WBSTA") == "C"),
            self._detect_step(4, "Billing", "VBRK", records,
                lambda r: self._get(r, "FKART") in ("F2", "F8", "G2")),
            self._detect_step(5, "Accounting (AR)", "BKPF", records,
                lambda r: self._get(r, "AWTYP") == "VBRK" or self._get(r, "BLART") == "RV"),
            self._detect_step(6, "Payment Receipt", "BSEG", records,
                lambda r: bool(self._get(r, "AUGBL")) and self._get(r, "BSCHL") == "15"),
        ]
        return self._build_process_health("OTC", "Order-to-Cash", steps)

    def _detect_ptp(self, records: list[dict]) -> ProcessHealth:
        """Procure-to-Pay (PTP) — 7 steps."""
        steps = [
            self._detect_step(1, "Purchase Requisition", "EBAN", records,
                lambda r: bool(self._get(r, "BANFN"))),
            self._detect_step(2, "Purchase Order", "EKKO", records,
                lambda r: self._get(r, "BSART") in ("NB", "ZNB", "FO")),
            self._detect_step(3, "Goods Receipt", "MSEG", records,
                lambda r: str(self._get(r, "BWART") or "") == "101"),
            self._detect_step(4, "Invoice Receipt", "RSEG", records,
                lambda r: bool(self._get(r, "EBELN"))),
            self._detect_step(5, "GR/IR Clearing", "BSEG", records,
                lambda r: str(self._get(r, "HKONT") or "").startswith("191")),
            self._detect_step(6, "AP Posting", "BKPF", records,
                lambda r: self._get(r, "AWTYP") == "RMRP" or self._get(r, "BLART") == "RE"),
            self._detect_step(7, "Payment Run", "REGUH", records,
                lambda r: bool(self._get(r, "LAUFD"))),
        ]
        return self._build_process_health("PTP", "Procure-to-Pay", steps)

    def _detect_rtr(self, records: list[dict]) -> ProcessHealth:
        """Record-to-Report (RTR) — 6 steps."""
        steps = [
            self._detect_step(1, "Journal Entry", "BKPF", records,
                lambda r: self._get(r, "BLART") in ("SA", "AB", "SB")),
            self._detect_step(2, "Cost Allocation", "COBK", records,
                lambda r: bool(self._get(r, "KOKRS"))),
            self._detect_step(3, "Accruals/Deferrals", "BKPF", records,
                lambda r: self._get(r, "BSTAT") == "V" or str(self._get(r, "BLART") or "") == "AB"),
            self._detect_step(4, "Period Close", "BKPF", records,
                lambda r: _safe_int(self._get(r, "MONAT")) >= 12),
            self._detect_step(5, "Reconciliation", "BSEG", records,
                lambda r: bool(self._get(r, "AUGBL"))),
            self._detect_step(6, "Reporting", "BKPF", records,
                lambda _r: False),
        ]
        return self._build_process_health("RTR", "Record-to-Report", steps)

    def _detect_ptp_mfg(self, records: list[dict]) -> ProcessHealth:
        """Plan-to-Produce (PTP_MFG) — 6 steps."""
        steps = [
            self._detect_step(1, "Demand Planning", "PBIM", records,
                lambda r: _safe_float(self._get(r, "BEDMG")) > 0),
            self._detect_step(2, "MRP Run", "PLAF", records,
                lambda r: bool(self._get(r, "PLNUM"))),
            self._detect_step(3, "Production Order", "AFKO", records,
                lambda r: bool(self._get(r, "AUFNR")) and (
                    str(self._get(r, "AUTYP") or "") == "10" or bool(self._get(r, "GAMNG")))),
            self._detect_step(4, "Material Staging", "RESB", records,
                lambda r: bool(self._get(r, "RSNUM"))),
            self._detect_step(5, "Confirmation", "AFRU", records,
                lambda r: bool(self._get(r, "LMNGA") or self._get(r, "RMNGA"))),
            self._detect_step(6, "GR from Production", "MSEG", records,
                lambda r: str(self._get(r, "BWART") or "") == "101" and bool(self._get(r, "AUFNR"))),
        ]
        return self._build_process_health("PTP_MFG", "Plan-to-Produce", steps)

    def _detect_mto(self, records: list[dict]) -> ProcessHealth:
        """Maintain-to-Operate (MTO) — 6 steps."""
        steps = [
            self._detect_step(1, "Notification", "QMEL", records,
                lambda r: bool(self._get(r, "QMNUM")) and self._get(r, "QMART") in ("M1", "M2", "M3")),
            self._detect_step(2, "Work Order", "AUFK", records,
                lambda r: str(self._get(r, "AUTYP") or "") == "30"),
            self._detect_step(3, "Planning", "RESB", records,
                lambda r: bool(self._get(r, "AUFNR")) and str(self._get(r, "RSART") or "") == "PM"),
            self._detect_step(4, "Execution", "AFRU", records,
                lambda r: bool(self._get(r, "AUFNR")) and bool(self._get(r, "ISMNW"))),
            self._detect_step(5, "Technical Completion", "AUFK", records,
                lambda r: bool(self._get(r, "STAT")) and "TECO" in str(self._get(r, "STAT") or "")),
            self._detect_step(6, "Settlement", "COBK", records,
                lambda r: bool(self._get(r, "AUFNR")) and bool(self._get(r, "BELNR"))),
        ]
        return self._build_process_health("MTO", "Maintain-to-Operate", steps)

    def _detect_htr(self, records: list[dict]) -> ProcessHealth:
        """Hire-to-Retire (HTR) — 7 steps."""
        steps = [
            self._detect_step(1, "Recruitment", "PA0000", records,
                lambda r: self._get(r, "MASSN") == "01" or self._get(r, "ACTION_TYPE") == "HIRE"),
            self._detect_step(2, "Onboarding", "PA0001", records,
                lambda r: bool(self._get(r, "PLANS")) and bool(self._get(r, "ORGEH"))),
            self._detect_step(3, "Position Management", "HRP1000", records,
                lambda r: self._get(r, "OTYPE") == "S"),
            self._detect_step(4, "Time Management", "PA2001", records,
                lambda r: bool(self._get(r, "SUBTY") or self._get(r, "AWART"))),
            self._detect_step(5, "Payroll", "PA0008", records,
                lambda r: bool(self._get(r, "TRFAR") or self._get(r, "SALARY"))),
            self._detect_step(6, "Performance", "PA0006", records,
                lambda r: bool(self._get(r, "REVIEW_STATUS") or self._get(r, "RATING"))),
            self._detect_step(7, "Termination", "PA0000", records,
                lambda r: self._get(r, "MASSN") == "10" or self._get(r, "ACTION_TYPE") == "TERMINATE"),
        ]
        return self._build_process_health("HTR", "Hire-to-Retire", steps)

    def _detect_stc(self, records: list[dict]) -> ProcessHealth:
        """Source-to-Contract (STC) — 6 steps."""
        steps = [
            self._detect_step(1, "RFQ", "EKKO", records,
                lambda r: str(self._get(r, "BSART") or "") == "AN"),
            self._detect_step(2, "Quotation", "EKKO", records,
                lambda r: str(self._get(r, "BSART") or "") == "AN" and bool(self._get(r, "KALSM"))),
            self._detect_step(3, "Contract", "EKKO", records,
                lambda r: str(self._get(r, "BSART") or "") in ("MK", "WK", "LP")),
            self._detect_step(4, "Source List", "EORD", records,
                lambda r: bool(self._get(r, "MATNR")) and bool(self._get(r, "LIFNR"))),
            self._detect_step(5, "Info Records", "EINE", records,
                lambda r: bool(self._get(r, "INFNR"))),
            self._detect_step(6, "Vendor Evaluation", "ESSR", records,
                lambda r: bool(self._get(r, "SCORE") or self._get(r, "LIFNR"))),
        ]
        return self._build_process_health("STC", "Source-to-Contract", steps)


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------

def _safe_int(val) -> int:
    """Safely convert to int, returning 0 on failure."""
    try:
        return int(val)
    except (TypeError, ValueError):
        return 0


def _safe_float(val) -> float:
    """Safely convert to float, returning 0.0 on failure."""
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0
