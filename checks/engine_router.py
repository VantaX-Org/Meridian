"""Engine router — selects fused, chunked, or legacy path per analysis.

The router evaluates the analysis size and check composition to select
the optimal execution path:

- Fused engine: < 40k rows, all checks supported (null, regex, domain, cross_field, freshness)
- Legacy per-rule: referential_check, or when fused engine has known issues
- Chunked engine: >= 40k rows, all checks, bounded memory

Configuration:
    MERIDIAN_ENGINE_FUSED_MAX: row count threshold for fused path (default: 40000)
    CHECK_ENGINE: "fused" | "legacy" | "auto" (default: "auto")

Usage:
    from checks.engine_router import run_analysis
    
    results = run_analysis(
        parquet_path="path/to/data.parquet",
        module_name="business_partner",
        rules=rules,
        id_field="PARTNER",
    )
"""

from __future__ import annotations

import io
import logging
import os
from typing import TYPE_CHECKING, Union

try:
    import polars as pl

    POLARS_AVAILABLE = True
except ImportError:
    pl = None  # type: ignore[assignment]
    POLARS_AVAILABLE = False

from checks.base import CheckResult

if TYPE_CHECKING:
    from checks.fused_engine import run_module_fused
    from checks.chunked_engine import run_module_chunked
    from checks.polars_engine import run_checks_polars

logger = logging.getLogger("meridian.checks.engine_router")

# Configuration
MERIDIAN_ENGINE_FUSED_MAX = int(os.getenv("MERIDIAN_ENGINE_FUSED_MAX", "40000"))
CHECK_ENGINE_MODE = os.getenv("CHECK_ENGINE", "auto")

# Check classes that CAN be handled by fused engine
FUSED_COMPATIBLE_CHECKS = {
    "null_check",
    "regex_check",
    "domain_value_check",
    "cross_field_check",
    "freshness_check",
}

# Check classes that MUST go to legacy path
LEGACY_ONLY_CHECKS = {
    "referential_check",
}


def _get_row_count(source: Union[str, bytes]) -> int:
    """Estimate row count from parquet source without full materialization."""
    if isinstance(source, bytes):
        buf = io.BytesIO(source)
        return pl.read_parquet_schema(buf).get("__len__", 0) or _count_rows_from_bytes(source)
    
    # For file path, use scan_parquet's estimated row count
    try:
        lf = pl.scan_parquet(source)
        return lf.collect().__len__()
    except Exception:
        return 0


def _count_rows_from_bytes(data: bytes) -> int:
    """Count rows from raw parquet bytes using pyarrow."""
    try:
        import pyarrow.parquet as pq
        reader = pq.ParquetFile(io.BytesIO(data))
        return reader.metadata.num_rows
    except ImportError:
        # Fallback: just read and count
        df = pl.read_parquet(io.BytesIO(data))
        return len(df)


def _check_composition_requires_legacy(rules: list[dict]) -> bool:
    """Return True if any rule requires legacy engine."""
    for rule in rules:
        check_class = rule.get("check_class", "")
        if check_class in LEGACY_ONLY_CHECKS:
            return True
    return False


def select_engine(
    row_count: int,
    rules: list[dict],
    mode: str = CHECK_ENGINE_MODE,
) -> str:
    """Select the optimal engine for the given analysis.

    Args:
        row_count: Number of rows to process
        rules: List of rule configurations
        mode: Engine selection mode — "fused", "legacy", "auto"

    Returns:
        Engine name: "fused", "chunked", or "legacy"
    """
    if mode == "legacy":
        return "legacy"
    
    if mode == "fused" or (mode == "auto" and row_count < MERIDIAN_ENGINE_FUSED_MAX):
        # Check if any rules require legacy
        if _check_composition_requires_legacy(rules):
            # Fall back to legacy for referential checks
            return "legacy"
        return "fused"
    
    if mode == "auto" and row_count >= MERIDIAN_ENGINE_FUSED_MAX:
        # Chunked engine for large datasets
        return "chunked"
    
    # Default fallback
    return "legacy"


