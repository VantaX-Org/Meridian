"""Progress reporter for long-running analyses.

Provides progress tracking and reporting for chunked engine operations.
Integrates with Celery task progress and SSE events.

Usage:
    from checks.progress import ProgressReporter
    
    reporter = ProgressReporter("version_123")
    reporter.start(total_rows=400000, module="business_partner")
    
    for i, chunk in enumerate(chunks):
        process(chunk)
        reporter.update(rows_done=i * chunk_size, total_rows=400000)
    
    reporter.complete()
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

logger = logging.getLogger("meridian.checks.progress")


@dataclass
class ProgressState:
    """Current state of a progress report."""
    version_id: str
    module: str
    total_rows: int
    rows_done: int
    chunks_done: int
    total_chunks: int
    start_time: float
    end_time: Optional[float] = None
    errors: list[str] = field(default_factory=list)
    status: str = "running"  # running, completed, cancelled, error
    
    @property
    def percent(self) -> float:
        if self.total_rows == 0:
            return 0.0
        return round(self.rows_done / self.total_rows * 100, 2)
    
    @property
    def elapsed_seconds(self) -> float:
        end = self.end_time or time.time()
        return round(end - self.start_time, 1)
    
    @property
    def rows_per_second(self) -> float:
        elapsed = self.elapsed_seconds
        if elapsed == 0:
            return 0.0
        return round(self.rows_done / elapsed, 1)
    
    @property
    def eta_seconds(self) -> Optional[float]:
        rps = self.rows_per_second
        if rps == 0:
            return None
        remaining = self.total_rows - self.rows_done
        return round(remaining / rps, 1)


class ProgressReporter:
    """Progress reporter for analysis operations.
    
    Tracks progress through a multi-step analysis and provides
    callbacks for UI updates, SSE events, and Celery task states.
    """
    
    def __init__(
        self,
        version_id: str,
        on_progress: Callable[[ProgressState], None] | None = None,
        on_complete: Callable[[ProgressState], None] | None = None,
        on_error: Callable[[ProgressState, Exception], None] | None = None,
        emit_interval: float = 2.0,
    ):
        """Initialize a progress reporter.
        
        Args:
            version_id: Unique identifier for this analysis
            on_progress: Callback invoked periodically with progress updates
            on_complete: Callback invoked when analysis completes
            on_error: Callback invoked when analysis fails
            emit_interval: Minimum seconds between progress callbacks
        """
        self.version_id = version_id
        self._on_progress = on_progress
        self._on_complete = on_complete
        self._on_error = on_error
        self._emit_interval = emit_interval
        self._state: Optional[ProgressState] = None
        self._last_emit = 0.0
        self._done = False
    
    def start(
        self,
        total_rows: int,
        module: str,
        total_chunks: int = 0,
    ) -> None:
        """Mark the start of an analysis.
        
        Args:
            total_rows: Total rows to process
            module: Module name being analyzed
            total_chunks: Total number of chunks (0 = unknown)
        """
        self._state = ProgressState(
            version_id=self.version_id,
            module=module,
            total_rows=total_rows,
            rows_done=0,
            chunks_done=0,
            total_chunks=total_chunks,
            start_time=time.time(),
            status="running",
        )
        logger.info(
            f"Progress started: {module}, {total_rows:,} rows, "
            f"{total_chunks} chunks"
        )
    
    def update(
        self,
        rows_done: int,
        total_rows: int | None = None,
        chunk_num: int | None = None,
        total_chunks: int | None = None,
        errors: list[str] | None = None,
    ) -> None:
        """Update progress state.
        
        Args:
            rows_done: Number of rows processed so far
            total_rows: Updated total rows (if changed)
            chunk_num: Current chunk number
            total_chunks: Updated total chunks
            errors: List of errors encountered
        """
        if self._state is None:
            return
        
        self._state.rows_done = rows_done
        if total_rows is not None:
            self._state.total_rows = total_rows
        if chunk_num is not None:
            self._state.chunks_done = chunk_num
        if total_chunks is not None:
            self._state.total_chunks = total_chunks
        if errors is not None:
            self._state.errors = errors
        
        # Rate-limit emissions
        now = time.time()
        if now - self._last_emit >= self._emit_interval:
            self._emit_progress()
            self._last_emit = now
    
    def _emit_progress(self) -> None:
        """Emit progress to callback."""
        if self._state and self._on_progress and not self._done:
            try:
                self._on_progress(self._state)
            except Exception as e:
                logger.warning(f"Progress callback error: {e}")
    
    def chunk_complete(self, rows_in_chunk: int) -> None:
        """Mark a chunk as complete.
        
        Args:
            rows_in_chunk: Number of rows in the completed chunk
        """
        if self._state:
            self._state.rows_done += rows_in_chunk
            self._state.chunks_done += 1
            self._emit_progress()
    
    def complete(self) -> ProgressState:
        """Mark analysis as complete.
        
        Returns:
            Final progress state
        """
        if self._state:
            self._state.end_time = time.time()
            self._state.status = "completed"
            logger.info(
                f"Progress complete: {self._state.chunks_done} chunks, "
                f"{self._state.rows_done:,} rows, "
                f"{self._state.elapsed_seconds}s"
            )
            if self._on_complete:
                try:
                    self._on_complete(self._state)
                except Exception as e:
                    logger.warning(f"Complete callback error: {e}")
        self._done = True
        return self._state or ProgressState(
            version_id=self.version_id,
            module="",
            total_rows=0,
            rows_done=0,
            chunks_done=0,
            total_chunks=0,
            start_time=time.time(),
            end_time=time.time(),
            status="completed",
        )
    
    def fail(self, error: str) -> ProgressState:
        """Mark analysis as failed.
        
        Args:
            error: Error message
        
        Returns:
            Final progress state
        """
        if self._state:
            self._state.end_time = time.time()
            self._state.status = "error"
            self._state.errors.append(error)
            logger.error(f"Progress failed: {error}")
            if self._on_error:
                try:
                    self._on_error(self._state, Exception(error))
                except Exception as e:
                    logger.warning(f"Error callback error: {e}")
        self._done = True
        return self._state or ProgressState(
            version_id=self.version_id,
            module="",
            total_rows=0,
            rows_done=0,
            chunks_done=0,
            total_chunks=0,
            start_time=time.time(),
            end_time=time.time(),
            status="error",
            errors=[error],
        )
    
    def cancel(self) -> ProgressState:
        """Mark analysis as cancelled.
        
        Returns:
            Final progress state
        """
        if self._state:
            self._state.end_time = time.time()
            self._state.status = "cancelled"
            logger.info("Progress cancelled")
        self._done = True
        return self._state or ProgressState(
            version_id=self.version_id,
            module="",
            total_rows=0,
            rows_done=0,
            chunks_done=0,
            total_chunks=0,
            start_time=time.time(),
            end_time=time.time(),
            status="cancelled",
        )
    
    @property
    def state(self) -> Optional[ProgressState]:
        """Get current progress state."""
        return self._state
    
    def to_dict(self) -> dict:
        """Convert state to dict for JSON serialization."""
        if not self._state:
            return {"status": "unknown", "version_id": self.version_id}
        
        return {
            "version_id": self._state.version_id,
            "module": self._state.module,
            "total_rows": self._state.total_rows,
            "rows_done": self._state.rows_done,
            "chunks_done": self._state.chunks_done,
            "total_chunks": self._state.total_chunks,
            "percent": self._state.percent,
            "elapsed_seconds": self._state.elapsed_seconds,
            "rows_per_second": self._state.rows_per_second,
            "eta_seconds": self._state.eta_seconds,
            "status": self._state.status,
            "errors": self._state.errors,
        }


class NoOpProgressReporter(ProgressReporter):
    """A progress reporter that does nothing — for testing or when no reporting is needed."""
    
    def __init__(self, version_id: str = ""):
        super().__init__(version_id)
    
    def start(self, total_rows: int, module: str, total_chunks: int = 0) -> None:
        pass
    
    def update(self, rows_done: int, total_rows: int | None = None, chunk_num: int | None = None, total_chunks: int | None = None, errors: list[str] | None = None) -> None:
        pass
    
    def chunk_complete(self, rows_in_chunk: int) -> None:
        pass
    
    def complete(self) -> ProgressState:
        return ProgressState(
            version_id=self.version_id,
            module="",
            total_rows=0,
            rows_done=0,
            chunks_done=0,
            total_chunks=0,
            start_time=time.time(),
            end_time=time.time(),
            status="completed",
        )