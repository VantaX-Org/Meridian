"""Chunked Polars engine for large dataset processing.

Primary path for analyses above MERIDIAN_ENGINE_FUSED_MAX rows (default 40k).
Reads parquet in row-group chunks, applies fused plan per chunk,
merges per-rule counters into an accumulator, and flushes record-level
data to Postgres between chunks. Bounded memory regardless of dataset size.

Usage:
    from checks.chunked_engine import run_module_chunked
    from checks.cancel import CancelToken
    from checks.progress import ProgressReporter
    from db.chunk_sink import ChunkSink
    
    token = CancelToken("version_123")
    sink = ChunkSink(tenant_id, version_id)
    reporter = ProgressReporter("version_123")
    
    results = run_module_chunked(
        parquet_path="path/to/data.parquet",
        module_name="business_partner",
        rules=rules,
        needed_columns=["PARTNER", "BU_TYPE"],
        id_field="PARTNER",
        chunk_rows=50000,
        cancel_token=token,
        sink=sink,
        progress=reporter,
    )
"""

from __future__ import annotations

import gc
import io
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Optional

try:
    import polars as pl

    POLARS_AVAILABLE = True
except ImportError:
    pl = None  # type: ignore[assignment]
    POLARS_AVAILABLE = False

from checks.cancel import CancelToken, CancelRequested
from checks.progress import ProgressReporter
from checks.parquet_reader import iter_chunks, estimate_chunk_count
from checks.fused_engine import run_module_fused, _make_error_result

logger = logging.getLogger("meridian.checks.chunked_engine")

# Default chunk size (rows per chunk)
DEFAULT_CHUNK_ROWS = 50000
# GC every N chunks
GC_INTERVAL = 4

# Caps for record-level data per check
MAX_RECORDS_PER_CHECK_CHUNK = 500
MAX_RECORDS_PER_CHECK_TOTAL = 5000

if TYPE_CHECKING:
    from checks.fused_engine import CheckResult


@dataclass
class CheckAccumulator:
    """Accumulates counters across chunks for a single check.
    
    Handles different accumulator semantics per check type:
    - null_check, regex_check, domain_value_check, cross_field_check: sum counts
    - freshness_check: sum counts, track min oldest timestamp
    - domain distinct_invalid: merge dicts additively, cap at 50 entries
    - record-level samples: retain first non-empty sample per check, cap at 10
    """
    
    check_id: str
    check_class: str
    
    # Numeric counters
    fail_count: int = 0
    denominator: int = 0
    
    # Freshness-specific
    oldest_ts: Optional[str] = None
    
    # Domain distinct values (capped at 50)
    distinct_invalid: dict[str, int] = field(default_factory=dict)
    
    # Record-level samples (capped at 10 per check)
    samples: list[dict] = field(default_factory=list)
    
    # Chunk tracking
    chunks_seen: int = 0
    
    def merge(self, other: "CheckAccumulator") -> None:
        """Merge another accumulator's values into this one."""
        self.fail_count += other.fail_count
        self.denominator += other.denominator
        self.chunks_seen += 1
        
        # Freshness: track oldest timestamp
        if other.oldest_ts and (
            self.oldest_ts is None or other.oldest_ts < self.oldest_ts
        ):
            self.oldest_ts = other.oldest_ts
        
        # Domain distinct: merge dicts, cap at 50 by count
        for val, count in other.distinct_invalid.items():
            self.distinct_invalid[val] = self.distinct_invalid.get(val, 0) + count
        
        # Cap at 50 entries by total count
        if len(self.distinct_invalid) > 50:
            sorted_vals = sorted(
                self.distinct_invalid.items(),
                key=lambda x: x[1],
                reverse=True
            )
            self.distinct_invalid = dict(sorted_vals[:50])
        
        # Record samples: append up to 10 total
        remaining = 10 - len(self.samples)
        if remaining > 0:
            self.samples.extend(other.samples[:remaining])
    
    def finalize(self, total_rows: int, rule: dict) -> dict:
        """Convert accumulator to a CheckResult dict."""
        pass_rate = round((total_rows - self.fail_count) / total_rows * 100, 2) if total_rows > 0 else 100.0
        threshold = rule.get("threshold", 100.0)
        passed = pass_rate >= threshold
        
        details = {}
        
        # Add check-class-specific details
        if self.check_class == "domain_value_check":
            details["distinct_invalid_values"] = self.distinct_invalid
        elif self.check_class == "freshness_check":
            details["oldest_record"] = self.oldest_ts
        elif self.samples:
            details["sample_failing_records"] = self.samples
        
        return {
            "check_id": rule.get("id", "UNKNOWN"),
            "module": rule.get("module", ""),
            "field": rule.get("field", ""),
            "severity": rule.get("severity", "medium"),
            "dimension": rule.get("dimension", ""),
            "passed": passed,
            "affected_count": self.fail_count,
            "total_count": total_rows,
            "pass_rate": pass_rate,
            "message": rule.get("message", ""),
            "details": details,
        }


