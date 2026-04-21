"""Parquet reader with column pruning and row-group streaming.

Provides utilities for reading parquet files with:
- Column pruning (only load needed columns)
- Row-group iteration for chunked processing
- Schema introspection for validation

Usage:
    from checks.parquet_reader import ParquetReader, iter_chunks
    
    reader = ParquetReader("path/to/data.parquet")
    df = reader.read(columns=["PARTNER", "BU_TYPE"])
    
    for chunk in iter_chunks("path/to/data.parquet", needed_columns, chunk_rows=50000):
        process(chunk)
"""

from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import Iterator, NamedTuple

try:
    import polars as pl
    import pyarrow.parquet as pq

    PYARROW_AVAILABLE = True
except ImportError:
    pl = None  # type: ignore[assignment]
    pq = None
    PYARROW_AVAILABLE = False

logger = logging.getLogger("meridian.checks.parquet_reader")


class ParquetStats(NamedTuple):
    """Statistics about a parquet file."""
    path: str
    row_count: int
    column_count: int
    row_groups: int
    size_bytes: int
    columns: list[str]
    estimated_size_mb: float


class ParquetReader:
    """Efficient parquet reader with column pruning."""
    
    def __init__(self, path: str | Path):
        self.path = Path(path)
        if not self.path.exists():
            raise FileNotFoundError(f"Parquet file not found: {self.path}")
    
    def get_stats(self) -> ParquetStats:
        """Get statistics about the parquet file."""
        try:
            import os
            size_bytes = self.path.stat().st_size
            schema = pl.read_schema(self.path)
            columns = list(schema.keys())
            
            # Get row count and row groups from pyarrow
            if PYARROW_AVAILABLE:
                pf = pq.ParquetFile(str(self.path))
                row_count = pf.metadata.num_rows
                row_groups = pf.num_row_groups
            else:
                # Fallback: read and count
                df = pl.read_parquet(self.path)
                row_count = len(df)
                row_groups = 1
            
            return ParquetStats(
                path=str(self.path),
                row_count=row_count,
                column_count=len(columns),
                row_groups=row_groups,
                size_bytes=size_bytes,
                columns=columns,
                estimated_size_mb=size_bytes / (1024 * 1024),
            )
        except Exception as e:
            logger.error(f"Failed to get parquet stats: {e}")
            raise
    
    def get_schema(self) -> dict[str, str]:
        """Get column names and types."""
        return dict(pl.read_schema(self.path))
    
    def read(
        self,
        columns: list[str] | None = None,
        row_offset: int = 0,
        row_limit: int | None = None,
    ) -> pl.DataFrame:
        """Read parquet with optional column pruning.
        
        Args:
            columns: List of column names to load. If None, load all.
            row_offset: Number of rows to skip
            row_limit: Maximum rows to read
        
        Returns:
            Polars DataFrame
        """
        try:
            if columns:
                # Prune columns — significantly faster for wide tables
                projection = [c for c in columns if c in self.get_schema()]
                if projection:
                    df = pl.read_parquet(
                        self.path,
                        columns=projection,
                        n_rows=row_limit,
                        row_index_name="_row_idx",
                    )
                    if row_offset > 0:
                        df = df.filter(pl.col("_row_idx") >= row_offset)
                    return df.drop("_row_idx")
            
            df = pl.read_parquet(self.path, n_rows=row_limit)
            if row_offset > 0:
                df = df.slice(row_offset, row_limit or None)
            return df
        except Exception as e:
            logger.error(f"Failed to read parquet: {e}", exc_info=True)
            raise
    
    def read_lazy(
        self,
        columns: list[str] | None = None,
    ) -> pl.LazyFrame:
        """Read as a lazy frame for streaming operations."""
        if columns:
            valid_cols = [c for c in columns if c in self.get_schema()]
            if valid_cols:
                return pl.scan_parquet(self.path, columns=valid_cols)
        return pl.scan_parquet(self.path)


