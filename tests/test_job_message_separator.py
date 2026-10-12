"""Job messages must not carry U+00B7; the separator is a plain ASCII pipe."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ["workers/tasks/run_checks.py", "api/routes/versions.py", "api/routes/simulation.py"]
DOT = chr(0xB7)


def test_job_message_sources_have_no_middle_dot():
    for rel in FILES:
        src = (ROOT / rel).read_text(encoding="utf-8")
        assert DOT not in src, rel
        assert "\\u00b7" not in src.lower(), rel
