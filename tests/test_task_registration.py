"""Every Celery task must actually be a task.

A helper function inserted between `@celery_app.task(...)` and the function it decorates silently
binds the decorator to the helper. The decorated function then becomes a plain function: no error
at import, no error in the tests that call it directly, and the failure only appears at runtime as

    AttributeError: 'function' object has no attribute 'delay'

which is how a deployed build shipped with extraction unable to start at all.
"""

import pytest

from workers.celery_app import celery_app

# tasks whose registration matters to the product, not only to a test
CRITICAL = [
    "workers.tasks.run_extraction.run_extraction",
    "workers.tasks.run_checks.run_checks",
    "workers.tasks.run_agents.run_agents",
]


@pytest.mark.parametrize("name", CRITICAL)
def test_the_task_is_registered_under_its_documented_name(name: str) -> None:
    assert name in celery_app.tasks, (
        f"{name} is not registered. A decorator bound to the wrong object does this silently - "
        f"check that @celery_app.task sits immediately above its function."
    )


def test_run_extraction_is_dispatchable() -> None:
    from workers.tasks.run_extraction import run_extraction

    assert hasattr(run_extraction, "delay"), (
        "run_extraction has no .delay: the task decorator is bound to something else, so no "
        "extraction can ever be queued"
    )
    assert run_extraction.name == "workers.tasks.run_extraction.run_extraction"


def test_the_version_lock_helper_is_not_the_task() -> None:
    """The exact mistake: the helper must not carry the task decorator."""
    from workers.tasks.run_extraction import _acquire_version_lock

    assert not hasattr(_acquire_version_lock, "delay")
