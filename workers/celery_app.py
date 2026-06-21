import os

from celery import Celery

broker_url = os.getenv("REDIS_URL", "redis://redis:6379/0")

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
import workers.tasks.run_migration  # noqa: F401 — source→source/destination migration mode
import workers.scheduler  # noqa: F401, E402 — registers beat schedule