def iter_chunks(
    parquet_path: str,
    needed_columns: list[str],
    chunk_rows: int = 50000,
) -> Iterator[pl.DataFrame]:
    """Iterate over parquet file in row-group chunks.
    
    Yields DataFrames with only the needed columns to minimize memory.
    
    Args:
        parquet_path: Path to the parquet file
        needed_columns: List of columns to load per chunk
        chunk_rows: Target rows per chunk
    
    Yields:
        Polars DataFrame chunks
    """
    if not PYARROW_AVAILABLE:
        # Fallback: read whole file and yield in slices
        lf = pl.scan_parquet(parquet_path)
        # Prune columns
        valid_cols = [c for c in needed_columns if c in lf.columns]
        lf = lf.select(valid_cols) if valid_cols else lf
        
        offset = 0
        while True:
            chunk = lf.fetch(chunk_rows)
            if chunk.is_empty():
                break
            yield chunk
            offset += len(chunk)
            if len(chunk) < chunk_rows:
                break
        return
    
    pf = pq.ParquetFile(parquet_path)
    total_rows = pf.metadata.num_rows
    
    # Validate and filter columns
    parquet_schema = pf.schema_arrow
    available_cols = {f.name for f in parquet_schema}
    valid_cols = [c for c in needed_columns if c in available_cols]
    
    # Calculate chunks based on row groups and target chunk size
    # Use row groups as the natural chunk boundary
    num_row_groups = pf.num_row_groups
    
    for rg_idx in range(num_row_groups):
        rg = pf.metadata.row_group(rg_idx)
        rows_in_rg = rg.num_rows
        
        # For large row groups, split further
        if rows_in_rg > chunk_rows * 2:
            # Split by rows within the row group
            for start in range(0, rows_in_rg, chunk_rows):
                end = min(start + chunk_rows, rows_in_rg)
                table = pf.read_row_group(
                    rg_idx,
                    columns=valid_cols,
                    row_start=start,
                    row_count=end - start,
                )
                yield pl.from_arrow(table)
        else:
            table = pf.read_row_group(rg_idx, columns=valid_cols)
            yield pl.from_arrow(table)


def read_parquet_streaming(
    parquet_path: str,
    needed_columns: list[str],
    batch_size: int = 10000,
) -> Iterator[pl.DataFrame]:
    """Stream parquet in batches using PyArrow.
    
    Lower-level API than iter_chunks — yields raw batches.
    """
    if not PYARROW_AVAILABLE:
        raise RuntimeError("PyArrow is required for streaming reads")
    
    pf = pq.ParquetFile(parquet_path)
    valid_cols = [c for c in needed_columns if c in pf.schema_arrow.names]
    
    for batch in pf.iter_batches(columns=valid_cols, batch_size=batch_size):
        yield pl.from_arrow(batch)


def validate_parquet(path: str | Path, required_columns: list[str] | None = None) -> tuple[bool, str]:
    """Validate a parquet file for analysis.
    
    Args:
        path: Path to parquet file
        required_columns: Optional list of columns that must be present
    
    Returns:
        (is_valid, error_message)
    """
    path = Path(path)
    if not path.exists():
        return False, f"File not found: {path}"
    
    try:
        schema = pl.read_schema(path)
        available = set(schema.keys())
        
        if required_columns:
            missing = [c for c in required_columns if c not in available]
            if missing:
                return False, f"Missing required columns: {missing}"
        
        # Check for corrupted data
        try:
            sample = pl.read_parquet(path, n_rows=10)
        except Exception as e:
            return False, f"Corrupt parquet file: {e}"
        
        return True, ""
    
    except Exception as e:
        return False, str(e)


def estimate_chunk_count(path: str | Path, chunk_rows: int) -> int:
    """Estimate number of chunks for a parquet file."""
    path = Path(path)
    try:
        pf = pq.ParquetFile(path)
        total_rows = pf.metadata.num_rows
        return (total_rows + chunk_rows - 1) // chunk_rows
    except Exception:
        # Fallback: read and count
        df = pl.read_parquet(path)
        return (len(df) + chunk_rows - 1) // chunk_rows