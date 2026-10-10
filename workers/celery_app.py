import os

from celery import Celery

broker_url = os.getenv("REDIS_URL", "redis://redis:6379/0")

# Extraction task time limit (run_extraction, run_sync): a full live read of a
# large object takes hours over RFC_READ_TABLE. Lives here so task modules can
# read it without importing each other.
EXTRACT_TIME_LIMIT = int(os.getenv("MERIDIAN_EXTRACT_TIME_LIMIT", "21600"))

celery_app = Celery(
    "meridian",
    broker=broker_url,
    backend=broker_url,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Africa/Johannesburg",
    enable_utc=True,
    task_always_eager=False,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=1800,   # 30 minutes — raises SoftTimeLimitExceeded
    task_hard_time_limit=2100,   # 35 minutes — kills the task
    # acks_late tasks unacked past the visibility timeout (Redis default 1 h) are
    # redelivered while still running; keep it above the longest task (extraction).
    broker_transport_options={"visibility_timeout": EXTRACT_TIME_LIMIT + 3600},
)

# Auto-discover tasks in workers/tasks/
celery_app.autodiscover_tasks(["workers.tasks"])

# Explicit imports for task registration
import workers.tasks.run_checks  # noqa: F401, E402
import workers.tasks.run_agents  # noqa: F401, E402
import workers.tasks.generate_pdf  # noqa: F401, E402
import workers.tasks.send_notifications  # noqa: F401, E402
import workers.tasks.send_user_invitation  # noqa: F401, E402
import workers.tasks.send_password_reset  # noqa: F401, E402
import workers.tasks.run_cleaning  # noqa: F401
import workers.tasks.evaluate_contracts  # noqa: F401
import workers.tasks.run_exception_scan  # noqa: F401
import workers.tasks.run_sync  # noqa: F401
import workers.tasks.rule_proposal_task  # noqa: F401
import workers.tasks.ai_triage  # noqa: F401
import workers.tasks.populate_stewardship_queue  # noqa: F401
import workers.tasks.snapshot_mdm_metrics  # noqa: F401
import workers.tasks.ai_health_narrative  # noqa: F401
import workers.tasks.ai_enrich_report  # noqa: F401
import workers.tasks.mining.orchestrator  # noqa: F401 — registers dedup/anomaly/relationship + mining
import workers.tasks.build_golden_records  # noqa: F401
import workers.tasks.run_migration  # noqa: F401 — source→source/dest migration
import workers.tasks.run_extraction  # noqa: F401 — live SAP extraction → checks
import workers.tasks.run_config_sync  # noqa: F401 — SPRO/FO config sync
import workers.tasks.run_load_config  # noqa: F401 — read-only config snapshot + flow derivation
import workers.tasks.run_health_check  # noqa: F401 — scheduled connection health
import workers.tasks.run_discovery  # noqa: F401 — source-system design discovery
import workers.tasks.run_config_intelligence  # noqa: F401 — config + Z-object intelligence per version
import workers.tasks.revalidate_licence  # noqa: F401
import workers.tasks.triage_sla  # noqa: F401 — SLA sweep + auto-assign
import workers.tasks.forced_update  # noqa: F401
import workers.tasks.run_simulation  # noqa: F401 — fix what-if on a copy of the frames
import workers.tasks.send_owner_digests  # noqa: F401 — weekly owner digest (beat)
import workers.scheduler  # noqa: F401, E402 — registers beat schedule