class AccumulatorMap:
    """Map of check_id -> CheckAccumulator for all checks in an analysis."""
    
    def __init__(self):
        self._accumulators: dict[str, CheckAccumulator] = {}
    
    def get_or_create(self, check_id: str, check_class: str) -> CheckAccumulator:
        """Get existing or create new accumulator."""
        if check_id not in self._accumulators:
            self._accumulators[check_id] = CheckAccumulator(
                check_id=check_id,
                check_class=check_class,
            )
        return self._accumulators[check_id]
    
    def merge(self, chunk_results: list[dict]) -> None:
        """Merge results from a chunk into the accumulators.
        
        Args:
            chunk_results: List of result dicts from run_module_fused for one chunk
        """
        for result in chunk_results:
            check_id = result.get("check_id", "UNKNOWN")
            check_class = result.get("check_class", "")
            
            acc = self.get_or_create(check_id, check_class)
            
            # Update numeric counters
            acc.fail_count += result.get("affected_count", 0)
            acc.denominator += result.get("total_count", 0)
            
            # Check-class-specific fields
            details = result.get("details", {})
            
            if "distinct_invalid_values" in details:
                for val, count in details["distinct_invalid_values"].items():
                    acc.distinct_invalid[val] = acc.distinct_invalid.get(val, 0) + count
            
            if "oldest_ts" in details:
                ts = details["oldest_ts"]
                if ts and (acc.oldest_ts is None or ts < acc.oldest_ts):
                    acc.oldest_ts = ts
            
            if "sample_failing_records" in details:
                remaining = 10 - len(acc.samples)
                if remaining > 0:
                    acc.samples.extend(details["sample_failing_records"][:remaining])
    
    def finalize(self, total_rows: int, rules: list[dict]) -> list[dict]:
        """Convert all accumulators to final result dicts."""
        rule_map = {r.get("id"): r for r in rules}
        results = []
        
        for check_id, acc in self._accumulators.items():
            rule = rule_map.get(check_id, {})
            result = acc.finalize(total_rows, rule)
            results.append(result)
        
        return results


