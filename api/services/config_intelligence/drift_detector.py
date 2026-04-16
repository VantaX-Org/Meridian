"""Config Drift Detector.

Compares two config inventory snapshots to detect configuration changes
between runs (added, removed, or modified elements).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from api.models.config_intelligence import ConfigElement


@dataclass
class DriftEntry:
    module: str
    element_type: str
    element_value: str
    change_type: str  # 'added', 'removed', 'modified'
    previous_value: Optional[str] = None
    current_value: Optional[str] = None


class DriftDetector:
    """Compare two config inventories and detect drift."""

    def compare_runs(
        self,
        previous: list[ConfigElement],
        current: list[ConfigElement],
    ) -> list[DriftEntry]:
        """Compare two config inventories and return drift entries."""
        prev_map: dict[str, ConfigElement] = {}
        for e in previous:
            key = f"{e.module}|{e.element_type}|{e.element_value}"
            prev_map[key] = e

        curr_map: dict[str, ConfigElement] = {}
        for e in current:
            key = f"{e.module}|{e.element_type}|{e.element_value}"
            curr_map[key] = e

        drift: list[DriftEntry] = []

        # Added: in current but not in previous
        for key, elem in curr_map.items():
            if key not in prev_map:
                drift.append(DriftEntry(
                    module=elem.module,
                    element_type=elem.element_type,
                    element_value=elem.element_value,
                    change_type="added",
                    current_value=f"count={elem.transaction_count}",
                ))

        # Removed: in previous but not in current
        for key, elem in prev_map.items():
            if key not in curr_map:
                drift.append(DriftEntry(
                    module=elem.module,
                    element_type=elem.element_type,
                    element_value=elem.element_value,
                    change_type="removed",
                    previous_value=f"count={elem.transaction_count}",
                ))

        # Modified: in both but status changed
        for key in prev_map:
            if key in curr_map:
                prev_e = prev_map[key]
                curr_e = curr_map[key]
                if prev_e.status != curr_e.status:
                    drift.append(DriftEntry(
                        module=curr_e.module,
                        element_type=curr_e.element_type,
                        element_value=curr_e.element_value,
                        change_type="modified",
                        previous_value=f"status={prev_e.status.value}, count={prev_e.transaction_count}",
                        current_value=f"status={curr_e.status.value}, count={curr_e.transaction_count}",
                    ))

        return drift
