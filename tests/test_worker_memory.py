"""A worker must not carry one task's frames into the next.

Observed on the deployment: after a failed material_master extraction the worker held 16.88 GB
with zero active tasks, leaving 11 GB available on a 30 GB box. The next MARC read then saw an
"available" figure reduced by the previous attempt's garbage - which is what made the memory guard
trip on memory nothing was using.
"""

from workers.celery_app import celery_app


def test_the_worker_recycles_its_child_after_each_task():
    assert celery_app.conf.worker_max_tasks_per_child == 1, (
        "without recycling, a failed extraction's frames stay resident and starve the next run"
    )