def run_module_chunked(
    parquet_path: str | None = None,
    parquet_bytes: bytes | None = None,
    module_name: str = "",
    rules: list[dict] = None,
    needed_columns: list[str] | None = None,
    id_field: str = "record_id",
    chunk_rows: int = DEFAULT_CHUNK_ROWS,
    cancel_token: CancelToken | None = None,
    sink: "ChunkSink | None" = None,
    progress: ProgressReporter | None = None,
) -> list[dict]:
    """Run checks against a large parquet file using chunked processing.

    Args:
        parquet_path: Path to the parquet file (mutually exclusive with parquet_bytes)
        parquet_bytes: Raw parquet bytes (mutually exclusive with parquet_path)
        module_name: Name of the module for rule loading
        rules: List of rule configurations
        needed_columns: Columns to load per chunk (optimizes I/O)
        id_field: Field to use as record ID for samples
        chunk_rows: Target rows per chunk
        cancel_token: Cancellation token for graceful stop
        sink: ChunkSink for writing record fixes
        progress: Progress reporter

    Returns:
        List of result dicts — one per check
    """
    if rules is None:
        rules = []
    
    if not POLARS_AVAILABLE:
        raise RuntimeError("Polars is required for chunked engine")
    
    # Validate source
    if parquet_path is None and parquet_bytes is None:
        raise ValueError("Either parquet_path or parquet_bytes must be provided")
    
    # Determine columns to load
    if needed_columns is None:
        needed_columns = _get_needed_columns(rules)
    
    # Add ID field to needed columns
    if id_field and id_field not in needed_columns:
        needed_columns.append(id_field)
    
    # Initialize accumulators
    accumulator_map = AccumulatorMap()
    
    # Estimate total rows for progress reporting
    if parquet_path:
        total_rows = _count_rows(parquet_path)
    else:
        total_rows = _count_rows_from_bytes(parquet_bytes)
    
    total_chunks = (total_rows + chunk_rows - 1) // chunk_rows if total_rows > 0 else 0
    
    if progress:
        progress.start(total_rows=total_rows, module=module_name, total_chunks=total_chunks)
    
    # Process chunks
    rows_processed = 0
    chunk_num = 0
    errors = []
    
    try:
        if parquet_path:
            chunks = iter_chunks(parquet_path, needed_columns, chunk_rows)
        else:
            # Write bytes to temp file for streaming
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as f:
                f.write(parquet_bytes)
                temp_path = f.name
            
            try:
                chunks = iter_chunks(temp_path, needed_columns, chunk_rows)
            finally:
                import os
                os.unlink(temp_path)
        
        for chunk in chunks:
            # Check for cancellation before processing
            if cancel_token:
                cancel_token.raise_if_set()
            
            # Process the chunk
            try:
                chunk_results = _process_chunk(
                    chunk,
                    module_name,
                    rules,
                    id_field,
                    cancel_token,
                    sink,
                )
                accumulator_map.merge(chunk_results)
                
            except CancelRequested:
                logger.info("Chunked engine cancelled")
                raise
            except Exception as e:
                logger.error(f"Chunk {chunk_num} failed: {e}", exc_info=True)
                errors.append(f"Chunk {chunk_num}: {str(e)}")
            
            rows_processed += len(chunk)
            chunk_num += 1
            
            # Update progress
            if progress:
                progress.update(
                    rows_done=rows_processed,
                    total_rows=total_rows,
                    chunk_num=chunk_num,
                    total_chunks=total_chunks,
                    errors=errors if errors else None,
                )
            
            # Check for cancellation after processing
            if cancel_token:
                cancel_token.raise_if_set()
            
            # Periodic garbage collection
            if chunk_num % GC_INTERVAL == 0:
                gc.collect()
            
            # Delete chunk reference to free memory
            del chunk
    
    except CancelRequested:
        if progress:
            progress.cancel()
        # Return partial results
        partial_results = accumulator_map.finalize(rows_processed, rules)
        for result in partial_results:
            result["status"] = "cancelled"
            result["rows_processed"] = rows_processed
        return partial_results
    
    # Finalize results
    if progress:
        progress.complete()
    
    results = accumulator_map.finalize(total_rows, rules)
    
    # Flush any remaining data in the sink
    if sink:
        try:
            sink.flush()
        except Exception as e:
            logger.error(f"Failed to flush sink: {e}")
            errors.append(f"Sink flush: {str(e)}")
    
    # Add metadata to results
    for result in results:
        result["chunks_processed"] = chunk_num
        result["total_rows"] = total_rows
        if errors:
            result["chunk_errors"] = errors
    
    return results


def _process_chunk(
    chunk: pl.DataFrame,
    module_name: str,
    rules: list[dict],
    id_field: str,
    cancel_token: CancelToken | None,
    sink: "ChunkSink | None",
) -> list[dict]:
    """Process a single chunk with fused engine."""
    # Build LazyFrame for fused engine
    lf = chunk.lazy()
    
    # Run fused checks on the chunk
    results = run_module_fused(lf, module_name, rules, id_field=id_field)
    
    # Convert CheckResult objects to dicts
    chunk_results = []
    for result in results:
        chunk_results.append({
            "check_id": result.check_id,
            "check_class": _get_check_class(rules, result.check_id),
            "module": result.module,
            "field": result.field,
            "severity": result.severity,
            "dimension": result.dimension,
            "passed": result.passed,
            "affected_count": result.affected_count,
            "total_count": result.total_count,
            "pass_rate": result.pass_rate,
            "message": result.message,
            "details": result.details,
            "error": result.error,
        })
    
    # Flush failing records to sink
    if sink:
        _flush_failing_records(chunk, results, id_field, sink)
    
    return chunk_results


