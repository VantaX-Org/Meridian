"""Shared Celery task time limits.

Pulled out of ``run_extraction.py`` so modules that only need the limit
(not the task itself) can import it without pulling in ``run_extraction``'s
module, which registers a Celery task via ``workers.celery_app`` — the
import that caused ``run_extraction`` <-> ``run_sync`` to be circular
(``celery_app`` imports ``run_sync``, which imported ``run_extraction`` at
module level for both the task function and this constant).
"""

import os

# A full live read of a large object takes hours over RFC_READ_TABLE.
EXTRACT_TIME_LIMIT = int(os.getenv("MERIDIAN_EXTRACT_TIME_LIMIT", "21600"))
