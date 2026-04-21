"""ChunkSink — buffered writer for record-level fixes.

Buffers up to 10,000 RecordFix rows in memory, flushes via COPY FROM STDIN
at buffer-full or end-of-chunk. Per-chunk transaction. Per-check caps
(500 per chunk, 5,000 per analysis total) prevent pathological checks
from writing 360k rows.

Usage:
    from db.chunk_sink import ChunkSink
    
    sink = ChunkSink(tenant_id, version_id, session)
    
    # In chunked engine loop:
    sink.write_batch(failing_records)  # auto-flushes at 10k
    
    # At end:
    sink.flush()  # Final flush
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("meridian.db.chunk_sink")

# Buffer thresholds
DEFAULT_BUFFER_SIZE = 10000
MAX_RECORDS_PER_CHECK_CHUNK = 500
MAX_RECORDS_PER_CHECK_TOTAL = 5000


@dataclass
class RecordFix:
    """A single record that failed a check and needs fixing."""
    check_id: str
    module: str
    record_id: str
    id_field: str
    field: str
    invalid_value: str
    suggested_value: Optional[str] = None
    fix_instruction: Optional[str] = None
    sql_statement: Optional[str] = None
    severity: str = "medium"
    status: str = "open"
    assigned_to: Optional[str] = None


class ChunkSink:
    """Buffered writer for record-level fixes.
    
    Accumulates record fixes in memory and flushes in batches using
    PostgreSQL COPY for high throughput.
    """
    
    def __init__(
        self,
        tenant_id: str,
        version_id: str,
        session: Session,
        buffer_size: int = DEFAULT_BUFFER_SIZE,
        check_cap_per_chunk: int = MAX_RECORDS_PER_CHECK_CHUNK,
        check_cap_total: int = MAX_RECORDS_PER_CHECK_TOTAL,
    ):
        """Initialize the chunk sink.
        
        Args:
            tenant_id: Tenant ID for RLS
            version_id: Analysis version ID
            session: SQLAlchemy session
            buffer_size: Auto-flush threshold
            check_cap_per_chunk: Max records per check per chunk
            check_cap_total: Max records per check across entire analysis
        """
        self.tenant_id = tenant_id
        self.version_id = version_id
        self.session = session
        self.buffer_size = buffer_size
        self.check_cap_per_chunk = check_cap_per_chunk
        self.check_cap_total = check_cap_total
        
        self._buffer: list[dict] = []
        self._check_counts: dict[str, int] = {}  # track per-check totals
    
    def write_batch(self, records: list[dict]) -> None:
        """Write a batch of records, respecting caps.
        
        Args:
            records: List of record fix dicts
        """
        # Apply per-check caps
        capped_records = self._apply_caps(records)
        
        self._buffer.extend(capped_records)
        
        # Auto-flush if buffer is full
        if len(self._buffer) >= self.buffer_size:
            self.flush()
    
    def _apply_caps(self, records: list[dict]) -> list[dict]:
        """Apply per-check caps to prevent pathological writes.
        
        Args:
            records: Raw records from chunk
        
        Returns:
            Filtered records respecting caps
        """
        filtered = []
        
        for record in records:
            check_id = record.get("check_id", "unknown")
            
            # Check total cap
            total_count = self._check_counts.get(check_id, 0)
            if total_count >= self.check_cap_total:
                continue
            
            # Check chunk cap
            remaining_in_chunk = self.check_cap_per_chunk - len([
                r for r in filtered if r.get("check_id") == check_id
            ])
            remaining_total = self.check_cap_total - total_count
            
            cap = min(remaining_in_chunk, remaining_total)
            if cap <= 0:
                continue
            
            filtered.append(record)
            
            # Update counters
            self._check_counts[check_id] = total_count + 1
        
        return filtered
    
    def flush(self) -> int:
        """Flush buffered records to the database.
        
        Returns:
            Number of records flushed
        """
        if not self._buffer:
            return 0
        
        records_to_flush = self._buffer
        self._buffer = []
        
        try:
            count = self._copy_records(records_to_flush)
            logger.info(f"ChunkSink flushed {count} record fixes")
            return count
        except Exception as e:
            logger.error(f"ChunkSink flush failed: {e}", exc_info=True)
            # Re-add to buffer for retry
            self._buffer = records_to_flush + self._buffer
            raise
    
    def _copy_records(self, records: list[dict]) -> int:
        """COPY records to the record_fixes table."""
        if not records:
            return 0
        
        # Set RLS context
        self.session.execute(
            text("SET LOCAL app.tenant_id = :tenant_id"),
            {"tenant_id": self.tenant_id}
        )
        
        # Build COPY data
        import io
        buffer = io.StringIO()
        
        columns = [
            "version_id", "tenant_id", "check_id", "module",
            "record_id", "id_field", "field", "invalid_value",
            "suggested_value", "fix_instruction", "sql_statement",
            "severity", "status",
        ]
        
        for record in records:
            values = []
            for col in columns:
                val = record.get(col)
                if val is None:
                    values.append("\\N")
                elif isinstance(val, bool):
                    values.append("true" if val else "false")
                else:
                    values.append(self._escape_text(str(val)))
            buffer.write("\t".join(values) + "\n")
        
        buffer.seek(0)
        
        # Execute COPY
        columns_str = ", ".join(columns)
        copy_sql = f"COPY record_fixes ({columns_str}) FROM STDIN (FORMAT text, NULL '\\N')"
        
        try:
            with self.session.connection().connection.cursor() as cur:
                cur.copy_expert(copy_sql, buffer)
        except Exception as e:
            logger.error(f"COPY to record_fixes failed: {e}")
            raise
        
        return len(records)
    
    def _escape_text(self, value: str) -> str:
        """Escape text for COPY."""
        return (
            value.replace("\\", "\\\\")
            .replace("\t", "\\t")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
        )
    
    @property
    def buffer_size(self) -> int:
        """Current number of records in buffer."""
        return len(self._buffer)
    
    @property
    def check_counts(self) -> dict[str, int]:
        """Per-check record counts."""
        return dict(self._check_counts)
    
    def __enter__(self) -> "ChunkSink":
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.flush()


class MultiChunkSink:
    """Wrapper for handling multiple module sinks.
    
    Creates and manages ChunkSink instances for each module being analyzed.
    """
    
    def __init__(
        self,
        tenant_id: str,
        version_id: str,
        session: Session,
        buffer_size: int = DEFAULT_BUFFER_SIZE,
    ):
        self.tenant_id = tenant_id
        self.version_id = version_id
        self.session = session
        self.buffer_size = buffer_size
        self._sinks: dict[str, ChunkSink] = {}
    
    def get_sink(self, module: str) -> ChunkSink:
        """Get or create a sink for a module."""
        if module not in self._sinks:
            self._sinks[module] = ChunkSink(
                tenant_id=self.tenant_id,
                version_id=self.version_id,
                session=self.session,
                buffer_size=self.buffer_size,
            )
        return self._sinks[module]
    
    def flush_all(self) -> dict[str, int]:
        """Flush all module sinks.
        
        Returns:
            Dict of module -> count flushed
        """
        results = {}
        for module, sink in self._sinks.items():
            try:
                count = sink.flush()
                results[module] = count
            except Exception as e:
                logger.error(f"Failed to flush sink for module {module}: {e}")
                results[module] = 0
        return results
    
    def __enter__(self) -> "MultiChunkSink":
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.flush_all()