def _get_needed_columns(rules: list[dict]) -> list[str]:
    """Extract all needed columns from rules."""
    cols = set()
    for rule in rules:
        field = rule.get("field")
        if field:
            cols.add(field)
        for f in rule.get("fields", []) or []:
            cols.add(f)
        # Cross-field check references multiple fields
        if rule.get("check_class") == "cross_field_check":
            condition = rule.get("condition", "")
            # Extract simple field references (just alphanumeric identifiers)
            import re
            for match in re.findall(r'[a-zA-Z_][a-zA-Z0-9_]*', condition):
                if match.lower() not in ('and', 'or', 'not', 'true', 'false', 'null'):
                    cols.add(match)
    return list(cols)


def _count_rows(path: str) -> int:
    """Count rows in a parquet file."""
    try:
        import pyarrow.parquet as pq
        pf = pq.ParquetFile(path)
        return pf.metadata.num_rows
    except Exception:
        df = pl.read_parquet(path)
        return len(df)


def _count_rows_from_bytes(data: bytes) -> int:
    """Count rows from raw parquet bytes."""
    try:
        import pyarrow.parquet as pq
        reader = pq.ParquetFile(io.BytesIO(data))
        return reader.metadata.num_rows
    except Exception:
        df = pl.read_parquet(io.BytesIO(data))
        return len(df)


def _get_check_class(rules: list[dict], check_id: str) -> str:
    """Get the check_class for a check_id."""
    for rule in rules:
        if rule.get("id") == check_id:
            return rule.get("check_class", "")
    return ""


def _flush_failing_records(
    chunk: pl.DataFrame,
    results: list[Any],
    id_field: str,
    sink: "ChunkSink",
) -> None:
    """Flush failing records to the chunk sink."""
    from checks.base import CheckResult
    
    records_to_flush = []
    
    for result in results:
        if not isinstance(result, CheckResult):
            continue
        if result.passed or result.error:
            continue
        
        # Get failing records from the chunk
        field = result.field
        if not field or field not in chunk.columns:
            continue
        
        # Get sample of failing records
        try:
            # Find records that fail this check
            failing_mask = _get_fail_mask(chunk, result)
            failing_records = chunk.filter(failing_mask)
            
            # Cap at MAX_RECORDS_PER_CHECK_CHUNK
            sample_records = failing_records.head(MAX_RECORDS_PER_CHECK_CHUNK)
            
            for _, row in sample_records.iter_rows(named=True):
                records_to_flush.append({
                    "check_id": result.check_id,
                    "module": result.module,
                    "record_id": row.get(id_field, "unknown"),
                    "id_field": id_field,
                    "field": field,
                    "invalid_value": str(row.get(field, "")),
                    "severity": result.severity,
                })
        except Exception as e:
            logger.warning(f"Failed to extract failing records for {result.check_id}: {e}")
    
    if records_to_flush:
        try:
            sink.write_batch(records_to_flush)
        except Exception as e:
            logger.error(f"Failed to write to sink: {e}")


def _get_fail_mask(chunk: pl.DataFrame, result: "CheckResult") -> pl.Expr:
    """Get a Polars expression for records that fail a check."""
    field = result.field
    check_class = getattr(result, 'check_class', None)
    
    if check_class == "null_check":
        return pl.col(field).is_null() | (pl.col(field).cast(pl.Utf8) == "")
    elif check_class == "regex_check":
        pattern = result.details.get("pattern", "")
        return ~pl.col(field).cast(pl.Utf8).str.contains(pattern)
    elif check_class == "domain_value_check":
        allowed = result.details.get("allowed_values", [])
        return ~pl.col(field).cast(pl.Utf8).is_in(allowed)
    else:
        return pl.lit(True)  # Conservative: include all records


# ChunkSink import handled at runtime to avoid circular imports
ChunkSink = Any