def run_analysis(
    parquet_source: Union[str, bytes],
    module_name: str,
    rules: list[dict],
    id_field: str | None = None,
    chunk_rows: int = 50000,
    cancel_token: "CancelToken | None" = None,
    sink: "ChunkSink | None" = None,
    progress: "ProgressReporter | None" = None,
) -> list[CheckResult]:
    """Run analysis using the optimal engine selection.

    Args:
        parquet_source: Path to parquet file or raw bytes
        module_name: Module name for rule loading
        rules: List of rule configurations
        id_field: ID field for record identification
        chunk_rows: Chunk size for chunked engine
        cancel_token: Cancellation token for chunked engine
        sink: ChunkSink for writing record fixes
        progress: Progress reporter callback

    Returns:
        List of CheckResult objects
    """
    # Get row count for engine selection
    row_count = _get_row_count(parquet_source)
    engine = select_engine(row_count, rules)
    
    logger.info(
        f"Engine selection for {module_name} ({row_count:,} rows): {engine}"
    )
    
    if engine == "fused":
        return _run_fused(parquet_source, module_name, rules, id_field)
    
    if engine == "chunked":
        # Import lazily to avoid circular imports
        from checks.chunked_engine import run_module_chunked
        from checks.cancel import CancelToken
        from checks.progress import ProgressReporter
        
        token = cancel_token or CancelToken(module_name)
        reporter = progress or ProgressReporter(module_name)
        
        return run_module_chunked(
            parquet_path=parquet_source if isinstance(parquet_source, str) else None,
            parquet_bytes=parquet_source if isinstance(parquet_source, bytes) else None,
            module_name=module_name,
            rules=rules,
            id_field=id_field or "record_id",
            chunk_rows=chunk_rows,
            cancel_token=token,
            sink=sink,
            progress=reporter,
        )
    
    # Legacy path — use existing polars_engine per-rule
    return _run_legacy(parquet_source, module_name, rules)


def _run_fused(
    parquet_source: Union[str, bytes],
    module_name: str,
    rules: list[dict],
    id_field: str | None,
) -> list[CheckResult]:
    """Run using the fused engine."""
    from checks.fused_engine import run_checks_fused
    
    return run_checks_fused(parquet_source, module_name, rules, id_field=id_field)


def _run_legacy(
    parquet_source: Union[str, bytes],
    module_name: str,
    rules: list[dict],
) -> list[CheckResult]:
    """Run using the legacy per-rule Polars engine."""
    from checks.polars_engine import run_checks_polars
    
    if isinstance(parquet_source, bytes):
        buf = io.BytesIO(parquet_source)
    else:
        buf = parquet_source  # path string
    
    raw_results = run_checks_polars(buf, module_name, rules)
    
    # Convert to CheckResult objects
    return [
        CheckResult(
            check_id=r.get("check_id", "UNKNOWN"),
            module=r.get("module", module_name),
            field=r.get("field", ""),
            severity=r.get("severity", "medium"),
            dimension=r.get("dimension", ""),
            passed=r.get("passed", False),
            affected_count=r.get("affected_count", 0),
            total_count=r.get("total_count", 0),
            pass_rate=r.get("pass_rate", 0.0),
            message=r.get("message", ""),
            details=r.get("details", {}),
            error=r.get("error"),
        )
        for r in raw_results
    ]


def get_engine_info() -> dict:
    """Return current engine configuration and capabilities."""
    return {
        "mode": CHECK_ENGINE_MODE,
        "fused_max_rows": MERIDIAN_ENGINE_FUSED_MAX,
        "polars_available": POLARS_AVAILABLE,
        "fused_compatible_checks": sorted(FUSED_COMPATIBLE_CHECKS),
        "legacy_only_checks": sorted(LEGACY_ONLY_CHECKS),
    }