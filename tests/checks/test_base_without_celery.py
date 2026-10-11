import subprocess
import sys

CODE = """
import sys
sys.modules['celery'] = None
sys.modules['celery.exceptions'] = None
from checks.base import reraise_soft_limit
import checks.runner
reraise_soft_limit(ValueError('x'))  # no-op without celery
print('ok')
"""


def test_checks_import_without_celery() -> None:
    r = subprocess.run([sys.executable, "-c", CODE], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "ok" in r.stdout
