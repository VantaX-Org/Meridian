"""Regression: workers.tasks.run_extraction must import standalone.

run_extraction imports workers.celery_app, which (to register every task)
imports workers.tasks.run_sync, which used to import run_extraction back at
module level — a cycle that only broke when run_extraction was the FIRST of
the two to be imported, since Python then finds it partially initialised.
Each case runs in its own fresh interpreter so no other test's import order
can hide the regression.
"""

import subprocess
import sys


def _import_in_fresh_interpreter(module: str) -> None:
    subprocess.run([sys.executable, "-c", f"import {module}"], check=True)


def test_run_extraction_imports_first_in_fresh_interpreter():
    _import_in_fresh_interpreter("workers.tasks.run_extraction")


def test_run_sync_imports_first_in_fresh_interpreter():
    _import_in_fresh_interpreter("workers.tasks.run_sync")


if __name__ == "__main__":
    test_run_extraction_imports_first_in_fresh_interpreter()
    test_run_sync_imports_first_in_fresh_interpreter()
    print("ok")
