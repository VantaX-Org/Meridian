"""Config Intelligence Engine (Orchestrator).

Chains all 3 layers — Config Discovery, Process Detection, and Alignment
Validation — into a single end-to-end analysis pipeline.
"""

from __future__ import annotations

from api.models.config_intelligence import (
    ConfigIntelligenceResult,
    ProcessStatus,
    RootCauseAnalysis,
)
from api.services.config_intelligence.alignment_validator import AlignmentValidator
from api.services.config_intelligence.discovery import ConfigDiscovery
from api.services.config_intelligence.drift_detector import DriftDetector
from api.services.config_intelligence.process_detector import ProcessDetector


class ConfigIntelligenceEngine:
    """Orchestrate all 3 layers of configuration intelligence analysis."""

    def __init__(self) -> None:
        self.discovery = ConfigDiscovery()
        self.detector = ProcessDetector()
        self.validator = AlignmentValidator()
        self.drift_detector = DriftDetector()

    def analyze(self, records: list[dict]) -> ConfigIntelligenceResult:
        """Run full 3-layer configuration intelligence analysis."""
        # Layer 0: Detect SAP version
        sap_version = self.discovery.detect_sap_version(records)

        # Layer 1: Config Discovery
        config_inventory = self.discovery.discover_config(records)

        # Layer 2: Process Detection
        processes = self.detector.detect_processes(records, config_inventory)

        # Layer 3: Alignment Validation
        findings = self.validator.validate_alignment(config_inventory, processes, records)

        # Calculate CHS
        health_scores = self.validator.calculate_chs(findings)
        avg_chs = (
            round(sum(h.chs for h in health_scores) / len(health_scores))
            if health_scores else 100
        )

        return ConfigIntelligenceResult(
            sap_version=sap_version,
            config_inventory=config_inventory,
            processes=processes,
            alignment_findings=findings,
            health_scores=health_scores,
            total_config_elements=len(config_inventory),
            active_processes=sum(1 for p in processes if p.status == ProcessStatus.ACTIVE),
            partial_processes=sum(1 for p in processes if p.status == ProcessStatus.PARTIAL),
            inactive_processes=sum(1 for p in processes if p.status == ProcessStatus.INACTIVE),
            total_findings=len(findings),
            critical_findings=sum(1 for f in findings if f.severity.value == "critical"),
            aggregate_chs=avg_chs,
            estimated_total_impact_zar=sum(f.estimated_impact_zar for f in findings),
        )

    def root_cause_analysis(
        self,
        finding: dict,
        config_inventory=None,
        processes=None,
    ) -> RootCauseAnalysis:
        """Root cause analysis for a specific DQ finding."""
        return self.validator.analyze_root_cause(
            finding, config_inventory or [], processes or [],
        )

    def detect_drift(self, previous_inventory, current_inventory):
        """Compare two config runs to detect drift."""
        return self.drift_detector.compare_runs(previous_inventory, current_inventory)
